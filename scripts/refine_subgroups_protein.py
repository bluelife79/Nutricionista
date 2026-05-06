"""
refine_subgroups_protein.py

Classifies protein-category foods in database.json into canonical subgroups:
  meat_lean, meat_fatty, viscera, processed_meat,
  fish_white, fish_fatty, eggs, legumes, plant_protein, other

Contract:
- Idempotent: re-running produces no new changes.
- Backup: database.json.bak.<unix_ts> created before any write.
- Review queue: scripts/review_protein.csv for ambiguous foods.
- Diff report: printed to stdout.
- Only modifies foods in category == 'protein'.

Usage:
  python3 scripts/refine_subgroups_protein.py
  python3 scripts/refine_subgroups_protein.py --dry-run
"""

import json
import csv
import re
import os
import sys
import shutil
import time

# -- Paths -----------------------------------------------------------------------
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DB_PATH      = os.path.join(PROJECT_ROOT, 'database.json')
REVIEW_CSV   = os.path.join(SCRIPT_DIR, 'review_protein.csv')

DRY_RUN = '--dry-run' in sys.argv

# -- Canonical subgroup set for protein ------------------------------------------
CANONICAL_PROTEIN_SUBGROUPS = {
    'meat_lean', 'meat_fatty', 'viscera', 'processed_meat',
    'fish_white', 'fish_fatty', 'eggs', 'legumes', 'plant_protein', 'other',
}

# -- Classification rules (ordered by specificity — first match wins) -------------
# Each rule: (subgroup_key, regex_pattern)
# Pattern is matched case-insensitively against food name.
RULES = [
    # viscera — must come before meat rules to avoid 'higado de cerdo' -> meat_lean
    ('viscera', r'\b(h[ií]gado|ri[nñ][oó]n|callos?|coraz[oó]n|mollejas?|sesos|pulmones?|tripa|andrajos|menudillo|casqueria|ca[sz]quer[ií]a|mondongo|despojos?|víscera|viscera)\b'),

    # processed_meat — before lean/fatty to catch jamon cocido, jamon york, etc.
    # Expanded: espetec, longaniza more explicit, fuet, cansalada, cotna/cansalada curada
    ('processed_meat', r'\b(chorizo|choriza|salchich[oó]n|salchicha|frankfurt|mortadela|fuet|salami|butifarra|sobrasada|longaniza|morcilla|pat[eé]|fiambre|cecina|lomo\s+embuchado|jam[oó]n\s+(cocido|york|dulce|curado|serrano|ib[eé]rico)|jamon\s+(cocido|york|dulce|curado|serrano|ib[eé]rico)|paleta\s+(curada?|ib[eé]rica?)|torrezno|chicharr[oó]n|chicharritos?|chicharricos?\b|chistorra|bacon|panceta|beicon|filet[eo]\s+de\s+pavo\s+cocido|espetec|taquitos?\s+de\s+jam[oó]n|tiras\s+de\s+jam[oó]n|mini\s+taquitos?\s+de\s+jam[oó]n|pernil\s+(cuit|serrano|iberic)|pit\s+s[\'\"]?indiot|espatlla\s+curada|cansalada\s+(viada|curada)|lombo\b|chourico|jam[oó]ncitos\b|pincho\s+moruno|pinchos\s+estilo|confit\s+de\s+(canard|pato)|carpaccio|pernil\s+cuit|jamó\s+serrano|jamó\s+(de\s+cebo|gran\s+reserva|cocido)|jamoncitos\b|cotnes\b|choped?\s+de\s+pavo|paleta\s+de\s+cerdo\s+ib[eé]ric)\b'),

    # plant_protein — expanded with heura, tempeh, quorn, soja texturizada variants,
    # vegano/vegetariano, falafel, mycoprotein
    ('plant_protein', r'\b(tofu|seit[aá]n|soja\s+texturizada|proteína\s+(de\s+soja|vegetal)|proteina\s+(de\s+soja|vegetal)|tempeh|heura|texturizada|quorn|mycoprotein|falafel|vegano|vegana|vegetariano|vegetariana|proteína\s+vegetal|proteina\s+vegetal)\b'),

    # eggs
    ('eggs', r'\b(huevo|huevos|clara|yema|tortilla\s+francesa|revuelto\s+de\s+huevo)\b'),

    # legumes (protein context — dry legumes as protein source)
    ('legumes', r'\b(lenteja|garbanzo|jud[ií]as?\s+(blancas?|pintas?|negras?|rojas?)|alubias?|alubia|soja\s+(germinada)?|guisantes?\s+(secos?|proteicos?)|habas?\s+(secas?|proteicas?)|legumbre|edamame|mixbeans)\b'),

    # fish_fatty — before fish_white to capture oily fish
    # Expanded: sardinas/sardinhas/sardines/sardinetes (all forms), anchoa/anchoas,
    # trucha ahumada, salmon fume, saumon fume
    # Note: \b boundary doesn't work after 's' in "sardinas" so use sardina\w* form
    ('fish_fatty', r'(salm[oó]n|salm[oó]\b|salmó|at[uú]n\b|tonyina|caballas?\b|sardina\w*|sardinilla\w*|petinga\w*|boquer[oó]n\w*|anchoa\w*|anxova\w*|jurel\b|palometa\b|bonito\b|pez\s+espada|espad[ií]n\b|trucha\s+(de\s+mar|asalmonada|marina|ahumada)|arenque\b|ca[nñ]abota\b|melva\b|saumon\b|salmó\s+fumat)'),

    # fish_white — lean fish and seafood (low fat shellfish)
    # Expanded: potón/poton del pacifico, cigala, colas de langosta, vieiras
    ('fish_white', r'(merluza\b|bacalao\b|lubina\b|dorada\b|lenguado\b|gallos?\b|rape\b|rodaballo\b|mero\b|corvina\b|panga\b|faneca\b|abadejo\b|flet[aá]n\b|raya\b|besugo\b|salmonete\b|breca\b|dent[oó]n\b|serviola\b|halibut\b|lirio\b|cabracho\b|congrio\b|anguila\b|gambas?\b|gambón\b|gambòn\b|langostinos?\b|camar[oó]n\w*|mejill[oó]n\w*|almeja\w*|almejone\w*|berberecho\w*|pulpos?\b|sepias?\b|calamare\w*|coquina\b|ostras?\b|vieiras?\b|n[eé]cora\b|centollo\b|bogavante\b|cangrejo\w*|percebes?\b|navaja\b|chirla\b|surimi\b|cigalas?\b|langostas?\b|pot[oó]n\b|potones\b|chipiro\w*|pota\b)'),

    # Additional fish_white for anchovies/boquerones explicitly (various spellings)
    ('fish_white', r'(boquerone\w*|filetes?\s+de\s+anchoa\w*|filets\s+d[\'\"]anxova\w*|filets\s+d\'anxova)'),

    # meat_lean — lean cuts, low-fat poultry, rabbit, veal fillets
    # Expanded: burger_de_vacuno (lean), chicken wings (classify lean), T-bone steak
    # Also: generic 'pollo' and 'pavo' foods when not composite/fatty
    ('meat_lean', r'\b(pechuga|pechuguita|solomillo\s+(de\s+(pollo|pavo|cerdo|ternera|res|buey))?|solomillo\b|filete\s+(de\s+(ternera|res|buey|pollo|pavo))?|lomo\s+(de\s+cerdo\s+)?(magro|fresco|bajo\s+en\s+grasa)?|lomo\b|maxi\s+lomo|caña\s+lomo|escalopin|conejo|pavo\s+(en\s+filete|fileteado|pechuga|magro|asado|cocido|jumbo|supreme|big|lonchas?|finas)?|jumbo\s+pavo|big\s+pavo|supreme\s+pavo|m[aá]ximo\s+pavo|ternera\s+(magra|filete|escalope|bistec)?|redondo\s+de\s+(ternera|res)|tapa\s+de\s+(ternera|res)|babilla\s+de\s+(ternera|res)|aguja\s+de\s+ternera|carne\s+picada\s+(magra|de\s+pavo|de\s+pollo)|hamburguesa\s+(de\s+pavo|de\s+pollo|magra|pavo|pollo)|hamburgesa\b|burger\s+(de\s+(pavo|pollo|vacuno|novilho|cerdo)|meat\s+(pollo|pavo|vacuno|de\s+pollo|de\s+pavo|mixta|pollo\s+pavo)|pollo|de\s+pollo)|burget\s+meat|burguer|brocheta\s+de\s+(pollo|pavo)|brochetas?\s+de\s+pollo|yakitori|tiras\s+de\s+pollo|tiras\s+pollo|tiras\s+curadas?\s+de|pollo\s+(al\s+natural|desmenuzado|asado\s+troceado|asado\b|mechan|kampero|campero|bbq|rebozado|tikka|marinado|kong\s+pao|mostaza|relleno|con\s+champi|enrollado)|al\s+ajill[ií]\s+pavo|pollo\b|jamón\s+de\s+(ternera|pavo|cerdo\s+ibérico|cerdo\s+iberico|pierna)|jamon\s+de\s+(ternera|pavo|cerdo\s+ib[eé]rico)|t[\-\s]bone\s+steak|vacuno\b|novilho\b|magro\s+de\s+cerdo|carne\s+picada\s+de\s+vacuno|albóndigas\s+de\s+(pollo|pavo)|albondiga\s+de\s+(pollo|pavo)|albóndigas\s+pollo|nugets?\s+de\s+pollo|nuggets?\s+de\s+pollo|taquitos?\s+de\s+pollo|lonchas?\s+(finas\s+)?de\s+pavo|lonchas?\s+de\s+pavo|dados\s+de\s+pavo|todo\s+ave|extratierno\s+de\s+pollo|wurstel|wieners|picada\s+de\s+pavo|redondo\s+de\s+pollo|dim\s+sum\s+de\s+pollo|dim\s+sum\s+pollo|gyoza|gyozas|sangre\s+hervida|tender\s+de\s+pollo|cintas\s+marinadas\s+de\s+pollo|arrachera|chilorio|choped?\s+de\s+pavo)\b'),

    # meat_fatty — fatty cuts, lamb, duck, whole chicken pieces with skin
    # Expanded: alas/alitas (wings are fatty), albóndigas cerdo, manteca de cerdo
    ('meat_fatty', r'\b(muslo|contramuslo|ala\s+de\s+pollo|alitas?\b|alas\s+de\s+pollo|chuleta|costill[ao]|cordero|pato|cerdo\s+(graso|con\s+grasa)|lard[oó]n|lac[oó]n|codillo|morro|rabo|oreja|carrillera|papada|espalda\s+de\s+cordero|pierna\s+de\s+cordero|chuletillas?|falda\s+de\s+ternera|chuletas\s+de\s+(sajonia|cerdo)|chicken\s+wings|manteca\s+de\s+cerdo|zurrapa|budin\s+de\s+cerdo|albóndigas?\s+(de\s+cerdo|cerdo|de\s+cerdo\s+ib[eé]rico|vacuno\s+cerdo)|albóndigas\s+vacuno\s+cerdo|nems\s+cerdo|mixta\s+cerdo|elaborados\s+cerdo|chicharricos?\s+de\s+cerdo|paleta\s+(de\s+cerdo\s+ib[eé]ric|ibéric)|jamón\s+de\s+cerdo\s+ib[eé]rico|burger\s+gruesa|burger\s+meat\s+(vacuno\s+y\s+cerdo|vacuno\s+cerdo|mixta\s+vacuno|cerdo)|medio\s+pollo|muslo\s+de\s+pavo\s+cocido|pinchos?\s+andaluz|cerdo\s+ib[eé]rico)\b'),
]

# Composite/prepared meal keywords — flag for manual review
# Note: 'cocido' is NOT listed here because 'magro de cerdo cocido', 'lomo cocido' are
# single-ingredient cooked meats, not composite dishes.
# 'preparado' alone is too broad — use 'plato preparado' or more specific context.
COMPOSITE_PATTERN = re.compile(
    r'\b(estofado|guiso|cazuela|paella|potaje|plato\s+preparado|precoci|pizza|lasa[nñ]a|croqueta|empanada|tortilla\s+de\s+patata|bast[oó]n|fingers?\s+de|wrap|bocadillo|sandwich|s[aá]ndwich|men[uú]\b|combinado|ensaladilla|ravioli|tortelloni|fusilli\s+de|gnocchi|yakisoba|yakisobas?|fideos\s+(orientales|chinos)\s+(con|de|sabor)|noodles\s+(con|de|sabor)|calzone|sazonador\s+para|avecrem\b|parrillada\s+de\s+verduras\s+con|salteado\s+de\s+verduras\s+con|braseado\s+de\s+verduras\s+con|tarrito|puré\s+de\s+verdurit|crema\s+de\s+pollo\s+con\s+verduras|relleno\s+para\s+fajita|con\s+(arroz|pasta|fideos|verduras\s+(y|con)|patatas\s+y))\b',
    re.IGNORECASE
)


def classify_food(food):
    """
    Returns (new_subgroup, confidence, notes).
    confidence: 'high' | 'medium' | 'low'
    notes: string with reasoning
    """
    name = food.get('name', '') or ''

    # Flag composite/prepared dishes early — route to review
    if COMPOSITE_PATTERN.search(name):
        return None, 'low', 'plato preparado/compuesto — requiere revision manual'

    for subgroup, pattern in RULES:
        if re.search(pattern, name, re.IGNORECASE):
            return subgroup, 'high', f'matched rule: {subgroup}'

    return None, 'low', 'sin coincidencia de regla — revisar manualmente'


def main():
    # Load DB
    with open(DB_PATH, 'r', encoding='utf-8') as f:
        raw = json.load(f)

    foods = raw['foods']
    protein_foods = [f for f in foods if f.get('category') == 'protein']

    # Check idempotency: collect foods that need changes
    changes = []
    review_rows = []

    for food in protein_foods:
        current_sg = food.get('subgroup')

        # Already canonical — skip (idempotency)
        if current_sg in CANONICAL_PROTEIN_SUBGROUPS and current_sg != 'other':
            continue

        new_sg, confidence, notes = classify_food(food)

        if new_sg is None:
            # Route to review CSV
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

    # Diff report
    from collections import Counter
    transition_counts = Counter(
        (str(c['old_sg']), c['new_sg']) for c in changes
    )
    print(f'\n=== refine_subgroups_protein.py ===')
    print(f'Protein foods total:       {len(protein_foods)}')
    print(f'Changes to apply:          {len(changes)}')
    print(f'Routed to review CSV:      {len(review_rows)}')
    print(f'\nTransitions:')
    for (old, new), cnt in sorted(transition_counts.items(), key=lambda x: -x[1]):
        print(f'  {old} -> {new}: {cnt}')

    if DRY_RUN:
        print('\n[DRY RUN] No changes written.')
        return

    if not changes and not review_rows:
        print('\nAlready idempotent — no changes needed.')

    # Backup before any write
    if changes:
        ts = int(time.time())
        bak_path = DB_PATH + f'.bak.{ts}'
        shutil.copy2(DB_PATH, bak_path)
        print(f'\nBackup created: {bak_path}')

        # Apply changes
        food_index = {f['id']: f for f in foods}
        for change in changes:
            food_index[change['food']['id']]['subgroup'] = change['new_sg']

        with open(DB_PATH, 'w', encoding='utf-8') as f:
            json.dump(raw, f, ensure_ascii=False, indent=2)
        print(f'database.json updated.')
    else:
        print('\nNo subgroup changes needed (already canonical or no matches).')

    # Write review CSV (always, even if no changes — clears previous state)
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
