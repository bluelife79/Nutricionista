# Informe de candidata — Premium v2

Fecha de validación: 26 de julio de 2026
Rama: `codex/premium-exchange-v2`
Código validado: `c171b792c28dbfa0b023dffec08aa2f017db1248`
PR: `https://github.com/bluelife79/Nutricionista/pull/1`
Preview: `https://intercambio-git-codex-premium-exchange-v2-jonathan-aqs-projects.vercel.app/`
Producción: no modificada

## Dictamen

La candidata cumple el gate técnico y de producto definido para Premium v2.
Se considera preparada para una revisión de aceptación final en preview y
posterior promoción controlada. No se ha promovido automáticamente a
producción.

Este dictamen significa que la versión ha demostrado el comportamiento
acordado en los casos y recorridos definidos. No convierte la herramienta en
una prescripción médica ni equivale a una validación clínica independiente.

## Resultado del catálogo

| Métrica | Resultado |
|---|---:|
| Registros conservados | 5.324 |
| Registros publicables | 3.961 |
| Registros ocultos o en cuarentena | 1.363 |
| Registros con fuente Open Food Facts | 1.354 |
| OFF visible fuera del gate de mercado español | 0 |
| Nombres extranjeros detectados en registros visibles | 0 |
| Contradicciones críticas de metadatos visibles | 0 |
| Registros con macros inválidos visibles | 0 |
| Contextos aún no clasificables | 696 |

Los 696 contextos no clasificables no inventan resultados: pueden localizarse
si el nombre es útil, pero el motor falla de forma cerrada y no ofrece un
intercambio directo hasta que exista una clasificación fiable.

Los registros OFF descartados no se borraron. Conservan trazabilidad y pueden
revisarse en una futura ampliación del catálogo.

## Matriz Premium

| Control | Resultado |
|---|---:|
| Casos | 100/100 |
| Orígenes localizados y publicables | 100/100 |
| Casos directos con al menos tres alternativas | 87/87 |
| Huecos de cobertura | 0 |
| Incompatibilidades culinarias críticas en TOP 5 | 0 |
| Raciones críticas | 0 |
| Contradicciones de metadatos expuestas | 0 |
| Etiquetas extranjeras en TOP 5 | 0 |
| Orígenes OFF no verificados | 0 |
| Alternativas OFF no verificadas en TOP 5 | 0 |

Distribución:

- 16 hidratos;
- 26 proteínas;
- 14 lácteos;
- 13 frutas;
- 13 verduras;
- 10 grasas;
- 8 alimentos difíciles o preparados.

## Raciones grandes aceptadas con aviso

Estas cuatro equivalencias son matemáticamente válidas y siguen dentro de
límites culinarios razonables, pero se relegan y muestran una explicación:

| Origen | Alternativa | Cantidad |
|---|---|---:|
| 50 g espirales integrales | Boniato | 141 g |
| 60 g pan de centeno | Patata hervida | 176 g |
| 100 g tempeh | Tofu | 251 g |
| 100 g seitán | Tofu | 296 g |

La decisión exacta está versionada en
`config/portion_review_decisions.json`. Ninguna ración crítica se publica.

## Pruebas automáticas

`npm test` completado:

- integridad de 5.324 alimentos;
- hash e índice semántico sincronizados;
- 21 casos dorados del algoritmo;
- 60 casos contextuales;
- filtros vegetariano y sin lactosa;
- curador de Open Food Facts España;
- gate Premium de 100 casos;
- sesión firmada, fallo cerrado, rate limit y panel de administración.

## Recorridos web reales

Se ejecutaron los 100 casos a través de la preview, usando el recorrido de la
usuaria:

1. buscar;
2. elegir el alimento;
3. introducir gramos;
4. calcular;
5. leer resultados.

Resultado final: 100/100 recorridos válidos.

En cada recorrido se comprobó:

- que el alimento aparece y se puede seleccionar;
- que la cantidad se acepta;
- que el bloque esperado existe;
- que los 87 casos directos muestran al menos tres alternativas;
- que todas las cantidades visibles están entre 5 y 600 g;
- que el TOP 5 no contiene las etiquetas extranjeras auditadas;
- que las raciones grandes muestran aviso.

La pregunta opcional de mozzarella se probó en los modos frío/ensalada y
fundir/gratinar. La elección filtra resultados incompatibles.

## Vista móvil y escritorio

Validación visual:

- móvil: 375 px de ancho, sin desbordamiento horizontal, tarjetas de 311 px y
  macros en dos columnas;
- escritorio: 1.425 px de ancho útil, contenedor de 500 px y macros en cuatro
  columnas;
- consola limpia después de un cálculo real: 0 errores y 0 avisos.

## Acceso y administración

- login real de la usuaria de prueba verificado en preview;
- sesión persistente verificada al recargar;
- endpoint de administración sin contraseña devuelve 401;
- contraseña de administración menor de 12 caracteres no habilita el panel;
- códigos y secretos no se incluyen en el repositorio ni en este informe.

## Cambios de producto más relevantes

- contexto culinario obligatorio antes del cálculo;
- `unknown` falla cerrado;
- BEDCA abre las búsquedas genéricas cuando existe;
- Open Food Facts solo entra con procedencia española verificada;
- fuente, contexto y practicidad forman parte del ranking;
- las raciones grandes se relegan y explican;
- mozzarella pregunta por uso solo cuando cambia el resultado;
- nombres extranjeros expuestos se localizan conservando el original;
- subgrupos históricos ya no caen por un fail-open silencioso;
- catálogo, reglas, decisiones e índice son reproducibles.

## Limitaciones honestas

1. No se afirma que los 5.324 registros tengan revisión nutricionista
   individual. La exposición se controla por reglas, trazabilidad y matriz.
2. Los 696 contextos desconocidos dan una respuesta vacía antes que una
   alternativa inventada.
3. La política de raciones es un control de producto y practicidad, no una
   prescripción individual.
4. Un producto nuevo o una actualización futura de fuente debe volver a pasar
   curación, embeddings, regresión y preview.

## Condición de promoción

La preview puede promoverse después de que la persona responsable de producto
acepte visualmente esta candidata. La promoción debe apuntar al commit validado
o a un descendiente que solo contenga documentación; cualquier cambio de
código o datos obliga a repetir el gate.
