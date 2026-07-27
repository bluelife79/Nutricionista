#!/usr/bin/env python3
"""LLM audit detallado: genera usage_es (descripción de uso culinario español)
para cada food en el scope clínico relevante.

Output: añade campo `usage_es` (~30 palabras) a cada food en database.json.
El judge runtime incluye este field en el payload → la decisión clínica del
LLM tiene contexto culinario explícito en vez de adivinar.

Scope inicial: granos, tubers, legumbres, frutas, vegetales — ~1500 foods.
Extender si Hugo lo pide a otros subgroups.

Uso:
    python scripts/audit_usage_with_llm.py --dry-run     # solo reporte
    python scripts/audit_usage_with_llm.py --apply       # aplica al DB
    python scripts/audit_usage_with_llm.py --apply --scope=carbs   # solo carbs
"""
from __future__ import annotations
import argparse
import asyncio
import csv
import json
import os
import re
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
DB_PATH = ROOT / "database.json"
REPORT_PATH = ROOT / "scripts" / "audit_usage_report.csv"

load_dotenv(ROOT / ".env")
load_dotenv(ROOT / ".env.local", override=True)

ENDPOINT = os.getenv("BULK_LABEL_ENDPOINT", "https://api.z.ai/api/coding/paas/v4/chat/completions")
MODEL = os.getenv("BULK_LABEL_MODEL", "glm-5-turbo")
TEMPERATURE = float(os.getenv("BULK_LABEL_TEMPERATURE", "0.1"))
HTTP_TIMEOUT_S = float(os.getenv("AUDIT_USAGE_HTTP_TIMEOUT_S", "180"))
INTER_BATCH_DELAY_S = float(os.getenv("BULK_LABEL_INTER_BATCH_DELAY_S", "0.5"))
BATCH_SIZE = int(os.getenv("AUDIT_USAGE_BATCH_SIZE", "10"))
API_KEY = os.getenv("GLM_API_KEY", "") or os.getenv("ZAI_API_KEY", "")

# Scope per --scope flag. Default = todos los core subgroups.
SCOPE_SUBGROUPS = {
    "carbs":  ["grains", "tubers", "legumes", "fruit", "other_carbs", "sweets_bakery"],
    "protein": ["meat", "fish", "eggs", "legumes", "processed_protein", "other_protein"],
    "dairy":  ["basic_dairy", "low_fat_dairy", "whole_dairy", "high_protein_dairy",
               "fresh_cheese", "aged_cheese", "cheese", "other_dairy"],
    "fat":    ["olive_oil", "other_oils", "nuts_seeds", "avocado", "butter_margarine", "other_fat"],
    "veggies": ["vegetables"],
    "all":    None,  # all foods
}

SYSTEM_PROMPT = """\
Eres un experto en gastronomía y dietética clínica española. Para cada
alimento devuelve un objeto JSON con un campo `usage_es` que describa,
en 25-40 palabras, su uso culinario típico en España.

El campo debe cubrir 4 puntos en orden:
1. QUÉ ES — categoría culinaria del alimento (cereal en grano, fruta de
   pepita, queso curado de leche cruda, etc.).
2. CÓMO SE CONSUME — preparación típica (hervido como plato, ingrediente
   de bollería, snack entre horas, etc.). Si NO es comestible directamente
   aunque se cocine (ej. cebada cruda → gachas/cerveza, no plato),
   mencionalo EXPLÍCITAMENTE.
3. CUÁNDO — momento de consumo típico (desayuno, comida, cena, snack,
   ingrediente).
4. INTERCAMBIO CLÍNICO — qué otros alimentos lo sustituyen sin
   problemas en una pauta dietética española (ej. "intercambio con
   pasta cocida, cuscús, bulgur").

Reglas:
- 25-40 palabras. Sin tecnicismos. Lenguaje claro de nutricionista.
- Si el alimento es exótico o raro en España, dilo.
- Si es ingrediente de cocina (no plato), dilo.
- Si su uso es exclusivamente desayuno o snack, dilo.
- Sin markdown. Sin comillas internas. Sin saltos de línea dentro del texto.

Devuelve EXCLUSIVAMENTE un array JSON con esta forma exacta:
[
  {"id": "<id>", "usage_es": "<texto 25-40 palabras>"},
  ...
]
Sin texto antes ni después.\
"""


def build_user_message(batch: list[dict]) -> str:
    items = []
    for f in batch:
        items.append({
            "id": f["id"],
            "name": f.get("name", ""),
            "category": f.get("category"),
            "subgroup": f.get("subgroup"),
            "meal_slot": f.get("meal_slot"),
            "ready_to_eat": f.get("ready_to_eat"),
            "raw_ingredient": f.get("raw_ingredient"),
            "frequency": f.get("frequency"),
            "macros_per_100g": {
                "kcal": f.get("calories"),
                "protein": f.get("protein"),
                "carbs": f.get("carbs"),
                "fat": f.get("fat"),
            },
        })
    return (
        f"Genera usage_es para los {len(batch)} alimentos siguientes.\n\n"
        f"{json.dumps(items, ensure_ascii=False, indent=2)}"
    )


@dataclass
class Verdict:
    id: str
    usage_es: str


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
        usage = str(obj.get("usage_es", "")).strip()
        if usage:
            verdicts.append(Verdict(id=fid, usage_es=usage[:300]))
    return BatchResult(verdicts=verdicts, failed_ids=sorted(batch_ids - seen))


def select_scope(foods: list[dict], scope: str) -> list[dict]:
    if scope == "all":
        return foods
    subs = SCOPE_SUBGROUPS.get(scope)
    if subs is None:
        return foods
    return [f for f in foods if f.get("subgroup") in subs]


async def main_async(args):
    if not API_KEY:
        print("ERROR: GLM_API_KEY/ZAI_API_KEY no encontrado en .env"); return

    db = json.loads(DB_PATH.read_text(encoding="utf-8"))
    foods = db if isinstance(db, list) else db.get("foods", [])
    print(f"Total foods: {len(foods)}")

    candidates = select_scope(foods, args.scope)
    # Skip foods que ya tienen usage_es (idempotente, salvo --force)
    if not args.force:
        candidates = [f for f in candidates if not f.get("usage_es")]
    if args.limit:
        candidates = candidates[:args.limit]
    print(f"Scope='{args.scope}' candidates={len(candidates)}")
    n_batches = (len(candidates) + BATCH_SIZE - 1) // BATCH_SIZE
    print(f"Batches de {BATCH_SIZE}: {n_batches} ({100*n_batches/400:.1f}% quota 5h z.ai)")
    if not candidates:
        print("Nada para auditar."); return

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

    by_id_cand = {f["id"]: f for f in candidates}
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with REPORT_PATH.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "name", "category", "subgroup", "usage_es"])
        for v in all_verdicts:
            f = by_id_cand.get(v.id)
            if not f: continue
            w.writerow([v.id, f.get("name"), f.get("category"), f.get("subgroup"), v.usage_es])

    if args.apply:
        food_by_id = {f["id"]: f for f in foods}
        ts = int(time.time())
        bak = ROOT / f"database.json.bak.{ts}"
        shutil.copy(DB_PATH, bak)
        applied = 0
        for v in all_verdicts:
            f = food_by_id.get(v.id)
            if not f: continue
            f["usage_es"] = v.usage_es
            applied += 1
        DB_PATH.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n✓ Aplicado: {applied} usage_es nuevos. Backup: {bak.name}")

    print(f"\nResumen: verdicts={len(all_verdicts)}  failed={len(all_failed)}")
    print(f"Reporte: {REPORT_PATH.relative_to(ROOT)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--force", action="store_true", help="Re-auditar foods con usage_es ya existente")
    ap.add_argument("--scope", default="carbs", choices=list(SCOPE_SUBGROUPS.keys()),
                    help="Subset clínico (default: carbs = grains/tubers/legumes/fruit/...)")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
