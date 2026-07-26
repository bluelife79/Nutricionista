# =============================================================================
# Microservicio LLM Judge — RevolucionaT
# =============================================================================
# Plataforma destino: Railway (con railway.json incluido en este directorio).
# Funciona también en Render, Fly.io y cualquier host Docker.
#
# Contenido del servicio (post sentence-transformers removal):
#   - POST /judge       → LLM fallback re-ranker (GLM dev / DeepSeek prod)
#   - GET  /judge/stats → cache hit rate, latencia, providers
#   - GET  /health      → liveness probe
#
# El semantic /rerank fue retirado para reducir el peso del Docker image
# (de ~2.5 GB con torch+transformers a ~300 MB sin ellos). Si se necesita
# en el futuro, restaurar deps en pyproject.toml + main.py desde git history.
#
# Build context: este directorio (microservicio/), NO el root del repo.
# Railway lo configura vía railway.json.
# =============================================================================

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Cache layer: only re-install if pyproject.toml or uv.lock change.
COPY pyproject.toml uv.lock* ./

RUN pip install uv && \
    uv pip install --system --no-cache .

# Application code only — no data/ directory needed without semantic rerank.
COPY main.py judge.py judge_cache.py _judge_prompt.py ./

# Database lives outside the image — mounted at runtime OR copied from the
# parent project root. For Railway: the parent's database.json is needed for
# db_version computation in judge_cache.py. Mount or copy at deploy time.

ENV PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen(f'http://localhost:{__import__(\"os\").environ.get(\"PORT\", 8000)}/health').read()" || exit 1

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
