#!/usr/bin/env python3
"""
scripts/audit_full_db.py

Auditoría exhaustiva de database.json en 12 dimensiones para verificar
que la base esté completa, coherente y lista para producción según el
brief de Hugo (mail 16/05/2026).

DIMENSIONES AUDITADAS:
  D1.  Campos obligatorios presentes (id, name, source, category, etc.)
  D2.  macro_profile alineado con macros (no declarar macro <2g)
  D3.  category ↔ subgroup coherente (plant_protein → protein, etc.)
  D4.  subgroup pertenece a lista canónica de exchange_groups
  D5.  dairy_subfamily presente cuando category=dairy
  D6.  oil_added consistente con category=fat + tokens
  D7.  exotic flag para casquería / mariscos raros / exóticos por nombre
  D8.  culinary_role asignado (5322 deben tenerlo)
  D9.  raw_ingredient coherente con cooking-state del nombre
  D10. Plausibilidad de macros (4P + 4C + 9F ≈ kcal ± 15%)
  D11. Nombres vagos / sin contexto ("Light", "Ligera", etc.)
  D12. Duplicados sospechosos (mismo nombre exacto, mismas macros)

Uso:
  python3 scripts/audit_full_db.py             # report a stdout
  python3 scripts/audit_full_db.py --csv out.csv   # también CSV
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "database.json"


# ── Canonical subgroups por category (derivado de exchange_groups.js) ──
ALLOWED_SUBGROUPS_BY_CAT = {
    "protein": {
        "meat_lean", "meat", "meat_fatty", "viscera", "processed_meat",
        "fish_white", "fish_fatty", "eggs", "plant_protein",
        "other_protein",
    },
    "carbs": {
        "grains", "tubers", "legumes", "sweets_bakery", "fruit",
        "tropical", "frutos_bosque", "other_carbs",
    },
    "fat": {
        "olive_oil", "other_oils", "avocado", "nuts_seeds",
        "other_fat", "butter_margarine",
    },
    "dairy": {
        "whole_dairy", "low_fat_dairy", "high_protein_dairy",
        "fresh_cheese", "aged_cheese", "other_dairy",
    },
    "postres_proteicos": {"high_protein_dairy", "fresh_cheese", "other_dairy"},
    "vegetables": {"vegetables", "fruiting_veg", "other_veg"},
    "fruits": {"fruit", "tropical", "frutos_bosque"},
    "other": {"other"},
}

DAIRY_SUBFAMILIES = {
    "frescos_proteicos", "quesos_solidos", "liquidos",
    "grasas_lacteas", "postres_lacteos",
}

VALID_CULINARY_ROLES = {
    "meal_dish", "staple", "snack", "recipe_ingredient", "dessert",
}

# Tokens que indican exotic / casquería que DEBERÍAN tener exotic=true
EXOTIC_TOKENS_RE = re.compile(
    r"\b("
    r"necora|percebe|bogavante|langosta|cigala|vieira|centollo|"
    r"buey de mar|ostra|navaja|erizo de mar|caracola|"
    r"anguila|morena|esturion|foie|chipiron|choco\b|"
    r"pulmon|higado de cordero|higado de cerdo|higado de ternera|"
    r"sesos|callos|molleja|rinones?|"
    r"lengua de cordero|lengua de ternera|"
    r"rabo de toro|rabo de vaca|morro|oreja de cerdo|"
    r"manitas de cerdo|sangrecilla|tripa|criadilla|"
    r"avestruz|jabali|ciervo|venado|canguro|"
    r"conejo silvestre|perdiz|codorniz|liebre|"
    r"bisonte|reno"
    r")\b"
)

# Tokens que indican oil_added (productos con aceite añadido)
OIL_ADDED_TOKENS_RE = re.compile(
    r"\b("
    r"frit[oa]s?|en aceite|con aceite|al aceite|"
    r"saltead[oa]s?|reboz[oa]d[oa]s?|escabech[ea]d[oa]s?|"
    r"sofrito|salsa|vinagreta|mayonesa|alioli|"
    r"tomate.*con aceite|ajos en aceite|pimientos en aceite|"
    r"berenjena.*frita|berenjena.*en aceite"
    r")\b"
)

# Plant protein
PLANT_PROTEIN_RE = re.compile(
    r"^(tofu|tempeh|seit[áa]n|soja\s+text|soja\s+desh|heura|"
    r"prote[íi]na\s+vegetal\s+textur)",
    re.IGNORECASE,
)

# Nombres "vagos" — palabra única corta sin contexto
VAGUE_NAMES_RE = re.compile(
    r"^(ligera?|light|natural|original|cl[áa]sica?|premium|"
    r"el\s+tri[áa]ngulo|el\s+abuelo|la\s+cl[áa]sica)$",
    re.IGNORECASE,
)


def _norm(s: str) -> str:
    if not s:
        return ""
    nfkd = unicodedata.normalize("NFKD", s.lower())
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def audit(foods: list[dict]) -> dict:
    """Run all 12 dimension audits, return dict of issue lists."""
    issues = defaultdict(list)

    # Stats agregados
    stats = {
        "total": len(foods),
        "by_source": Counter(),
        "by_category": Counter(),
        "by_culinary_role": Counter(),
        "by_subgroup_top20": Counter(),
        "missing_fields": Counter(),
    }

    # Para detectar duplicados
    seen_signatures = defaultdict(list)

    for food in foods:
        fid = food.get("id", "MISSING")
        name = (food.get("name") or "").strip()
        cat = food.get("category")
        sub = food.get("subgroup")
        src = food.get("source")
        nameN = _norm(name)

        stats["by_source"][src or "MISSING"] += 1
        stats["by_category"][cat or "MISSING"] += 1
        stats["by_culinary_role"][food.get("culinary_role") or "MISSING"] += 1
        stats["by_subgroup_top20"][sub or "MISSING"] += 1

        # D1: Campos obligatorios
        REQUIRED = ["id", "name", "source", "category", "macro_profile"]
        for f in REQUIRED:
            if not food.get(f):
                issues["D1_missing_required"].append({
                    "id": fid, "name": name, "field": f,
                })
                stats["missing_fields"][f] += 1

        # D2: macro_profile vs macros
        mp = food.get("macro_profile")
        if mp in ("protein", "carbs", "fat"):
            val = food.get(mp, 0) or 0
            if val < 2.0:
                issues["D2_macro_profile_anchor_absent"].append({
                    "id": fid, "name": name,
                    "macro_profile": mp, "value": val,
                    "P": food.get("protein"), "C": food.get("carbs"),
                    "F": food.get("fat"),
                })

        # D3: category ↔ subgroup coherente
        if cat and sub:
            allowed = ALLOWED_SUBGROUPS_BY_CAT.get(cat, set())
            if allowed and sub not in allowed and sub != "other":
                issues["D3_category_subgroup_mismatch"].append({
                    "id": fid, "name": name,
                    "category": cat, "subgroup": sub,
                    "allowed_sample": sorted(list(allowed))[:5],
                })

        # D4: subgroup en lista canónica global
        all_subs = set()
        for sset in ALLOWED_SUBGROUPS_BY_CAT.values():
            all_subs.update(sset)
        if sub and sub not in all_subs and sub not in ("other", None):
            issues["D4_subgroup_not_canonical"].append({
                "id": fid, "name": name, "subgroup": sub, "category": cat,
            })

        # D5: dairy debe tener dairy_subfamily
        if cat == "dairy":
            df = food.get("dairy_subfamily")
            if df not in DAIRY_SUBFAMILIES:
                issues["D5_dairy_missing_subfamily"].append({
                    "id": fid, "name": name, "dairy_subfamily": df,
                })

        # D6: oil_added consistencia
        if cat == "fat" and OIL_ADDED_TOKENS_RE.search(nameN):
            if food.get("oil_added") is not True:
                # name parece oil-added pero flag no está
                # algunos están bien por excepción (ej "Aceite de oliva extra
                # virgen" tiene "aceite" pero NO es oil_added)
                if not _norm(name).startswith("aceite "):
                    issues["D6_oil_added_missing_flag"].append({
                        "id": fid, "name": name,
                    })

        # D7: exotic flag para casquería/marisco raro
        if EXOTIC_TOKENS_RE.search(nameN):
            if food.get("exotic") is not True:
                issues["D7_exotic_token_no_flag"].append({
                    "id": fid, "name": name, "exotic": food.get("exotic"),
                })

        # D8: culinary_role asignado
        role = food.get("culinary_role")
        if role not in VALID_CULINARY_ROLES:
            issues["D8_culinary_role_invalid"].append({
                "id": fid, "name": name, "culinary_role": role,
            })

        # D9: raw_ingredient vs cooking-state
        cooked_re = re.compile(r"\b(cocido|cocida|hervido|hervida|asado|asada|"
                              r"frito|frita|plancha|al horno|guisado|guisada|"
                              r"al vapor|braseado|braseada|estofado|estofada)\b")
        raw_re = re.compile(r"\b(crudo|cruda|crudos|crudas)\b")
        is_cooked_name = cooked_re.search(nameN)
        is_raw_name = raw_re.search(nameN)
        raw_flag = food.get("raw_ingredient")
        if is_cooked_name and raw_flag is True:
            issues["D9_cooked_marked_raw"].append({
                "id": fid, "name": name,
            })
        if is_raw_name and raw_flag is False and cat in ("carbs",):
            # raw grano (arroz/quinoa/lenteja cruda) debería ser raw_ingredient
            if any(t in nameN for t in ["arroz", "quinoa", "lenteja", "garbanzo",
                                         "avena", "cebada", "centeno", "trigo"]):
                issues["D9_raw_marked_not_raw"].append({
                    "id": fid, "name": name,
                })

        # D10: plausibilidad macros
        p = food.get("protein") or 0
        c = food.get("carbs") or 0
        f_ = food.get("fat") or 0
        kcal = food.get("calories") or 0
        expected_kcal = 4 * p + 4 * c + 9 * f_
        if expected_kcal > 5 and kcal > 5:
            ratio = abs(expected_kcal - kcal) / max(expected_kcal, kcal)
            if ratio > 0.20:  # >20% diferencia
                issues["D10_macros_implausible"].append({
                    "id": fid, "name": name,
                    "declared_kcal": kcal, "computed_kcal": round(expected_kcal, 1),
                    "P": p, "C": c, "F": f_,
                })

        # Macros sospechosos extremos
        if p > 100 or c > 100 or f_ > 100:
            issues["D10_macros_out_of_range"].append({
                "id": fid, "name": name, "P": p, "C": c, "F": f_,
            })

        # D11: nombres vagos
        if name and len(name) < 30 and VAGUE_NAMES_RE.match(nameN):
            issues["D11_vague_name"].append({
                "id": fid, "name": name, "source": src,
            })

        # D12: duplicados (mismo nombre + macros muy parecidas)
        sig = (
            nameN,
            round(p, 1), round(c, 1), round(f_, 1), round(kcal, 0)
        )
        seen_signatures[sig].append(fid)

    # Procesar duplicados (más de 1 por firma)
    for sig, ids in seen_signatures.items():
        if len(ids) > 1:
            issues["D12_duplicates"].append({
                "name": sig[0],
                "macros": f"P={sig[1]} C={sig[2]} F={sig[3]} kcal={sig[4]}",
                "ids": ids,
                "count": len(ids),
            })

    return {"issues": issues, "stats": stats}


def print_report(result: dict) -> None:
    issues = result["issues"]
    stats = result["stats"]

    print()
    print("█" * 78)
    print("  AUDIT DATABASE.JSON — REPORTE COMPLETO (12 DIMENSIONES)".center(78))
    print("█" * 78)
    print()

    print(f"  Total alimentos: {stats['total']}")
    print()
    print("  Por source:")
    for src, cnt in stats["by_source"].most_common(10):
        print(f"    {src:<25} {cnt:>5}")
    print()
    print("  Por category:")
    for c, cnt in stats["by_category"].most_common():
        print(f"    {c:<25} {cnt:>5}")
    print()
    print("  Por culinary_role:")
    for r, cnt in stats["by_culinary_role"].most_common():
        print(f"    {r:<25} {cnt:>5}")
    print()

    DIMENSION_DESCS = {
        "D1_missing_required":          ("Campos obligatorios faltantes", "CRITICAL"),
        "D2_macro_profile_anchor_absent": ("macro_profile declara macro <2g", "HIGH"),
        "D3_category_subgroup_mismatch":  ("category ↔ subgroup incoherente", "HIGH"),
        "D4_subgroup_not_canonical":     ("subgroup fuera de lista canónica", "MEDIUM"),
        "D5_dairy_missing_subfamily":    ("dairy sin dairy_subfamily", "MEDIUM"),
        "D6_oil_added_missing_flag":     ("nombre indica oil_added pero falta flag", "LOW"),
        "D7_exotic_token_no_flag":       ("casquería/exótico sin flag exotic=true", "HIGH"),
        "D8_culinary_role_invalid":      ("culinary_role inválido o ausente", "CRITICAL"),
        "D9_cooked_marked_raw":          ("nombre cocido pero raw_ingredient=true", "MEDIUM"),
        "D9_raw_marked_not_raw":         ("grano crudo sin raw_ingredient=true", "MEDIUM"),
        "D10_macros_implausible":        ("kcal computado vs declarado difiere >20%", "MEDIUM"),
        "D10_macros_out_of_range":       ("macros >100g/100g (imposible)", "CRITICAL"),
        "D11_vague_name":                ("nombres vagos sin contexto", "LOW"),
        "D12_duplicates":                ("duplicados (mismo nombre + macros)", "LOW"),
    }

    print("=" * 78)
    print("  ISSUES POR DIMENSIÓN")
    print("=" * 78)
    print()

    SEVERITY_ORDER = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
    sorted_dims = sorted(
        DIMENSION_DESCS.items(),
        key=lambda kv: SEVERITY_ORDER[kv[1][1]],
    )

    for dim_key, (desc, sev) in sorted_dims:
        items = issues.get(dim_key, [])
        marker = "✅" if not items else ("🔴" if sev == "CRITICAL"
                                         else "🟠" if sev == "HIGH"
                                         else "🟡" if sev == "MEDIUM" else "⚪")
        print(f"  {marker} [{sev:<8}] {dim_key:<35} {desc}")
        print(f"           → {len(items)} entradas")
        if items:
            for it in items[:5]:
                if dim_key == "D12_duplicates":
                    print(f"             • {it['name'][:42]:42} ({it['count']}x) {it['macros']}")
                elif "name" in it:
                    extra = ""
                    if dim_key == "D2_macro_profile_anchor_absent":
                        extra = f"  mp={it['macro_profile']} val={it['value']} P={it['P']} F={it['F']}"
                    elif dim_key == "D3_category_subgroup_mismatch":
                        extra = f"  {it['category']}/{it['subgroup']}"
                    elif dim_key == "D7_exotic_token_no_flag":
                        extra = f"  exotic={it.get('exotic')}"
                    elif dim_key == "D10_macros_implausible":
                        extra = f"  decl={it['declared_kcal']} comp={it['computed_kcal']}"
                    elif dim_key == "D10_macros_out_of_range":
                        extra = f"  P={it['P']} C={it['C']} F={it['F']}"
                    elif dim_key == "D11_vague_name":
                        extra = f"  src={it.get('source')}"
                    print(f"             • {it.get('id','?'):20} {it['name'][:42]:42}{extra}")
            if len(items) > 5:
                print(f"             … ({len(items) - 5} más)")
        print()

    # Score global
    weights = {"CRITICAL": 100, "HIGH": 20, "MEDIUM": 5, "LOW": 1}
    total_score = sum(
        len(issues.get(dk, [])) * weights[sev]
        for dk, (_, sev) in DIMENSION_DESCS.items()
    )
    print("=" * 78)
    print(f"  HEALTH SCORE (lower is better): {total_score}")
    print(f"    CRITICAL: {sum(len(issues.get(dk, [])) for dk, (_, s) in DIMENSION_DESCS.items() if s == 'CRITICAL')}")
    print(f"    HIGH:     {sum(len(issues.get(dk, [])) for dk, (_, s) in DIMENSION_DESCS.items() if s == 'HIGH')}")
    print(f"    MEDIUM:   {sum(len(issues.get(dk, [])) for dk, (_, s) in DIMENSION_DESCS.items() if s == 'MEDIUM')}")
    print(f"    LOW:      {sum(len(issues.get(dk, [])) for dk, (_, s) in DIMENSION_DESCS.items() if s == 'LOW')}")
    print("=" * 78)


def export_csv(result: dict, path: Path) -> None:
    import csv
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["dimension", "severity", "id", "name", "detail"])
        DIM_SEV = {
            "D1_missing_required": "CRITICAL",
            "D2_macro_profile_anchor_absent": "HIGH",
            "D3_category_subgroup_mismatch": "HIGH",
            "D4_subgroup_not_canonical": "MEDIUM",
            "D5_dairy_missing_subfamily": "MEDIUM",
            "D6_oil_added_missing_flag": "LOW",
            "D7_exotic_token_no_flag": "HIGH",
            "D8_culinary_role_invalid": "CRITICAL",
            "D9_cooked_marked_raw": "MEDIUM",
            "D9_raw_marked_not_raw": "MEDIUM",
            "D10_macros_implausible": "MEDIUM",
            "D10_macros_out_of_range": "CRITICAL",
            "D11_vague_name": "LOW",
            "D12_duplicates": "LOW",
        }
        for dim, items in result["issues"].items():
            sev = DIM_SEV.get(dim, "?")
            for it in items:
                detail = json.dumps({k: v for k, v in it.items()
                                     if k not in ("id", "name")}, ensure_ascii=False)
                w.writerow([dim, sev, it.get("id", "?"), it.get("name", ""), detail])
    print(f"\n  CSV escrito: {path}")


def main() -> int:
    with DB_PATH.open(encoding="utf-8") as f:
        foods = json.load(f)
    result = audit(foods)
    print_report(result)
    if "--csv" in sys.argv:
        i = sys.argv.index("--csv")
        out = Path(sys.argv[i + 1]) if i + 1 < len(sys.argv) else ROOT / "audit_db_full.csv"
        export_csv(result, out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
