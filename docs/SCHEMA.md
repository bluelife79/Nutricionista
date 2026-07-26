# Esquema de alimentos — Premium v2.1

`database.json` es un array plano. Contiene la ficha nutricional, las señales
de uso culinario y la trazabilidad necesaria para decidir si un alimento puede
buscarse y aparecer como alternativa.

Este documento describe el estado real de la release Premium v2.1. El contrato
de producto completo está en `docs/PREMIUM_PRODUCT_CONTRACT.md`.

## Registro mínimo

```json
{
  "id": "bedca_0001",
  "name": "Pechuga de pollo, cruda",
  "protein": 23,
  "carbs": 0,
  "fat": 1.5,
  "calories": 105,
  "category": "protein",
  "subgroup": "meat_lean",
  "macro_profile": "protein",
  "source": "BEDCA",
  "brand": null,
  "flags": [],
  "raw_ingredient": true,
  "ready_to_eat": false,
  "culinary_role": "meal_dish",
  "meal_slot": "any",
  "frequency": "habitual",
  "exotic": false
}
```

Los cuatro nutrientes siempre se expresan por 100 g del estado indicado en el
nombre. No se mezclan valores en crudo y cocinado bajo el mismo registro.

## Identidad y composición

| Campo | Tipo | Regla |
|---|---|---|
| `id` | string | Único y estable. No se reutiliza. |
| `name` | string | Nombre comprensible en España e incluye el estado cuando importa. |
| `name_original` | string/null | Nombre de fuente antes de una localización determinista. |
| `protein` | number | Proteína por 100 g. Finita y no negativa. |
| `carbs` | number | Hidratos por 100 g. Finita y no negativa. |
| `fat` | number | Grasa por 100 g. Finita y no negativa. |
| `calories` | number | Energía por 100 g, positiva. |
| `source` | string | BEDCA, supermercado o OpenFoodFacts. |
| `brand` | string/null | Marca comercial; null en genéricos. |
| `code` / `ean` | string/null | Código de barras cuando existe. |
| `quantity` | string/number/null | Formato comercial de referencia; no cambia la base por 100 g. |

Un registro con composición inválida se conserva solo para trazabilidad y lleva
`quality_status: "quarantine"`; no puede buscarse ni entrar en resultados.

## Clasificación nutricional

Valores actuales de `category`:

- `protein`
- `carbs`
- `fat`
- `dairy`
- `postres_proteicos`
- `fruits`
- `vegetables`
- `other`

Valores actuales publicables de `macro_profile`:

- `protein`
- `carbs`
- `fat`
- `calories`

`macro_profile: "unknown"` solo puede sobrevivir aislado por cuarentena.

Subgrupos actuales:

```text
aged_cheese, allium, avocado, basic_dairy, butter_margarine,
cheese, cold_soup, cruciferous, eggs, fish, fish_fatty, fish_white,
fresh_cheese, fruit, fruiting_veg, frutos_bosque, grains,
high_protein_dairy, leafy, legumes, low_fat_dairy, meat,
meat_fatty, meat_lean, nuts_seeds, olive_oil, other, other_carbs,
other_dairy, other_fat, other_oils, other_protein, other_veg,
plant_protein, processed_meat, processed_protein, root_veg,
seafood, stalk_veg, sweets_bakery, tropical, tubers, vegetables,
viscera, whole_dairy
```

No se crea un subgrupo nuevo desde texto libre. Primero se cambia esta
taxonomía, las reglas de compatibilidad, las pruebas y los embeddings.

## Contexto y forma de uso

| Campo | Uso |
|---|---|
| `premium_context` | Contexto explícito cuando la inferencia por categoría, subgrupo y nombre no basta. |
| `culinary_role` | Papel del alimento: plato, base, ingrediente, postre, etc. |
| `raw_ingredient` | El valor nutricional corresponde a materia prima. |
| `ready_to_eat` | Se consume directamente en el estado descrito. |
| `meal_slot` | Momento de consumo cuando es relevante. |
| `dairy_subfamily` | Cohorte láctea compatible. |
| `clean_carb` | Hidrato base frente a dulce, snack o preparado. |
| `clean_protein` | Proteína simple frente a procesada o preparada. |
| `clean_fat` | Grasa simple frente a salsa, conserva o compuesto. |
| `oil_added` | El producto contiene aceite añadido y no es una grasa base. |
| `cold_soup` | Identifica sopa fría sin convertirla en verdura simple. |

`premium_context` admite actualmente:

```text
breakfast_cereal, bread, dry_grain, cooked_grain, tuber,
cooked_tuber, baking_input, lean_meat, fatty_meat, minced_meat,
processed_meat, egg, white_fish, fatty_fish, canned_fish,
processed_fish, seafood, plant_protein, protein_supplement,
cooked_legume, milk, plant_drink, fermented_dairy, fresh_cheese,
aged_cheese, whole_fruit, fruit_beverage, leafy_vegetable,
cruciferous, fruiting_vegetable, root_vegetable, stalk_vegetable,
other_vegetable, oil, nuts_seeds, avocado, olive, nut_spread,
chocolate, cold_soup, savory_spread, savory_sauce, condiment,
seasoning, sweet_spread, sweet_dessert, sweet_bakery, hot_beverage,
soft_beverage, alcoholic_beverage, prepared_meal, non_exchangeable,
unknown
```

La mayoría de registros no necesita guardar ese campo: el navegador lo infiere
de manera determinista. Los contextos `unknown` y `non_exchangeable` fallan de
forma cerrada y no inventan un intercambio directo. En la candidata 2.1 no hay
ningún registro visible en esos dos estados.

## Perfil de intención culinaria 2.1

Todos los registros conservan la decisión de intención auditada:

```json
{
  "culinary_intent": {
    "version": "premium-v2.1-intent-5",
    "family": "cheese",
    "uses": ["cold", "melt"],
    "primary_uses": ["cold"],
    "prompt_id": "cheese_use",
    "validated_modes": ["cold", "melt"],
    "validation_status": "release_validated"
  }
}
```

| Campo | Regla |
|---|---|
| `version` | Versión exacta del clasificador y del contrato servido. |
| `family` | Familia culinaria determinista. |
| `uses` | Usos compatibles conocidos para el alimento. |
| `primary_uses` | Usos preferentes; siempre es subconjunto de `uses`. |
| `prompt_id` | Plantilla visible o `null` si no se debe preguntar. |
| `validated_modes` | Modalidades ejecutadas con éxito por la auditoría exhaustiva. |
| `validation_status` | `release_validated`, `release_silent` o `not_publishable`. |

El navegador no vuelve a decidir libremente qué pregunta mostrar: sirve las
modalidades almacenadas que superaron la auditoría. La respuesta se pasa al
motor, excluye usos incompatibles y da prioridad a los usos principales y a la
familia proteica adecuada.

En esta release existen plantillas adaptativas para queso, avena, pan, carne,
pescado, proteína vegetal, legumbre, tubérculo, fermentado lácteo y verdura. La
pregunta solo se muestra si quedan al menos dos modalidades validadas y el TOP
cambia materialmente. “Me da igual” conserva el recorrido simple.

## Visibilidad y calidad

| Campo/valor | Efecto |
|---|---|
| `flags: ["hidden"]` | No aparece en búsqueda ni resultados. |
| `flags: ["condiment"]` | No entra como intercambio. |
| `flags: ["prepared"]` | Solo puede aparecer en el bloque de preparados. |
| `flags: ["sweet"]` | No completa intercambios de alimentos base. |
| `quality_status: "quarantine"` | Exclusión total en tiempo de ejecución. |
| `quality_reasons` | Motivos estructurados de aislamiento. |
| `usage_review_status` | Estado de una descripción de uso corregida o rechazada. |
| `name_review_status` | Estado de una localización de nombre. |

El texto `usage_es` es informativo. Nunca decide por sí solo la categoría,
el cálculo ni la elegibilidad.

## Trazabilidad de Open Food Facts

Todo registro con `source: "OpenFoodFacts"` lleva `market_provenance`.

```json
{
  "source": "OpenFoodFacts",
  "status": "verified_core_es",
  "market": "ES",
  "retailer": "mercadona",
  "spanish_name": "Nombre visible",
  "spanish_name_basis": "localized_es",
  "language": "es",
  "countries_tags": ["en:spain"],
  "stores_tags": ["mercadona"],
  "quality_errors": [],
  "rejection_reason": null,
  "restored_from_dump": "openfoodfacts-products.jsonl.gz"
}
```

Únicos estados publicables:

- `verified_core_es`: evidencia de España y Mercadona, Carrefour, Lidl o Aldi.
- `verified_spain_other`: evidencia suficiente de venta en España.

Cualquier otro estado se conserva oculto o en cuarentena. El motor vuelve a
comprobar esta regla en cada búsqueda y cálculo, aunque el fichero derive.

La jerarquía de desempate es:

1. BEDCA;
2. Mercadona, Carrefour, Lidl y Aldi como fuente directa;
3. otros distribuidores españoles controlados;
4. OFF verificado en uno de los cuatro distribuidores;
5. OFF verificado en España.

Relevancia culinaria y nutricional sigue mandando; la procedencia solo decide
entre candidatos razonablemente cercanos.

## Raciones

`config/serving_policy.json` es la fuente versionada de límites por contexto.
`js/premium_policy.js` contiene el espejo de navegador y el gate prueba que
ambos coinciden.

Estados de una equivalencia:

- `direct`: exacta y práctica;
- `review`: válida, relegada y con aviso de ración grande;
- `reject`: fuera de los límites y no publicable como intercambio.

Cada caso `review` expuesto por la matriz de 100 casos debe tener una decisión
explícita en `config/portion_review_decisions.json`.

## Proceso para incorporar o modificar datos

1. Conservar el registro original o su trazabilidad.
2. Validar macros y estado crudo/cocinado.
3. Asignar categoría, subgrupo y señales estructuradas.
4. Si procede de OFF, demostrar mercado español y calidad de fuente.
5. Ejecutar la auditoría de catálogo.
6. Regenerar embeddings porque el índice depende del contenido exacto de la DB.
7. Ejecutar toda la regresión y el gate Premium.
8. Validar una preview inmutable antes de producción.

Comandos de control:

```text
npm run audit:catalog
npm run audit:premium
npm run audit:intent
npm run audit:intent:exhaustive
npm run test:premium
npm test
```
