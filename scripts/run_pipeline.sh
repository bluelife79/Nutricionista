#!/usr/bin/env bash
set -euo pipefail

echo "=== Nutricionista Data Pipeline ==="
echo ""
echo "Step 1/5: Audit..."
python3 scripts/audit_data.py

echo "Step 2/5: Fix categories..."
python3 scripts/fix_categories.py

echo "Step 3/5: Fill subgroups..."
python3 scripts/fill_subgroups.py

echo "Step 4/5: Fix flags..."
python3 scripts/fix_flags.py

echo "Step 5/5: Minify..."
python3 scripts/minify_db.py

echo ""
echo "=== Pipeline completo ==="
echo "IMPORTANTE: Revisar scripts/subgroups_review.json antes de promover database_v4.json → database.json"
