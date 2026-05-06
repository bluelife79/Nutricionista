"""
refine_subgroups_dairy.py

Classifies dairy-category foods in database.json into canonical subgroups:
  whole_dairy, low_fat_dairy, high_protein_dairy, aged_cheese, fresh_cheese, other

Extended batch 2 goals:
- Drain cheese (108) -> aged_cheese / fresh_cheese with expanded keywords
- Drain basic_dairy (6) -> whole_dairy / low_fat_dairy / sweets_bakery
- Drain other_dairy (189) -> helados/postres -> sweets_bakery, nata -> whole_dairy,
  leche condensada -> sweets_bakery. Rest stays in other_dairy for manual review.

Contract: idempotent, backup before write, review CSV for ambiguous foods.

Usage:
  python3 scripts/refine_subgroups_dairy.py
  python3 scripts/refine_subgroups_dairy.py --dry-run
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
REVIEW_CSV   = os.path.join(SCRIPT_DIR, 'review_dairy.csv')

DRY_RUN = '--dry-run' in sys.argv

CANONICAL_DAIRY_SUBGROUPS = {
    'whole_dairy', 'low_fat_dairy', 'high_protein_dairy',
    'aged_cheese', 'fresh_cheese', 'other',
}

# Rules: first match wins, ordered by specificity.
# Also applies to foods with category != dairy (e.g., other_protein with cheeses)
# but only touched if their subgroup is non-canonical.
RULES = [
    # high_protein_dairy — specialty items with elevated protein
    ('high_protein_dairy', r'\b(skyr|yopro|yo[\s\-]*pro|quark|fromage\s+blanc|reques[oó]n|requezon|mat[oó]|prote[íi]na|proteico|protein\b|kyr\b|siggi|icelandic)\b'),

    # sweets_bakery — cross-domain move: ice cream, sweetened batidos, condensed milk,
    # dessert preparations with high sugar content
    # This WILL set subgroup=sweets_bakery on foods in category=dairy —
    # the drift detection in JS will flag them, but clinically it's correct.
    ('sweets_bakery', r'\b(helado|ice\s*cream|gelato|sorbete|semifr[ií]o|leche\s+condensada|leche\s+condensad|dulce\s+de\s+leche|flan\b|natillas?|pudding|mousse\b|tarta\b|tiramisú|tiramisu|postre\s+(l[aá]cteo|de\s+leche)|crema\s+catalana|panna\s+cotta|pannacotta|arroz\s+con\s+leche)\b'),

    # aged_cheese — hard/semi-hard cured cheeses
    # Expanded: semicurado without qualifier, añejo, viejo, curado without qualifier,
    # all named aged varieties (gouda, emmental, havarti, maasdam, edam, comté, etc.)
    # Also: multi-cheese blends (4 quesos, fondue, etc.) and "especial fundir/gratinar"
    ('aged_cheese', r'\b(manchego|parmesano|parmigiano|reggiano|pecorino|grana\s+padano|grana\s+padà|cheddar|gruy[eè]re?|emmental\w*|edam\b|gouda\w*|maasdam\w*|havarti\w*|com[té]e?\b|beaufort|appenzeller|curado\b|semicurado\b|a[nñ]ejo\b|viejo\b|abondance|raclette|queso\s+(manchego|oveja|cabra)\s*(curado|semicurado|añejo)?|idiazabal|zamorano|majorero|torta\s+del\s+casar|torta\s+(de\s+)?la\s+serena|provolone|provolón|mimolette|gouda\s+velho|formatge\s+(maasdam|edam)|especial\s+fundir|gratinar|[234]\s*quesos?|fondue\b|girasoles\s+quesos|queso\s+mezcla\s+(semi|tierno|curado)|cheese\s+(lonchas?|bloque?|rallado)|käse\b|fromage\s+(?!light|frais|blanc))\b'),

    # fresh_cheese — soft, high moisture, low fat cheeses
    # Expanded: mozzarella (all spellings), queso de untar/crema, queso blanco,
    # cottage, brie, camembert, queso tierno (tierno = fresh soft)
    ('fresh_cheese', r'\b(burgos\b|ricotta|mozzarella\w*|mozzarela\w*|queso\s+fresco|cottage\b|feta\b|mascarpone|cream\s+cheese|queso\s+(crema|de\s+untar|untable|blanco|tierno|cabra\s+fresco|cabra\s+tierno|cabra\s+maestro)|fromage\s+(frais|light)|neufch[aâ]tel|brie\b|camembert\b|queso\s+de\s+(cabra|oveja)\s*(fresco|tierno|rulo)?|rulo\s+de\s+cabra|mini\s+mozzarella|mozzarella\s+rallado|queso\s+sin\s+lactosa|queso\s+azul|quesito|queso\s+de\s+(Burgos|burgos)|queso\s+(blanco\s+pasteurizado|en\s+hilo|fundido?|lonchas?|dados?|rallado)|queso\s+(finas\s+hierbas|hierbas)|formatge\s+mozzarella)\b'),

    # low_fat_dairy — skimmed or semi-skimmed products
    # Note: 0% / 0,x% patterns don't use \b because digits+% don't form word boundaries
    ('low_fat_dairy', r'(?:\b(desnatado\w*|semidesnatado\w*|semi\s*desnatado\w*|light(?!\s+(cheese|cream))|slim|bajo\s+en\s+grasa|reducido\s+en\s+grasa|sin\s+grasa|skimmed|semi-skimmed|descremad\w*|reducida\s+en\s+grasa|reducido\s+grasa|reducidas?\s+calor[íi]as?)\b|(?<!\d)0[,.]?\d?\s*%)'),

    # whole_dairy — standard full-fat dairy (fallback for basic/other)
    # Expanded: nata/cream -> whole_dairy, leches pasterizada, bebida de soja,
    # yogures sabores (unspecified fat = whole), bebida lactea, bífidus (probiotic dairy)
    ('whole_dairy', r'\b(entero\b|whole\b|full[\s\-]?fat|leche\s+entera|leche\s+fresca\s+entera|leches?\s+(fresca\s+)?pasterizada|leche\s+UHT|yogur\w*\s+(entero|natural|de\s+soja|sabores?)\b|yogurt\w*\s+(entero|natural|de\s+soja|sabores?)\b|yogurt\w*\s+de\s+soja|yogurth?\s+de\s+soja|yogures\s+sabores|kefir\s+entero|kéfir\s+entero|nata\b|crema\s+de\s+leche|bebida\s+(de\s+(soja|arroz|avena|almendras?|coco)|l[aá]ctea)|bebida\s+sabor|leche\s+(semidesnatada|de\s+soja|de\s+avena)|lapte\b|latte\b|b[ií]fidus\b|proviact\b|assorted\s+yogurt|batido\s+de\s+(vainilla|chocolate|fresa)|cuidacol)\b'),
]

# Composite/prepared dairy patterns — send to review
COMPOSITE_DAIRY = re.compile(
    r'\b(bechamel|carbonara|salsa\s+(fresca|de\s+nata)|café\s+(latte|macchiato|capuccino|espresso)|latte\s+macchiato|caffè|bebida\s+de\s+soja\s+con\s+(extracto|café)|soja\s+para\s+cocinar|batido\s+con\s+(yogur|avena)|hoymecuido|tortellini|tortelloni|ravioli|girasoli|fusilli|pasta|pizza|lasaña|espinacas\s+a\s+la\s+crema|ensalada|ensaladilla|guiso|cacerola|tabla\s+de\s+quesos|gildas|mejillones|calamares|salsa\s+bolognese?|salsa\s+boloñesa)\b',
    re.IGNORECASE
)


def classify_food(food):
    name = food.get('name', '') or ''
    current_sg = food.get('subgroup')

    if COMPOSITE_DAIRY.search(name):
        return None, 'low', 'preparado lactico/compuesto — revisar manualmente'

    for subgroup, pattern in RULES:
        if re.search(pattern, name, re.IGNORECASE):
            return subgroup, 'high', f'matched rule: {subgroup}'

    # Generic cheese without subtype — needs manual review
    if re.search(r'\bqueso\b|\bcheese\b', name, re.IGNORECASE):
        # Try aged_cheese as best guess for unlabeled cheese
        return 'aged_cheese', 'medium', 'queso sin especificador — asignado aged_cheese (revisar si fresco)'

    # Generic dairy name without fat modifier — default whole_dairy
    if current_sg in ('basic_dairy', 'other_dairy', None):
        if re.search(r'\b(leche|yogur|yogurt|kefir|kéfir)\b', name, re.IGNORECASE):
            return 'whole_dairy', 'medium', 'lacteo basico sin especificador de grasa — asignado whole_dairy'

    return None, 'low', 'sin coincidencia — revisar manualmente'


def main():
    with open(DB_PATH, 'r', encoding='utf-8') as f:
        raw = json.load(f)

    foods = raw['foods']
    dairy_foods = [f for f in foods if f.get('category') == 'dairy']

    changes = []
    review_rows = []

    for food in dairy_foods:
        current_sg = food.get('subgroup')

        # Already canonical and not a generic catch-all — skip
        if current_sg in CANONICAL_DAIRY_SUBGROUPS and current_sg != 'other':
            continue

        # These legacy values need proper subtype:
        # basic_dairy -> whole_dairy/low_fat_dairy/sweets_bakery
        # cheese -> aged_cheese/fresh_cheese
        # other_dairy -> proper subtype or stays in review

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
    print(f'\n=== refine_subgroups_dairy.py ===')
    print(f'Dairy foods total:         {len(dairy_foods)}')
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
