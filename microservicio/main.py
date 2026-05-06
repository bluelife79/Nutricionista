from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import numpy as np
import json
import os
import hashlib
import logging
from pathlib import Path

# Load microservicio/.env BEFORE any module that reads env vars at import time
# (judge.py reads LLM_API_KEY at module load — without this, AsyncOpenAI is
# constructed with empty key and fails with "Missing credentials").
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

from sentence_transformers import SentenceTransformer

from judge import router as judge_router, init_cache
from judge_cache import compute_db_version

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent / "data"
state: dict = {}


# ---------------------------------------------------------------------------
# Lifespan — load model and embeddings once at startup
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load model
    model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")
    state["model"] = model

    # Load embeddings matrix (N, 384), L2-normalized float32
    npz = np.load(DATA_DIR / "embeddings.npz")
    state["matrix"] = npz["matrix"]

    # Load id → row_index mapping
    with open(DATA_DIR / "index.json", encoding="utf-8") as f:
        state["index"] = json.load(f)

    # Load metadata
    with open(DATA_DIR / "meta.json", encoding="utf-8") as f:
        meta = json.load(f)
    state["meta"] = meta

    # Warn if database.json has changed since embeddings were generated (task 2.2)
    db_path = Path(__file__).parent.parent / "database.json"
    if db_path.exists():
        current_hash = hashlib.sha256(db_path.read_bytes()).hexdigest()
        if current_hash != meta.get("db_hash"):
            logger.warning(
                "embeddings may be stale: db hash mismatch. Re-run scripts/embed_foods.py"
            )

    # Initialize judge cache with a db_version fingerprint (MD5 of database.json).
    # Restarting the microservice after a database.json update invalidates all
    # cached verdicts automatically — different prefix → cache miss on all keys.
    db_version = compute_db_version(db_path)
    state["db_version"] = db_version
    init_cache(db_version)

    logger.info(
        "Model loaded. n_foods=%d, matrix shape=%s",
        len(state["index"]),
        state["matrix"].shape,
    )

    yield

    state.clear()


# ---------------------------------------------------------------------------
# App + CORS (task 2.3)
# ---------------------------------------------------------------------------

app = FastAPI(lifespan=lifespan)

ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "")
# En producción: setear ALLOWED_ORIGIN=https://tu-app.vercel.app
# En local: permite file://, Live Server, cualquier localhost
IS_PRODUCTION = bool(ALLOWED_ORIGIN)

if IS_PRODUCTION:
    origins = [o for o in [ALLOWED_ORIGIN] if o]
    origin_regex = None
else:
    # Dev: aceptar file:// (Origin: null), localhost:*, 127.0.0.1:*
    origins = ["null"]  # file:// protocol sends Origin: null
    origin_regex = r"https?://(localhost|127\.0\.0\.1)(:\d+)?"

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=origin_regex,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# Register LLM judge router (POST /judge, GET /judge/stats)
app.include_router(judge_router)


# ---------------------------------------------------------------------------
# Health (task 2.4)
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {
        "status": "ok" if "model" in state else "loading",
        "model_loaded": "model" in state,
        "n_foods": len(state.get("index", {})),
        "model": state.get("meta", {}).get("model", "unknown"),
    }


# ---------------------------------------------------------------------------
# Pydantic models (task 2.5)
# ---------------------------------------------------------------------------

class Candidate(BaseModel):
    id: str
    tier: int


class RerankRequest(BaseModel):
    query: str
    candidates: list[Candidate]


class RankedItem(BaseModel):
    id: str
    score: float
    tier: int


class RerankResponse(BaseModel):
    ranked: list[RankedItem]
    missing: list[str]
    model: str


# ---------------------------------------------------------------------------
# POST /rerank (tasks 2.6, 2.7)
# ---------------------------------------------------------------------------

@app.post("/rerank", response_model=RerankResponse)
def rerank(req: RerankRequest):
    # Guard: 503 if model not ready yet
    if "model" not in state:
        raise HTTPException(status_code=503, detail="Model not loaded yet")

    model: SentenceTransformer = state["model"]
    matrix: np.ndarray = state["matrix"]
    index: dict = state["index"]

    # Encode query — L2-normalize so dot product == cosine similarity
    query_vec = model.encode(req.query, normalize_embeddings=True)  # shape (384,)

    ranked: list[RankedItem] = []
    missing: list[str] = []

    for candidate in req.candidates:
        row = index.get(candidate.id)
        if row is None:
            # task 2.7: log structured warning, exclude from ranked, HTTP 200 still returned
            logger.warning("rerank: candidate id not in embedding index: %s", candidate.id)
            missing.append(candidate.id)
            continue

        score = float(np.dot(query_vec, matrix[row]))  # cosine similarity (both L2-normalized)
        ranked.append(RankedItem(id=candidate.id, score=score, tier=candidate.tier))

    # Sort: tier ASC, score DESC
    ranked.sort(key=lambda x: (x.tier, -x.score))

    return RerankResponse(
        ranked=ranked,
        missing=missing,
        model=state.get("meta", {}).get("model", "unknown"),
    )
