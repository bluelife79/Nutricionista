#!/usr/bin/env python3
"""
fill_subgroups.py — Opción C: Reglas mejoradas + Claude Haiku para ambiguos.

Estrategia:
  Pass 1 — Reglas keyword+category (mejoradas, category filter más permisivo)
  Pass 2 — Claude Haiku API en batch para items sin match
  Pass 3 — Fallback por categoría para los que Haiku no clasifique con confianza

Outputs:
  database_v3.json                   — database con todos los subgroups asignados
  scripts/subgroups_changelog.json   — {id, name, assigned_subgroup, method}
  scripts/subgroups_review.json      — items con baja confianza (revisión manual)
"""

import copy
import json
import os
import unicodedata
from pathlib import Path

ROOT = Path(__file__).parent.parent
DB_PATH = ROOT / "database_v2.json"
OUT_DB = ROOT / "database_v3.json"
CHANGELOG_PATH = ROOT / "scripts" / "subgroups_changelog.json"
REVIEW_PATH = ROOT / "scripts" / "subgroups_review.json"

# ---------------------------------------------------------------------------
# Subgroups válidos
# ---------------------------------------------------------------------------
VALID_SUBGROUPS = {
    "grains", "meat", "fish", "fruit", "eggs", "cheese",
    "basic_dairy", "other_dairy", "high_protein_dairy",
    "legumes", "tubers", "olive_oil", "nuts_seeds",
    "other_fat", "other_carbs", "other_protein", "other",
}

# ---------------------------------------------------------------------------
# Reglas mejoradas
# (keywords_en_nombre_normalizado, category_filter_o_None, subgroup)
# - category_filter=None significa: aplica a cualquier categoría
# - Primera regla que matchea gana
# ---------------------------------------------------------------------------
RULES: list[tuple[list[str], list[str] | None, str]] = [
    # --- PESCADOS Y MARISCOS (category filter ampliado: protein + fat) ---
    (
        ["salmon", "merluza", "atun", "bacalao", "dorada", "lubina", "rape",
         "sardina", "anchoa", "boqueron", "gambas", "langostino", "camaron",
         "mejillon", "sepia", "pulpo", "calamar", "pescado", "pez espada",
         "emperor", "raya", "lenguado", "rodaballo", "gallo ", "besugo",
         "trucha", "carpa", "tilapia", "perca", "mero", "chicharro",
         "caballa", "jurel", "bonito", "palometa", "fletán", "halibut",
         "abadejo", "surimi", "mariscos", "langosta", "bogavante", "cangrejo",
         "necora", "percebe", "almeja", "berberecho", "ostra", "vieira",
         "navaja", "berberecho", "chipirón", "calamar",
         "faneca", "pijota", "panga", "breca", "sargo", "oblada",
         "chanquete", "pintarroja", "cazon", "anguila", "platija",
         "gallineta", "capellan", "siluro", "lucio", "lamprea"],
        None,
        "fish",
    ),
    # --- CARNES (category filter ampliado incluyendo dairy: tocino mal categorizado) ---
    (
        ["pollo", "pechuga", "pavo", "ternera", "cerdo", "vaca", "buey",
         "cordero", "conejo", "pato", "carne", "lomo", "filete", "costilla",
         "jamon", "embutido", "salchich", "chorizo", "morcilla", "bacon",
         "tocino", "panceta", "butifarra", "mortadela", "fuet", "sobrasada",
         "cecina", "bresaola", "carrillera", "magro", "codillo", "muslo",
         "alita", "menudillo", "higado", "rinon", "corazon", "mollejas",
         "liebre", "jabali", "venado", "codorniz", "perdiz",
         "salami", "pepperoni", "foie", "pate ", "paté"],
        ["protein", "fat", "other", "dairy"],
        "meat",
    ),
    # --- HUEVOS (fat incluido: yema de huevo tiene macro dominante grasa) ---
    (
        ["huevo", "clara", "yema"],
        ["protein", "fat", "other"],
        "eggs",
    ),
    # --- PROTEÍNAS VEGETALES / SUPLEMENTOS ---
    (
        ["tofu", "tempeh", "seitan", "proteina de", "whey", "caseina",
         "proteina vegetal", "proteina en polvo", "isolate", "concentrado proteico",
         "soja texturizada", "texturizado"],
        ["protein", "other"],
        "other_protein",
    ),
    # --- CEREALES Y GRANOS ---
    (
        ["arroz", "pasta ", "macarrones", "espagueti", "talarin", "fideo",
         "pan ", "panecillo", "baguette", "harina", "avena", "quinoa",
         "bulgur", "cuscus", "centeno", "trigo", "cebada", "mijo", "espelta",
         "salvado", "cereal", "corn flakes", "granola", "muesli", "polenta",
         "semola", "tortita", "galleta", "bizcocho", "brioche",
         "tostada", "crackers", "palomitas", "palomita", "gofio",
         "copos de", "puffed", "inflado"],
        ["carbs", "other"],
        "grains",
    ),
    # --- LEGUMBRES ---
    (
        ["lenteja", "garbanzo", "alubia", "judia", "guisante", "soja",
         "edamame", "legumbre", "frijol", "haba ", "mungo", "azuki",
         "altramuz", "lupino", "cacahuete hervido"],
        ["carbs", "protein", "other"],
        "legumes",
    ),
    # --- TUBÉRCULOS ---
    (
        ["patata", "boniato", "yuca", "name ", "mandioca", "tuberculo",
         "taro", "batata", "ñame", "chirivía", "nabo", "remolacha"],
        ["carbs", "other"],
        "tubers",
    ),
    # --- VERDURAS / HORTALIZAS → other_carbs ---
    (
        ["pimiento", "tomate", "zanahoria", "cebolla", "ajo ", "lechuga",
         "espinaca", "brocoli", "coliflor", "repollo", "col ", "pepino",
         "calabacin", "berenjena", "apio", "puerro", "alcachofa", "esparrago",
         "judias verdes", "acelga", "endibia", "endivia", "rucula", "canonigo",
         "berro", "lombarda", "cardo", "hinojo", "rabano", "champiñon",
         "seta", "hongo", "shiitake", "portobello", "boletus", "verdura",
         "hortaliza", "vegetal", "gazpacho", "pisto", "sofrito", "menestra",
         "ensalada", "escarola", "pak choi", "col rizada", "kale",
         "calabaza", "borraja", "alga ", "wakame", "nori ", "alcaparra",
         "aceitunas", "olive", "brecol", "brécol", "chayote", "bambu",
         "miso", "alfalfa", "germinado", "brote "],
        None,
        "other_carbs",
    ),
    # --- FRUTAS ---
    (
        ["manzana", "pera", "naranja", "mandarina", "platano", "fresa",
         "uva", "mango", "pina", "kiwi", "melocoton", "albaricoque",
         "cereza", "fruta", "arandano", "frambuesa", "melon", "sandia",
         "papaya", "maracuya", "guayaba", "limon", "lima ", "pomelo",
         "ciruela", "higo", "datil", "frutos del bosque", "granada ",
         "caqui", "chirimoya", "litchi", "nectarina"],
        ["carbs", "other"],
        "fruit",
    ),
    # --- LÁCTEOS BÁSICOS ---
    (
        ["leche ", "bebida de avena", "bebida de soja", "bebida de almendra",
         "bebida vegetal", "bebida de arroz", "bebida de avellana"],
        ["dairy", "other", "carbs"],
        "basic_dairy",
    ),
    (
        ["yogur", "kefir", "yoghurt", "yogourt"],
        ["dairy", "other"],
        "basic_dairy",
    ),
    # --- LÁCTEOS ALTO EN PROTEÍNA ---
    (
        ["skyr", "cottage", "quark", "requejon", "ricotta", "fromage frais"],
        ["dairy", "postres_proteicos", "protein", "other"],
        "high_protein_dairy",
    ),
    # --- QUESOS ---
    (
        ["queso", "mozzarella", "parmesano", "gouda", "edam", "manchego",
         "brie", "camembert", "roquefort", "gruyere", "cheddar", "emmental",
         "feta", "burrata", "mascarpone", "gorgonzola"],
        ["dairy", "protein", "fat", "other"],
        "cheese",
    ),
    # --- ACEITE DE OLIVA (primero que "aceite" genérico) ---
    (
        ["aceite de oliva", "aove", "oliva virgen"],
        ["fat", "other"],
        "olive_oil",
    ),
    # --- FRUTOS SECOS Y SEMILLAS ---
    (
        ["almendra", "nuez", "cacahuete", "avellana", "pistacho", "anacardo",
         "semilla", "chia", "lino", "girasol", "calabaza", "coco ",
         "macadamia", "pecana", "pino ", "sesamo", "amapola"],
        ["fat", "other"],
        "nuts_seeds",
    ),
    # --- GRASAS ANIMALES Y OTRAS GRASAS ---
    (
        ["aceite", "mantequilla", "margarina", "nata", "crema de", "manteca",
         "ghee", "sebo", "grasa ", "aguacate", "aceituna", "tapenade",
         "tahini", "crema de cacahuete", "crema de almendra"],
        ["fat", "other"],
        "other_fat",
    ),
]

CATEGORY_FALLBACK: dict[str, str] = {
    "protein": "other_protein",
    "carbs": "other_carbs",
    "fat": "other_fat",
    "dairy": "other_dairy",
    "other": "other",
    "postres_proteicos": "high_protein_dairy",
}

CONFIDENCE_THRESHOLD = 0.75  # Haiku debe tener >= esta confianza para aceptar


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def normalize(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def apply_rules(name_norm: str, category: str | None) -> str | None:
    for keywords, cat_filter, subgroup in RULES:
        if cat_filter is not None and category not in cat_filter:
            continue
        if any(kw in name_norm for kw in keywords):
            return subgroup
    return None


# ---------------------------------------------------------------------------
# Claude Haiku — clasificación en batch
# ---------------------------------------------------------------------------
def classify_with_haiku(items: list[dict]) -> dict[str, tuple[str, float]]:
    """
    Envía items a Claude Haiku para clasificar subgroup.
    Retorna {id: (subgroup, confidence)} donde confidence es 0.0-1.0.
    Si ANTHROPIC_API_KEY no está configurada, retorna dict vacío.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        print("  [Haiku] ANTHROPIC_API_KEY no encontrada — saltando paso LLM.")
        print("  Para habilitarlo: export ANTHROPIC_API_KEY=tu_clave")
        return {}

    try:
        import anthropic
    except ImportError:
        print("  [Haiku] anthropic SDK no instalado — ejecutá: pip install anthropic")
        return {}

    client = anthropic.Anthropic(api_key=api_key)
    results: dict[str, tuple[str, float]] = {}

    # Procesar en batches de 30 para no exceder context window
    batch_size = 30
    for i in range(0, len(items), batch_size):
        batch = items[i : i + batch_size]
        batch_num = i // batch_size + 1
        total_batches = (len(items) + batch_size - 1) // batch_size
        print(f"  [Haiku] Batch {batch_num}/{total_batches} ({len(batch)} items)...")

        items_text = "\n".join(
            f'{j+1}. ID={item["id"]} | name="{item["name"]}" | '
            f'category={item["category"]} | '
            f'protein={item["protein"]:.1f}g carbs={item["carbs"]:.1f}g fat={item["fat"]:.1f}g'
            for j, item in enumerate(batch)
        )

        prompt = f"""Eres un experto en nutrición. Clasifica cada alimento en el subgroup más preciso.

SUBGROUPS VÁLIDOS (usar exactamente uno):
grains, meat, fish, fruit, eggs, cheese, basic_dairy, other_dairy,
high_protein_dairy, legumes, tubers, olive_oil, nuts_seeds,
other_fat, other_carbs, other_protein, other

ALIMENTOS A CLASIFICAR:
{items_text}

REGLAS:
- grains: cereales, harinas, panes, pasta, arroz, avena, quinoa
- meat: carnes de cualquier tipo (aunque sean grasas como cerdo gordo)
- fish: pescados Y mariscos (gambas, camarón, mejillón, etc.)
- fruit: frutas frescas y secas
- eggs: huevos y derivados directos
- cheese: quesos de cualquier tipo
- basic_dairy: leche, yogur, kéfir, bebidas vegetales
- other_dairy: nata, mantequilla de vaca, crema, helados lácteos
- high_protein_dairy: skyr, cottage, quark, requesón
- legumes: lentejas, garbanzos, alubias, soja, edamame
- tubers: patata, boniato, yuca, ñame
- olive_oil: aceite de oliva exclusivamente
- nuts_seeds: frutos secos, semillas
- other_fat: otras grasas, aceites no oliva, aguacate, aceitunas
- other_carbs: verduras, hortalizas, salsas, condimentos procesados
- other_protein: proteínas vegetales procesadas, suplementos proteicos
- other: todo lo demás que no encaje en ninguna categoría

Responde SOLO con un JSON array con exactamente {len(batch)} objetos, en el mismo orden:
[{{"id": "...", "subgroup": "...", "confidence": 0.0-1.0}}, ...]

confidence: 1.0=completamente seguro, 0.5=dudoso, 0.0=no sé"""

        try:
            message = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=1024,
                messages=[{"role": "user", "content": prompt}],
            )
            response_text = message.content[0].text.strip()

            # Extraer JSON del response (puede tener texto extra)
            start = response_text.find("[")
            end = response_text.rfind("]") + 1
            if start == -1 or end == 0:
                print(f"  [Haiku] Batch {batch_num}: respuesta sin JSON válido")
                continue

            classifications = json.loads(response_text[start:end])

            for item_data in classifications:
                item_id = item_data.get("id")
                subgroup = item_data.get("subgroup", "").strip()
                confidence = float(item_data.get("confidence", 0.0))

                if subgroup in VALID_SUBGROUPS:
                    results[item_id] = (subgroup, confidence)
                else:
                    print(f"  [Haiku] Subgroup inválido '{subgroup}' para {item_id}")

        except Exception as e:
            print(f"  [Haiku] Error en batch {batch_num}: {e}")
            continue

    return results


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    print(f"Reading {DB_PATH}...")
    with open(DB_PATH, encoding="utf-8") as f:
        data = json.load(f)

    foods = copy.deepcopy(data["foods"])

    # Separar los que necesitan clasificación
    needs_classification = [f for f in foods if f.get("subgroup") is None]
    print(f"Items sin subgroup: {len(needs_classification)}")

    # --- Pass 1: Reglas mejoradas ---
    rule_results: dict[str, str] = {}
    no_rule: list[dict] = []

    for food in needs_classification:
        name = food.get("name", "")
        category = food.get("category")
        name_norm = normalize(name) + " "

        assigned = apply_rules(name_norm, category)
        if assigned:
            rule_results[food["id"]] = assigned
        else:
            no_rule.append(food)

    print(f"Pass 1 (reglas): {len(rule_results)} clasificados, {len(no_rule)} sin match")

    # --- Pass 2: Claude Haiku para los sin match ---
    haiku_results: dict[str, tuple[str, float]] = {}
    low_confidence: list[dict] = []

    if no_rule:
        print(f"Pass 2 (Haiku): clasificando {len(no_rule)} items...")
        haiku_results = classify_with_haiku(no_rule)

        # Separar alta confianza vs baja confianza
        for food in no_rule:
            fid = food["id"]
            if fid in haiku_results:
                subgroup, confidence = haiku_results[fid]
                if confidence < CONFIDENCE_THRESHOLD:
                    low_confidence.append(food)
            else:
                low_confidence.append(food)  # no clasificado por Haiku

        high_conf = len(no_rule) - len(low_confidence)
        print(f"  Haiku alta confianza: {high_conf}")
        print(f"  Haiku baja confianza / no clasificados: {len(low_confidence)}")
    else:
        print("Pass 2 (Haiku): no hay items sin match — saltando")

    # --- Aplicar resultados a los foods ---
    changelog: list[dict] = []
    review: list[dict] = []

    for food in foods:
        if food.get("subgroup") is not None:
            continue  # ya tenía subgroup

        fid = food["id"]
        name = food.get("name", "")
        category = food.get("category")

        if fid in rule_results:
            food["subgroup"] = rule_results[fid]
            method = "rule"
        elif fid in haiku_results:
            subgroup, confidence = haiku_results[fid]
            if confidence >= CONFIDENCE_THRESHOLD:
                food["subgroup"] = subgroup
                method = f"haiku_{confidence:.2f}"
            else:
                # Baja confianza: usar fallback pero mandar a review
                fallback = CATEGORY_FALLBACK.get(category or "", "other")
                food["subgroup"] = fallback
                method = f"fallback_low_conf_{confidence:.2f}"
                review.append({
                    "id": fid,
                    "name": name,
                    "category": category,
                    "protein": food.get("protein", 0),
                    "carbs": food.get("carbs", 0),
                    "fat": food.get("fat", 0),
                    "haiku_suggestion": subgroup,
                    "haiku_confidence": confidence,
                    "assigned_subgroup": fallback,
                    "note": "Haiku baja confianza — revisar manualmente",
                })
        else:
            # Fallback puro (Haiku no disponible o no clasificó este item)
            fallback = CATEGORY_FALLBACK.get(category or "", "other")
            food["subgroup"] = fallback
            method = "fallback"
            review.append({
                "id": fid,
                "name": name,
                "category": category,
                "protein": food.get("protein", 0),
                "carbs": food.get("carbs", 0),
                "fat": food.get("fat", 0),
                "assigned_subgroup": fallback,
                "note": "Sin match de reglas ni Haiku — revisar manualmente",
            })

        changelog.append({
            "id": fid,
            "name": name,
            "assigned_subgroup": food["subgroup"],
            "method": method,
        })

    # --- Verificación final ---
    remaining_nulls = sum(1 for f in foods if f.get("subgroup") is None)

    # --- Escribir outputs ---
    data_out = {"foods": foods}
    with open(OUT_DB, "w", encoding="utf-8") as f:
        json.dump(data_out, f, ensure_ascii=False, indent=2)

    CHANGELOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CHANGELOG_PATH, "w", encoding="utf-8") as f:
        json.dump(changelog, f, ensure_ascii=False, indent=2)

    with open(REVIEW_PATH, "w", encoding="utf-8") as f:
        json.dump(review, f, ensure_ascii=False, indent=2)

    print()
    print("=== Resultado ===")
    print(f"Clasificados por reglas:   {len(rule_results)}")
    print(f"Clasificados por Haiku:    {len([fid for fid in haiku_results if haiku_results[fid][1] >= CONFIDENCE_THRESHOLD])}")
    print(f"Fallback (revisar):        {len(review)}")
    print(f"Nulls restantes:           {remaining_nulls}")
    print(f"database_v3.json escrito")
    print(f"subgroups_changelog.json:  {len(changelog)} entradas")
    print(f"subgroups_review.json:     {len(review)} items para revisar")


if __name__ == "__main__":
    main()
