"""
refine_subgroups_carbs.py

Classifies carbs-category foods in database.json into canonical subgroups:
  grains, tubers, sweets_bakery, other

NOTE: 'bread_pasta' is NOT used. Per spec REQ-A (which is authoritative over the
design draft), 'grains' is the single canonical key for all cereal/bread/pasta/rice
items. The design draft mentioned 'bread_pasta' as a sibling but the spec does not
enumerate it — spec wins.

Current DB state:
  fruit: 396 (cross-category misassignment — these stay as-is, wrong category not our scope)
  other_carbs: 339, grains: 329, None: 224, legumes: 91, tubers: 56, other: 45

Contract: idempotent, backup before write, review CSV for ambiguous foods.

Usage:
  python3 scripts/refine_subgroups_carbs.py
  python3 scripts/refine_subgroups_carbs.py --dry-run
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
REVIEW_CSV   = os.path.join(SCRIPT_DIR, 'review_carbs.csv')

DRY_RUN = '--dry-run' in sys.argv

CANONICAL_CARBS_SUBGROUPS = {
    'grains', 'tubers', 'sweets_bakery', 'other',
    # legacy canonical — legumes stays as-is under protein classification in this script
    # we do NOT touch legumes here (it's protein-side by design)
}

# Subgroups we intentionally leave alone (they belong here canonically)
LEAVE_ALONE = {'grains', 'tubers', 'legumes', 'other'}

# Rules: first match wins
RULES = [
    # sweets_bakery — industrial sweets, candy, pastries (high glycemic, refined)
    ('sweets_bakery', r'\b(gominola|caramelo|chuche|chicle|lollipop|piruleta|regaliz|nubes?|ositos?\s+de\s+gominola|gelatina\s+(de\s+azúcar|gomosa)|gominolas|chuches|candy)\b'),
    ('sweets_bakery', r'\b(bollería|croissant|donut|dónut|napolitana|palmera|berlín|berlines|suizo|magdalena|muffin|cupcake|bizcocho|brownie|galleta|cookie|barquillo|oblea|waffle|gofre|churro|buñuelo|pestiño)\b'),
    ('sweets_bakery', r'\b(helado|sorbete|polo\s+de\s+hielo|granizado|nieve)\b'),
    ('sweets_bakery', r'\b(chocolate\s+(con\s+(leche|almendra|avellana)|negro|blanco|fondant|puro|relleno)|tableta\s+de\s+chocolate|bombón|trufa|praline|cacao\s+(en\s+polvo|soluble)|nocilla|nutella|crema\s+de\s+cacao)\b'),
    ('sweets_bakery', r'\b(turrón|mazapán|polvorón|mantecado|nougat|toffee|fudge|mermelada\s+(industrial|azucarada)|confitura|miel\s+(como\s+dulce)?|jarabe|sirope|azúcar|glucosa|fructosa|dextrosa)\b'),

    # tubers — starchy root vegetables
    ('tubers', r'\b(patata|papa|boniato|batata|yuca|ñame|mandioca|taro|tapioca|raíz\s+de\s+mandioca)\b'),

    # grains — all cereals, bread, pasta, rice (single canonical key per spec REQ-A)
    # NOTE: 'bread_pasta' is intentionally absent — 'grains' covers everything
    ('grains', r'\b(arroz|pasta|espagueti|espaguetis|macarr[oó]n|macarrones|penne|fusilli|tallarines|fideos|lasaña|ñoquis|gnocchi|cuscús|couscous|bulgur|sémola)\b'),
    ('grains', r'\b(pan\s+(blanco|integral|de\s+molde|de\s+centeno|de\s+espelta|tostado|de\s+pueblo|baguette|chapata|ciabatta|pita|naan|tortilla\s+de\s+maíz|multilingüe)?|pan\b|baguette|chapata|pita|naan|rebanada\s+de\s+pan|tostada\b)\b'),
    ('grains', r'\b(avena|copos\s+de\s+avena|porridge|granola|müsli|muesli|corn\s+flakes|cereales?\s+de\s+desayuno|copos?\s+de\s+(maíz|arroz|trigo|cebada)|cereal\s+de\s+desayuno)\b'),
    ('grains', r'\b(quinoa|quinua|amaranto|espelta|mijo|sorgo|cebada|trigo\s+(sarraceno|tierno|duro)|kamut|centeno|escanda|farro|freekeh|teff)\b'),
    ('grains', r'\b(maíz\s+(en\s+grano|cocido|hervido)|palomita|tortita\s+de\s+(maíz|arroz|quinoa|espelta)|wasa|crackers?\s+(de\s+arroz|integrales?)|biscote|regañá)\b'),
    ('grains', r'\b(harina\s+de\s+(trigo|arroz|maíz|avena|centeno|espelta|garbanzo|almendra)|pan\s+rallado|rebozado|empanado)\b'),
]

COMPOSITE_PATTERN = re.compile(
    r'\b(ensalada\s+de|plato\s+preparado|preparado|precoci|pizza|lasaña\s+(preparada)|pasta\s+(con|al|a\s+la)|arroz\s+(con|al|a\s+la|frito|tres\s+delicias)|risotto\s+preparado)\b',
    re.IGNORECASE
)


def classify_food(food):
    name = food.get('name', '') or ''
    current_sg = food.get('subgroup')

    if COMPOSITE_PATTERN.search(name):
        return None, 'low', 'preparado compuesto — revisar manualmente'

    for subgroup, pattern in RULES:
        if re.search(pattern, name, re.IGNORECASE):
            return subgroup, 'high', f'matched rule: {subgroup}'

    # other_carbs legacy bucket — flag for review
    if current_sg == 'other_carbs':
        return None, 'medium', 'other_carbs genérico — determinar subgrupo específico'

    return None, 'low', 'sin coincidencia — revisar manualmente'


def main():
    with open(DB_PATH, 'r', encoding='utf-8') as f:
        raw = json.load(f)

    foods = raw['foods']
    carbs_foods = [f for f in foods if f.get('category') == 'carbs']

    changes = []
    review_rows = []

    for food in carbs_foods:
        current_sg = food.get('subgroup')

        # Leave canonical subgroups intact (idempotency)
        if current_sg in LEAVE_ALONE:
            continue

        # 'fruit' subgroup in carbs category is a cross-category misassignment
        # from a previous script run — do NOT touch (out of scope for this script)
        if current_sg == 'fruit':
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
    print(f'\n=== refine_subgroups_carbs.py ===')
    print(f'Carbs foods total:         {len(carbs_foods)}')
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
