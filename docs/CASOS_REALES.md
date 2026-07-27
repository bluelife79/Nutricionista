# Casos reales de uso — RevolucionaT

> Escenarios reales de mujeres españolas de 35-60 años usando la app.
> Usar este documento para validar que los intercambios son clínicamente correctos.
> Si algún caso falla, hay un bug a reportar.

---

## Cómo usar este documento

1. Abrir la app en el móvil o navegador
2. Buscar el alimento indicado en "Buscar alimento"
3. Ingresar la cantidad indicada
4. Verificar que los intercambios mostrados coinciden con lo esperado

**Verde ✅ = debería aparecer / es correcto**  
**Rojo ❌ = NO debería aparecer / es un error**  
**Amarillo ⚠️ = caso límite, preguntar a la nutricionista**

---

## GRUPO 1 — Carbohidratos comunes

### Caso 1.1 — Arroz blanco (123g)
**Perfil:** María, 48 años, dieta de mantenimiento. Come arroz de guarnición.

**Intercambios esperados ✅**
- Pasta cocida (~150g) — cereal equivalente
- Quinoa (~110g) — cereal proteico
- Patata hervida (~250g) — hidrato de diferente índice glucémico
- Cuscús (~115g) — cereal fácil
- Boniato (~200g) — tubérculo más nutritivo
- Pan integral (~70g) — para quien quiera cambiar a bocadillo

**NO debe aparecer ❌**
- Golosinas (Mousy, Osi Fruit, Krokodil, gominolas) — son azúcar puro, no hidrato de cocina
- Mermeladas — condimento, no guarnición
- Miel — condimento
- Chocolate — grasa, no carbohidrato de cocina
- Refrescos — bebida azucarada

---

### Caso 1.2 — Pan de molde blanco (2 rebanadas = 60g)
**Perfil:** Carmen, 52 años, desayuna tostadas cada mañana. Quiere variedad.

**Intercambios esperados ✅**
- Pan integral (60g) — misma cantidad, más fibra
- Pan de centeno (~55g) — alternativa más nutritiva
- Tostadas tipo biscotte (~35g) — formato diferente
- Avena (~50g) — desayuno alternativo
- Arroz inflado (~40g) — cereal de desayuno

**NO debe aparecer ❌**
- Golosinas o caramelos
- Patata o arroz cocido — son para comida principal, no desayuno (aunque matemáticamente equivalentes)

---

### Caso 1.3 — Patata hervida (200g)
**Perfil:** Ana, 41 años, come patata como guarnición en la cena.

**Intercambios esperados ✅**
- Boniato hervido (~180g) — tubérculo más nutritivo
- Arroz blanco cocido (~130g) — cereal equivalente
- Pasta cocida (~155g) — cereal fácil
- Maíz dulce en conserva (~200g) — guarnición similar
- Yuca cocida (~150g) — tubérculo alternativo

**NO debe aparecer ❌**
- Golosinas
- Frutas (aunque son carbohidratos, no son intercambiables clínicamente como guarnición)

---

## GRUPO 2 — Proteínas

### Caso 2.1 — Pechuga de pollo a la plancha (150g)
**Perfil:** Laura, 45 años, come pollo casi todos los días y quiere variedad.

**Intercambios esperados ✅**
- Pechuga de pavo (~150g) — proteína equivalente, misma familia
- Merluza al horno (~180g) — pescado blanco, proteína baja en grasa
- Lomo de cerdo (~130g) — carne más sabrosa, similar proteína
- Atún en agua escurrido (~120g) — proteína rápida
- Clara de huevo (~250g) — proteína pura, muy distinto en volumen
- Lentejas cocidas (~300g) — proteína vegetal (mucho más volumen)

**MISMA FAMILIA (secundarios):**
- Pollo troceado (~150g)
- Muslo de pollo sin piel (~155g)
- Pollo asado (~145g)

**NO debe aparecer ❌**
- Condimentos (sal, pimienta, orégano)
- Aceite de oliva — es grasa, no proteína
- Mantequilla
- Quesos grasos — si aparecen, hay bug en macro_profile

---

### Caso 2.2 — Salmón fresco (120g)
**Perfil:** Marta, 55 años, cardíaca. La nutricionista le recomienda pescado azul 3 veces/semana.

**Intercambios esperados ✅**
- Atún fresco (~115g) — pescado azul equivalente
- Caballa (~120g) — pescado azul similar en omega-3
- Sardinas (~130g) — alternativa económica
- Trucha (~130g) — pescado semigraso

**Intercambios secundarios ✅**
- Merluza (~200g) — pescado blanco, menos grasa (más cantidad)
- Pechuga de pollo (~130g) — proteína equivalente pero sin omega-3

**NO debe aparecer ❌**
- Queso manchego — la grasa es saturada, no omega-3
- Mantequilla
- Aceite de oliva solo

---

### Caso 2.3 — Huevos revueltos (2 huevos = 120g)
**Perfil:** Sofía, 39 años, vegetariana. Desayuna huevos.

**Intercambios esperados ✅**
- Clara de huevo (~200g) — sin grasa de yema
- Tofu firme (~150g) — proteína vegetal sólida
- Requesón (~200g) — proteína láctea
- Pechuga de pavo (~100g) — para quien no sea vegetariana
- Queso fresco desnatado (~180g)

**NO debe aparecer ❌**
- Leche sola (sin acompañamiento)
- Yogur como plato principal (volumen insuficiente)

---

## GRUPO 3 — Lácteos

### Caso 3.1 — Yogur natural (1 unidad = 125g)
**Perfil:** Rosa, 60 años, osteoporosis. Come yogur para el calcio.

**Intercambios esperados ✅**
- Kéfir (~130g) — fermentado equivalente
- Yogur griego desnatado (~115g) — más proteína
- Skyr (~110g) — muy proteico
- Queso fresco batido 0% (~130g)

**NO debe aparecer ❌**
- Salmón o proteína animal — son intercambios de proteína, no de lácteo
- Bebida vegetal (almendras, avena) — si aparece, puede ser correcto según la app pero la nutricionista debe evaluar (no aporta calcio equivalente)

---

## GRUPO 4 — Grasas

### Caso 4.1 — Aceite de oliva virgen extra (15ml = 14g)
**Perfil:** Pilar, 50 años, dieta mediterránea. Aliña con AOVE.

**Intercambios esperados ✅**
- Aceite de girasol (14g) — grasa equivalente, diferente perfil lipídico
- Mantequilla (~12g) — grasa diferente, más saturada ⚠️ (válido matemáticamente, la nutricionista decide)
- Aguacate (~65g) — grasa vegetal en forma de alimento

**NO debe aparecer ❌**
- Pan, arroz, pasta — son carbohidratos, no grasas
- Proteínas
- Bebidas

---

## GRUPO 5 — Verduras

### Caso 5.1 — Brócoli al vapor (200g)
**Perfil:** Elena, 44 años, intenta comer más verdura. Le piden cambiar el brócoli.

**Intercambios esperados ✅**
- Coliflor (~200g) — crucífera equivalente
- Col de Bruselas (~190g) — misma familia
- Judías verdes (~210g) — alternativa fácil
- Espinacas (~220g) — hoja verde nutritiva
- Espárrago verde (~200g) — similar en calorías

**NO debe aparecer ❌**
- Pechuga de pollo — es proteína
- Arroz — es hidrato
- Queso — es lácteo/grasa

---

### Caso 5.2 — Espárrago verde (150g)
**Perfil:** Isabel, 58 años, cocina espárragos a la plancha. Este fue el caso que mostró el bug original.

**Intercambios esperados ✅**
- Brócoli (~150g)
- Calabacín (~160g)
- Espinacas (~155g)
- Coliflor (~150g)
- Pimiento verde (~160g)
- Alcachofas (~150g)

**NO debe aparecer ❌**
- Pavo, pollo, ternera — eran el bug original (categoría protein ≠ vegetables)
- Quesos
- Carbohidratos

---

## GRUPO 6 — Casos especiales / edge cases

### Caso 6.1 — Lentejas cocidas (200g)
**Perfil:** Amelia, 47 años, vegetariana. Come lentejas como proteína principal.

**Comportamiento actual:** Las lentejas están en `category: protein` o `carbs` según la fuente.
**Intercambios esperados:** Garbanzos, alubias, tofu, soja.
**Posible bug:** Si las lentejas aparecen con intercambios de arroz o verduras, hay problema de categoría.

---

### Caso 6.2 — Aguacate (½ unidad = 80g)
**Perfil:** Nuria, 35 años, dieta keto. Come aguacate como grasa.

**Intercambios esperados ✅**
- Aceite de oliva (~20g) — grasa equivalente en volumen reducido
- Frutos secos mixtos (~30g) — grasa vegetal

**NO debe aparecer ❌**
- Frutas dulces (mango, plátano) — son carbohidratos aunque el aguacate sea fruta botánicamente

---

### Caso 6.3 — Nocilla / Nutella (20g)
**Perfil:** Gemma, 38 años, la toma en el desayuno. Quiere alternativa más sana.

**Comportamiento esperado:** Si aparece como búsqueda, debe tener `flags: ["sweet"]`.
**Intercambios que tienen sentido:** Mantequilla de cacahuete, tahini, otras cremas de frutos secos.
**NO debe aparecer:** Pechuga de pollo, arroz, yogur.

---

### Caso 6.4 — Crema de verduras (250ml = 250g)
**Perfil:** Concha, 62 años, come cremas como cena ligera.

**Intercambios esperados ✅**
- Otras cremas de verduras
- Gazpacho (~250g)
- Pisto (~250g)

**Posible bug:** Si la crema está en `category: other` sin `flags: ["prepared"]`, puede aparecer como intercambio de verdura cruda. Verificar el flag.

---

## Bugs conocidos (ya corregidos)

| Bug | Descripción | Estado |
|-----|-------------|--------|
| Espárrago → Pavo | Las verduras no tenían categoría propia, se mezclaban con proteínas | ✅ Corregido — categoría `vegetables` creada |
| Arroz → Golosinas | Gominolas sin flag aparecían como intercambio de cereales | ✅ Corregido — flag `"sweet"` en 98 dulces |
| Pavo en "familia" del pollo | Subgroup `"meat"` demasiado genérico para la detección de T1 | ✅ Corregido — detección por nombre (token) |

---

## Cómo reportar un bug nuevo

Si al probar alguno de estos casos el resultado es incorrecto:

1. Anotar: nombre del alimento buscado + cantidad + intercambio incorrecto que apareció
2. Buscar el alimento incorrecto en `database.json` y revisar sus campos `category`, `subgroup`, `macro_profile`, `flags`
3. Si el problema es de categoría → corregir en `database.json` y ejecutar `bash scripts/actualizar.sh`
4. Si el problema es sistémico (muchos alimentos del mismo tipo) → consultar con el desarrollador

---

*Documento para uso interno del equipo RevolucionaT.*  
*Actualizar cuando se detecten y corrijan nuevos bugs.*
