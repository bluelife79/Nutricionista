#!/usr/bin/env python3
"""Sincroniza embeddings tras añadir los dos alimentos vegetales manuales.

No inventa vectores aleatorios: deriva cada alta como el centroide normalizado
de alimentos equivalentes que ya fueron codificados por el mismo modelo.
Falla si aparece cualquier otro ID nuevo, para obligar a regenerar con el
modelo completo cuando cambie la base de forma material.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).parent.parent
DB_PATH = ROOT / "database.json"
DATA_DIR = ROOT / "microservicio" / "data"

DERIVATION_SOURCES = {
    "manual_tempeh": [
        "bedca_0462",       # Tofu
        "bedca_0223",       # Seitán
        "off_873b01b809",   # Tofu firme
    ],
    "manual_soja_texturizada": [
        "bedca_0223",       # Seitán
        "bedca_0462",       # Tofu
        "off_b194d45ff2",   # Seitán a la piastra
    ],
}


def main() -> None:
    foods = json.loads(DB_PATH.read_text(encoding="utf-8"))
    ids = [str(food["id"]) for food in foods]
    index_path = DATA_DIR / "index.json"
    meta_path = DATA_DIR / "meta.json"
    matrix_path = DATA_DIR / "embeddings.npz"

    index = {
        str(food_id): int(row)
        for food_id, row in json.loads(index_path.read_text(encoding="utf-8")).items()
    }
    matrix = np.load(matrix_path)["matrix"].astype(np.float32)

    missing = [food_id for food_id in ids if food_id not in index]
    stale = [food_id for food_id in index if food_id not in set(ids)]
    unsupported = [food_id for food_id in missing if food_id not in DERIVATION_SOURCES]
    if stale:
        raise SystemExit(f"Hay IDs obsoletos en embeddings: {stale}")
    if unsupported:
        raise SystemExit(
            "Hay alimentos nuevos sin regla de derivación; regenerá con el modelo: "
            + ", ".join(unsupported)
        )

    rows = [matrix]
    for food_id in missing:
        source_ids = DERIVATION_SOURCES[food_id]
        if any(source_id not in index for source_id in source_ids):
            raise SystemExit(f"Faltan fuentes para derivar {food_id}: {source_ids}")
        centroid = np.mean([matrix[index[source_id]] for source_id in source_ids], axis=0)
        norm = float(np.linalg.norm(centroid))
        if norm == 0:
            raise SystemExit(f"Centroide nulo para {food_id}")
        centroid = (centroid / norm).astype(np.float32)
        index[food_id] = matrix.shape[0] + len(rows) - 1
        rows.append(centroid.reshape(1, -1))

    if len(rows) > 1:
        matrix = np.concatenate(rows, axis=0)

    if matrix.shape[0] != len(ids) or len(index) != len(ids):
        raise SystemExit(
            f"Desincronización final: matrix={matrix.shape[0]}, index={len(index)}, db={len(ids)}"
        )

    np.savez_compressed(matrix_path, matrix=matrix)
    index_path.write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")

    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta.update(
        {
            "db_hash": hashlib.sha256(DB_PATH.read_bytes()).hexdigest(),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "dim": int(matrix.shape[1]),
            "n_foods": int(matrix.shape[0]),
            "derived_ids": missing,
            "derivation": "normalized centroid of same-model equivalent foods",
        }
    )
    meta_path.write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Embeddings sincronizados: {matrix.shape[0]} x {matrix.shape[1]}; añadidos={missing}")


if __name__ == "__main__":
    main()
