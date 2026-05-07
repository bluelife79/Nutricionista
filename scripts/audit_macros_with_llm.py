#!/usr/bin/env python3
"""
audit_macros_with_llm.py — Auditoría de macros del database.json en 2 capas.

Phase 1 (math, gratis):
  Para cada food: compara calorías reportadas vs computadas (4p + 4c + 9f).
  Flag si desviación > MATH_DELTA_PCT (default 25%).

Phase 2 (LLM, paga quota):
  Set de auditoría = BEDCA ∪ math-flagged.
  Batched a GLM-5-Turbo via z.ai. Pregunta si los macros son plausibles para
  el alimento nombrado, según referencias estándar españolas.

Output:
  scripts/audit_macros_report.csv  — TODOS los flagged con verdict + suggested
  scripts/audit_macros_summary.csv — stats por fuente y verdict

NO modifica database.json. Solo lee y escribe CSVs.

Uso:
  python scripts/audit_macros_with_llm.py [--dry-run] [--scope bedca|all|flagged-only]
                                          [--batch-size 25] [--concurrency 5]

Idempotencia: re-correr re-audita (no hay state file). Usá --dry-run para ver
el set sin gastar quota.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _audit_prompt import SYSTEM_PROMPT, build_user_message  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "database.json"
REPORT_PATH = ROOT / "scripts" / "audit_macros_report.csv"
SUMMARY_PATH = ROOT / "scripts" / "audit_macros_summary.csv"

load_dotenv(ROOT / ".env")
load_dotenv(ROOT / ".env.local", override=True)

# ---- Config ----
ENDPOINT = os.getenv("BULK_LABEL_ENDPOINT", "https://api.z.ai/api/paas/v4/chat/completions")
MODEL = os.getenv("BULK_LABEL_MODEL", "glm-5-turbo")
TEMPERATURE = float(os.getenv("BULK_LABEL_TEMPERATURE", "0.1"))
HTTP_TIMEOUT_S = float(os.getenv("BULK_LABEL_HTTP_TIMEOUT_S", "60"))
INTER_BATCH_DELAY_S = float(os.getenv("BULK_LABEL_INTER_BATCH_DELAY_S", "0.5"))

API_KEY = os.getenv("GLM_API_KEY", "")

# Math thresholds
MATH_DELTA_PCT = 25.0  # Phase 1 sospecha si computed vs reported difiere >25%
TRUST_CONFIDENCE = 80  # Confidence mínimo para incluir suggested macros


@dataclass
class Verdict:
    id: str
    verdict: str  # "ok" | "suspicious" | "wrong"
    suggested: dict[str, float] | None
    confidence: int
    reason: str


@dataclass
class BatchResult:
    verdicts: list[Verdict]
    failed_ids: list[str] = field(default_factory=list)
    raw_response: str = ""
    error: str | None = None


# ============================================================
# Phase 1: Math check
# ============================================================
def math_inconsistent(food: dict) -> tuple[bool, float | None]:
    """Returns (is_inconsistent, deviation_pct)."""
    p = food.get("protein") or 0
    c = food.get("carbs") or 0
    fa = food.get("fat") or 0
    cal = food.get("calories") or 0
    if cal < 5:
        return False, None
    computed = 4 * p + 4 * c + 9 * fa
    if computed < 1:
        return False, None
    delta_pct = abs(computed - cal) / cal * 100
    return delta_pct > MATH_DELTA_PCT, delta_pct


# ============================================================
# Phase 2: LLM call
# ============================================================
async def call_glm(batch: list[dict], session: httpx.AsyncClient) -> str:
    """POST a GLM-5-Turbo. Returns raw response content text. Raises on transport errors."""
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
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }
    resp = await session.post(ENDPOINT, json=payload, headers=headers, timeout=HTTP_TIMEOUT_S)
    resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]


def parse_response(text: str, batch: list[dict]) -> BatchResult:
    """Multi-tier parse. Match verdicts to batch by id."""
    batch_ids = {f["id"] for f in batch}

    # Tier 1: direct json.loads (might fail if wrapped in markdown)
    parsed: list | None = None
    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        pass

    # Tier 2: regex extract first JSON array
    if parsed is None or not isinstance(parsed, list):
        m = re.search(r"\[\s*\{.*?\}\s*\]", text, re.DOTALL)
        if m:
            try:
                parsed = json.loads(m.group(0))
            except (json.JSONDecodeError, ValueError):
                parsed = None

    if parsed is None or not isinstance(parsed, list):
        return BatchResult(verdicts=[], failed_ids=[f["id"] for f in batch], raw_response=text, error="parse_failed")

    verdicts: list[Verdict] = []
    seen_ids: set[str] = set()
    for obj in parsed:
        if not isinstance(obj, dict):
            continue
        fid = obj.get("id")
        if fid not in batch_ids or fid in seen_ids:
            continue
        seen_ids.add(fid)
        verdict = obj.get("verdict", "ok")
        if verdict not in ("ok", "suspicious", "wrong"):
            verdict = "suspicious"
        suggested = obj.get("suggested")
        if suggested is not None and not (
            isinstance(suggested, dict)
            and all(k in suggested for k in ("calories", "protein", "carbs", "fat"))
        ):
            suggested = None
        try:
            confidence = max(0, min(100, int(obj.get("confidence", 0))))
        except (TypeError, ValueError):
            confidence = 0
        reason = str(obj.get("reason", ""))[:200]
        verdicts.append(Verdict(id=fid, verdict=verdict, suggested=suggested, confidence=confidence, reason=reason))

    failed_ids = sorted(batch_ids - seen_ids)
    return BatchResult(verdicts=verdicts, failed_ids=failed_ids, raw_response=text)


async def process_batch(
    batch_idx: int,
    batch: list[dict],
    session: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    total_batches: int,
) -> BatchResult:
    async with semaphore:
        t0 = time.time()
        try:
            text = await call_glm(batch, session)
        except httpx.HTTPStatusError as e:
            print(f"[audit] BATCH_FAIL idx={batch_idx}/{total_batches} status={e.response.status_code}")
            return BatchResult(verdicts=[], failed_ids=[f["id"] for f in batch], error=f"http_{e.response.status_code}")
        except (httpx.TimeoutException, httpx.RequestError) as e:
            print(f"[audit] BATCH_FAIL idx={batch_idx}/{total_batches} transport={type(e).__name__}")
            return BatchResult(verdicts=[], failed_ids=[f["id"] for f in batch], error=f"transport_{type(e).__name__}")
        result = parse_response(text, batch)
        elapsed_ms = int((time.time() - t0) * 1000)
        if result.error:
            print(f"[audit] BATCH_PARSE_FAIL idx={batch_idx}/{total_batches} latency_ms={elapsed_ms}")
        else:
            ok_n = sum(1 for v in result.verdicts if v.verdict == "ok")
            sus_n = sum(1 for v in result.verdicts if v.verdict == "suspicious")
            wrong_n = sum(1 for v in result.verdicts if v.verdict == "wrong")
            print(
                f"[audit] BATCH_OK idx={batch_idx}/{total_batches} verdicts={len(result.verdicts)} "
                f"ok={ok_n} sus={sus_n} wrong={wrong_n} failed={len(result.failed_ids)} ms={elapsed_ms}"
            )
        await asyncio.sleep(INTER_BATCH_DELAY_S)
        return result


# ============================================================
# Output
# ============================================================
def write_report(
    foods_audited: list[dict],
    verdicts_by_id: dict[str, Verdict],
    math_results: dict[str, float | None],
    output_path: Path,
) -> None:
    """Write the per-food audit report CSV."""
    rows_written = 0
    with open(output_path, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(
            [
                "id",
                "source",
                "name",
                "brand",
                "current_cal",
                "current_prot",
                "current_carb",
                "current_fat",
                "math_delta_pct",
                "math_flag",
                "llm_verdict",
                "llm_suggested_cal",
                "llm_suggested_prot",
                "llm_suggested_carb",
                "llm_suggested_fat",
                "llm_confidence",
                "llm_reason",
                "trust_suggestion",
            ]
        )
        for f in foods_audited:
            fid = f.get("id", "")
            v = verdicts_by_id.get(fid)
            md = math_results.get(fid)
            math_flag = "yes" if (md is not None and md > MATH_DELTA_PCT) else "no"

            # Skip rows that are fully OK by both math and LLM (clean signal in CSV)
            verdict_str = v.verdict if v else "no_verdict"
            if math_flag == "no" and verdict_str == "ok":
                continue

            sug = v.suggested if v else None
            trust = "yes" if (v and v.confidence >= TRUST_CONFIDENCE and sug) else "no"
            w.writerow(
                [
                    fid,
                    f.get("source", ""),
                    f.get("name", ""),
                    f.get("brand", "") or "",
                    f.get("calories", ""),
                    f.get("protein", ""),
                    f.get("carbs", ""),
                    f.get("fat", ""),
                    f"{md:.1f}" if md is not None else "",
                    math_flag,
                    verdict_str,
                    sug.get("calories", "") if sug else "",
                    sug.get("protein", "") if sug else "",
                    sug.get("carbs", "") if sug else "",
                    sug.get("fat", "") if sug else "",
                    v.confidence if v else "",
                    v.reason if v else "",
                    trust,
                ]
            )
            rows_written += 1
    print(f"[audit] Wrote report: {output_path.name} ({rows_written} flagged rows)")


def write_summary(verdicts_by_id: dict[str, Verdict], foods_audited: list[dict], output_path: Path) -> None:
    """Aggregate summary by source × verdict."""
    rows: dict[tuple[str, str], int] = {}
    for f in foods_audited:
        fid = f.get("id", "")
        src = f.get("source", "?")
        v = verdicts_by_id.get(fid)
        verdict = v.verdict if v else "no_verdict"
        rows[(src, verdict)] = rows.get((src, verdict), 0) + 1

    with open(output_path, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["source", "verdict", "count"])
        for (src, verdict), count in sorted(rows.items()):
            w.writerow([src, verdict, count])
    print(f"[audit] Wrote summary: {output_path.name}")


# ============================================================
# Main
# ============================================================
async def amain(args: argparse.Namespace) -> None:
    if not API_KEY and not args.dry_run:
        print("ERROR: GLM_API_KEY no encontrada en .env / .env.local. Abortando.")
        sys.exit(1)

    with open(DB_PATH, encoding="utf-8") as fh:
        db = json.load(fh)
    foods = db if isinstance(db, list) else db.get("foods", db)
    print(f"[audit] Loaded {len(foods)} foods from {DB_PATH.name}")

    # Phase 1: math check
    math_results: dict[str, float | None] = {}
    math_flagged_ids: set[str] = set()
    for f in foods:
        fid = f.get("id")
        if not fid:
            continue
        flagged, delta = math_inconsistent(f)
        math_results[fid] = delta
        if flagged:
            math_flagged_ids.add(fid)
    print(f"[audit] Phase 1 (math): {len(math_flagged_ids)} foods flagged (delta > {MATH_DELTA_PCT}%)")

    # Phase 2: scope decision
    if args.scope == "bedca":
        bedca_ids = {f["id"] for f in foods if f.get("source") == "BEDCA"}
        audit_set_ids = bedca_ids | math_flagged_ids
    elif args.scope == "flagged-only":
        audit_set_ids = math_flagged_ids
    else:  # all
        audit_set_ids = {f["id"] for f in foods if f.get("id")}

    foods_audited = [f for f in foods if f.get("id") in audit_set_ids]
    n_total = len(foods_audited)
    n_batches = (n_total + args.batch_size - 1) // args.batch_size
    print(f"[audit] Phase 2 scope={args.scope}: {n_total} foods → {n_batches} batches of {args.batch_size}")

    if args.dry_run:
        print("[audit] DRY RUN — no LLM calls. Exiting.")
        # Still write a partial report based on math only
        verdicts_by_id: dict[str, Verdict] = {}
        write_report(foods_audited, verdicts_by_id, math_results, REPORT_PATH)
        return

    # Process batches
    semaphore = asyncio.Semaphore(args.concurrency)
    async with httpx.AsyncClient() as session:
        tasks = []
        for i in range(0, n_total, args.batch_size):
            batch = foods_audited[i : i + args.batch_size]
            batch_idx = i // args.batch_size + 1
            tasks.append(process_batch(batch_idx, batch, session, semaphore, n_batches))
        results = await asyncio.gather(*tasks)

    # Aggregate
    verdicts_by_id: dict[str, Verdict] = {}
    total_failed = 0
    for r in results:
        for v in r.verdicts:
            verdicts_by_id[v.id] = v
        total_failed += len(r.failed_ids)

    print(
        f"\n[audit] DONE total={n_total} verdicts={len(verdicts_by_id)} failed_to_get_verdict={total_failed}"
    )

    write_report(foods_audited, verdicts_by_id, math_results, REPORT_PATH)
    write_summary(verdicts_by_id, foods_audited, SUMMARY_PATH)

    # Print top wrong/suspicious by confidence
    flagged = [v for v in verdicts_by_id.values() if v.verdict in ("wrong", "suspicious")]
    flagged.sort(key=lambda x: (x.verdict != "wrong", -x.confidence))
    print(f"\n[audit] Top 10 high-confidence flagged:")
    foods_by_id = {f["id"]: f for f in foods}
    for v in flagged[:10]:
        f = foods_by_id.get(v.id, {})
        sug = ""
        if v.suggested:
            sug = f" → cal={v.suggested.get('calories')}"
        print(
            f"  [{v.verdict:10s}] conf={v.confidence:>3} | {f.get('source','?'):12s} | "
            f"{f.get('name','')[:45]:45s} cal={f.get('calories','?')}{sug} | {v.reason[:60]}"
        )


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--scope", choices=["bedca", "all", "flagged-only"], default="bedca")
    p.add_argument("--batch-size", type=int, default=25)
    p.add_argument("--concurrency", type=int, default=5)
    p.add_argument("--dry-run", action="store_true", help="Phase 1 only, no LLM calls")
    args = p.parse_args()
    asyncio.run(amain(args))


if __name__ == "__main__":
    main()
