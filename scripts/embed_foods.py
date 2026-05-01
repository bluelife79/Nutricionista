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
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sentence_transformers import SentenceTransformer

# ---------------------------------------------------------------------------
# Semantic context maps (ADR-1)
# ---------------------------------------------------------------------------

CATEGORY_MAP = {
    "protein": "proteína carne animal",
    "carbs": "carbohidrato cereal farináceo",
    "fat": "grasa aceite lípido",
    "dairy": "lácteo leche derivado",
    "postres_proteicos": "postre proteico lácteo dulce",
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
    foods = db["foods"]
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
