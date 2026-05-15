#!/usr/bin/env bash
# =============================================================================
# scripts/actualizar.sh
# Ejecutar después de cualquier cambio en database.json.
#
# Hace siete cosas en orden:
#   1. Reclasifica verduras mal categorizadas (fix_categories.py)
#   2. Reclasifica frutas mal categorizadas (fix_fruits.py)
#   3. Marca golosinas y dulces (fix_sweets.py)
#   4. Marca platos preparados (fix_prepared.py)
#   5. Mueve bebidas calientes con leche fuera de dairy (fix_beverages.py)
#   6. Deduplica básicos repetidos (dedupe_basicos.py)
#   7. Regenera los embeddings semánticos (embed_foods.py) + cuantización int8
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
echo "▶ Paso 1/6 — Reclasificando verduras..."
python3 scripts/fix_categories.py
echo ""

# ── PASO 2: Reclasificar frutas ──────────────────────────────────────────────
echo "▶ Paso 2/6 — Reclasificando frutas..."
python3 scripts/fix_fruits.py
echo ""

# ── PASO 3: Marcar golosinas y dulces ────────────────────────────────────────
echo "▶ Paso 3/6 — Marcando golosinas y dulces..."
python3 scripts/fix_sweets.py
echo ""

# ── PASO 4: Marcar platos preparados ─────────────────────────────────────────
echo "▶ Paso 4/7 — Marcando platos preparados..."
python3 scripts/fix_prepared.py
echo ""

# ── PASO 5: Mover bebidas calientes con leche fuera de dairy ─────────────────
echo "▶ Paso 5/7 — Reclasificando bebidas con leche (café/té/latte)..."
python3 scripts/fix_beverages.py
echo ""

# ── PASO 6: Deduplicar básicos ───────────────────────────────────────────────
echo "▶ Paso 6/7 — Deduplicando alimentos básicos..."
python3 scripts/dedupe_basicos.py
echo ""

# ── PASO 7: Regenerar embeddings ─────────────────────────────────────────────
echo "▶ Paso 7/7 — Regenerando embeddings semánticos..."
uv run --with "numpy>=2.0" --with "sentence-transformers>=5.0" \
  --directory microservicio python3 ../scripts/embed_foods.py
uv run --with "numpy>=2.0" \
  --directory microservicio python3 ../scripts/quantize_embeddings_browser.py
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
