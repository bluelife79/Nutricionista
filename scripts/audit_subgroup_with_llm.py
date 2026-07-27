#!/usr/bin/env python3
"""Audit LLM de subgroup faltante o "other" → propone subgroup correcto.

Audita 775 foods con subgroup ∈ {None, "other"} usando GLM-5-Turbo.
Por cada food envía: name, category, macros y opciones de subgroup
válidas para esa category. LLM responde con subgroup + confidence + reason.

Output:
  scripts/audit_subgroup_report.csv — todos los verdicts con before/after
  scripts/audit_subgroup_summary.csv — solo los que cambian con confidence>=70

Uso:
    python scripts/audit_subgroup_with_llm.py --dry-run          # solo reporte
    python scripts/audit_subgroup_with_llm.py --apply            # aplica fixes confidence>=70
    python scripts/audit_subgroup_with_llm.py --apply --threshold 80   # más conservador
"""
from __future__ import annotations
import argparse
import asyncio
import csv
import json
import os
import re
import shutil
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
DB_PATH = ROOT / "database.json"
REPORT_PATH = ROOT / "scripts" / "audit_subgroup_report.csv"
SUMMARY_PATH = ROOT / "scripts" / "audit_subgroup_summary.csv"

load_dotenv(ROOT / ".env")
load_dotenv(ROOT / ".env.local", override=True)

ENDPOINT = os.getenv("BULK_LABEL_ENDPOINT", "https://api.z.ai/api/coding/paas/v4/chat/completions")
MODEL = os.getenv("BULK_LABEL_MODEL", "glm-5-turbo")
TEMPERATURE = float(os.getenv("BULK_LABEL_TEMPERATURE", "0.1"))
HTTP_TIMEOUT_S = float(os.getenv("BULK_LABEL_HTTP_TIMEOUT_S", "60"))
INTER_BATCH_DELAY_S = float(os.getenv("BULK_LABEL_INTER_BATCH_DELAY_S", "0.5"))
BATCH_SIZE = int(os.getenv("AUDIT_BATCH_SIZE", "25"))
API_KEY = os.getenv("GLM_API_KEY", "") or os.getenv("ZAI_API_KEY", "")

# Subgroups válidos por category (extraídos de combinaciones reales en database.json).
# Permisivo intencionalmente — la BD existente tiene crossovers (ej. legumes en cat:carbs).
VALID_SUBGROUPS = {
    "protein": ["meat", "fish", "eggs", "legumes", "processed_protein", "other_protein", "tofu_seitan"],
    "carbs":   ["grains", "tubers", "legumes", "vegetables", "fruit", "nuts_seeds",
                "other_carbs", "sweets_bakery", "basic_dairy", "fresh_cheese"],
    "fat":     ["olive_oil", "other_oils", "nuts_seeds", "avocado", "butter_margarine",
                "other_fat", "fish", "meat", "sweets_bakery"],
    "dairy":   ["basic_dairy", "low_fat_dairy", "whole_dairy", "high_protein_dairy",
                "fresh_cheese", "aged_cheese", "cheese", "other_dairy", "fruit", "sweets_bakery"],
    "fruits":  ["fruit", "tropical", "frutos_bosque", "nuts_seeds"],
    "postres_proteicos": ["high_protein_dairy", "basic_dairy", "low_fat_dairy", "fresh_cheese", "fruit", "sweets_bakery"],
    "other":   ["vegetables", "fruit", "other", "other_carbs", "sweets_bakery"],
}

SYSTEM_PROMPT = """\
Eres un experto en clasificación de alimentos según taxonomía nutricional
española. Tu tarea: dado el nombre, categoría y macros de un alimento,
determinar el subgroup más adecuado de las opciones permitidas.

Reglas:
1. SOLO usa subgroups de la lista permitida que recibes para cada food.
2. Si dudas entre 2 opciones, elige la más común en dieta española.
3. Si el alimento no encaja claramente en ningún subgroup permitido,
   responde "other" (si es opción) y confidence < 60.
4. confidence: 90-100 = obvio; 70-89 = razonablemente seguro; <70 = duda.
5. reason: máximo 12 palabras explicando la decisión.

Devuelve EXCLUSIVAMENTE un array JSON con esta forma exacta:
[
  {"id": "<id>", "subgroup": "<opcion>", "confidence": <0-100>, "reason": "<máx 12 palabras>"},
  ...
]
Sin texto antes ni después. Sin markdown.\
"""


def build_user_message(batch: list[dict]) -> str:
    items = []
    for f in batch:
        cat = f.get("category", "other")
        opts = VALID_SUBGROUPS.get(cat, ["other"])
        items.append({
            "id": f["id"],
            "name": f.get("name", ""),
            "category": cat,
            "subgroup_actual": f.get("subgroup"),
            "macros_per_100g": {
                "protein": f.get("protein"),
                "carbs": f.get("carbs"),
                "fat": f.get("fat"),
                "calories": f.get("calories"),
            },
            "subgroup_options": opts,
        })
    return (
        f"Clasifica los {len(batch)} alimentos siguientes. Para cada uno, elige el "
        f"subgroup más apropiado de su lista de opciones (campo 'subgroup_options').\n\n"
        f"{json.dumps(items, ensure_ascii=False, indent=2)}"
    )


@dataclass
class Verdict:
    id: str
    subgroup: str
    confidence: int
    reason: str


@dataclass
class BatchResult:
    verdicts: list[Verdict]
    failed_ids: list[str] = field(default_factory=list)
    error: str | None = None


async def call_glm(batch: list[dict], session: httpx.AsyncClient) -> str:
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_user_message(batch)},
        ],
        "temperature": TEMPERATURE,
        "thinking": {"type": "disabled"},
        "max_tokens": 4096,
    }
    headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}
    resp = await session.post(ENDPOINT, json=payload, headers=headers, timeout=HTTP_TIMEOUT_S)
    resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]


def parse_response(text: str, batch: list[dict]) -> BatchResult:
    batch_ids = {f["id"] for f in batch}
    parsed = None
    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        m = re.search(r"\[\s*\{.*?\}\s*\]", text, re.DOTALL)
        if m:
            try:
                parsed = json.loads(m.group(0))
            except (json.JSONDecodeError, ValueError):
                pass

    if not isinstance(parsed, list):
        return BatchResult(verdicts=[], failed_ids=list(batch_ids), error="parse_failed")

    verdicts, seen = [], set()
    for obj in parsed:
        if not isinstance(obj, dict): continue
        fid = obj.get("id")
        if fid not in batch_ids or fid in seen: continue
        seen.add(fid)
        sub = obj.get("subgroup", "other")
        try:
            conf = max(0, min(100, int(obj.get("confidence", 0))))
        except (TypeError, ValueError):
            conf = 0
        verdicts.append(Verdict(id=fid, subgroup=sub, confidence=conf, reason=str(obj.get("reason", ""))[:200]))

    return BatchResult(verdicts=verdicts, failed_ids=sorted(batch_ids - seen))


async def main_async(args):
    if not API_KEY:
        print("ERROR: GLM_API_KEY o ZAI_API_KEY no encontrado en .env / .env.local")
        sys.exit(1)

    db = json.loads(DB_PATH.read_text(encoding="utf-8"))
    foods = db if isinstance(db, list) else db.get("foods", [])
    print(f"Total foods: {len(foods)}")

    # Filtrar candidatos: subgroup faltante o "other"
    candidates = [f for f in foods if not f.get("subgroup") or f.get("subgroup") == "other"]
    if args.limit:
        candidates = candidates[:args.limit]
    print(f"Candidatos a auditar: {len(candidates)}")
    n_batches = (len(candidates) + BATCH_SIZE - 1) // BATCH_SIZE
    print(f"Batches de {BATCH_SIZE}: {n_batches}")

    all_verdicts: list[Verdict] = []
    all_failed: list[str] = []

    async with httpx.AsyncClient() as session:
        for i in range(0, len(candidates), BATCH_SIZE):
            batch = candidates[i:i+BATCH_SIZE]
            bidx = i // BATCH_SIZE + 1
            print(f"Batch {bidx}/{n_batches} ({len(batch)} items)... ", end="", flush=True)
            try:
                text = await call_glm(batch, session)
                result = parse_response(text, batch)
                all_verdicts.extend(result.verdicts)
                all_failed.extend(result.failed_ids)
                print(f"verdicts={len(result.verdicts)} failed={len(result.failed_ids)}")
            except Exception as e:
                print(f"ERROR: {type(e).__name__} {e}")
                all_failed.extend([f["id"] for f in batch])
            if bidx < n_batches:
                await asyncio.sleep(INTER_BATCH_DELAY_S)

    # Reporte completo
    by_id = {f["id"]: f for f in candidates}
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with REPORT_PATH.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "name", "category", "subgroup_before", "subgroup_after", "changed", "confidence", "reason"])
        for v in all_verdicts:
            f = by_id.get(v.id)
            if not f: continue
            before = f.get("subgroup")
            changed = (before != v.subgroup)
            w.writerow([v.id, f.get("name"), f.get("category"), before, v.subgroup, changed, v.confidence, v.reason])

    # Apply (si --apply y confidence >= threshold)
    applied = 0
    if args.apply:
        threshold = args.threshold
        ts = int(time.time())
        bak = ROOT / f"database.json.bak.{ts}"
        shutil.copy(DB_PATH, bak)
        food_by_id = {f["id"]: f for f in foods}
        for v in all_verdicts:
            if v.confidence < threshold: continue
            f = food_by_id.get(v.id)
            if not f: continue
            if f.get("subgroup") == v.subgroup: continue
            if v.subgroup not in VALID_SUBGROUPS.get(f.get("category", "other"), []): continue
            f["subgroup"] = v.subgroup
            applied += 1
        DB_PATH.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n✓ Aplicado: {applied} fixes (threshold={threshold}). Backup: {bak.name}")

    print(f"\nResumen:")
    print(f"  Total verdicts: {len(all_verdicts)}")
    print(f"  Failed:         {len(all_failed)}")
    print(f"  Reporte:        {REPORT_PATH.relative_to(ROOT)}")
    if not args.apply:
        n_changed_70 = sum(1 for v in all_verdicts if v.confidence >= 70 and by_id.get(v.id, {}).get("subgroup") != v.subgroup)
        print(f"  Cambios proponen confidence>=70: {n_changed_70} (re-correr con --apply para escribir)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--threshold", type=int, default=70, help="Confidence mínimo para aplicar (default 70)")
    ap.add_argument("--limit", type=int, default=None, help="Limitar candidatos (smoke test)")
    args = ap.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
