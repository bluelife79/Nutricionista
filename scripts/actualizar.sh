#!/usr/bin/env bash
# =============================================================================
# scripts/actualizar.sh
# Ejecutar después de cualquier cambio en database.json.
#
# Hace cinco cosas en orden:
#   1. Reclasifica verduras mal categorizadas (fix_categories.py)
#   2. Marca golosinas y dulces (fix_sweets.py)
#   3. Marca platos preparados (fix_prepared.py)
#   4. Deduplica básicos repetidos (dedupe_basicos.py)
#   5. Regenera los embeddings semánticos (embed_foods.py)
#
# Todos los scripts son IDEMPOTENTES: correrlos varias veces produce el mismo
# resultado. No borran datos, solo agregan/modifican flags y categorías.
#
# Uso:
#   bash scripts/actualizar.sh
# =============================================================================

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   RevolucionaT — Actualizar base de datos    ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── PASO 1: Reclasificar verduras ────────────────────────────────────────────
echo "▶ Paso 1/5 — Reclasificando categorías..."
python3 scripts/fix_categories.py
echo ""

# ── PASO 2: Marcar golosinas y dulces ────────────────────────────────────────
echo "▶ Paso 2/5 — Marcando golosinas y dulces..."
python3 scripts/fix_sweets.py
echo ""

# ── PASO 3: Marcar platos preparados ─────────────────────────────────────────
echo "▶ Paso 3/5 — Marcando platos preparados..."
python3 scripts/fix_prepared.py
echo ""

# ── PASO 4: Deduplicar básicos ───────────────────────────────────────────────
echo "▶ Paso 4/5 — Deduplicando alimentos básicos..."
python3 scripts/dedupe_basicos.py
echo ""

# ── PASO 5: Regenerar embeddings ─────────────────────────────────────────────
echo "▶ Paso 5/5 — Regenerando embeddings semánticos..."
uv run --directory microservicio python3 ../scripts/embed_foods.py
echo ""

# ── RESUMEN ───────────────────────────────────────────────────────────────────
echo "╔══════════════════════════════════════════════╗"
echo "║                 ✅ LISTO                     ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "Archivos actualizados:"
echo "  • database.json          (categorías corregidas)"
echo "  • microservicio/data/    (embeddings nuevos)"
echo ""
echo "Para publicar los cambios:"
echo ""
echo "  git add database.json microservicio/data/"
echo "  git commit -m 'feat: agregar nuevos alimentos'"
echo "  git push"
echo ""
echo "Si usás GitHub Actions, el deploy es automático."
echo "Si no, ejecutá también: vercel --prod"
echo ""
