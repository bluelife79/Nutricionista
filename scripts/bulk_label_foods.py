"""bulk_label_foods.py
Label every food in database.json with culinary flags via GLM-5-Turbo.

Usage:
  python3 scripts/bulk_label_foods.py --pilot 50
  python3 scripts/bulk_label_foods.py             # full run after pilot review
  python3 scripts/bulk_label_foods.py --force     # re-label all foods
  python3 scripts/bulk_label_foods.py --dry-run   # parse + plan, no API calls

Env (loaded from .env):
  GLM_API_KEY                       (required)
  BULK_LABEL_ENDPOINT               default: z.ai coding paas v4
  BULK_LABEL_MODEL                  default: glm-5-turbo
  BULK_LABEL_TEMPERATURE            default: 0.1
  BULK_LABEL_BATCH_SIZE             default: 25
  BULK_LABEL_CONCURRENCY            default: 5
  BULK_LABEL_INTER_BATCH_DELAY_S    default: 0.5
  BULK_LABEL_HTTP_TIMEOUT_S         default: 60
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import logging
import os
import re
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import httpx
from dotenv import load_dotenv
from pydantic import BaseModel, Field, model_validator

# ---------------------------------------------------------------------------
# Local imports
# ---------------------------------------------------------------------------
# Adjust path so the script works when invoked from repo root as:
#   python3 scripts/bulk_label_foods.py
_SCRIPTS_DIR = Path(__file__).parent
sys.path.insert(0, str(_SCRIPTS_DIR))
from _label_prompt import SYSTEM_PROMPT, build_user_message  # noqa: E402

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("bulk-label")


def _log(msg: str) -> None:
    """Print a prefixed log line to stdout (spec REQ-H format)."""
    print(f"[bulk-label] {msg}", flush=True)


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
_DEFAULT_ENDPOINT = (
    "https://api.z.ai/api/coding/paas/v4/chat/completions"
)
_DB_PATH = Path(__file__).parent.parent / "database.json"


class Config:
    def __init__(self) -> None:
        load_dotenv()
        self.api_key: str = os.environ.get("GLM_API_KEY", "")
        self.endpoint: str = os.environ.get("BULK_LABEL_ENDPOINT", _DEFAULT_ENDPOINT)
        self.model: str = os.environ.get("BULK_LABEL_MODEL", "glm-5-turbo")
        self.temperature: float = float(os.environ.get("BULK_LABEL_TEMPERATURE", "0.1"))
        self.batch_size: int = int(os.environ.get("BULK_LABEL_BATCH_SIZE", "25"))
        self.concurrency: int = int(os.environ.get("BULK_LABEL_CONCURRENCY", "5"))
        self.inter_batch_delay: float = float(
            os.environ.get("BULK_LABEL_INTER_BATCH_DELAY_S", "0.5")
        )
        self.http_timeout: float = float(os.environ.get("BULK_LABEL_HTTP_TIMEOUT_S", "60"))
        self.db_path: Path = _DB_PATH


# ---------------------------------------------------------------------------
# Pydantic models  (T2.2)
# ---------------------------------------------------------------------------

class FoodInput(BaseModel):
    id: str
    name: str
    brand: str | None = None
    category: str | None = None
    subgroup: str | None = None


_VALID_MEAL_SLOTS = {"desayuno", "comida", "cena", "snack", "any"}
_VALID_FREQUENCIES = {"habitual", "ocasional", "raro"}

MEAL_SLOT_LITERAL = Literal["desayuno", "comida", "cena", "snack", "any"]
FREQUENCY_LITERAL = Literal["habitual", "ocasional", "raro"]


class FoodVerdict(BaseModel):
    id: str
    ready_to_eat: bool
    raw_ingredient: bool
    meal_slot: MEAL_SLOT_LITERAL
    frequency: FREQUENCY_LITERAL
    exotic: bool
    confidence: int = Field(ge=0, le=100)
    reason: str


class BatchResult(BaseModel):
    batch_idx: int
    verdicts: list[FoodVerdict] = Field(default_factory=list)
    failed_ids: list[str] = Field(default_factory=list)
    error: str | None = None
    raw_response: str | None = None  # kept only for failures.csv triage


# ---------------------------------------------------------------------------
# Argparse  (T2.1)
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Label foods in database.json with culinary flags via GLM-5-Turbo.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--pilot",
        nargs="?",
        const=50,
        type=int,
        metavar="N",
        help="Process only the first N foods (default 50 when flag is present without value). "
             "Writes to bulk_label_report.pilot.csv; does NOT modify database.json.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-label all foods, overwriting existing flags. Requires confirmation.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse database and plan batches without making any API calls.",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=None,
        metavar="N",
        help="Max concurrent API requests (overrides BULK_LABEL_CONCURRENCY env).",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=None,
        metavar="N",
        help="Foods per batch (overrides BULK_LABEL_BATCH_SIZE env).",
    )
    return parser.parse_args()


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def load_db(path: Path) -> list[dict]:
    """Read and parse database.json. Exits non-zero on error."""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"ERROR: {path} not found.", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as exc:
        print(f"ERROR: {path} is not valid JSON: {exc}", file=sys.stderr)
        sys.exit(1)

    # database.json may be a list or {"foods": [...]} wrapper
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("foods", "items", "data"):
            if key in data and isinstance(data[key], list):
                return data[key]
    print(f"ERROR: Unexpected structure in {path}.", file=sys.stderr)
    sys.exit(1)


def filter_pending(db: list[dict], *, force: bool) -> list[FoodInput]:
    """Return foods that need labeling. Skips already-labeled unless --force."""
    result = []
    for food in db:
        if not force and "ready_to_eat" in food:
            continue  # already labeled — idempotency (REQ-F01)
        result.append(
            FoodInput(
                id=str(food.get("id", "")),
                name=str(food.get("name", food.get("nombre", ""))),
                brand=food.get("brand") or food.get("marca") or None,
                category=food.get("category") or food.get("categoria") or None,
                subgroup=food.get("subgroup") or food.get("subgrupo") or None,
            )
        )
    return result


# ---------------------------------------------------------------------------
# LLM call  (T2.3)
# ---------------------------------------------------------------------------

async def call_glm(
    batch: list[FoodInput],
    client: httpx.AsyncClient,
    cfg: Config,
) -> str:
    """One POST to z.ai. Returns raw response text.

    Raises:
        httpx.HTTPStatusError: on non-2xx response.
        httpx.TimeoutException: on timeout.
    """
    payload = {
        "model": cfg.model,
        "temperature": cfg.temperature,
        "thinking": {"type": "disabled"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_user_message(batch)},
        ],
    }
    response = await client.post(cfg.endpoint, json=payload)
    response.raise_for_status()
    data = response.json()
    # Extract content from the first choice
    return data["choices"][0]["message"]["content"]


# ---------------------------------------------------------------------------
# Parser  (T2.4)
# ---------------------------------------------------------------------------

def _truncate_reason(reason: str, max_words: int = 12) -> str:
    words = reason.split()
    if len(words) <= max_words:
        return reason
    return " ".join(words[:max_words])


def _validate_raw_verdict(
    raw: dict,
    batch_ids: set[str],
) -> tuple[FoodVerdict | None, str | None]:
    """Validate a single raw verdict dict.

    Returns (FoodVerdict, None) on success or (None, failure_reason) on hard failure.
    Coerces meal_slot and frequency on soft violations per REQ-C table.
    """
    food_id = raw.get("id")
    if not isinstance(food_id, str) or food_id not in batch_ids:
        return None, "mismatched_id"

    # Hard failures: boolean fields missing
    for bool_field in ("ready_to_eat", "raw_ingredient", "exotic"):
        val = raw.get(bool_field)
        if not isinstance(val, bool):
            return None, "missing_required_field"

    # Soft coercions
    meal_slot = raw.get("meal_slot")
    if meal_slot not in _VALID_MEAL_SLOTS:
        log.warning(
            "[bulk-label] COERCE meal_slot=%r → 'any' for id=%s",
            meal_slot,
            food_id,
        )
        meal_slot = "any"

    frequency = raw.get("frequency")
    if frequency not in _VALID_FREQUENCIES:
        log.warning(
            "[bulk-label] COERCE frequency=%r → 'habitual' for id=%s",
            frequency,
            food_id,
        )
        frequency = "habitual"

    # Confidence: clamp silently
    confidence = raw.get("confidence", 50)
    try:
        confidence = int(confidence)
    except (TypeError, ValueError):
        confidence = 50
    confidence = max(0, min(100, confidence))

    # Reason: truncate to 12 words
    reason = str(raw.get("reason", ""))
    reason = _truncate_reason(reason)

    try:
        verdict = FoodVerdict(
            id=food_id,
            ready_to_eat=raw["ready_to_eat"],
            raw_ingredient=raw["raw_ingredient"],
            meal_slot=meal_slot,
            frequency=frequency,
            exotic=raw["exotic"],
            confidence=confidence,
            reason=reason,
        )
    except Exception as exc:  # noqa: BLE001
        return None, f"validation_error: {exc}"

    return verdict, None


async def parse_response(text: str, batch: list[FoodInput]) -> BatchResult:
    """3-tier parsing per REQ-D. Returns BatchResult (never raises)."""
    batch_idx = 0  # caller may set; default 0 here for standalone use
    batch_ids = {f.id for f in batch}

    # Tier 1 — happy path
    parsed = None
    try:
        candidate = json.loads(text)
        if isinstance(candidate, list):
            parsed = candidate
    except (json.JSONDecodeError, ValueError):
        pass

    # Tier 2 — regex extraction
    if parsed is None:
        match = re.search(r"\[.*\]", text, re.DOTALL)
        if match:
            try:
                candidate = json.loads(match.group(0))
                if isinstance(candidate, list):
                    parsed = candidate
            except (json.JSONDecodeError, ValueError):
                pass

    # Tier 3 — batch failure
    if parsed is None:
        return BatchResult(
            batch_idx=batch_idx,
            verdicts=[],
            failed_ids=list(batch_ids),
            error="parse_failed",
            raw_response=text[:500],
        )

    # Per-verdict validation
    verdicts: list[FoodVerdict] = []
    failed_ids: list[str] = []

    seen_ids: set[str] = set()
    for raw in parsed:
        if not isinstance(raw, dict):
            continue
        # Duplicate id: take first occurrence (design §10)
        raw_id = raw.get("id")
        if isinstance(raw_id, str) and raw_id in seen_ids:
            log.warning("[bulk-label] DUPLICATE id=%s in response — skipping", raw_id)
            continue
        if isinstance(raw_id, str):
            seen_ids.add(raw_id)

        verdict, failure_reason = _validate_raw_verdict(raw, batch_ids)
        if verdict is not None:
            verdicts.append(verdict)
        else:
            failed_id = raw.get("id", "unknown")
            failed_ids.append(str(failed_id))

    # ID coverage check (≥80%)
    matched_count = sum(1 for v in verdicts if v.id in batch_ids)
    coverage = matched_count / len(batch) if batch else 1.0
    if coverage < 0.80:
        return BatchResult(
            batch_idx=batch_idx,
            verdicts=verdicts,
            failed_ids=failed_ids,
            error="coverage",
            raw_response=text[:500],
        )

    return BatchResult(
        batch_idx=batch_idx,
        verdicts=verdicts,
        failed_ids=failed_ids,
        error=None,
        raw_response=None,
    )


# ---------------------------------------------------------------------------
# Retry state machine  (T2.5)
# ---------------------------------------------------------------------------

async def process_batch_with_retry(
    batch_idx: int,
    batch: list[FoodInput],
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    cfg: Config,
) -> BatchResult:
    """State-machine retry per design §5.2. Always returns BatchResult; never raises
    (except 401/403 which re-raise as fatal).
    """
    rate_backoff = [30, 60, 120]
    server_backoff = [5, 15, 45]
    parse_retried = False
    coverage_retried = False
    timeout_retried = False

    async with sem:
        while True:
            try:
                text = await call_glm(batch, client, cfg)
                result = await parse_response(text, batch)
                result = BatchResult(
                    batch_idx=batch_idx,
                    verdicts=result.verdicts,
                    failed_ids=result.failed_ids,
                    error=result.error,
                    raw_response=result.raw_response,
                )

                if result.error == "parse_failed" and not parse_retried:
                    parse_retried = True
                    _log(f"BATCH_RETRY batch={batch_idx} reason=parse_failed")
                    continue

                if result.error == "coverage" and not coverage_retried:
                    coverage_retried = True
                    matched = sum(1 for v in result.verdicts if v.id in {f.id for f in batch})
                    _log(
                        f"BATCH_RETRY batch={batch_idx} reason=id_coverage_low "
                        f"({matched}/{len(batch)})"
                    )
                    continue

                # Success or final failure
                if result.error is None:
                    pass  # caller logs BATCH_OK
                elif result.error in ("parse_failed", "coverage"):
                    _log(f"BATCH_FAIL batch={batch_idx} reason={result.error}")

                await asyncio.sleep(cfg.inter_batch_delay)
                return result

            except httpx.HTTPStatusError as exc:
                code = exc.response.status_code

                if code in (401, 403):
                    print(
                        f"GLM_API_KEY rejected (HTTP {code}). Check .env.",
                        file=sys.stderr,
                    )
                    raise  # fatal — propagate to main()

                if code == 429 and rate_backoff:
                    wait = rate_backoff.pop(0)
                    _log(f"RATE_LIMIT_BACKOFF wait={wait}s")
                    await asyncio.sleep(wait)
                    continue

                if 500 <= code < 600 and server_backoff:
                    wait = server_backoff.pop(0)
                    await asyncio.sleep(wait)
                    continue

                # 4xx (not 429) or exhausted server retries — no retry
                _log(f"BATCH_FAIL batch={batch_idx} reason=client_error_{code}")
                await asyncio.sleep(cfg.inter_batch_delay)
                return BatchResult(
                    batch_idx=batch_idx,
                    verdicts=[],
                    failed_ids=[f.id for f in batch],
                    error=f"client_error_{code}",
                )

            except httpx.TimeoutException:
                if not timeout_retried:
                    timeout_retried = True
                    _log(f"BATCH_RETRY batch={batch_idx} reason=timeout")
                    await asyncio.sleep(10)
                    continue

                _log(f"BATCH_FAIL batch={batch_idx} reason=timeout")
                await asyncio.sleep(cfg.inter_batch_delay)
                return BatchResult(
                    batch_idx=batch_idx,
                    verdicts=[],
                    failed_ids=[f.id for f in batch],
                    error="timeout",
                )

            except httpx.ConnectError:
                if not timeout_retried:
                    timeout_retried = True
                    _log(f"BATCH_RETRY batch={batch_idx} reason=network_error")
                    await asyncio.sleep(10)
                    continue

                _log(f"BATCH_FAIL batch={batch_idx} reason=network_error")
                await asyncio.sleep(cfg.inter_batch_delay)
                return BatchResult(
                    batch_idx=batch_idx,
                    verdicts=[],
                    failed_ids=[f.id for f in batch],
                    error="network_error",
                )


# ---------------------------------------------------------------------------
# DB merge  (T2.6)
# ---------------------------------------------------------------------------

def merge_verdicts_into_db(
    verdicts: list[FoodVerdict],
    db: list[dict],
) -> int:
    """Mutate db in-place, merging verdict fields keyed by id.

    Field name mapping (spec REQ-C note):
      verdict.confidence  → food["label_confidence"]
      verdict.reason      → food["label_reason"]
    All other verdict fields are written under their own names.

    Returns count of foods actually updated.
    """
    db_by_id: dict[str, dict] = {str(f.get("id", "")): f for f in db}
    updated = 0
    for verdict in verdicts:
        food = db_by_id.get(verdict.id)
        if food is None:
            log.warning("[bulk-label] MERGE SKIP: id=%s not in db", verdict.id)
            continue
        food["ready_to_eat"] = verdict.ready_to_eat
        food["raw_ingredient"] = verdict.raw_ingredient
        food["meal_slot"] = verdict.meal_slot
        food["frequency"] = verdict.frequency
        food["exotic"] = verdict.exotic
        food["label_confidence"] = verdict.confidence   # name mapping
        food["label_reason"] = verdict.reason           # name mapping
        updated += 1
    return updated


# ---------------------------------------------------------------------------
# CSV output  (T2.7)
# ---------------------------------------------------------------------------

_REPORT_HEADERS = [
    "id", "name", "brand", "category", "subgroup",
    "ready_to_eat", "raw_ingredient", "meal_slot", "frequency",
    "exotic", "confidence", "reason", "batch_index", "labeled_at",
]

_FAILURE_HEADERS = [
    "id", "name", "batch_index", "failure_reason", "raw_response",
]


def _write_csv(path: Path, headers: list[str], rows: list[dict]) -> None:
    """Write a CSV file with UTF-8 BOM encoding per spec REQ-E."""
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=headers,
            delimiter=",",
            quoting=csv.QUOTE_MINIMAL,
            extrasaction="ignore",
        )
        writer.writeheader()
        writer.writerows(rows)


def write_outputs(
    db: list[dict],
    all_verdicts: list[tuple[int, FoodVerdict, str]],  # (batch_idx, verdict, labeled_at)
    all_failures: list[dict],
    db_path: Path,
    *,
    pilot_mode: bool,
) -> None:
    """Atomic DB write (non-pilot) + audit CSVs per spec REQ-E + design §6.

    pilot_mode=True: database.json is NOT modified. Writes pilot CSV only.
    pilot_mode=False: atomic backup → tmp → os.replace, then main CSV.
    """
    scripts_dir = db_path.parent / "scripts"

    if not pilot_mode:
        # 1. Backup
        ts = int(time.time())
        backup = Path(f"{db_path}.bak.{ts}")
        shutil.copy2(db_path, backup)
        _log(f"BACKUP created: {backup.name}")

        # 2. Write to .tmp
        tmp = Path(f"{db_path}.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(db, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())

        # 3. Atomic rename
        os.replace(tmp, db_path)
        _log(f"DB written atomically to {db_path.name}")

        report_path = scripts_dir / "bulk_label_report.csv"
    else:
        report_path = scripts_dir / "bulk_label_report.pilot.csv"

    # 4. Report CSV
    report_rows = []
    for batch_idx, verdict, labeled_at in all_verdicts:
        # Find food metadata from db for name/brand/category/subgroup
        # (best-effort — verdict has id only)
        report_rows.append(
            {
                "id": verdict.id,
                "name": "",  # populated below if found in db
                "brand": "",
                "category": "",
                "subgroup": "",
                "ready_to_eat": verdict.ready_to_eat,
                "raw_ingredient": verdict.raw_ingredient,
                "meal_slot": verdict.meal_slot,
                "frequency": verdict.frequency,
                "exotic": verdict.exotic,
                "confidence": verdict.confidence,
                "reason": verdict.reason,
                "batch_index": batch_idx,
                "labeled_at": labeled_at,
            }
        )

    # Enrich report rows with db metadata
    db_by_id = {str(f.get("id", "")): f for f in db}
    for row in report_rows:
        food = db_by_id.get(row["id"])
        if food:
            row["name"] = food.get("name", food.get("nombre", ""))
            row["brand"] = food.get("brand", food.get("marca", "")) or ""
            row["category"] = food.get("category", food.get("categoria", "")) or ""
            row["subgroup"] = food.get("subgroup", food.get("subgrupo", "")) or ""

    _write_csv(report_path, _REPORT_HEADERS, report_rows)
    _log(f"REPORT written: {report_path.name} ({len(report_rows)} rows)")

    # 5. Failures CSV
    failures_path = scripts_dir / "bulk_label_failures.csv"
    _write_csv(failures_path, _FAILURE_HEADERS, all_failures)
    _log(f"FAILURES written: {failures_path.name} ({len(all_failures)} rows)")


# ---------------------------------------------------------------------------
# Run orchestration
# ---------------------------------------------------------------------------

def _make_batches(foods: list[FoodInput], batch_size: int) -> list[list[FoodInput]]:
    return [foods[i : i + batch_size] for i in range(0, len(foods), batch_size)]


async def run_batches(
    batches: list[list[FoodInput]],
    client: httpx.AsyncClient,
    cfg: Config,
    total_batches: int,
    *,
    start_batch_label: int = 1,
    is_pilot: bool = False,
) -> tuple[list[tuple[int, FoodVerdict, str]], list[dict]]:
    """Process all batches with concurrency. Returns (verdicts_with_meta, failures)."""
    sem = asyncio.Semaphore(cfg.concurrency)
    all_verdicts: list[tuple[int, FoodVerdict, str]] = []
    all_failures: list[dict] = []

    async def bounded(idx: int, batch: list[FoodInput]) -> BatchResult:
        batch_label = start_batch_label + idx
        if is_pilot:
            _log(f"PILOT_START batch={batch_label}/{total_batches} size={len(batch)}")
        result = await process_batch_with_retry(idx, batch, client, sem, cfg)
        return result

    tasks = [bounded(i, b) for i, b in enumerate(batches)]
    results: list[BatchResult] = await asyncio.gather(*tasks)

    batch_ids_by_idx: dict[int, dict[str, FoodInput]] = {
        i: {f.id: f for f in b} for i, b in enumerate(batches)
    }

    for i, result in enumerate(results):
        batch_label = start_batch_label + i
        batch_map = batch_ids_by_idx[i]
        labeled_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        if result.error is None:
            latency_ms = 0  # not tracked per-batch in this impl; placeholder
            _log(
                f"BATCH_OK batch={batch_label}/{total_batches} "
                f"labeled={len(result.verdicts)} failed={len(result.failed_ids)} "
                f"latency_ms={latency_ms}"
            )
            for v in result.verdicts:
                all_verdicts.append((batch_label, v, labeled_at))
        else:
            # Failures: one row per unprocessed food
            raw_resp = result.raw_response or ""
            for food_id in result.failed_ids:
                food = batch_map.get(food_id)
                all_failures.append(
                    {
                        "id": food_id,
                        "name": food.name if food else "",
                        "batch_index": batch_label,
                        "failure_reason": result.error,
                        "raw_response": raw_resp if result.error == "parse_failed" else "",
                    }
                )
            # Also any unmatched inputs not in failed_ids
            matched_ids = {v.id for v in result.verdicts} | set(result.failed_ids)
            for food_id, food in batch_map.items():
                if food_id not in matched_ids:
                    all_failures.append(
                        {
                            "id": food_id,
                            "name": food.name,
                            "batch_index": batch_label,
                            "failure_reason": result.error or "unknown",
                            "raw_response": "",
                        }
                    )

    return all_verdicts, all_failures


# ---------------------------------------------------------------------------
# Entry point  (T2.1 / T2.7)
# ---------------------------------------------------------------------------

async def main() -> None:
    args = parse_args()
    cfg = Config()

    # CLI overrides
    if args.concurrency is not None:
        cfg.concurrency = args.concurrency
    if args.batch_size is not None:
        cfg.batch_size = args.batch_size

    # Load DB
    db = load_db(cfg.db_path)
    _log(f"Loaded {len(db)} foods from {cfg.db_path.name}")

    # --force confirmation (REQ-F)
    if args.force:
        print(f"¿Confirmar --force sobre {len(db)} foods? [yes/N] ", end="", flush=True)
        answer = input().strip().lower()
        if answer != "yes":
            print("Aborted.")
            sys.exit(0)

    # Filter pending
    foods = filter_pending(db, force=args.force)
    skipped = len(db) - len(foods)
    _log(f"Pending: {len(foods)} foods to label, {skipped} already labeled (skipped)")

    if not foods:
        elapsed = 0
        _log(
            f"DONE total={len(db)} success=0 failed=0 skipped={skipped} elapsed=0s"
        )
        sys.exit(0)

    # Pilot mode
    pilot_mode = args.pilot is not None
    if pilot_mode:
        pilot_n = args.pilot
        foods = foods[:pilot_n]
        _log(f"PILOT mode: processing first {len(foods)} foods")

    # Dry run
    batches = _make_batches(foods, cfg.batch_size)
    total_batches = len(batches)
    _log(
        f"Plan: {len(foods)} foods → {total_batches} batches of up to {cfg.batch_size}"
    )

    if args.dry_run:
        _log("DRY_RUN — no API calls will be made. Exiting.")
        sys.exit(0)

    if not cfg.api_key:
        print("ERROR: GLM_API_KEY is not set. Add it to .env.", file=sys.stderr)
        sys.exit(1)

    # Run
    t_start = time.monotonic()
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(cfg.http_timeout, connect=10.0),
        headers={
            "Authorization": f"Bearer {cfg.api_key}",
            "Content-Type": "application/json",
        },
    ) as client:
        try:
            all_verdicts, all_failures = await run_batches(
                batches,
                client,
                cfg,
                total_batches,
                is_pilot=pilot_mode,
            )
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (401, 403):
                print(
                    f"GLM_API_KEY rejected (HTTP {exc.response.status_code}). "
                    "Check .env.",
                    file=sys.stderr,
                )
                sys.exit(2)
            raise

    # Merge verdicts into DB (non-pilot only)
    verdict_objects = [v for _, v, _ in all_verdicts]
    if not pilot_mode:
        merge_verdicts_into_db(verdict_objects, db)

    # Write outputs
    write_outputs(
        db,
        all_verdicts,
        all_failures,
        cfg.db_path,
        pilot_mode=pilot_mode,
    )

    # Summary
    t_elapsed = time.monotonic() - t_start
    elapsed_str = (
        f"{int(t_elapsed // 60)}m{int(t_elapsed % 60)}s"
        if t_elapsed >= 60
        else f"{int(t_elapsed)}s"
    )
    success_count = len(verdict_objects)
    failed_count = len(all_failures)

    _log(
        f"DONE total={len(db)} success={success_count} failed={failed_count} "
        f"skipped={skipped} elapsed={elapsed_str}"
    )


if __name__ == "__main__":
    asyncio.run(main())
