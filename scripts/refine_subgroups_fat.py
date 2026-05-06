"""
refine_subgroups_fat.py

Classifies fat-category foods in database.json into canonical subgroups:
  olive_oil, other_oils, nuts_seeds, butter_margarine, avocado, other

Current DB state:
  other_fat: 200, olive_oil: 188, nuts_seeds: 121, None: 61, other: 15, fish: 10, ...

Contract: idempotent, backup before write, review CSV for ambiguous foods.

Usage:
  python3 scripts/refine_subgroups_fat.py
  python3 scripts/refine_subgroups_fat.py --dry-run
"""

import json
import csv
import re
import os
import sys
import shutil
import time
from collections import Counter

SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DB_PATH      = os.path.join(PROJECT_ROOT, 'database.json')
REVIEW_CSV   = os.path.join(SCRIPT_DIR, 'review_fat.csv')

DRY_RUN = '--dry-run' in sys.argv

CANONICAL_FAT_SUBGROUPS = {
    'olive_oil', 'other_oils', 'nuts_seeds', 'butter_margarine', 'avocado', 'other',
}

# Rules: first match wins
RULES = [
    # olive_oil — all olive oil variants
    ('olive_oil', r'\b(aceite\s+de\s+oliva|aove|oliva\s+virgen|olive\s+oil|aceite\s+oliva)\b'),

    # avocado — before nuts to avoid 'guacamole de aguacate con nueces'
    ('avocado', r'\b(aguacate|avocado|guacamole)\b'),

    # butter_margarine — solid fats
    ('butter_margarine', r'\b(mantequilla|margarina|ghee|manteca|shortening)\b'),

    # nuts_seeds — nuts and seeds (broad)
    ('nuts_seeds', r'\b(almendra|nuez|nueces|avellana|cacahuete|pistacho|anacardo|castañas?|semillas?|pipas?\s+(de\s+girasol|de\s+calabaza)?|ch[ií]a|lino|sésamo|sesamo|cáñamo|cañamo|girasol\s+(semilla|pipa)|coco\s+rallado|crema\s+de\s+(cacahuete|almendra|frutos\s+secos)|tahini|tahín|mantequilla\s+de\s+(cacahuete|almendra)|pasta\s+de\s+(cacahuete|almendra)|frutos?\s+secos?)\b'),

    # other_oils — non-olive vegetable oils
    ('other_oils', r'\b(aceite\s+de\s+(girasol|maíz|maiz|coco|lino|colza|soja|sésamo|sesamo|palma|palmiste|nuez|argán|argan|borraja|onagra|oliva\s+suave|oliva\s+refinado|arroz|semilla|vid|uva|jojoba|rosa\s+mosqueta)|aceite\s+vegetal)\b'),
]


def classify_food(food):
    name = food.get('name', '') or ''
    current_sg = food.get('subgroup')

    for subgroup, pattern in RULES:
        if re.search(pattern, name, re.IGNORECASE):
            return subgroup, 'high', f'matched rule: {subgroup}'

    # other_fat is a legacy catch-all — flag for review
    if current_sg == 'other_fat':
        return None, 'medium', 'other_fat genérico — determinar subgrupo específico'

    return None, 'low', 'sin coincidencia — revisar manualmente'


def main():
    with open(DB_PATH, 'r', encoding='utf-8') as f:
        raw = json.load(f)

    foods = raw['foods']
    fat_foods = [f for f in foods if f.get('category') == 'fat']

    changes = []
    review_rows = []

    for food in fat_foods:
        current_sg = food.get('subgroup')

        # Already canonical — skip
        if current_sg in CANONICAL_FAT_SUBGROUPS and current_sg != 'other':
            continue

        new_sg, confidence, notes = classify_food(food)

        if new_sg is None:
            review_rows.append({
                'id': food.get('id', ''),
                'name': food.get('name', ''),
                'brand': food.get('brand', ''),
                'current_subgroup': str(current_sg),
                'suggested_subgroup': '',
                'confidence': confidence,
                'notes': notes,
            })
        else:
            if new_sg != current_sg:
                changes.append({
                    'food': food,
                    'old_sg': current_sg,
                    'new_sg': new_sg,
                })

    transition_counts = Counter(
        (str(c['old_sg']), c['new_sg']) for c in changes
    )
    print(f'\n=== refine_subgroups_fat.py ===')
    print(f'Fat foods total:           {len(fat_foods)}')
    print(f'Changes to apply:          {len(changes)}')
    print(f'Routed to review CSV:      {len(review_rows)}')
    print(f'\nTransitions:')
    for (old, new), cnt in sorted(transition_counts.items(), key=lambda x: -x[1]):
        print(f'  {old} -> {new}: {cnt}')

    if DRY_RUN:
        print('\n[DRY RUN] No changes written.')
        return

    if changes:
        ts = int(time.time())
        bak_path = DB_PATH + f'.bak.{ts}'
        shutil.copy2(DB_PATH, bak_path)
        print(f'\nBackup created: {bak_path}')

        food_index = {f['id']: f for f in foods}
        for change in changes:
            food_index[change['food']['id']]['subgroup'] = change['new_sg']

        with open(DB_PATH, 'w', encoding='utf-8') as f:
            json.dump(raw, f, ensure_ascii=False, indent=2)
        print(f'database.json updated.')
    else:
        print('\nNo subgroup changes needed.')

    with open(REVIEW_CSV, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(
            f,
            fieldnames=['id', 'name', 'brand', 'current_subgroup', 'suggested_subgroup', 'confidence', 'notes']
        )
        writer.writeheader()
        writer.writerows(review_rows)
    print(f'Review CSV written: {REVIEW_CSV} ({len(review_rows)} rows)')


if __name__ == '__main__':
    main()
