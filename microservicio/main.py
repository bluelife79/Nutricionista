"""Microservicio minimal — LLM judge endpoint only.

The previous semantic /rerank endpoint (sentence-transformers + numpy) was
disabled to keep the Docker image small for Railway deploy. The LLM judge
fallback compensates: when search results need re-ranking, the LLM is called
selectively (trigger-gated). The frontend's /rerank fetch fails fast (404)
and falls back to the deterministic ranking.

To re-enable semantic rerank in the future:
  1. Restore sentence-transformers + numpy in pyproject.toml
  2. Restore lifespan model loading + /rerank handler from git history
  3. Set window.RERANK_ENABLED = true in the frontend
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path

# Load microservicio/.env BEFORE judge.py imports — judge reads LLM_API_KEY
# at module load time and AsyncOpenAI rejects empty keys.
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

from judge import router as judge_router, init_cache
from judge_cache import compute_db_version

logger = logging.getLogger(__name__)
state: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Compute db_version from database.json so the judge cache is namespaced
    # to the current DB content. Restarting after a DB update auto-invalidates
    # all cached verdicts (different prefix → miss on every key).
    db_path = Path(__file__).parent.parent / "database.json"
    db_version = compute_db_version(db_path)
    state["db_version"] = db_version
    init_cache(db_version)
    logger.info("microservicio ready — db_version=%s", db_version[:12])

    yield

    state.clear()


app = FastAPI(lifespan=lifespan)

ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "")
IS_PRODUCTION = bool(ALLOWED_ORIGIN)

if IS_PRODUCTION:
    origins = [o for o in [ALLOWED_ORIGIN] if o]
    origin_regex = None
else:
    # Dev: file://, localhost:*, 127.0.0.1:*
    origins = ["null"]
    origin_regex = r"https?://(localhost|127\.0\.0\.1)(:\d+)?"

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=origin_regex,
    allow_methods=["*"],   # was ["GET","POST"] — preflight OPTIONS was 400ing
    allow_headers=["*"],
    allow_credentials=False,
)

app.include_router(judge_router)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "rerank_enabled": False,
        "judge_enabled": os.getenv("LLM_JUDGE_ENABLED", "true").lower() != "false",
        "db_version": state.get("db_version", "unknown")[:12],
    }
