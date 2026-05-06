"""judge.py — selective LLM fallback for runtime culinary judgment.

Endpoint POST /judge accepts an origin food + up to 50 candidates with their
bulk-label flags. Returns a reordered ranked_ids list + a removed_ids list.
Failures degrade to no-op (caller responsibility to handle). Cache is in-memory
TTLCache keyed by (db_version, origin_id, hash(sorted candidate_ids)).

Provider switching is env-only — same OpenAI SDK client for both GLM (z.ai)
and DeepSeek. See design §7 for the matrix.

NEVER raises HTTPException for LLM-side failures: returns 200 with
cache="error" and ranked_ids = [c.id for c in req.candidates] (no-op).
The frontend always gets a valid verdict shape.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from collections import defaultdict, deque
from typing import Literal

from fastapi import APIRouter, HTTPException
from openai import AsyncOpenAI
from openai import APIError, APITimeoutError, RateLimitError
from pydantic import BaseModel, Field, ConfigDict

from _judge_prompt import SYSTEM_PROMPT, build_judge_user_message, JUDGE_PROMPT_VERSION
from judge_cache import JudgeCache, make_cache_key

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Config (read once at import) ──────────────────────────────────────────────
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.z.ai/api/coding/paas/v4")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "glm-5-turbo")
LLM_TIMEOUT_S = float(os.getenv("LLM_TIMEOUT_MS", "3000")) / 1000.0
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.1"))
LLM_JUDGE_ENABLED = os.getenv("LLM_JUDGE_ENABLED", "true").lower() != "false"
LLM_MAX_CANDIDATES = int(os.getenv("LLM_MAX_CANDIDATES", "50"))

# ── Provider identification ────────────────────────────────────────────────────
def _detect_provider() -> str:
    if "z.ai" in LLM_BASE_URL:
        return "glm"
    if "deepseek" in LLM_BASE_URL:
        return "deepseek"
    return "unknown"

PROVIDER = _detect_provider()

# ── Lazy client singleton ──────────────────────────────────────────────────────
_client: AsyncOpenAI | None = None

_client_timeout_s: float | None = None

def _get_client() -> AsyncOpenAI:
    """Lazy singleton — rebuilt if LLM_TIMEOUT_MS env var changed since last
    construction. Reads env vars at call time so .env reloads take effect
    without process restart."""
    global _client, _client_timeout_s
    current_timeout = float(os.getenv("LLM_TIMEOUT_MS") or (LLM_TIMEOUT_S * 1000)) / 1000.0
    if _client is None or _client_timeout_s != current_timeout:
        api_key = os.getenv("LLM_API_KEY", "") or LLM_API_KEY
        base_url = os.getenv("LLM_BASE_URL", "") or LLM_BASE_URL
        if not api_key:
            raise RuntimeError(
                "LLM_API_KEY is empty. Check microservicio/.env contains "
                "LLM_API_KEY=<your-key> and that load_dotenv() runs before "
                "this client is constructed (see main.py top imports)."
            )
        logger.info(
            "[llm-judge] initializing AsyncOpenAI base_url=%s key_len=%d timeout_s=%.1f",
            base_url, len(api_key), current_timeout,
        )
        _client = AsyncOpenAI(
            base_url=base_url,
            api_key=api_key,
            timeout=current_timeout,
        )
        _client_timeout_s = current_timeout
    return _client

# ── Pydantic models ────────────────────────────────────────────────────────────

class FoodFlags(BaseModel):
    """One food item — shared shape for both origin and candidates.

    extra="ignore" so the frontend can pass _sortScore, equivalentAmount, etc.
    without triggering a 422. Only the culinary-relevant fields are used.
    """
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    category: str | None = None
    subgroup: str | None = None
    ready_to_eat: bool | None = None
    raw_ingredient: bool | None = None
    meal_slot: str | None = None
    frequency: str | None = None
    exotic: bool | None = None
    label_confidence: int | None = None
    calories: float | None = None


class JudgeRequest(BaseModel):
    origin: FoodFlags
    candidates: list[FoodFlags] = Field(min_length=1, max_length=LLM_MAX_CANDIDATES)
    debug_triggers: list[str] = Field(default_factory=list)  # ["S2","S4"] advisory


class JudgeResponse(BaseModel):
    ranked_ids: list[str]
    removed_ids: list[str] = []
    provider: str = PROVIDER
    cache: Literal["hit", "miss", "error", "disabled"]
    latency_ms: int
    tokens_in: int | None = None
    tokens_out: int | None = None
    prompt_version: str = JUDGE_PROMPT_VERSION
    error: str | None = None


# ── In-memory cache + stats ────────────────────────────────────────────────────
_cache: JudgeCache | None = None

_stats: dict = {
    "total_calls": 0,
    "cache_hits": 0,
    "cache_misses": 0,
    "errors": 0,
    "disabled_skips": 0,
    "latencies_ms": deque(maxlen=200),   # bounded ring buffer
    "trigger_counts": defaultdict(int),
    "started_at": time.time(),
}


def init_cache(db_version: str) -> None:
    """Called from main.py lifespan AFTER db_version is computed."""
    global _cache
    _cache = JudgeCache(
        db_version=db_version,
        max_size=int(os.getenv("LLM_CACHE_MAX_ENTRIES", "1000")),
        ttl_s=int(os.getenv("LLM_CACHE_TTL_S", "86400")),
    )
    logger.info(
        "judge cache initialized db_version=%s max=%s ttl_s=%s",
        db_version,
        os.getenv("LLM_CACHE_MAX_ENTRIES", "1000"),
        os.getenv("LLM_CACHE_TTL_S", "86400"),
    )


# ── Server-side trigger sanity check (advisory only) ──────────────────────────

def evaluate_triggers(req: JudgeRequest) -> list[str]:
    """Re-evaluate triggers server-side for logging and stats.

    The CLIENT is the source of truth (it has _sortScore for S6).
    This check is advisory: it never blocks a call, it just logs a warning
    if zero triggers fire server-side while the client sent none either.
    """
    fired: set[str] = set()
    o = req.origin

    for c in req.candidates:
        if c.label_confidence is not None and c.label_confidence < 70:
            fired.add("S1")
        if c.raw_ingredient is True and o.raw_ingredient is not True:
            fired.add("S2")
        if c.ready_to_eat is None:
            fired.add("S3")
        if c.subgroup is None or o.subgroup is None:
            fired.add("S4")
        if o.calories and o.calories > 0 and c.calories is not None:
            if abs(c.calories - o.calories) / o.calories > 1.0:
                fired.add("S5")
        # S6 not evaluable server-side (no _sortScore) — trust client

    return sorted(fired)


# ── LLM invocation ────────────────────────────────────────────────────────────

def build_messages(req: JudgeRequest) -> list[dict]:
    """Compose the [system, user] messages list for the LLM call."""
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": build_judge_user_message(
                req.origin, req.candidates, req.debug_triggers
            ),
        },
    ]


async def call_llm(
    messages: list[dict],
) -> tuple[str, int | None, int | None]:
    """One AsyncOpenAI call. Returns (text, tokens_in, tokens_out).

    Raises APIError / APITimeoutError / RateLimitError on failure.
    GLM's "thinking" mode is disabled via extra_body for classification tasks
    (per bulk-label decision D12). Silently ignored by DeepSeek.
    """
    client = _get_client()

    extra_body = {}
    if "z.ai" in LLM_BASE_URL:
        # Disable chain-of-thought for GLM on coding plan — reduces latency,
        # prevents token bleed into the structured JSON output.
        extra_body = {"thinking": {"type": "disabled"}}

    resp = await client.chat.completions.create(
        model=LLM_MODEL,
        messages=messages,
        temperature=LLM_TEMPERATURE,
        max_tokens=4096,
        extra_body=extra_body if extra_body else None,
    )

    text = resp.choices[0].message.content or ""
    usage = getattr(resp, "usage", None)
    tokens_in = getattr(usage, "prompt_tokens", None)
    tokens_out = getattr(usage, "completion_tokens", None)
    return text, tokens_in, tokens_out


# ── Verdict parser ────────────────────────────────────────────────────────────
_JSON_BLOCK_RE = re.compile(r"\{[\s\S]*?\}", re.MULTILINE)
_JSON_GREEDY_RE = re.compile(r"\{[\s\S]*\}", re.MULTILINE)


def parse_verdict(
    text: str, candidate_ids: list[str]
) -> tuple[list[str], list[str]]:
    """3-tier extraction: json.loads → regex block → fallback ValueError.

    Defensive rules:
    - drops ids not in the input set (LLM hallucinations)
    - appends any input ids the LLM omitted from ranked_ids (preserves input order)
    - never raises on "inventend" ids — just silently filters them

    Raises ValueError if no JSON block with ranked_ids can be found.
    """
    cand_set = set(candidate_ids)

    # Tier 1: whole text as JSON
    try:
        obj = json.loads(text.strip())
        return _extract_from_obj(obj, cand_set, candidate_ids)
    except (json.JSONDecodeError, ValueError):
        pass

    # Tier 2: extract first/largest JSON block
    for pattern in (_JSON_GREEDY_RE, _JSON_BLOCK_RE):
        m = pattern.search(text)
        if m:
            try:
                obj = json.loads(m.group(0))
                return _extract_from_obj(obj, cand_set, candidate_ids)
            except (json.JSONDecodeError, ValueError):
                continue

    raise ValueError(
        f"no parseable JSON with ranked_ids found in LLM output: {text[:300]!r}"
    )


def _extract_from_obj(
    obj: dict, cand_set: set[str], candidate_ids: list[str]
) -> tuple[list[str], list[str]]:
    """Extract ranked_ids/removed_ids from a parsed dict. Raises ValueError if
    ranked_ids is absent. Silently drops unknown ids."""
    if "ranked_ids" not in obj:
        raise ValueError("ranked_ids key missing from parsed object")

    removed = [i for i in obj.get("removed_ids", []) if i in cand_set]
    removed_set = set(removed)
    ranked = [i for i in obj["ranked_ids"] if i in cand_set and i not in removed_set]

    # Append any input ids the LLM omitted (original order for stability)
    seen = set(ranked) | removed_set
    for cid in candidate_ids:
        if cid not in seen:
            ranked.append(cid)

    return ranked, removed


# ── FastAPI handlers ──────────────────────────────────────────────────────────

@router.post("/judge", response_model=JudgeResponse)
async def judge_handler(req: JudgeRequest) -> JudgeResponse:
    """POST /judge — culinary ranking fallback via LLM.

    Returns HTTP 200 on ALL LLM failures with ranked_ids = input order (no-op).
    Returns HTTP 422 only on Pydantic validation failure (wrong input shape).
    Returns HTTP 503 when LLM_JUDGE_ENABLED=false (server-side kill-switch).
    """
    t0 = time.perf_counter()
    _stats["total_calls"] += 1

    # Track which triggers the client reported
    for t in req.debug_triggers:
        _stats["trigger_counts"][t] += 1

    # Server-side kill-switch
    if not LLM_JUDGE_ENABLED:
        _stats["disabled_skips"] += 1
        latency = int((time.perf_counter() - t0) * 1000)
        raise HTTPException(
            status_code=503,
            detail="LLM judge is disabled (LLM_JUDGE_ENABLED=false)",
        )

    cand_ids = [c.id for c in req.candidates]
    cand_ids_sorted = sorted(cand_ids)

    # Cache lookup
    key = make_cache_key(req.origin.id, cand_ids_sorted) if _cache else None
    if _cache and key:
        cached = _cache.get(key)
        if cached is not None:
            _stats["cache_hits"] += 1
            ranked, removed = cached
            latency = int((time.perf_counter() - t0) * 1000)
            _stats["latencies_ms"].append(latency)
            logger.info(
                "[llm-judge] CALL latency_ms=%d cache=hit provider=%s triggers=%s",
                latency, PROVIDER, req.debug_triggers,
            )
            return JudgeResponse(
                ranked_ids=ranked,
                removed_ids=removed,
                cache="hit",
                latency_ms=latency,
            )

    # Cache MISS — call LLM
    _stats["cache_misses"] += 1

    # Advisory server-side trigger check (logged, never blocks)
    server_triggers = evaluate_triggers(req)
    if not server_triggers and not req.debug_triggers:
        logger.warning(
            "[llm-judge] warning: no triggers detected server-side "
            "and client sent none — may be unnecessary call"
        )

    try:
        # Read timeout lazily so env changes take effect on next call without
        # restarting the worker. Falls back to module-level constant if env unset.
        timeout_s = float(os.getenv("LLM_TIMEOUT_MS") or (LLM_TIMEOUT_S * 1000)) / 1000.0
        text, tokens_in, tokens_out = await asyncio.wait_for(
            call_llm(build_messages(req)),
            timeout=timeout_s,
        )
        ranked, removed = parse_verdict(text, cand_ids)

        if _cache and key:
            _cache.set(key, (ranked, removed))

        latency = int((time.perf_counter() - t0) * 1000)
        _stats["latencies_ms"].append(latency)
        logger.info(
            "[llm-judge] CALL latency_ms=%d tokens_in=%s tokens_out=%s "
            "cache=miss provider=%s triggers=%s",
            latency, tokens_in, tokens_out, PROVIDER, req.debug_triggers,
        )
        return JudgeResponse(
            ranked_ids=ranked,
            removed_ids=removed,
            cache="miss",
            latency_ms=latency,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
        )

    except (
        APITimeoutError,
        asyncio.TimeoutError,
        APIError,
        RateLimitError,
        ValueError,
        json.JSONDecodeError,
        Exception,
    ) as e:
        _stats["errors"] += 1
        error_type = type(e).__name__

        # Map error class to REQ-F error string
        if isinstance(e, (asyncio.TimeoutError, APITimeoutError)):
            error_str = "timeout"
        elif isinstance(e, RateLimitError):
            error_str = "rate_limited"
        elif isinstance(e, APIError):
            error_str = "upstream_5xx"
        elif isinstance(e, (ValueError, json.JSONDecodeError)):
            error_str = "parse_error"
        else:
            error_str = "unknown"

        latency = int((time.perf_counter() - t0) * 1000)
        _stats["latencies_ms"].append(latency)
        # logger.exception emits FULL stack trace to stdout — needed to debug
        # "unknown" errors (anything not caught by the typed branches above).
        logger.exception(
            "[llm-judge] ERROR %s: %s — falling back to no-op (latency_ms=%d)",
            error_type, str(e)[:200], latency,
        )
        # Surface error class + message in response during dev (helps user
        # diagnose without tailing logs). Safe — no secrets in exception text.
        debug_detail = f"{error_type}: {str(e)[:300]}"
        return JudgeResponse(
            ranked_ids=cand_ids,
            removed_ids=[],
            cache="error",
            latency_ms=latency,
            error=f"{error_str} | {debug_detail}",
        )


@router.get("/judge/stats")
def stats_handler() -> dict:
    """GET /judge/stats — in-process observability counters.

    Resets on microservice restart. No auth — private Railway network only.
    """
    lat = list(_stats["latencies_ms"])
    total = _stats["total_calls"]
    cache_lookups = _stats["cache_hits"] + _stats["cache_misses"]

    # Top 3 triggers by count
    trigger_counts = dict(_stats["trigger_counts"])
    top_triggers = sorted(trigger_counts, key=lambda k: -trigger_counts[k])[:3]

    return {
        "total_calls": total,
        "cache_hits": _stats["cache_hits"],
        "cache_misses": _stats["cache_misses"],
        "cache_hit_rate": (
            round(_stats["cache_hits"] / cache_lookups, 4) if cache_lookups else 0.0
        ),
        "errors": _stats["errors"],
        "disabled_skips": _stats["disabled_skips"],
        "avg_latency_ms": int(sum(lat) / len(lat)) if lat else 0,
        "p95_latency_ms": (
            sorted(lat)[int(len(lat) * 0.95)] if len(lat) >= 20 else None
        ),
        "last_24h_calls": total,  # reset on restart, so this = session total
        "top_triggers": top_triggers,
        "trigger_counts": trigger_counts,
        "uptime_s": int(time.time() - _stats["started_at"]),
        "provider": PROVIDER,
        "model": LLM_MODEL,
        "enabled": LLM_JUDGE_ENABLED,
        "prompt_version": JUDGE_PROMPT_VERSION,
        "cache_stats": _cache.stats() if _cache else None,
    }
