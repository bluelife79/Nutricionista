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
| Núcleo de intercambio | 1.197 |
| Referencias ocasionales o compuestas | 238 |
| Excluidos por política | 2.494 |
| No publicables por calidad | 1.395 |
| Buscables por la usuaria | 1.435 |

Controles del núcleo:

- 0 productos NOVA 4;
- 0 productos con edulcorantes;
- 0 nombres contaminantes conocidos;
- 0 registros requeridos que debían excluirse y permanecieran activos.

Entre los casos expresamente fuera están Yatekomo, Avecrem, cubitos de caldo,
salchichón, lasaña comercial, preparados de carne picada, zumos, lácteos
saborizados, ultraprocesados y productos cuya identidad no es suficientemente
clara.

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
macros válidos, calidad OFF, alimento real identificable, ausencia de NOVA 4,
edulcorantes, azúcar añadida y familias industriales, produjo una cola de
4.531 productos:

- 1.071 NOVA 1;
- 116 NOVA 2;
- 1.611 NOVA 3;
- 1.733 sin evidencia de procesamiento suficiente;
- 634 ya existen en el catálogo;
- 3.897 serían nuevos.

Esta cola **no se importa automáticamente**. Los registros sin evidencia pasan
a revisión manual y todos los demás deben superar clasificación, deduplicación,
política de alcance, intención culinaria, raciones y regresión antes de una
futura alta.

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
| Perfiles buscables completos | 1.435 / 1.435 |
| Alimentos con pregunta validada | 483 |
| Familias adaptativas | 9 |
| Alimentos ambiguos auditados | 655 |
| Modalidades ejecutadas | 1.422 |
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
- 1.435/1.435 perfiles culinarios buscables completos;
- gate Premium: 100/100 orígenes;
- 87/87 casos directos con cobertura;
- 0 contextos críticos;
- 0 raciones críticas;
- 0 nombres extranjeros en el TOP 5;
- 0 productos OFF sin procedencia verificada en el TOP 5;
- 0 NOVA 4 y 0 edulcorantes en candidatos núcleo;
- autenticación, cookie firmada, limitación de intentos y panel de
  administración verificados automáticamente.

Siete raciones no críticas superan el umbral de revisión por multiplicador,
pero permanecen dentro del límite práctico documentado: pan con patata, pasta
con boniato, pan de centeno con patata/maíz/batata y tempeh o seitán con tofu.
Cada una tiene decisión explícita en la política de raciones.

## Criterio de promoción

La 2.2 debe desplegarse primero como preview asociada a un commit inmutable.
Antes de producción faltan únicamente la aceptación web final en móvil y
escritorio y la comprobación de autenticación en esa URL concreta.

No se promete que todo producto presente o futuro de cualquier supermercado
esté automáticamente aprobado. Sí se garantiza que ningún producto nuevo puede
entrar por volumen o por parecido de macros sin atravesar las mismas barreras.
