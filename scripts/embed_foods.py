"""
Offline embedder for Nutricionista food database.
Run from project root:
    cd microservicio && uv run python ../scripts/embed_foods.py

Writes three files into microservicio/data/:
  - embeddings.npz   (matrix: N x 384, float32, L2-normalized)
  - index.json       {food_id: row_index}
  - meta.json        {model, db_hash, generated_at, dim, n_foods}
"""

import hashlib
import json
import os
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sentence_transformers import SentenceTransformer


def _norm(s: str) -> str:
    """Lowercase + strip diacritics. Mirrors js/algorithm.js:norm() so the
    processing-level inference matches frontend behavior token-for-token."""
    if not s:
        return ""
    nfkd = unicodedata.normalize("NFKD", s.lower())
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def infer_processing_level(food: dict) -> int:
    """Port of inferProcessingLevel() from js/algorithm.js:852.

    Returns 0 (simple) → 3 (ultraprocessed). Used as fallback when the
    `processing_level` field is absent from the DB row.
    """
    sub = (food.get("subgroup") or "").lower()
    name = _norm(food.get("name") or "")

    # Level 3 — ultraprocessed (cured meats, industrial plant protein)
    if sub == "processed_meat":
        return 3
    if any(tok in name for tok in ("frankfurt", "salchicha", "mortadela", "chopped")):
        return 3

    # Level 2 — processed (marinated, smoked, burger, processed cheese)
    if any(tok in name for tok in ("adobado", "marinado", "ahumado", "escabechado")):
        return 2
    if "burger" in name or "hamburgue" in name:
        return 2
    if sub == "butter_margarine":
        return 2
    if sub == "other_oils" and any(
        tok in name for tok in ("palma", "algodon", "germen", "semilla", "higado")
    ):
        return 2

    # Level 1 — minimally processed (light flavoring, basic preparations)
    if any(tok in name for tok in ("sabor", "saborizado", "con miel", "azucarado")):
        return 1
    if any(tok in name for tok in ("al garam", "con especias", "con trufa")):
        return 1
    if "tostado" in name and sub == "legumes":
        return 1

    return 0

# ---------------------------------------------------------------------------
# Semantic context maps (ADR-1)
# ---------------------------------------------------------------------------

CATEGORY_MAP = {
    "protein": "proteína carne animal",
    "carbs": "carbohidrato cereal farináceo",
    "fat": "grasa aceite lípido",
    "dairy": "lácteo leche derivado",
    "postres_proteicos": "postre proteico lácteo dulce",
    "fruits": "fruta entera fresca",
    "vegetables": "verdura hortaliza",
    "other": "alimento mixto",
}

SUBGROUP_MAP = {
    "meat": "carne animal terrestre res ave cerdo",
    "fish": "pescado marisco animal marino",
    "eggs": "huevo ovoproducto",
    "legumes": "legumbre vegetal proteína vegetal alubia garbanzo lenteja",
    "grains": "cereal grano farináceo arroz pasta pan",
    "tubers": "tubérculo patata boniato fécula",
    "vegetables": "verdura vegetal hortaliza hoja verde",
    "nuts_seeds": "fruto seco semilla nuez almendra",
    "fruit": "fruta vegetal dulce",
    "basic_dairy": "lácteo leche yogur básico",
    "high_protein_dairy": "lácteo proteico yogur griego skyr",
    "other_dairy": "lácteo derivado queso",
    "other_fat": "grasa aceite fuente lipídica",
    "other_carbs": "vegetal carbohidrato energético",
    "processed_protein": "proteína procesada fiambre embutido",
    "meat_lean": "carne magra ave ternera cerdo plato principal",
    "meat_fatty": "carne con grasa plato principal",
    "processed_meat": "embutido fiambre carne procesada consumo ocasional",
    "fish_white": "pescado blanco magro plato principal",
    "fish_fatty": "pescado azul graso plato principal",
    "seafood": "marisco crustáceo molusco",
    "plant_protein": "proteína vegetal tofu tempeh seitán soja",
    "whole_dairy": "yogur leche lácteo entero",
    "low_fat_dairy": "yogur leche lácteo desnatado",
    "fresh_cheese": "queso fresco requesón ricotta cottage",
    "aged_cheese": "queso curado semicurado sólido",
    "olive_oil": "aceite de oliva grasa vegetal",
    "other_oils": "aceite vegetal grasa de cocina",
    "avocado": "aguacate grasa vegetal fresca",
    "butter_margarine": "mantequilla margarina grasa untable",
    "tropical": "fruta tropical entera",
    "frutos_bosque": "frutos del bosque fruta entera",
    "leafy": "verdura de hoja verde",
    "cruciferous": "verdura crucífera brócoli coliflor",
    "allium": "verdura aliácea cebolla ajo puerro",
    "root_veg": "verdura de raíz zanahoria remolacha",
    "fruiting_veg": "hortaliza tomate pimiento berenjena calabacín pepino",
    "stalk_veg": "verdura de tallo flor alcachofa apio espárrago",
    "other_veg": "verdura hortaliza",
    "cold_soup": "sopa fría gazpacho salmorejo plato preparado",
    "sweets_bakery": "dulce chocolate bollería consumo ocasional",
    # Additional subgroups found in DB
    "cheese": "queso lácteo curado fresco semicurado",
    "olive_oil": "aceite oliva grasa vegetal monoinsaturada",
    "other_protein": "proteína otras fuentes origen animal vegetal",
    "other": "alimento variado sin categoría específica",
}

MACRO_PROFILE_MAP = {
    "protein": "plato principal fuente de proteína",
    "fat": "fuente de grasa cocción",
    "carbs": "fuente de carbohidratos energía",
    "unknown": "",
}

FLAGS_MAP = {
    "condiment": "condimento saborizante especia",
    "prepared": "plato preparado elaborado cocinado",
}

# ---------------------------------------------------------------------------
# Embedding text builder
# ---------------------------------------------------------------------------

def build_embedding_text(food: dict) -> str:
    parts = [food.get("name", "").strip()]
    parts.append(CATEGORY_MAP.get(food.get("category", ""), ""))
    parts.append(SUBGROUP_MAP.get(food.get("subgroup", ""), ""))
    parts.append(MACRO_PROFILE_MAP.get(food.get("macro_profile", ""), ""))
    for flag in food.get("flags", []):
        parts.append(FLAGS_MAP.get(flag, ""))

    premium_context = (food.get("premium_context") or "").strip()
    if premium_context:
        parts.append(f"contexto culinario {premium_context.replace('_', ' ')}")

    # Culinary context tokens — push the embedding away from purely numeric
    # macro similarity and toward "what would a real cook reach for". Mirrors
    # the demotions applied client-side in js/algorithm.js so retrieval and
    # ranking share the same signal.
    if food.get("raw_ingredient"):
        parts.append("ingrediente de cocina no comestible directo")

    meal_slot = (food.get("meal_slot") or "").lower()
    if meal_slot == "desayuno":
        parts.append("alimento de desayuno")
    elif meal_slot == "comida":
        parts.append("plato de comida principal")
    elif meal_slot == "snack":
        parts.append("snack merienda entre horas")

    # processing_level may be absent from the DB row — fall back to the
    # heuristic so the signal works on every food regardless of bulk-label state.
    proc = food.get("processing_level")
    if proc is None:
        proc = infer_processing_level(food)
    if proc and proc >= 2:
        parts.append("alimento procesado elaborado")

    # culinary_role (added by scripts/fix_culinary_role.py) — gives the
    # retrieval layer the same signal the algorithm uses for R1.
    role = food.get("culinary_role")
    if role == "snack":
        parts.append("snack aperitivo no es comida principal")
    elif role == "recipe_ingredient":
        parts.append("ingrediente de receta no se come solo")
    elif role == "dessert":
        parts.append("postre dulce")
    elif role == "staple":
        parts.append("alimento base versatil")

    # usage_es: descripción culinaria detallada (auditada via GLM en
    # audit_usage_with_llm.py). Si presente, enriquece la señal semántica
    # — hace que "patata cocida" y "arroz hervido" se acerquen porque
    # ambos describen "plato directo en comida", aunque tokens distintos.
    usage = (food.get("usage_es") or "").strip()
    if usage:
        parts.append(usage)
    return " ".join(p for p in parts if p).strip()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    # Resolve paths relative to this script's location
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    db_path = project_root / "database.json"
    data_dir = project_root / "microservicio" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    # --- Load database.json ---
    print(f"Loading database from: {db_path}")
    raw_bytes = db_path.read_bytes()
    db_hash = hashlib.sha256(raw_bytes).hexdigest()
    db = json.loads(raw_bytes)
    foods = db if isinstance(db, list) else db.get("foods", [])
    print(f"Loaded {len(foods)} foods. SHA-256: {db_hash[:12]}...")

    # --- Build embedding texts ---
    texts = [build_embedding_text(f) for f in foods]

    # Print 3 samples
    print("\nSample embedding texts:")
    for i in [0, len(foods) // 2, len(foods) - 1]:
        print(f"  [{i}] {texts[i]}")

    # --- Load model ---
    model_name = "paraphrase-multilingual-MiniLM-L12-v2"
    print(f"\nLoading model: {model_name}")
    model = SentenceTransformer(model_name)

    # --- Encode in batches of 64 ---
    print(f"\nEncoding {len(texts)} texts in batches of 64...")
    matrix = model.encode(
        texts,
        batch_size=64,
        normalize_embeddings=True,
        show_progress_bar=True,
        convert_to_numpy=True,
    ).astype(np.float32)

    print(f"Matrix shape: {matrix.shape}, dtype: {matrix.dtype}")

    # --- Build index: food_id -> row_index ---
    index = {f["id"]: i for i, f in enumerate(foods)}

    # --- Save embeddings.npz ---
    npz_path = data_dir / "embeddings.npz"
    np.savez_compressed(str(npz_path), matrix=matrix)
    npz_size = npz_path.stat().st_size

    # --- Save index.json ---
    index_path = data_dir / "index.json"
    index_path.write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
    index_size = index_path.stat().st_size

    # --- Save meta.json ---
    meta = {
        "model": model_name,
        "db_hash": db_hash,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "dim": matrix.shape[1],
        "n_foods": matrix.shape[0],
    }
    meta_path = data_dir / "meta.json"
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    meta_size = meta_path.stat().st_size

    # --- Summary ---
    print(f"\nDone!")
    print(f"  embeddings.npz : {npz_size / 1024:.1f} KB  (shape {matrix.shape})")
    print(f"  index.json     : {index_size / 1024:.1f} KB  ({len(index)} entries)")
    print(f"  meta.json      : {meta_size} bytes")
    print(f"  n_foods        : {meta['n_foods']}")
    print(f"  dim            : {meta['dim']}")
    print(f"  db_hash        : {db_hash}")
    print(f"  generated_at   : {meta['generated_at']}")


if __name__ == "__main__":
    main()
