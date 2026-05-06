"""
consolidate_fruit_veg.py

Consolidates orphan fruit/veg subgroups in database.json into canonical parents
that exist in the ALLOWED_SUBGROUPS map in js/exchange_groups.js.

Mapping (per spec decisions):
  citricos (7)     -> fruit      (citrus is a fruit subtype)
  fruta_seca (21)  -> nuts_seeds (clinically a nut/seed group)
  hueso (8)        -> fruit      (stone fruits: peach, cherry, plum)
  melon_sandia (4) -> fruit      (watermelon/melon are fruits)
  otra_fruta (6)   -> fruit      (catch-all, base fruit)
  pepita (11)      -> nuts_seeds (pepitas/pumpkin seeds are seeds)
  uva (4)          -> fruit      (grapes are fruit)
  mushroom (8)     -> other_veg  (mushrooms classify with vegetables in Spanish
                                   exchange tables — not with fruits)

Contract:
- Idempotent: re-running detects there is nothing left to change.
- Backup: creates database.json.bak.<unix_ts> before any write.
- Does NOT add new keys to ALLOWED_SUBGROUPS.
- Does NOT touch js/exchange_groups.js or js/algorithm.js.

Usage:
  python3 scripts/consolidate_fruit_veg.py
  python3 scripts/consolidate_fruit_veg.py --dry-run
"""

import json
import os
import sys
import shutil
import time
from collections import Counter

SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DB_PATH      = os.path.join(PROJECT_ROOT, 'database.json')

DRY_RUN = '--dry-run' in sys.argv

# Orphan -> canonical parent mapping
CONSOLIDATION_MAP = {
    'citricos':    'fruit',
    'fruta_seca':  'nuts_seeds',
    'hueso':       'fruit',
    'melon_sandia':'fruit',
    'otra_fruta':  'fruit',
    'pepita':      'nuts_seeds',
    'uva':         'fruit',
    'mushroom':    'other_veg',
}

# Canonical ALLOWED_SUBGROUPS keys (for verification only — not modified)
ALLOWED_SUBGROUPS_KEYS = {
    'meat_lean', 'meat_fatty', 'viscera', 'processed_meat',
    'fish_white', 'fish_fatty', 'eggs', 'legumes', 'plant_protein',
    'whole_dairy', 'low_fat_dairy', 'high_protein_dairy', 'aged_cheese', 'fresh_cheese',
    'olive_oil', 'other_oils', 'nuts_seeds', 'butter_margarine', 'avocado',
    'grains', 'tubers', 'sweets_bakery',
    'fruit', 'tropical', 'frutos_bosque',
    'leafy', 'cruciferous', 'allium', 'root_veg', 'stalk_veg', 'fruiting_veg', 'other_veg',
    'other',
}


def main():
    with open(DB_PATH, 'r', encoding='utf-8') as f:
        raw = json.load(f)

    foods = raw['foods']

    # Collect all distinct subgroups BEFORE consolidation
    before_subgroups = {f.get('subgroup') for f in foods if f.get('subgroup')}
    orphans_before = before_subgroups - ALLOWED_SUBGROUPS_KEYS

    print(f'\n=== consolidate_fruit_veg.py ===')
    print(f'Total foods: {len(foods)}')
    print(f'Distinct subgroups before: {len(before_subgroups)}')
    print(f'Orphan subgroups before:   {len(orphans_before)}')
    for o in sorted(orphans_before):
        cnt = sum(1 for f in foods if f.get('subgroup') == o)
        target = CONSOLIDATION_MAP.get(o, 'UNMAPPED')
        print(f'  {o} ({cnt}) -> {target}')

    # Collect changes
    changes = []
    for food in foods:
        sg = food.get('subgroup')
        if sg in CONSOLIDATION_MAP:
            new_sg = CONSOLIDATION_MAP[sg]
            changes.append({'food': food, 'old_sg': sg, 'new_sg': new_sg})

    transition_counts = Counter(
        (c['old_sg'], c['new_sg']) for c in changes
    )
    print(f'\nChanges to apply: {len(changes)}')
    print('Transitions:')
    for (old, new), cnt in sorted(transition_counts.items(), key=lambda x: -x[1]):
        print(f'  {old} -> {new}: {cnt}')

    if DRY_RUN:
        print('\n[DRY RUN] No changes written.')
        # Show what orphans would remain
        remaining = orphans_before - set(CONSOLIDATION_MAP.keys())
        print(f'Orphans that would remain after: {len(remaining)}')
        for o in sorted(remaining):
            print(f'  {o}')
        return

    if not changes:
        print('\nAlready idempotent — no changes needed.')
        return

    # Backup
    ts = int(time.time())
    bak_path = DB_PATH + f'.bak.{ts}'
    shutil.copy2(DB_PATH, bak_path)
    print(f'\nBackup created: {bak_path}')

    # Apply
    food_index = {f['id']: f for f in foods}
    for change in changes:
        food_index[change['food']['id']]['subgroup'] = change['new_sg']

    with open(DB_PATH, 'w', encoding='utf-8') as f:
        json.dump(raw, f, ensure_ascii=False, indent=2)
    print(f'database.json updated.')

    # Verify after
    after_subgroups = {f.get('subgroup') for f in raw['foods'] if f.get('subgroup')}
    orphans_after = after_subgroups - ALLOWED_SUBGROUPS_KEYS
    print(f'\nDistinct subgroups after: {len(after_subgroups)}')
    print(f'Orphan subgroups after:   {len(orphans_after)}')
    if orphans_after:
        print('Remaining orphans (NOT in this script scope):')
        for o in sorted(orphans_after):
            cnt = sum(1 for food in raw['foods'] if food.get('subgroup') == o)
            print(f'  {o} ({cnt})')
    else:
        print('No orphan subgroups remain.')


if __name__ == '__main__':
    main()
