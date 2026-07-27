# Premium 2.2 — informe de candidata

Estado: **lista para preview; producción permanece intacta**

Fecha de auditoría: 26 de julio de 2026.

## Objetivo

La 2.2 convierte el catálogo completo en una fuente controlada para una mujer
de más de 40 años del programa RevolucionaT en España. Un alimento no entra en
los resultados por tener calorías o macros parecidos: debe ser reconocible,
culinariamente coherente, práctico y compatible con el patrón de alimentación
del producto.

La regla central es positiva. El motor no parte de “todo salvo una lista
negra”, sino de alimentos con identidad demostrable. Los productos ocasionales
o compuestos se separan como referencias y el resto queda fuera.

## Alcance del catálogo activo

| Estado | Registros |
|---|---:|
| Total trazable | 5.324 |
| Núcleo de intercambio | 1.267 |
| Referencias ocasionales o compuestas | 315 |
| Excluidos por política | 2.347 |
| No publicables por calidad | 1.395 |
| Buscables por la usuaria | 1.582 |

Controles del núcleo:

- 1.203 elecciones prioritarias;
- 64 alternativas compatibles con explicación visible;
- 315 referencias de uso ocasional;
- 59 productos NOVA 4, todos identificados como compatibles;
- 7 productos con edulcorantes, todos identificados como compatibles y sin
  azúcar añadido detectado;
- 0 productos NOVA 4, con edulcorantes o con azúcar añadido sin aviso;
- 0 nombres contaminantes conocidos;
- 0 registros requeridos que debían excluirse y permanecieran activos.

Entre los casos expresamente fuera están Yatekomo, Avecrem, cubitos de caldo,
salchichón, lasaña comercial, preparados de carne picada, zumos, lácteos
saborizados con azúcar añadido o composición no verificable, familias
industriales y productos cuya identidad no es suficientemente clara.

NOVA 4 no funciona como veto universal. Solo puede entrar en contextos
controlados y siempre pierde prioridad frente a una elección más sencilla. La
interfaz comunica “Elección prioritaria”, “Alternativa compatible” o “Uso
ocasional” con una frase. El detalle de las dos últimas permanece plegado tras
“¿Por qué?”.

Chocolate negro de 70 % o más, sopas frías tradicionales, platos compuestos
honestos y algunos alimentos ahumados o salados pueden conservarse como
referencia; no desplazan a los alimentos del núcleo.

## Evidencia de Open Food Facts

Se recorrió por completo el fichero local
`openfoodfacts-products.jsonl.gz`:

| Control | Resultado |
|---|---:|
| Registros JSONL leídos | 4.290.376 |
| Productos activos con código localizado en el volcado | 2.717 |
| Productos activos con NOVA conocido | 1.666 |
| Productos activos NOVA 4 detectados | 833 |
| Productos activos con ingredientes en español | 1.577 |
| Productos activos con señal de edulcorantes | 87 |

La evidencia restaurada se guarda en `processing_evidence` para los 5.324
registros. No sustituye la composición BEDCA ni inventa datos ausentes.

El nuevo curador español se ejecutó también contra los 4.290.376 registros.
Tras exigir venta en España, Mercadona/Carrefour/Lidl/Aldi, nombre utilizable,
macros válidos, calidad OFF, identidad alimentaria reconocible, ausencia de
azúcar añadida en las familias sensibles y exclusión de familias industriales,
produjo una cola de 5.845 productos:

- 1.072 NOVA 1;
- 116 NOVA 2;
- 1.611 NOVA 3;
- 1.298 NOVA 4;
- 1.748 sin NOVA disponible;
- 3.143 para revisión ordinaria de alcance;
- 2.702 para revisión manual.

Los motivos de revisión manual pueden solaparse: 1.298 NOVA 4, 194 con
edulcorantes, 39 lácteos saborizados y 1.400 sin ingredientes disponibles.

Esta cola **no se importa automáticamente**. Los registros sin evidencia pasan
a revisión manual; NOVA 4 y edulcorantes también requieren decisión explícita.
Todos deben superar clasificación, deduplicación, política de alcance,
intención culinaria, raciones y regresión antes de una futura alta.

## Contexto culinario

Todo alimento buscable tiene un perfil culinario completo. La pregunta de uso
solo se publica si dos o más respuestas:

1. disponen de alternativas;
2. son compatibles con el uso elegido;
3. cambian materialmente el resultado;
4. han sido ejecutadas contra el motor real.

Resultado:

| Control | Resultado |
|---|---:|
| Perfiles buscables completos | 1.582 / 1.582 |
| Alimentos con pregunta validada | 528 |
| Familias adaptativas | 9 |
| Alimentos inicialmente candidatos a pregunta | 705 |
| Modalidades ejecutadas | 1.525 |
| Incompatibilidades publicadas | 0 |

Familias: queso, avena, pan, carne, pescado, proteína vegetal, legumbre,
fermentado lácteo y verdura.

Las preguntas no se fuerzan para alcanzar una cifra. Si “guarnición”, “guiso”
o “puré” produce el mismo conjunto para una patata, el recorrido permanece
simple.

## Validación de release

Resultado de la regresión completa:

- 5.324 identificadores y esquema mínimo válidos;
- catálogo e índice nutricional sincronizados;
- 21 casos dorados del algoritmo;
- 60 casos contextuales;
- filtros vegetariano y sin lactosa;
- curador OFF España;
- 1.582/1.582 perfiles culinarios buscables completos;
- 528 preguntas culinarias validadas;
- gate Premium: 100/100 orígenes;
- 87/87 casos directos con cobertura;
- 0 contextos críticos;
- 0 raciones críticas;
- 0 nombres extranjeros en el TOP 5;
- 0 productos OFF sin procedencia verificada en el TOP 5;
- 64 alternativas compatibles explicadas y priorizadas detrás de las
  elecciones cotidianas;
- 0 NOVA 4, edulcorantes o azúcar añadido sin aviso;
- autenticación, cookie firmada, limitación de intentos y panel de
  administración verificados automáticamente.

La aceptación web de esta candidata comprobó acceso real, búsqueda y cálculo
de yogur saborizado sin azúcar añadido, despliegue de “¿Por qué?”, orden de una
opción prioritaria por delante de la compatible, chocolate como uso ocasional,
Yatekomo oculto, 375 × 812 px sin desbordamiento horizontal y consola sin
errores.

Siete raciones no críticas superan el umbral de revisión por multiplicador,
pero permanecen dentro del límite práctico documentado: pan con patata, pasta
con boniato, pan de centeno con patata/maíz/batata y tempeh o seitán con tofu.
Cada una tiene decisión explícita en la política de raciones.

## Criterio de promoción

La 2.2 se despliega primero como preview asociada a un commit inmutable. La
aceptación técnica en móvil y escritorio y la autenticación de esa URL están
completadas; la promoción a producción requiere aprobación explícita de
Jonathan.

No se promete que todo producto presente o futuro de cualquier supermercado
esté automáticamente aprobado. Sí se garantiza que ningún producto nuevo puede
entrar por volumen o por parecido de macros sin atravesar las mismas barreras.
