"""
export_review_csv.py

Aggregates all review_<domain>.csv files generated in Phase 1 PLUS any foods
in database.json that still have subgroup=null/empty/? after Phase 1 runs.
Deduplicates by food id.
Output: scripts/review_pending.csv

Columns: id, name, brand, current_subgroup, suggested_subgroup, confidence, notes

Usage:
  python3 scripts/export_review_csv.py
"""

import json
import csv
import os

SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DB_PATH      = os.path.join(PROJECT_ROOT, 'database.json')
OUTPUT_CSV   = os.path.join(SCRIPT_DIR, 'review_pending.csv')

DOMAIN_CSVS = [
    ('protein', os.path.join(SCRIPT_DIR, 'review_protein.csv')),
    ('dairy',   os.path.join(SCRIPT_DIR, 'review_dairy.csv')),
    ('fat',     os.path.join(SCRIPT_DIR, 'review_fat.csv')),
    ('carbs',   os.path.join(SCRIPT_DIR, 'review_carbs.csv')),
]

FIELDNAMES = ['id', 'name', 'brand', 'current_subgroup', 'suggested_subgroup', 'confidence', 'notes']


def main():
    seen_ids = {}     # id -> row dict (dedup)
    domain_counts = {}

    # 1. Read all domain review CSVs
    for domain, path in DOMAIN_CSVS:
        if not os.path.exists(path):
            print(f'  WARNING: {path} not found — skipping {domain}')
            domain_counts[domain] = 0
            continue
        count = 0
        with open(path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                food_id = row.get('id', '').strip()
                if not food_id:
                    continue
                if food_id not in seen_ids:
                    seen_ids[food_id] = row
                    count += 1
                # else: already seen from another domain — keep first occurrence
        domain_counts[domain] = count
        print(f'  {domain}: {count} rows loaded from review_{domain}.csv')

    # 2. Add remaining foods in DB with subgroup=null/"?"/"" not already in the queue
    with open(DB_PATH, 'r', encoding='utf-8') as f:
        raw = json.load(f)
    foods = raw['foods']

    null_added = 0
    for food in foods:
        food_id = food.get('id', '')
        sg = food.get('subgroup')
        if sg in (None, '', '?') and food_id not in seen_ids:
            seen_ids[food_id] = {
                'id':                food_id,
                'name':              food.get('name', ''),
                'brand':             food.get('brand', '') or '',
                'current_subgroup':  str(sg),
                'suggested_subgroup': '',
                'confidence':        'manual',
                'notes':             f'category={food.get("category","?")} — subgroup null post-Phase1',
            }
            null_added += 1

    print(f'  Additional null-subgroup foods not in any review CSV: {null_added}')

    # 3. Write deduplicated output
    rows = list(seen_ids.values())
    # Sort by confidence (low first) then name
    confidence_order = {'low': 0, 'medium': 1, 'manual': 2, 'high': 3}
    rows.sort(key=lambda r: (confidence_order.get(r.get('confidence', 'manual'), 99), r.get('name', '')))

    with open(OUTPUT_CSV, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(rows)

    # 4. Summary
    total = len(rows)
    print(f'\n=== export_review_csv.py ===')
    print(f'Output: {OUTPUT_CSV}')
    print(f'Total rows (deduped): {total}')
    print(f'\nBreakdown by domain:')
    for domain, count in domain_counts.items():
        print(f'  {domain}: {count}')
    print(f'  additional_null: {null_added}')

    conf_counts = {}
    for row in rows:
        conf = row.get('confidence', 'unknown')
        conf_counts[conf] = conf_counts.get(conf, 0) + 1
    print(f'\nBy confidence level:')
    for conf, cnt in sorted(conf_counts.items(), key=lambda x: -x[1]):
        print(f'  {conf}: {cnt}')


if __name__ == '__main__':
    main()
