# 🚀 INSTRUCCIONES CLAUDE CODE - AMPLIAR BASE DATOS A 1500+ ALIMENTOS

## 📋 OBJETIVO

Expandir la base de datos de 200 a 1500+ alimentos mediante extracción automatizada de:

1. BEDCA completa (base datos oficial española)
2. Open Food Facts (productos comerciales España)

---

## ⚡ PASO A PASO PARA CLAUDE CODE

### PROMPT PARA COPIAR Y PEGAR:

```
Necesito que amplíes la base de datos de alimentos de RevolucionaT de 200 a 1500+ alimentos.

TAREAS:

1. DESCARGA BEDCA COMPLETA:
   - URL: https://www.bedca.net/bdpub/index.php
   - Busca la opción de descarga de base completa (Excel/CSV)
   - Extrae todos los alimentos con macros completos (proteína, carbos, grasas, calorías)
   - Ignora alimentos sin datos de macros

2. EXTRAE OPEN FOOD FACTS ESPAÑA:
   - API: https://world.openfoodfacts.org/cgi/search.pl
   - Parámetros:
     * countries_tags_en=spain
     * page_size=100
     * fields=product_name,brands,nutriments,categories_tags
   - Filtra productos con macros completos
   - Prioriza marcas: Mercadona (Hacendado), Lidl, Carrefour, Aldi, DIA

3. LIMPIEZA Y VALIDACIÓN:
   - Elimina duplicados por nombre + marca
   - Valida que todos tengan: protein_100g, carbs_100g, fat_100g
   - Elimina productos con macros = 0 o null
   - Categoriza automáticamente:
     * protein: si proteína > 15g/100g
     * carbs: si carbos > 40g/100g
     * fat: si grasas > 30g/100g
     * dairy: si contiene "yogur", "leche", "queso"

4. GENERA JSON FINAL:
   - Formato idéntico a database.json existente
   - Campos requeridos: id, name, brand, source, category, protein, carbs, fat, calories
   - Guarda como: database-full.json

IMPORTANTE:
- Asegúrate de que TODOS los valores numéricos son válidos
- No incluyas productos sin marca o nombre genérico duplicado
- Prioriza calidad sobre cantidad

¿Puedes ejecutar esto paso a paso y mostrarme el progreso?
```

---

## 📊 RESULTADO ESPERADO

**Archivo:** `database-full.json`

**Estructura:**

```json
{
  "metadata": {
    "version": "2.0.0",
    "total_foods": 1532,
    "sources": ["BEDCA", "Mercadona", "Lidl", "Carrefour", "Aldi", "DIA"],
    "last_updated": "2026-02-12",
    "verification": "Automated extraction + validation"
  },
  "foods": [
    {
      "id": "bedca_p001",
      "name": "Pechuga de pollo",
      "brand": "Genérico",
      "source": "BEDCA",
      "category": "protein",
      "protein": 23.0,
      "carbs": 0,
      "fat": 1.2,
      "calories": 110
    },
    ... (1500+ más)
  ]
}
```

---

## 🔧 INTEGRACIÓN CON LA APP

Una vez generado `database-full.json`:

1. **Reemplaza el archivo:**

   ```bash
   cp database-full.json database.json
   ```

2. **Verifica que funciona:**
   - Abre index.html en navegador
   - Busca alimentos
   - Comprueba que aparecen más resultados

3. **Deploy a Vercel:**
   ```bash
   vercel --prod
   ```

---

## ⚠️ TROUBLESHOOTING

### Si BEDCA no descarga automáticamente:

- Busca manualmente en https://www.bedca.net/bdpub/
- Descarga Excel/CSV
- Proporciona ruta del archivo a Claude Code

### Si Open Food Facts da rate limit:

- Añade delay entre llamadas: `time.sleep(0.5)`
- Reduce page_size a 50
- Procesa por lotes

### Si hay errores de validación:

- Revisa campos vacíos
- Convierte strings a números: `float(value)`
- Valida categorías con reglas más flexibles

---

## 📈 MÉTRICAS DE CALIDAD

**Objetivo mínimo:**

- ✅ 1000+ alimentos únicos
- ✅ 100% con macros completos
- ✅ <5% duplicados
- ✅ 70%+ BEDCA, 30%+ comerciales

**Distribución ideal:**

- Proteínas: ~400 alimentos
- Carbohidratos: ~400 alimentos
- Grasas: ~200 alimentos
- Lácteos: ~200 alimentos
- Verduras: ~300 alimentos

---

## 🎯 TIEMPO ESTIMADO

- Descarga BEDCA: 5-10 min
- Extracción Open Food Facts: 10-15 min
- Limpieza y validación: 5-10 min
- Generación JSON: 2-3 min

**TOTAL:** 30-40 minutos

---

## ✅ CHECKLIST POST-EJECUCIÓN

- [ ] database-full.json generado
- [ ] > 1000 alimentos
- [ ] Todos con macros completos
- [ ] Sin duplicados obvios
- [ ] Categorías asignadas correctamente
- [ ] JSON válido (sin errores de sintaxis)
- [ ] Integrado en la app
- [ ] Testeado en navegador
- [ ] Deployado a Vercel

---

**¿Dudas?** Vuelve a Claude Chat con el error específico.
