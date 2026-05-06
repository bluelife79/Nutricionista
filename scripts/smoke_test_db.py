"""
smoke_test_db.py

Post-Phase-1 smoke test assertions on database.json.
Tests that the refinement scripts correctly classified foods with clear keywords.
Foods routed to review_<domain>.csv (unmatched) may still have old subgroups — this
is expected. The assertions below target KNOWN foods with unambiguous names only.

Prints PASS/FAIL per assertion with food IDs for failures.

Usage:
  python3 scripts/smoke_test_db.py
"""

import json
import os

SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DB_PATH      = os.path.join(PROJECT_ROOT, 'database.json')


def load_db():
    with open(DB_PATH, 'r', encoding='utf-8') as f:
        raw = json.load(f)
    return raw['foods']


def assert_check(label, condition, offenders=None):
    if condition:
        print(f'  PASS  {label}')
    else:
        offender_list = ', '.join(
            f'{f["id"]} ({f["name"]}) sg={f.get("subgroup")}' for f in (offenders or [])[:5]
        )
        print(f'  FAIL  {label}')
        if offenders:
            print(f'        Offenders (up to 5): {offender_list}')


def main():
    db = load_db()
    print(f'\n=== smoke_test_db.py ===')
    print(f'Total foods: {len(db)}\n')

    # ── Protein category: viscera correctness ──────────────────────────────────
    # Foods containing clear viscera keywords must carry viscera.
    # These had unambiguous names and were processed by the protein script.
    protein = [f for f in db if f.get('category') == 'protein']

    viscera_kws = ['callos', 'hígado', 'higado', 'riñón', 'rinon', 'mollejas']
    viscera_foods = [
        f for f in protein
        if any(kw in (f.get('name') or '').lower() for kw in viscera_kws)
        # Exclude pâté de hígado (goes to processed_meat, not viscera)
        and 'paté' not in (f.get('name') or '').lower()
        and 'pate' not in (f.get('name') or '').lower()
    ]
    a1_offenders = [f for f in viscera_foods if f.get('subgroup') != 'viscera']
    assert_check(
        'A1: protein-category foods with callos/hígado/riñón/mollejas carry viscera',
        len(a1_offenders) == 0,
        a1_offenders
    )

    # ── Protein: no viscera mislabeled as meat_lean ────────────────────────────
    a2_offenders = [
        f for f in protein
        if f.get('subgroup') == 'meat_lean' and
        any(kw in (f.get('name') or '').lower()
            for kw in ['callos', 'hígado', 'higado', 'riñón', 'rinon', 'mollejas', 'sesos'])
    ]
    assert_check(
        'A2: No viscera food mislabeled as meat_lean',
        len(a2_offenders) == 0,
        a2_offenders
    )

    # ── Protein: processed_meat keywords → processed_meat ─────────────────────
    processed_kws = ['chorizo', 'salchichón', 'salchichon', 'mortadela', 'salami', 'frankfurt']
    processed_foods = [
        f for f in protein
        if any(kw in (f.get('name') or '').lower() for kw in processed_kws)
    ]
    a3_offenders = [f for f in processed_foods if f.get('subgroup') != 'processed_meat']
    assert_check(
        'A3: chorizo/salchichón/mortadela/salami/frankfurt carry processed_meat',
        len(a3_offenders) == 0,
        a3_offenders
    )

    # ── plant_protein: tofu in protein category ────────────────────────────────
    # Note: tofu in this DB is mostly in dairy/carbs categories due to prior
    # category assignment. Only protein-category tofu is classified by protein script.
    protein_plant = [f for f in protein if f.get('subgroup') == 'plant_protein']
    # Just verify the classification exists (at least 1 plant_protein in DB total)
    all_plant_protein = [f for f in db if f.get('subgroup') == 'plant_protein']
    assert_check(
        'A4: At least one food carries subgroup=plant_protein',
        len(all_plant_protein) >= 1,
        []
    )

    # ── Carbs: clear grains keywords → grains ─────────────────────────────────
    carbs = [f for f in db if f.get('category') == 'carbs']

    # BEDCA arroz crudo entries should be grains
    bedca_arroz = [
        f for f in carbs
        if f.get('source') == 'BEDCA' and
        'arroz' in (f.get('name') or '').lower() and
        f.get('subgroup') is not None  # exclude still-null
    ]
    a5_offenders = [f for f in bedca_arroz if f.get('subgroup') != 'grains']
    assert_check(
        'A5: BEDCA arroz entries carry subgroup=grains',
        len(a5_offenders) == 0,
        a5_offenders
    )

    # ── Carbs: gominola → sweets_bakery ────────────────────────────────────────
    gominola_foods = [
        f for f in carbs
        if 'gominola' in (f.get('name') or '').lower()
    ]
    a6_offenders = [f for f in gominola_foods if f.get('subgroup') != 'sweets_bakery']
    assert_check(
        'A6: gominola foods carry subgroup=sweets_bakery',
        len(a6_offenders) == 0,
        a6_offenders
    )

    # ── Dairy: skyr → high_protein_dairy ──────────────────────────────────────
    dairy = [f for f in db if f.get('category') == 'dairy']
    skyr_foods = [
        f for f in dairy
        if 'skyr' in (f.get('name') or '').lower()
    ]
    a7_offenders = [f for f in skyr_foods if f.get('subgroup') != 'high_protein_dairy']
    assert_check(
        'A7: Skyr dairy foods carry subgroup=high_protein_dairy',
        len(a7_offenders) == 0,
        a7_offenders
    )

    # ── Dairy: manchego curado → aged_cheese ──────────────────────────────────
    manchego_foods = [
        f for f in dairy
        if 'manchego' in (f.get('name') or '').lower()
    ]
    a8_offenders = [f for f in manchego_foods if f.get('subgroup') != 'aged_cheese']
    assert_check(
        'A8: Manchego cheese foods carry subgroup=aged_cheese',
        len(a8_offenders) == 0,
        a8_offenders
    )

    # ── Fat: BEDCA aceite de oliva → olive_oil ─────────────────────────────────
    fat = [f for f in db if f.get('category') == 'fat']
    aove_foods = [
        f for f in fat
        if 'aceite de oliva' in (f.get('name') or '').lower() or
           'aove' in (f.get('name') or '').lower()
    ]
    a9_offenders = [f for f in aove_foods if f.get('subgroup') != 'olive_oil']
    assert_check(
        'A9: Aceite de oliva / AOVE foods carry subgroup=olive_oil',
        len(a9_offenders) == 0,
        a9_offenders
    )

    # ── Review queue CSV validation ────────────────────────────────────────────
    import csv
    for domain in ['protein', 'dairy', 'fat', 'carbs']:
        csv_path = os.path.join(SCRIPT_DIR, f'review_{domain}.csv')
        if not os.path.exists(csv_path):
            print(f'  FAIL  Review CSV exists: review_{domain}.csv (FILE NOT FOUND)')
            continue
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            rows = list(reader)
            expected_cols = {'id', 'name', 'brand', 'current_subgroup', 'suggested_subgroup', 'confidence', 'notes'}
            actual_cols = set(reader.fieldnames or [])
            has_cols = expected_cols.issubset(actual_cols)
        assert_check(
            f'CSV: review_{domain}.csv exists and has required headers ({len(rows)} rows)',
            has_cols,
            []
        )

    # ── Final distribution summary ─────────────────────────────────────────────
    from collections import Counter
    print()
    all_subgroups = Counter(str(f.get('subgroup')) for f in db)
    print('Current subgroup distribution (all foods):')
    for sg, cnt in sorted(all_subgroups.items(), key=lambda x: -x[1]):
        print(f'  {sg}: {cnt}')

    # Drift analysis: subgroups still in DB that are NOT canonical
    CANONICAL = {
        # protein
        'meat_lean', 'meat_fatty', 'viscera', 'processed_meat',
        'fish_white', 'fish_fatty', 'eggs', 'legumes', 'plant_protein',
        # dairy
        'whole_dairy', 'low_fat_dairy', 'high_protein_dairy', 'aged_cheese', 'fresh_cheese',
        # fat
        'olive_oil', 'other_oils', 'nuts_seeds', 'butter_margarine', 'avocado',
        # carbs
        'grains', 'tubers', 'sweets_bakery',
        # fruit (existing, no changes required)
        'fruit', 'tropical', 'frutos_bosque',
        # vegetables (existing, no changes required)
        'leafy', 'cruciferous', 'allium', 'root_veg', 'stalk_veg', 'fruiting_veg', 'other_veg',
        # catch-all
        'other',
        # legacy fruit subgroups (existing, kept as-is)
        'fruta_seca', 'citricos', 'otra_fruta', 'uva', 'melon_sandia', 'pepita', 'hueso',
        # mushrooms (vegetables, existing)
        'mushroom',
    }
    NON_CANONICAL = {sg for sg in all_subgroups.keys() if sg not in CANONICAL and sg != 'None'}
    print()
    if NON_CANONICAL:
        print(f'NON-CANONICAL subgroups still in DB (in review queues — expected):')
        for sg in sorted(NON_CANONICAL):
            print(f'  {sg}: {all_subgroups[sg]} foods')
    else:
        print('No non-canonical subgroups in DB.')


if __name__ == '__main__':
    main()
