"""
import_review_csv.py

Reads the nutritionist-edited review_pending.csv and applies suggested_subgroup
changes to database.json. Validates that each suggested_subgroup is a known
canonical value. Invalid values are rejected with a console message.

Usage:
  python3 scripts/import_review_csv.py
  python3 scripts/import_review_csv.py --csv scripts/review_pending.csv
  python3 scripts/import_review_csv.py --dry-run

Idempotent: re-running with the same CSV produces no further changes.
"""

import json
import csv
import os
import sys
import shutil
import time

SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DB_PATH      = os.path.join(PROJECT_ROOT, 'database.json')

DRY_RUN = '--dry-run' in sys.argv

# Determine input CSV path from --csv flag or default
csv_arg = None
for i, arg in enumerate(sys.argv):
    if arg == '--csv' and i + 1 < len(sys.argv):
        csv_arg = sys.argv[i + 1]
INPUT_CSV = csv_arg or os.path.join(SCRIPT_DIR, 'review_pending.csv')

# Canonical allowed values — must match ALLOWED_SUBGROUPS keys in js/exchange_groups.js
# Keep this list in sync manually when new subgroups are added.
CANONICAL_SUBGROUPS = {
    # protein
    'meat_lean', 'meat_fatty', 'viscera', 'processed_meat',
    'fish_white', 'fish_fatty', 'eggs', 'legumes', 'plant_protein',
    # dairy
    'whole_dairy', 'low_fat_dairy', 'high_protein_dairy', 'aged_cheese', 'fresh_cheese',
    # fat
    'olive_oil', 'other_oils', 'nuts_seeds', 'butter_margarine', 'avocado',
    # carbs
    'grains', 'tubers', 'sweets_bakery',
    # fruit (existing, no changes)
    'fruit', 'tropical', 'frutos_bosque',
    # vegetables (existing, no changes)
    'leafy', 'cruciferous', 'allium', 'root_veg', 'stalk_veg', 'fruiting_veg', 'other_veg',
    # catch-all
    'other',
}


def main():
    if not os.path.exists(INPUT_CSV):
        print(f'ERROR: Input CSV not found: {INPUT_CSV}')
        print('Run export_review_csv.py first, then edit the CSV, then run this script.')
        sys.exit(1)

    # Load DB
    with open(DB_PATH, 'r', encoding='utf-8') as f:
        raw = json.load(f)
    foods = raw['foods']
    food_index = {f['id']: f for f in foods}

    # Read CSV
    with open(INPUT_CSV, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    n_applied  = 0
    n_skipped  = 0
    n_invalid  = 0
    n_no_change = 0
    invalid_rows = []

    changes = []

    for row in rows:
        food_id  = (row.get('id') or '').strip()
        suggested = (row.get('suggested_subgroup') or '').strip()

        if not food_id:
            n_skipped += 1
            continue

        if not suggested:
            # Blank suggested_subgroup — nutritionist left it empty, skip
            n_skipped += 1
            continue

        if suggested not in CANONICAL_SUBGROUPS:
            n_invalid += 1
            invalid_rows.append((food_id, row.get('name', ''), suggested))
            print(f'  ERROR: invalid subgroup "{suggested}" for id={food_id} ({row.get("name","")}) — skipping')
            continue

        food = food_index.get(food_id)
        if food is None:
            print(f'  WARNING: id={food_id} not found in database.json — skipping')
            n_skipped += 1
            continue

        current_sg = food.get('subgroup')
        if current_sg == suggested:
            # Already correct — idempotent
            n_no_change += 1
            continue

        changes.append({
            'food': food,
            'old_sg': current_sg,
            'new_sg': suggested,
        })
        n_applied += 1

    print(f'\n=== import_review_csv.py ===')
    print(f'Input CSV: {INPUT_CSV}')
    print(f'Total CSV rows: {len(rows)}')
    print(f'Applied (new changes): {n_applied}')
    print(f'Already correct (no-op): {n_no_change}')
    print(f'Skipped (blank suggested): {n_skipped}')
    print(f'Invalid subgroup value: {n_invalid}')

    if invalid_rows:
        print(f'\nInvalid values rejected (not in canonical list):')
        for fid, fname, bad_sg in invalid_rows:
            print(f'  id={fid} ({fname}) — "{bad_sg}"')
        print(f'\nValid canonical values are:')
        for sg in sorted(CANONICAL_SUBGROUPS):
            print(f'  {sg}')

    if DRY_RUN:
        print('\n[DRY RUN] No changes written.')
        return

    if not changes:
        print('\nNo changes to apply — database.json unchanged.')
        return

    # Backup before write
    ts = int(time.time())
    bak_path = DB_PATH + f'.bak.{ts}'
    shutil.copy2(DB_PATH, bak_path)
    print(f'\nBackup created: {bak_path}')

    # Apply changes
    for change in changes:
        food_index[change['food']['id']]['subgroup'] = change['new_sg']

    with open(DB_PATH, 'w', encoding='utf-8') as f:
        json.dump(raw, f, ensure_ascii=False, indent=2)
    print(f'database.json updated with {n_applied} changes.')


if __name__ == '__main__':
    main()
