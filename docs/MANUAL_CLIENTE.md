# Manual: Agregar y actualizar alimentos

> Para el equipo de RevolucionaT y para Claude cuando asista al cliente.
> Última actualización: 2026-04-30

---

## Cómo funciona el sistema

```
database.json          →   fix_categories.py   →   database.json (corregido)
(agregás alimentos)         (clasifica verduras)

database.json (corregido)  →  embed_foods.py   →   microservicio/data/
                               (actualiza IA)        (embeddings nuevos)

git push  →  Vercel redeploya automáticamente
```

**Tres archivos clave que no hay que tocar a mano:**
- `scripts/fix_categories.py` — clasifica verduras automáticamente
- `scripts/embed_foods.py` — actualiza la búsqueda semántica
- `microservicio/data/` — archivos de la IA (se generan solos)

**El único archivo que el cliente edita:** `database.json`

---

## Estructura de un alimento

Cada alimento es un objeto JSON dentro del array `foods[]` en `database.json`.

```json
{
  "id": "manual_0001",
  "name": "Espárrago, verde",
  "protein": 2.9,
  "carbs": 2.0,
  "fat": 0.2,
  "calories": 20.5,
  "category": "vegetables",
  "subgroup": "stalk_veg",
  "macro_profile": "calories",
  "flags": [],
  "source": "BEDCA",
  "brand": null,
  "code": null,
  "quantity": null
}
```

### Todos los campos explicados

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `id` | string | ✅ | Identificador único. Ver regla abajo. |
| `name` | string | ✅ | Nombre del alimento. Incluir estado si aplica (cruda, cocida, hervida). |
| `protein` | number | ✅ | Gramos de proteína por 100g. Usar punto, no coma. |
| `carbs` | number | ✅ | Gramos de carbohidratos por 100g. |
| `fat` | number | ✅ | Gramos de grasa por 100g. |
| `calories` | number | ✅ | Kcal por 100g. Fórmula: `(protein×4) + (carbs×4) + (fat×9)` |
| `category` | string | ✅ | Categoría principal. Ver tabla de valores válidos. |
| `subgroup` | string | ✅ | Subcategoría. **Nunca dejar `null`** — usar `other` si no encaja. |
| `macro_profile` | string | ✅ | Macro dominante. Ver tabla de valores válidos. |
| `flags` | array | ✅ | Etiquetas especiales. Dejar `[]` si no aplica ninguna. |
| `source` | string | ✅ | Fuente del dato nutricional. |
| `brand` | string o null | — | Marca del producto. `null` si es genérico. |
| `code` | string o null | — | Código de barras del producto. `null` si no tiene. |
| `quantity` | number o null | — | Porción estándar en gramos. `null` si no aplica. |

---

## Regla del `id`

El `id` debe ser **único en todo el archivo**. Formato: `{fuente}_{número}`.

```
bedca_0001    → alimento genérico de BEDCA
off_0042      → producto de OpenFoodFacts
manual_0001   → agregado a mano por el cliente
mercadona_0010 → producto de supermercado
```

**Cómo encontrar el próximo número:** buscar el último `id` que empiece con el prefijo elegido y sumar 1.

```bash
# Ejemplo para encontrar el último id "manual_"
grep '"id"' database.json | grep manual | tail -1
```

---

## Valores válidos de `category`

| Valor | Cuándo usarlo |
|-------|---------------|
| `protein` | Carnes, aves, pescados, mariscos, huevos, legumbres como fuente proteica |
| `carbs` | Pan, cereales, pasta, arroz, patata, legumbres como fuente de CH |
| `fat` | Aceites, mantequilla, frutos secos, aguacate, quesos curados |
| `dairy` | Leche, yogur, quesos frescos, bebidas lácteas |
| `postres_proteicos` | Skyr, quark, cottage, batidos proteicos, flanes proteicos |
| `vegetables` | Verduras, hortalizas, setas **con menos de 65 kcal por 100g** |
| `fruits` | Frutas frescas (manzana, naranja, plátano) y desecadas (dátil, pasas) |
| `other` | Lo que no encaja en ninguna categoría anterior |

### ¿Cuándo usar `vegetables`?

Un alimento va en `vegetables` si cumple **todas** estas condiciones:
- Calorías < 65 kcal por 100g
- Proteína < 10g por 100g
- Grasa < 8g por 100g
- Es una verdura, hortaliza o seta (no tiene carne, lácteo, cereal, ni fruta)
- No tiene `flags: ["condiment"]` ni `flags: ["prepared"]`

> **Nota:** No hace falta asignar `vegetables` a mano. El script `fix_categories.py` lo hace automáticamente después de ejecutar `bash scripts/actualizar.sh`. Podés poner `category: "other"` y el script lo corregirá si el alimento cumple las condiciones.

---

## Valores válidos de `subgroup`

### Para `category: "protein"`
| Valor | Qué incluye |
|-------|-------------|
| `meat` | Todas las carnes y embutidos |
| `fish` | Pescados y mariscos |
| `eggs` | Huevos y derivados |
| `plant_protein` | Legumbres como fuente proteica, tofu, tempeh |
| `other_protein` | Lo que no encaja |

### Para `category: "carbs"`
| Valor | Qué incluye |
|-------|-------------|
| `grains` | Pan, arroz, pasta, cereales, harina |
| `tubers` | Patata, boniato, yuca |
| `fruit` | Frutas frescas y en conserva |
| `legumes` | Legumbres como fuente de carbohidratos |
| `other_carbs` | Lo que no encaja |

### Para `category: "fat"`
| Valor | Qué incluye |
|-------|-------------|
| `oils` | Aceites vegetales |
| `nuts` | Frutos secos y semillas |
| `other_fat` | Lo que no encaja |

### Para `category: "dairy"`
| Valor | Qué incluye |
|-------|-------------|
| `basic_dairy` | Leche entera, semidesnatada, desnatada |
| `high_protein_dairy` | Yogures proteicos, skyr, kéfir proteico |
| `other_dairy` | Yogures normales, bebidas lácteas, quesos blandos |

### Para `category: "fruits"`
| Valor | Qué incluye |
|-------|-------------|
| `pepita` | Manzana, pera, membrillo |
| `citricos` | Naranja, mandarina, limón, pomelo, lima, clementina |
| `frutos_bosque` | Fresa, frambuesa, arándano, mora, grosella |
| `tropical` | Mango, kiwi, piña, plátano, papaya, maracuyá |
| `hueso` | Melocotón, ciruela, cereza, albaricoque, nectarina |
| `melon_sandia` | Melón y sandía |
| `uva` | Uvas frescas |
| `fruta_seca` | Dátil, pasas, higo seco, orejones, frutas deshidratadas |
| `otra_fruta` | Granada, caqui, chirimoya, lichi, higo fresco, níspero |

> **Nota:** No hace falta asignar `fruits` a mano. El script `fix_fruits.py` lo hace automáticamente cuando ejecutás `bash scripts/actualizar.sh`. Las frutas en almíbar, los zumos y los yogures con fruta NO son `fruits` — esos van a `carbs` u `other`.

### Para `category: "vegetables"`
| Valor | Qué incluye |
|-------|-------------|
| `leafy` | Lechuga, espinaca, rúcula, canónigos, acelga, berro, escarola |
| `cruciferous` | Brócoli, coliflor, repollo, lombarda, col de Bruselas |
| `allium` | Cebolla, ajo, puerro, cebolleta, ajetes |
| `mushroom` | Champiñón, seta, boletus, níscalo, shiitake, portobello |
| `root_veg` | Zanahoria, remolacha, nabo, rábano |
| `fruiting_veg` | Tomate, pimiento, berenjena, calabacín, calabaza, pepino |
| `stalk_veg` | Espárrago, apio, alcachofa, hinojo, cardo |
| `other_veg` | Guisantes, menestra, brotes, mezclas de verduras |

---

## Valores válidos de `macro_profile`

| Valor | Cuándo usarlo |
|-------|---------------|
| `protein` | La proteína aporta más calorías que grasa y CH |
| `carbs` | Los carbohidratos aportan más calorías |
| `fat` | La grasa aporta más calorías |
| `calories` | **Usar para todas las verduras y alimentos con muy pocas calorías** donde ningún macro domina claramente |

> El `macro_profile` es la fuente de verdad para el algoritmo de intercambios. Si `category` y `macro_profile` difieren, el algoritmo usa `macro_profile`.

---

## Valores válidos de `flags`

| Valor | Cuándo se agrega | Quién lo agrega |
|-------|-----------------|-----------------|
| `"condiment"` | Sal, pimienta, especias, vinagre, ketchup, mayonesa | Manualmente al cargar el alimento |
| `"prepared"` | Plato preparado: lasaña, paella, croquetas, "arroz con pollo", "pollo tikka", etc. | **Automático** — `fix_prepared.py` (también se puede agregar manualmente) |
| `"sweet"` | Golosinas, gominolas, chocolates, dulces concentrados | **Automático** — `fix_sweets.py` |
| `"hidden"` | Duplicado nutricional de un alimento básico (ej: 5 atunes idénticos) | **Automático** — `dedupe_basicos.py` |

```json
// Condimento:
"flags": ["condiment"]

// Plato preparado:
"flags": ["prepared"]

// Alimento simple:
"flags": []

// Combinaciones válidas:
"flags": ["condiment", "sweet"]   // ej: mermelada
"flags": ["sweet", "hidden"]      // golosina duplicada
```

> Los flags `"sweet"` y `"hidden"` los gestionan los scripts automáticamente al ejecutar `bash scripts/actualizar.sh`. **No los toques a mano** salvo que quieras forzar a esconder un alimento específico.

### El flag `"hidden"` y la deduplicación de básicos

Cuando hay 12 atunes al natural con macros casi idénticos, el script `dedupe_basicos.py` elige uno como **canónico** (preferentemente BEDCA) y marca los demás con `"hidden"`. Estos no aparecen en intercambios ni en búsquedas, pero **siguen estando en `database.json`**.

**Prioridad para elegir el canónico:**
1. Fuente `BEDCA` (mejor)
2. Fuente `OpenFoodFacts` con todos los macros completos
3. Cualquier supermercado (Mercadona, Carrefour, etc.)
4. Dentro del mismo nivel: el de nombre más corto y sin marca

**Qué pasa si querés que un alimento "hidden" vuelva a aparecer:**

Editá `database.json`, busca el alimento, y quitale el flag `"hidden"`:

```json
// Antes
"flags": ["hidden"]

// Después
"flags": []
```

Pero ojo — el próximo `bash scripts/actualizar.sh` lo va a volver a marcar como duplicado si nada cambió. Si querés conservarlo visible permanentemente, necesitás cambiar sus macros lo suficiente (>15% de diferencia con los otros) o eliminar el alimento canónico.

### Productos donde la marca SÍ importa (nunca se deduplican)

El script `dedupe_basicos.py` jamás toca alimentos cuyo nombre contiene cualquiera de estos términos, porque la marca afecta los macros realmente:

```
skyr, yopro, yogur proteico, queso fresco batido, queso cottage, quark,
hummus, fiambre, lonchas, loncheado,
bebida de almendra/avena/soja/arroz/coco/espelta, bebida vegetal,
pan, wrap, tortilla mexicana, barrita,
postre proteico, batido proteico, shake proteico, high protein
```

Si necesitás agregar una nueva categoría a esta lista (ej: aparece "kefir proteico" como producto nuevo), editá `scripts/dedupe_basicos.py` → variable `MARCA_IMPORTA`.

---

## Fuentes recomendadas para datos nutricionales

| Fuente | Para qué sirve | Valor en `source` |
|--------|----------------|-------------------|
| [BEDCA](https://www.bedca.net) | Alimentos genéricos españoles | `"BEDCA"` |
| [OpenFoodFacts](https://world.openfoodfacts.org) | Productos con código de barras | `"OpenFoodFacts"` |
| Etiqueta del producto | Cualquier producto de supermercado | Nombre del supermercado |
| [FatSecret España](https://www.fatsecret.es) | Alternativa a BEDCA | `"FatSecret"` |

Todos los valores deben estar **por 100g** de producto tal como se consume.

---

## Cómo agregar un alimento (paso a paso)

### Opción A — Con Claude (recomendado)

Decirle exactamente esto a Claude:

> Quiero agregar un alimento nuevo a la base de datos de RevolucionaT. El archivo a editar es `database.json`, array `foods[]`. El alimento es: **[nombre del alimento]**.
> 
> Por favor:
> 1. Buscá los valores nutricionales por 100g en BEDCA o OpenFoodFacts
> 2. Determiná el `id` correcto (revisá el último `manual_XXXX` en el archivo)
> 3. Completá todos los campos según el SCHEMA definido en `docs/SCHEMA.md`
> 4. Insertá el objeto al final del array `foods[]` en `database.json`
> 5. Verificá que el JSON sea válido
> 6. Ejecutá `bash scripts/actualizar.sh` para aplicar los cambios

### Opción B — A mano

1. Buscar los datos nutricionales por 100g (ver fuentes arriba)
2. Encontrar el último `id` del prefijo elegido: `grep '"id"' database.json | grep manual | tail -1`
3. Copiar la estructura del ejemplo de arriba y completar los campos
4. Abrir `database.json` y pegar el objeto **antes** del cierre `]` del array, con una coma al final del objeto anterior
5. Verificar que el JSON es válido: `node -e "JSON.parse(require('fs').readFileSync('database.json','utf8')); console.log('OK')"`
6. Ejecutar `bash scripts/actualizar.sh`

---

## Qué ejecutar después de cualquier cambio

**Un solo comando:**

```bash
bash scripts/actualizar.sh
```

Esto hace, en orden:
1. `fix_categories.py` — corrige categorías de verduras
2. `embed_foods.py` — regenera los embeddings de búsqueda semántica

Después, para publicar:

```bash
git add database.json microservicio/data/
git commit -m "feat: agregar [nombre del alimento]"
git push
```

---

## Actualización automática (GitHub Actions)

Si el repositorio está en GitHub y el archivo `.github/workflows/actualizar_bd.yml` existe, **todo es automático**:

1. Editás `database.json` y hacés `git push`
2. GitHub detecta el cambio en `database.json`
3. GitHub ejecuta automáticamente `fix_categories.py` y `embed_foods.py`
4. GitHub hace un commit de vuelta con los archivos actualizados
5. Vercel despliega el resultado automáticamente

No hace falta ejecutar nada más que el push.

```
Tu push → GitHub Action → fix + embeddings → commit automático → Vercel deploy
```

> **Importante:** El commit automático del bot lleva `[skip ci]` en el mensaje para no generar un bucle infinito.

---

## Checklist antes de publicar

```
[ ] El id es único (no existe en database.json)
[ ] subgroup no es null (usar "other" o el subgrupo correcto)
[ ] macro_profile es protein, carbs, fat o calories
[ ] flags es un array (aunque esté vacío: [])
[ ] Todos los valores numéricos usan punto decimal (0.5 no 0,5)
[ ] El JSON parsea sin errores (ver comando de verificación arriba)
[ ] Se ejecutó bash scripts/actualizar.sh (o el push fue a GitHub)
```

---

## Errores comunes

### El alimento aparece como intercambio de algo que no tiene sentido

Causa probable: `category` o `macro_profile` incorrectos. El algoritmo agrupa los intercambios por categoría.

Solución: verificar que `category` y `macro_profile` sean los correctos. Luego correr `bash scripts/actualizar.sh`.

### Una verdura no aparece como verdura

Causa probable: tiene más de 65 kcal, o le falta el keyword en el nombre.

Solución: revisar que las calorías sean correctas. Si el nombre no está en castellano estándar (ej: producto en catalán), puede ser necesario agregar el keyword a `fix_categories.py`. Consultar con el desarrollador.

### El JSON da error al parsear

Causa probable: falta una coma entre objetos, o sobra una coma al final del último objeto.

Solución: verificar con `node -e "JSON.parse(require('fs').readFileSync('database.json','utf8')); console.log('OK')"`. El error indica la línea exacta del problema.

### Los embeddings del microservicio están desactualizados

Síntoma: el microservicio muestra un warning sobre hash mismatch al arrancar.

Solución: ejecutar `bash scripts/actualizar.sh` y reiniciar el microservicio.

---

## Referencia rápida — Ejemplo completo por tipo de alimento

### Verdura
```json
{
  "id": "manual_0001",
  "name": "Alcachofa, cruda",
  "protein": 2.4,
  "carbs": 7.0,
  "fat": 0.2,
  "calories": 39.0,
  "category": "vegetables",
  "subgroup": "stalk_veg",
  "macro_profile": "calories",
  "flags": [],
  "source": "BEDCA",
  "brand": null,
  "code": null,
  "quantity": null
}
```

### Proteína animal
```json
{
  "id": "manual_0002",
  "name": "Pechuga de pavo, cruda",
  "protein": 24.0,
  "carbs": 0.0,
  "fat": 1.0,
  "calories": 105.0,
  "category": "protein",
  "subgroup": "meat",
  "macro_profile": "protein",
  "flags": [],
  "source": "BEDCA",
  "brand": null,
  "code": null,
  "quantity": null
}
```

### Cereal / Carbohidrato
```json
{
  "id": "manual_0003",
  "name": "Arroz blanco, cocido",
  "protein": 2.5,
  "carbs": 28.0,
  "fat": 0.3,
  "calories": 126.0,
  "category": "carbs",
  "subgroup": "grains",
  "macro_profile": "carbs",
  "flags": [],
  "source": "BEDCA",
  "brand": null,
  "code": null,
  "quantity": null
}
```

### Condimento
```json
{
  "id": "manual_0004",
  "name": "Orégano seco",
  "protein": 9.0,
  "carbs": 64.0,
  "fat": 4.3,
  "calories": 265.0,
  "category": "other",
  "subgroup": "other",
  "macro_profile": "carbs",
  "flags": ["condiment"],
  "source": "BEDCA",
  "brand": null,
  "code": null,
  "quantity": null
}
```

### Plato preparado
```json
{
  "id": "manual_0005",
  "name": "Lasaña de verduras",
  "protein": 6.0,
  "carbs": 14.0,
  "fat": 5.0,
  "calories": 125.0,
  "category": "carbs",
  "subgroup": "other_carbs",
  "macro_profile": "carbs",
  "flags": ["prepared"],
  "source": "Mercadona",
  "brand": "Hacendado",
  "code": null,
  "quantity": 400
}
```

---

*Mantener este documento actualizado si cambia el algoritmo o se agregan nuevas categorías.*
