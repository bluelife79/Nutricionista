# Contrato de producto — Intercambiador RevolucionaT Premium v2

Estado: **contrato de release**
Público principal: mujeres de más de 40 años del programa RevolucionaT en España.
Objetivo de salida: candidata apta para producción con una confianza demostrable del 90–95%.

## 1. Qué problema resuelve

La herramienta permite cambiar una cantidad concreta de un alimento por otra cantidad de un alimento diferente sin desordenar de forma relevante la intención nutricional de la toma.

No es:

- un generador de recetas;
- un buscador de productos por similitud de palabras;
- una autorización para sustituir cualquier alimento por otro que coincida en una sola cifra;
- una recomendación médica individual;
- una promesa de igualdad nutricional total.

El resultado correcto debe ser simultáneamente:

1. nutricionalmente honesto;
2. culinariamente lógico;
3. práctico de servir y consumir;
4. reconocible para una mujer que compra y cocina en España;
5. claro respecto a sus límites.

## 2. Jerarquía de fuentes

La procedencia se muestra y se usa en el orden siguiente:

1. **BEDCA**: referencia canónica para alimentos genéricos y composición por 100 g.
2. **Producto español controlado**: Mercadona, Carrefour, Lidl y Aldi.
3. **Otros distribuidores españoles auditados**: solo si aportan cobertura real.
4. **Open Food Facts curado**: únicamente productos con evidencia de venta en España, nombre comprensible, macros completos y sin incidencias graves de calidad.

Open Food Facts no entra directamente en producción por volumen. Todo producto pasa por una extracción reproducible, validación automática, deduplicación y revisión de los casos expuestos.

Cada alimento publicable debe conservar como mínimo:

- identificador estable;
- nombre visible en español o nombre comercial reconocible;
- fuente;
- energía, proteína, hidratos y grasa por 100 g;
- categoría y subgrupo;
- estado de calidad;
- estado de preparación;
- contexto culinario estructurado;
- trazabilidad de las reglas o de la revisión que lo aprobaron.

Un texto generado por IA nunca sustituye estos campos ni constituye evidencia de que el alimento está bien clasificado.

## 3. Modelo de decisión

El orden de decisión es obligatorio:

1. **Elegibilidad**: datos válidos, alimento visible, sin cuarentena, sin contradicciones críticas.
2. **Seguridad y restricciones**: vegetarianismo, lactosa y cualquier filtro activo.
3. **Cohorte culinaria**: conservar el tipo de uso que motivó el cambio.
4. **Cálculo nutricional**: usar el ancla adecuada y comprobar energía y macros secundarios.
5. **Ración práctica**: comprobar que la cantidad se puede entender, servir y consumir.
6. **Calidad española**: priorizar genérico BEDCA y productos habituales del mercado español.
7. **Diversidad útil**: evitar ocho formatos casi idénticos cuando existen alternativas distintas válidas.
8. **Explicación**: indicar por qué encaja y cualquier diferencia relevante.

Ningún punto posterior puede rescatar un alimento descartado por un punto anterior.

## 4. Contexto culinario

El contexto se modela con señales estructuradas, no con prosa generada:

- `premium_context`: cereal de desayuno, pan, grano, tubérculo, legumbre, carne, pescado, huevo, proteína vegetal, leche, fermentado lácteo, queso fresco, queso curado, fruta, verdura, grasa, plato preparado u otro;
- `raw_ingredient` y `ready_to_eat`: distinguen materia prima y estado de consumo;
- `culinary_role` y `meal_slot`: papel culinario y momento de la toma;
- `subgroup`, `dairy_subfamily`, `clean_carb`, `clean_protein`, `clean_fat` y `oil_added`: cohortes y exclusiones deterministas;
- `usage_mode`: opción transitoria elegida en la interfaz cuando un alimento admite usos incompatibles, por ejemplo frío frente a fundir;
- estados de calidad y revisión versionados.

Reglas de producto:

- yogur natural no se cambia por pescado, carne, queso curado ni postres saborizados;
- copos de avena priorizan cereales y desayunos neutros, no una guarnición salada solo porque cuadre un macro;
- garbanzos priorizan legumbres cocinadas y proteínas vegetales prácticas, nunca mermeladas o dulces;
- fruta entera se cambia por fruta entera; zumos y néctares no ocupan su primer bloque;
- verdura simple no se rellena con platos preparados;
- mozzarella distingue, cuando sea necesario, uso en frío de uso para fundir;
- un plato preparado puede tener referencias próximas, pero no se fuerza como intercambio directo si no existe una equivalencia honesta.

La interfaz solo pregunta por contexto cuando la respuesta puede cambiar materialmente. Por ejemplo:

> ¿Cómo la vas a usar? En frío/ensalada · Para fundir/gratinar

## 5. Cálculo y raciones

La herramienta conserva el cálculo exacto internamente y no oculta diferencias.

Para cada candidata se calcula:

- cantidad exacta;
- energía total de origen y alternativa;
- proteína, hidratos y grasa totales;
- diferencia absoluta y porcentual;
- multiplicador de cantidad;
- indicador de practicidad.

La política de ración tiene tres salidas:

1. **Exacta y práctica**: se muestra normalmente.
2. **Nutricionalmente válida pero poco práctica**: se muestra con aviso claro o en una zona secundaria.
3. **Absurda o engañosa**: no se muestra como intercambio directo.

Los límites de ración por contexto deben quedar en un fichero versionado. Los límites clínicos que no sean meramente de seguridad requieren aprobación de nutrición antes de activar producción. Hasta entonces se auditan, no se inventan silenciosamente.

## 6. Cobertura honesta

Más resultados no significa más calidad.

- Una mozzarella con cobertura escasa es un defecto si existen quesos frescos o usos culinarios compatibles que la taxonomía está ocultando.
- Un salmorejo puede tener cero intercambios directos y varias referencias de sopas frías; eso es una respuesta honesta.
- Un chocolate negro puede tener una única alternativa limpia; no se rellena con cualquier dulce.
- Las leches pueden mostrar formatos de la misma familia aunque no exista un intercambio transversal útil.

La interfaz diferencia:

- **Intercambios directos**;
- **Misma familia o formato**;
- **Referencias preparadas**;
- **No hay una alternativa suficientemente fiable**.

## 7. Nombre y procedencia visibles

No se publica:

- un nombre extranjero incomprensible si existe denominación española;
- texto promocional o una descripción kilométrica como nombre principal;
- un producto descatalogado;
- un alimento cuyo nombre, categoría y descripción se contradicen;
- un alimento comercial sin procedencia cuando la procedencia sea conocida.

BEDCA aparece antes que marcas para búsquedas genéricas. Las marcas se agrupan y no desplazan la referencia genérica.

## 8. Contrato de experiencia

El recorrido principal sigue siendo:

1. buscar alimento;
2. introducir cantidad;
3. ver alternativas;
4. entender la cantidad y el motivo;
5. cambiar de contexto solo si hace falta.

La usuaria no necesita entender macros, taxonomías ni puntuaciones internas. La explicación visible usa lenguaje cotidiano:

- “mismo tipo de desayuno”;
- “cantidad equivalente en proteína”;
- “ración grande porque este alimento aporta menos energía”;
- “misma familia, pero no es un intercambio nutricional directo”.

## 9. Matriz de validación

La release se valida con `scripts/premium_matrix.json`, exactamente 100 casos habituales:

| Grupo | Casos |
|---|---:|
| Hidratos | 16 |
| Proteínas | 26 |
| Lácteos | 14 |
| Frutas | 13 |
| Verduras | 13 |
| Grasas | 10 |
| Difíciles o preparados | 8 |
| **Total** | **100** |

La matriz incluye alimentos genéricos, productos reales, estados crudo/cocido, alternativas vegetales, baja cobertura legítima y datos históricamente problemáticos.

## 10. Gate de producción

No se promueve una candidata si falla uno solo de estos puntos:

- 100/100 orígenes localizables y publicables;
- 0 alimentos en cuarentena u ocultos en resultados;
- 0 cantidades inválidas;
- 0 incompatibilidades culinarias críticas en TOP 5;
- 0 contradicciones críticas de nombre/categoría/uso en alimentos expuestos;
- 0 violaciones de filtros dietéticos;
- 0 productos extranjeros no explicados en el bloque principal;
- 0 alertas de ración absurda sin decisión documentada;
- catálogo y embeddings sincronizados;
- regresión automática completa en verde;
- recorridos web reales en móvil y escritorio;
- autenticación y administración verificadas;
- revisión manual de los casos de alto riesgo;
- informe de release con versión, commit, fecha, métricas y limitaciones conocidas.

Producción no se usa como entorno de ensayo. Primero se valida una preview asociada a un commit inmutable.

## 11. Definición de terminado

“Premium v2 terminada” significa que:

- la implementación cumple este contrato;
- los 100 casos se han ejecutado contra el motor y contra la interfaz real;
- los problemas encontrados están corregidos o declarados como limitaciones honestas sin resultado engañoso;
- los datos de mayor exposición tienen trazabilidad;
- existe una candidata reproducible que supera el gate;
- una mujer puede usarla sin conocer la arquitectura interna y sin encontrarse resultados absurdos en los recorridos validados.

No significa que la base de datos mundial sea perfecta ni que no pueda existir ningún alimento futuro sin revisar.
