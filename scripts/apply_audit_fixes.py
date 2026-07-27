#!/usr/bin/env python3
"""
apply_audit_fixes.py — Aplica los fixes de Tier 1 del audit_macros_report.csv.

Filtro Tier 1: llm_verdict=wrong AND llm_confidence>=90 AND trust_suggestion=yes
                AND tiene suggested cal/prot/carb/fat completo.

Atómico: backup .bak.<unix_ts> + write a .tmp + os.replace.
Idempotente: skip foods donde los valores actuales ya coinciden con los sugeridos
             (tolerancia ±0.5 kcal o ±0.1 g por macro).

Uso:
  uv run --with-requirements scripts/requirements.txt scripts/apply_audit_fixes.py
  uv run --with-requirements scripts/requirements.txt scripts/apply_audit_fixes.py --min-confidence 95
  uv run --with-requirements scripts/requirements.txt scripts/apply_audit_fixes.py --dry-run

NOTA: este script NO toca bulk-label flags (ready_to_eat, meal_slot, etc.) —
solo reemplaza calories/protein/carbs/fat. Los flags persisten.
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "database.json"
REPORT_PATH = ROOT / "scripts" / "audit_macros_report.csv"

CAL_TOL = 0.5
MACRO_TOL = 0.1


def parse_float(s: str) -> float | None:
    s = (s or "").strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def already_applied(food: dict, sug_cal: float, sug_p: float, sug_c: float, sug_f: float) -> bool:
    return (
        abs((food.get("calories") or 0) - sug_cal) < CAL_TOL
        and abs((food.get("protein") or 0) - sug_p) < MACRO_TOL
        and abs((food.get("carbs") or 0) - sug_c) < MACRO_TOL
        and abs((food.get("fat") or 0) - sug_f) < MACRO_TOL
    )


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--min-confidence", type=int, default=90, help="Mínimo confidence del LLM para aplicar fix (default 90)")
    p.add_argument("--dry-run", action="store_true", help="Mostrar qué se aplicaría sin tocar database.json")
    p.add_argument("--report", type=Path, default=REPORT_PATH)
    args = p.parse_args()

    if not args.report.exists():
        print(f"ERROR: {args.report} no existe. Corré primero scripts/audit_macros_with_llm.py")
        sys.exit(1)

    # Read CSV — filter Tier 1
    fixes: list[dict] = []
    with open(args.report, encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            if row.get("llm_verdict") != "wrong":
                continue
            if row.get("trust_suggestion") != "yes":
                continue
            try:
                conf = int(row.get("llm_confidence") or 0)
            except ValueError:
                conf = 0
            if conf < args.min_confidence:
                continue
            sug_cal = parse_float(row.get("llm_suggested_cal", ""))
            sug_p = parse_float(row.get("llm_suggested_prot", ""))
            sug_c = parse_float(row.get("llm_suggested_carb", ""))
            sug_f = parse_float(row.get("llm_suggested_fat", ""))
            if None in (sug_cal, sug_p, sug_c, sug_f):
                continue
            fixes.append(
                {
                    "id": row["id"],
                    "name": row.get("name", ""),
                    "source": row.get("source", ""),
                    "current_cal": parse_float(row.get("current_cal", "")) or 0,
                    "sug_cal": sug_cal,
                    "sug_p": sug_p,
                    "sug_c": sug_c,
                    "sug_f": sug_f,
                    "reason": row.get("llm_reason", ""),
                    "confidence": conf,
                }
            )

    print(f"[apply] Tier 1 fixes con confidence ≥ {args.min_confidence}: {len(fixes)}")
    if not fixes:
        print("[apply] Nada que aplicar. Salida.")
        return

    # Load DB
    with open(DB_PATH, encoding="utf-8") as fh:
        db = json.load(fh)
    foods = db if isinstance(db, list) else db.get("foods", db)
    foods_by_id = {f.get("id"): f for f in foods}

    applied = 0
    skipped_idempotent = 0
    skipped_not_found = 0
    diff_log: list[str] = []

    for fix in fixes:
        food = foods_by_id.get(fix["id"])
        if not food:
            skipped_not_found += 1
            continue
        if already_applied(food, fix["sug_cal"], fix["sug_p"], fix["sug_c"], fix["sug_f"]):
            skipped_idempotent += 1
            continue
        before = (
            f"cal={food.get('calories'):.1f} p={food.get('protein')} "
            f"c={food.get('carbs')} f={food.get('fat')}"
        )
        food["calories"] = fix["sug_cal"]
        food["protein"] = fix["sug_p"]
        food["carbs"] = fix["sug_c"]
        food["fat"] = fix["sug_f"]
        after = f"cal={fix['sug_cal']} p={fix['sug_p']} c={fix['sug_c']} f={fix['sug_f']}"
        diff_log.append(
            f"  {fix['id']:20s} [{fix['source'][:10]:10s}] conf={fix['confidence']:>3} | "
            f"{fix['name'][:35]:35s} | {before} → {after} | {fix['reason'][:50]}"
        )
        applied += 1

    print(f"[apply] Applied={applied} idempotent_skipped={skipped_idempotent} not_found={skipped_not_found}")
    print()
    print("=== Diff (primeros 30) ===")
    for line in diff_log[:30]:
        print(line)
    if len(diff_log) > 30:
        print(f"  ... y {len(diff_log)-30} más")

    if args.dry_run:
        print("\n[apply] DRY RUN — sin escritura.")
        return

    if applied == 0:
        print("\n[apply] No-op (todo ya idempotent). Sin escritura.")
        return

    # Backup + atomic write
    backup = DB_PATH.with_suffix(f".json.bak.{int(time.time())}")
    shutil.copy(DB_PATH, backup)
    print(f"\n[apply] Backup: {backup.name}")

    tmp = DB_PATH.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(db, fh, ensure_ascii=False, indent=2)
    tmp.replace(DB_PATH)
    print(f"[apply] Wrote {DB_PATH.name} ({len(foods)} foods total)")


if __name__ == "__main__":
    main()
