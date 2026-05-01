# Schema de Alimentos — `database.json`

Este documento define la convención de datos para todos los alimentos en `database.json` (campo `foods[]`). Seguirla exactamente es **obligatorio** para que el algoritmo de equivalencias funcione correctamente.

---

## Estructura de un alimento

```json
{
  "id": "bedca_0001",
  "name": "Pechuga de pollo, cruda",
  "protein": 23.0,
  "carbs": 0.0,
  "fat": 1.5,
  "calories": 105.0,
  "category": "protein",
  "subgroup": "meat",
  "macro_profile": "protein",
  "flags": [],
  "source": "BEDCA",
  "brand": "Marca Blanca",
  "code": null,
  "quantity": null
}
```

---

## Campos

### `id` — string, obligatorio

Identificador único. Formato: `{fuente}_{numero}` en minúsculas.

Ejemplos: `bedca_0001`, `off_0042`, `mercadona_0010`

---

### `name` — string, obligatorio

Nombre del alimento tal como aparece en la fuente. Incluir estado si aplica (cruda, cocida, entera).

---

### `protein` / `carbs` / `fat` — number, obligatorio

Gramos por cada 100g de alimento. Usar punto decimal (`.`), nunca coma.

---

### `calories` — number, obligatorio

Kcal por cada 100g. Se puede calcular como `(protein * 4) + (carbs * 4) + (fat * 9)` si la fuente no lo provee.

---

### `category` — string, obligatorio

Clasifica el alimento por su función nutricional principal. Valores válidos:

| Valor | Cuándo usarlo |
|-------|---------------|
| `protein` | La proteína es el macro dominante |
| `carbs` | Los carbohidratos son el macro dominante |
| `fat` | Las grasas son el macro dominante |
| `dairy` | Lácteos: yogur, leche, quesos, derivados |
| `postres_proteicos` | Postres con perfil proteico alto: skyr, cottage, quark |
| `vegetables` | Verduras, hortalizas, setas con menos de 65 kcal/100g (ver condiciones abajo) |
| `fruits` | Frutas frescas o desecadas (ver condiciones abajo) |
| `other` | No encaja en ninguna categoría anterior |

**Condiciones para usar `vegetables`:** calorías < 65, proteína < 10g, grasa < 8g, sin carne/lácteo/cereal/fruta. El script `fix_categories.py` asigna esta categoría automáticamente — no es necesario asignarla a mano.

**Condiciones para usar `fruits`:** keyword de fruta (manzana, naranja, plátano, etc.) + macros razonables (frescas: cal<100, fat<3, prot<2.5, carbs≥4; desecadas: cal hasta 380). Sin keywords de productos compuestos (yogur, smoothie, mermelada, etc.). El script `fix_fruits.py` asigna esta categoría automáticamente.

---

### `subgroup` — string, obligatorio, **nunca null**

Subclasificación dentro de la categoría. Si no encaja, usar `other`, `other_carbs`, etc. — **nunca dejar `null`**.

| Valor | Qué incluye |
|-------|-------------|
| `meat` | Carnes de cualquier tipo, embutidos |
| `fish` | Pescados Y mariscos |
| `eggs` | Huevos y derivados directos |
| `other_protein` | Proteínas vegetales, suplementos proteicos |
| `grains` | Cereales, harinas, panes, pastas, arroz |
| `legumes` | Lentejas, garbanzos, alubias, guisantes, soja |
| `tubers` | Patata, boniato, yuca, ñame |
| `fruit` | Frutas frescas |
| `other_carbs` | Salsas no procesadas, alimentos mixtos de CH |
| `basic_dairy` | Leche, yogur normal, kéfir, bebidas vegetales |
| `cheese` | Quesos de cualquier tipo |
| `high_protein_dairy` | Skyr, cottage, quark, requesón |
| `other_dairy` | Nata, crema, helados lácteos |
| `olive_oil` | Aceite de oliva exclusivamente |
| `nuts_seeds` | Frutos secos y semillas |
| `other_fat` | Otros aceites, mantequilla, aguacate, aceitunas |
| `other` | Todo lo que no encaja en ningún subgrupo anterior |
| `pepita` | Frutas con pepitas: manzana, pera, membrillo _(solo para fruits)_ |
| `citricos` | Cítricos: naranja, mandarina, limón, pomelo, lima _(solo para fruits)_ |
| `frutos_bosque` | Bayas: fresa, frambuesa, arándano, mora, grosella _(solo para fruits)_ |
| `tropical` | Tropicales: mango, kiwi, piña, plátano, papaya _(solo para fruits)_ |
| `hueso` | Frutas con hueso: melocotón, ciruela, cereza, albaricoque _(solo para fruits)_ |
| `melon_sandia` | Melón y sandía _(solo para fruits)_ |
| `uva` | Uva fresca _(solo para fruits)_ |
| `fruta_seca` | Frutas desecadas: dátil, pasas, higo seco, orejones _(solo para fruits)_ |
| `otra_fruta` | Granada, caqui, chirimoya, lichi, higo fresco _(solo para fruits)_ |
| `leafy` | Hojas verdes: lechuga, espinaca, rúcula, acelga, berro _(solo para vegetables)_ |
| `cruciferous` | Crucíferas: brócoli, coliflor, repollo, lombarda, col de Bruselas _(solo para vegetables)_ |
| `allium` | Aliáceas: cebolla, ajo, puerro, cebolleta _(solo para vegetables)_ |
| `mushroom` | Setas y hongos _(solo para vegetables)_ |
| `root_veg` | Raíces: zanahoria, remolacha, nabo, rábano _(solo para vegetables)_ |
| `fruiting_veg` | Frutos-verdura: tomate, pimiento, berenjena, calabacín, pepino _(solo para vegetables)_ |
| `stalk_veg` | Tallo/flor: espárrago, alcachofa, apio, hinojo, cardo _(solo para vegetables)_ |
| `other_veg` | Guisantes, menestra, brotes, mezclas _(solo para vegetables)_ |

---

### `macro_profile` — string, obligatorio

Indica cuál es el macro realmente dominante del alimento. **El algoritmo lo usa como fuente de verdad para el cálculo de equivalencias.**

Valores válidos: `protein` | `carbs` | `fat` | `calories`

| Valor | Cuándo usarlo |
|-------|---------------|
| `protein` | La proteína aporta más calorías que los otros macros |
| `carbs` | Los carbohidratos aportan más calorías |
| `fat` | La grasa aporta más calorías |
| `calories` | **Verduras y alimentos con muy pocas calorías** donde ningún macro domina: calorías totales < 65 kcal/100g |

Debe coincidir con el macro dominante real, no necesariamente con la `category`. Si `category` y `macro_profile` difieren, **`macro_profile` es la fuente de verdad**.

---

### `flags` — array de strings, puede estar vacío `[]`

Modifica el comportamiento del alimento en el algoritmo:

| Flag | Efecto |
|------|--------|
| `"condiment"` | Especias, sazonadores, salsas muy reducidas. **EXCLUIDOS de resultados de equivalencias.** |
| `"prepared"` | Platos preparados, comidas compuestas. Solo aparecen como fallback de último recurso (T3). |

Ejemplo con flag: `"flags": ["condiment"]`
Sin flags: `"flags": []`

---

### `source` — string, informativo

Indica de dónde provienen los datos nutricionales.

| Valor | Descripción |
|-------|-------------|
| `BEDCA` | Base de Datos Española de Composición de Alimentos |
| `OpenFoodFacts` | Base open source con código de barras |
| `Mercadona` | Producto de Mercadona |
| `Carrefour` | Producto de Carrefour |
| `Lidl` | Producto de Lidl |
| *(nombre del super)* | Cualquier supermercado |

---

### `brand` — string o `null`

Marca comercial del producto. `null` si es un alimento genérico sin marca.

---

### `code` — string o `null`

Código de barras EAN/UPC. `null` si no aplica o no se conoce.

---

### `quantity` — number o `null`

Cantidad de referencia en gramos para ese producto específico. `null` si los macros ya están en por 100g (lo habitual).

---

## Reglas críticas para el algoritmo

Estas reglas son **no negociables**. Romperlas produce equivalencias incorrectas o errores en el cálculo:

1. **`subgroup` nunca puede ser `null`** — usar `other`, `other_carbs`, `other_fat`, etc. si no encaja en ningún subgrupo específico.

2. **`macro_profile` debe reflejar el macro real**, no la categoría asignada. Un alimento categorizado como `dairy` puede tener `macro_profile: "fat"` si la grasa domina.

3. **Condimentos y especias SIEMPRE con `flags: ["condiment"]`** — pimienta, sal, orégano, vinagre, ketchup light, etc. De lo contrario aparecen como equivalencias de proteínas o carbohidratos.

4. **Platos compuestos SIEMPRE con `flags: ["prepared"]`** — lasaña, paella, pizza, empanada, croquetas, etc.

5. **`category` y `macro_profile` deben ser consistentes** — si difieren, documentar por qué. Si hay duda, `macro_profile` es la fuente de verdad.

---

## Cómo agregar alimentos nuevos

Seguí estos pasos en orden. Saltarte alguno puede romper el algoritmo silenciosamente.

### Paso 1 — Obtener los datos nutricionales

Fuentes aceptadas (en orden de prioridad):
- **BEDCA** — [bedca.net](https://www.bedca.net) — para alimentos genéricos españoles
- **OpenFoodFacts** — [world.openfoodfacts.org](https://world.openfoodfacts.org) — para productos con código de barras
- **Etiqueta del producto** — para productos de supermercado sin entrada en las bases anteriores

Todos los valores deben estar **por 100g** de producto tal como se consume (crudo o cocido, según corresponda).

### Paso 2 — Generar el `id`

Formato: `{fuente}_{numero_correlativo}` en minúsculas.

- Revisar el último `id` de esa fuente en `database.json`
- Incrementar el número: si el último es `bedca_0134`, el nuevo es `bedca_0135`
- Nunca reutilizar un `id` existente

### Paso 3 — Determinar `category` y `subgroup`

1. Calcular cuál macro aporta más calorías:
   - Proteína: `protein * 4`
   - Carbohidratos: `carbs * 4`
   - Grasa: `fat * 9`
2. El macro dominante guía tanto `category` como `subgroup`
3. Para lácteos y postres proteicos, usar las categorías específicas aunque la proteína no sea el macro más alto en calorías
4. Consultar las tablas de valores válidos de este documento — **nunca inventar valores nuevos**

### Paso 4 — Asignar `macro_profile`

- Debe coincidir con el macro dominante real (el que más calorías aporta)
- Solo tres valores posibles: `protein`, `carbs`, `fat`
- Si el alimento es un lácteo graso (queso curado, nata), el `macro_profile` es `fat` aunque la `category` sea `dairy`

### Paso 5 — Revisar `flags`

Preguntate:
- ¿Es un condimento, especia o salsa de uso mínimo? → agregar `"condiment"`
- ¿Es un plato preparado o comida compuesta? → agregar `"prepared"`
- ¿Es un alimento simple y completo? → dejar `[]`

### Paso 6 — Completar el objeto JSON

```json
{
  "id": "bedca_XXXX",
  "name": "Nombre del alimento, estado",
  "protein": 0.0,
  "carbs": 0.0,
  "fat": 0.0,
  "calories": 0.0,
  "category": "...",
  "subgroup": "...",
  "macro_profile": "...",
  "flags": [],
  "source": "BEDCA",
  "brand": null,
  "code": null,
  "quantity": null
}
```

### Paso 7 — Insertar en `database.json`

- Abrir `database.json`
- Agregar el objeto al final del array `foods[]`, antes del cierre `]`
- Asegurarse de que el JSON es válido (no falte ni sobre ninguna coma)
- Verificar con: `node -e "JSON.parse(require('fs').readFileSync('database.json', 'utf8')); console.log('OK')"`

### Paso 8 — Verificación rápida

Antes de hacer commit, chequear:
- [ ] El `id` es único en todo el archivo
- [ ] `subgroup` no es `null`
- [ ] `macro_profile` es `protein`, `carbs` o `fat`
- [ ] `flags` es un array (aunque esté vacío)
- [ ] El JSON parsea sin errores

---

*Documento generado como parte del proyecto Nutricionista. Mantener actualizado ante cambios en el algoritmo de equivalencias.*
