# Audit Fix — Estado de implementación

**Rama**: `feat/disable-rerank-deploy`  
**Origen**: Auditoría del cliente (nutricionista) — archivo "Hola Elena.docx"  
**Problema raíz**: el `matchScore` matemático manda demasiado; alimentos mixtos (huevo, salmón, yogur griego) solo usan el macro ancla (proteína) e ignoran grasa/calorías.

---

## ✅ YA HECHO (commits pendientes)

### `js/algorithm.js`
1. **Constante `_demoteBreakfastOnLunch`** — agrega `×0.05` para candidatos con `meal_slot="desayuno"` cuando el origen es `"comida"`. Acumula sobre el `_demoteMealSlot` genérico (×0.4), total ×0.02.

2. **Función `inferProcessingLevel(food)`** — nueva función antes de `calculateAlternatives`. Infiere nivel 0-3 de procesado cuando el campo `processing_level` no está en la DB, usando `subgroup` y tokens del nombre.

3. **Demotion breakfast-on-lunch** — dentro del bloque `_bulkLabelEnabled`, después de `_demoteUncooked`:
   ```js
   if (a.meal_slot === "desayuno" && originalFood.meal_slot === "comida") {
     demotion *= _demoteBreakfastOnLunch;
   }
   ```

4. **Demotion mixed macro fat-loss** — después del bloque `kcal-density`, antes del `return`:
   Cuando `originalFood.protein > 5 && originalFood.fat >= 6`, penaliza candidatos que pierden >50% de la grasa del origen. `demotion = max(0.3, 1 - fatLossRatio * 0.8)`.

5. **Demotion processing level** — usa `processing_level` de la DB o `inferProcessingLevel()`. `demotion *= (1 - procLevel * 0.12)`.

6. **Captura `_judgeInsufficientMatches`** — variable nueva `let _judgeInsufficientMatches = false` en el gate del judge; se setea a `true` si `_verdict.insufficient_matches === true`.

7. **Return `noMatch`** — el resultado final ahora incluye:
   ```js
   const noMatch = _judgeInsufficientMatches && intercambios.length < 3;
   return { intercambios, familia, preparados, noMatch };
   ```

### `microservicio/_judge_prompt.py`
- **Versión bumpeada a `1.4.0`**
- **Regla 13 — INTERCAMBIO INSUFICIENTE**: el LLM marca `insufficient_matches: true` cuando quedan <3 candidatos culinariamente válidos.
- **Regla 14 — JERARQUÍA DE PROCESADO**: simple > conserva básica > preparado saborizado > elaborado > ultraprocesado. Relegar al final de `ranked_ids`, no a `removed_ids`.
- **Regla 15 — ALIMENTOS MIXTOS**: cuando el origen tiene proteína >8g y grasa >5g, no priorizar candidatos que igualan proteína pero pierden >20% de calorías. Candidatos muy magros van al final o a `removed_ids` si pérdida calórica >30%.
- **Schema del user message** actualizado con campo `"insufficient_matches": false` en el JSON pedido, y regla explícita de cuándo marcarlo `true`.

### `microservicio/judge.py`
- **`JudgeResponse`** tiene nuevo campo: `insufficient_matches: bool = False`

---

## 🔲 PENDIENTE

### `microservicio/judge.py` — parser de veredicto
El `parse_verdict()` y `_extract_from_obj()` devuelven `tuple[list, list]`. Hay que extender para que también extraigan `insufficient_matches` y lo propagen al `JudgeResponse`.

**Cambios concretos:**

```python
# parse_verdict → devolver 3-tuple
def parse_verdict(text, candidate_ids) -> tuple[list[str], list[str], bool]:
    # ... lógica existente ...
    # En _extract_from_obj, extraer el campo:
    insufficient = bool(obj.get("insufficient_matches", False))
    return ranked, removed, insufficient

def _extract_from_obj(obj, cand_set, candidate_ids) -> tuple[list[str], list[str], bool]:
    if "ranked_ids" not in obj:
        raise ValueError("ranked_ids key missing from parsed object")
    removed = [i for i in obj.get("removed_ids", []) if i in cand_set]
    removed_set = set(removed)
    ranked = [i for i in obj["ranked_ids"] if i in cand_set and i not in removed_set]
    seen = set(ranked) | removed_set
    for cid in candidate_ids:
        if cid not in seen:
            ranked.append(cid)
    insufficient = bool(obj.get("insufficient_matches", False))
    return ranked, removed, insufficient
```

En `judge_handler`, actualizar las 2 llamadas a `parse_verdict`:
```python
# cache MISS path (línea ~372):
ranked, removed, insufficient = parse_verdict(text, cand_ids)

# cache MISS → guardar en caché (incluir insufficient):
if _cache and key:
    _cache.set(key, (ranked, removed, insufficient))

# cache HIT path (línea ~338):
ranked, removed, insufficient = cached  # si el caché ya lo guarda como 3-tuple

# En los JudgeResponse del path miss y hit, agregar:
return JudgeResponse(
    ranked_ids=ranked,
    removed_ids=removed,
    insufficient_matches=insufficient,
    cache="miss",
    ...
)
```

⚠️ **El caché guarda actualmente tuplas de 2 elementos** `(ranked, removed)`. Al cambiar a 3 hay que considerar invalidación o manejar el caso de que el caché tenga tuplas viejas (try/except al desempaquetar).

### `scripts/embed_foods.py` — embeddings más ricos
El archivo ya tiene `usage_es`, `CATEGORY_MAP` y `SUBGROUP_MAP`. Lo que falta es agregar contexto de cooking state, meal_slot y nivel de procesado al texto:

```python
def build_embedding_text(food: dict) -> str:
    parts = [food.get("name", "").strip()]
    parts.append(CATEGORY_MAP.get(food.get("category", ""), ""))
    parts.append(SUBGROUP_MAP.get(food.get("subgroup", ""), ""))
    parts.append(MACRO_PROFILE_MAP.get(food.get("macro_profile", ""), ""))
    for flag in food.get("flags", []):
        parts.append(FLAGS_MAP.get(flag, ""))

    # --- NUEVO: contexto culinario adicional ---
    if food.get("raw_ingredient"):
        parts.append("ingrediente de cocina no comestible directo")
    meal_slot = food.get("meal_slot", "")
    if meal_slot == "desayuno":
        parts.append("alimento de desayuno")
    elif meal_slot == "comida":
        parts.append("plato de comida principal")
    elif meal_slot == "snack":
        parts.append("snack merienda entre horas")
    proc = food.get("processing_level", 0) or 0
    if proc >= 2:
        parts.append("alimento procesado elaborado")
    # --- FIN NUEVO ---

    usage = (food.get("usage_es") or "").strip()
    if usage:
        parts.append(usage)
    return " ".join(p for p in parts if p).strip()
```

Después de este cambio hay que **re-generar los embeddings**:
```bash
cd microservicio && uv run python ../scripts/embed_foods.py
```
Y re-cuantizar para el browser (si existe el script de cuantización).

---

## Ideas innovadoras pendientes de discutir con cliente

1. **Medidas caseras vía DeepSeek** — endpoint `/measures` en el microservicio. Una sola llamada por alimento, caché permanente. Devuelve "1 cucharada sopera", "2 huevos medianos", etc.

2. **UI progresiva (3 fases)**: resultados matemáticos al instante → rerank semántico ~5ms → DeepSeek verdict ~3s actualizando silenciosamente. Spinner sutil en el header, no en los cards.

3. **Threshold adaptativo de no-match**: `confidence = bestCandidate.matchScore * (1 - processing_level * 0.1)`. Si `confidence < 45` → mostrar "no hay intercambio claro" + "opciones más cercanas si querés explorar".

---

## Verificación end-to-end (casos de prueba)

Ejecutar `scripts/test_intercambios.py` antes y después con estos 6 casos:

| Alimento | Resultado esperado |
|---|---|
| Huevo 100g | Top 3: tortilla/huevo, salmón, sardina/caballa. Merluza y langostino más abajo. |
| Arroz 60g | Sin harinas, cereales, pan rallado en top 10. Sí: quinoa, cuscús, pasta, patata. |
| Aceite de oliva 15g | Aguacate y nueces en primeros. Aceite de palma y algodón al fondo. |
| Yogur griego 125g | Top 3: yogur griego similar, skyr, kéfir. "516g té con leche" fuera del top 10. |
| Lentejas cocidas 150g | Top 3: garbanzos, alubias, judías. Garbanzos al garam masala más abajo. |
| Chocolate negro | `noMatch: true` si el judge confirma `insufficient_matches: true`. |
