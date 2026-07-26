#!/usr/bin/env python3
"""Correcciones de datos encontradas en la auditoría contextual de 60 casos.

El script es determinista e idempotente. Solo corrige registros con evidencia
directa: productos descatalogados, cinco etiquetas rumanas impropias para la
interfaz española y dos metadatos incoherentes.
"""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "database.json"


def norm(value: str) -> str:
    text = unicodedata.normalize("NFKD", (value or "").lower())
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", text).strip()


def add_flag(food: dict, flag: str) -> bool:
    flags = list(food.get("flags") or [])
    if flag in flags:
        return False
    flags.append(flag)
    food["flags"] = flags
    return True


def main() -> None:
    foods = json.loads(DB_PATH.read_text(encoding="utf-8"))
    changes: list[str] = []

    for food in foods:
        name = norm(food.get("name") or "")
        food_id = str(food.get("id"))

        if "descatalogado" in name and add_flag(food, "hidden"):
            changes.append(f"{food_id}: ocultado por DESCATALOGADO")

        if (
            food.get("category") == "dairy"
            and re.search(r"\blapte\b|\bgrasime\b", name)
            and add_flag(food, "hidden")
        ):
            changes.append(f"{food_id}: etiqueta rumana oculta")

        if food_id == "bedca_0404" and food.get("subgroup") != "fruit":
            food["subgroup"] = "fruit"
            changes.append(f"{food_id}: Pera subgroup=fruit")

        if food_id == "off_873b01b809" and food.get("dairy_subfamily") is not None:
            food["dairy_subfamily"] = None
            changes.append(f"{food_id}: Tofu firme sin dairy_subfamily")

        if food_id == "off_ab38a0dab7" and add_flag(food, "prepared"):
            changes.append(f"{food_id}: Manzana kiwi marcada como preparado")

    DB_PATH.write_text(
        json.dumps(foods, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Correcciones contextuales aplicadas: {len(changes)}")
    for change in changes:
        print(f"  - {change}")


if __name__ == "__main__":
    main()
