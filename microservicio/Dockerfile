# =============================================================================
# Microservicio de re-ranking semántico — RevolucionaT
# =============================================================================
# Plataforma destino: Coolify, Railway, Render, Fly.io, o cualquier host
# que soporte Docker.
#
# Build context: este directorio (microservicio/), NO el root del repo.
# La plataforma debe configurarse con:
#   - Repository: github.com/tu-usuario/Nutricionista
#   - Base directory / Build context: /microservicio
#   - Dockerfile: ./Dockerfile (relativo al base directory)
#   - Port: 8000
#   - Health check path: /health
# =============================================================================

FROM python:3.11-slim

# Variables para que pip funcione más rápido y silencioso
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Dependencias del sistema (ninguna especial — sentence-transformers ya viene
# con torch CPU-only por default, sin compilar nada)
WORKDIR /app

# Primero copiamos solo los archivos de dependencias para aprovechar la
# cache de Docker. Si pyproject.toml/uv.lock no cambian, no se reinstala.
COPY pyproject.toml uv.lock* ./

# Instalamos uv (gestor de paquetes rápido) y las dependencias del proyecto
RUN pip install uv && \
    uv pip install --system --no-cache .

# Copiamos el resto del código y los embeddings pre-computados
COPY main.py ./
COPY data/ ./data/

# Pre-descargamos el modelo en el momento del build, no en el primer request.
# Esto hace que el primer arranque sea instantáneo (no descarga ~120MB).
RUN python -c "from sentence_transformers import SentenceTransformer; \
    SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')"

# La plataforma debe inyectar la variable PORT en runtime. Default 8000.
ENV PORT=8000
EXPOSE 8000

# Health check — la plataforma usa /health para saber si el servicio está OK
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen(f'http://localhost:{__import__(\"os\").environ.get(\"PORT\", 8000)}/health').read()" || exit 1

# Arranque con uvicorn. host=0.0.0.0 es obligatorio en contenedores.
# El puerto se lee de la variable de entorno (Coolify/Railway lo asignan).
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
