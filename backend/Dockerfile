# syntax=docker/dockerfile:1.7
# ---------- base: dependencias del sistema compartidas ----------
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends libglib2.0-0 curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---------- deps: solo pyproject para cachear la capa de dependencias ----------
FROM base AS deps
COPY pyproject.toml ./
RUN mkdir -p src/plano3d && touch src/plano3d/__init__.py \
 && pip install --prefix=/install ".[ocr]"  && pip install --prefix=/install --no-deps "rapidocr-onnxruntime>=1.4"

# ---------- dev: incluye herramientas de test/lint, código montado por volumen ----------
FROM base AS dev
COPY pyproject.toml ./
RUN mkdir -p src/plano3d && touch src/plano3d/__init__.py \
 && pip install -e ".[dev,ocr]" && pip install --no-deps "rapidocr-onnxruntime>=1.4"
COPY . .
RUN pip install -e ".[dev]" --no-deps
ENV PLANO3D_MODE=full
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn plano3d.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir src"]

# ---------- prod: imagen mínima, usuario sin privilegios ----------
FROM base AS prod
COPY --from=deps /install /usr/local
COPY src ./src
COPY alembic ./alembic
COPY alembic.ini pyproject.toml ./
# red de muros (onnxruntime); los .pt de entrenamiento no entran (.dockerignore)
COPY models ./models
ENV PLANO3D_MODELS_DIR=/app/models
RUN pip install --no-deps . \
 && useradd --create-home --uid 10001 app \
 && mkdir -p /app/data && chown app /app/data
USER app
ENV PLANO3D_MODE=full
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD curl -fsS http://localhost:8000/api/health || exit 1
CMD ["sh", "-c", "alembic upgrade head && uvicorn plano3d.main:app --host 0.0.0.0 --port 8000 --proxy-headers --workers 2"]
