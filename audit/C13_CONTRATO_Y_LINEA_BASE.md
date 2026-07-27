# C13 · Contrato reproducible de producto

Fecha: 27 de julio de 2026  
Base congelada: `d8ddbea` (`codex/premium-exchange-v2-3`)  
Producción de comparación: `5830133`

## Qué ejecuta

- La búsqueda real `getLocalSearchResults()`, no el buscador auxiliar de tests.
- El motor real, los embeddings locales y los mismos flags que carga el navegador.
- El orden de bloques definido en un único módulo compartido con la interfaz.
- Las 333 consultas del corpus adversarial y dos cantidades por alimento.
- Los 1.636 alimentos publicables y las 911 respuestas culinarias que la interfaz puede mostrar.
- Manifiesto, versión y SHA-256 de cada fichero ejecutable.

## Línea base reproducida exactamente

| Métrica | v2.3 |
|---|---:|
| Consultas | 333 |
| Escenarios calculados | 474 |
| Búsquedas vacías | 96 |
| Sin intercambio real | 56 |
| Marcas delante del intercambio | 73 |
| Inversión del porcentaje | 376 |
| Cruce crudo/cocinado | 64 |
| Origen cocinado elegido | 19 |
| Duplicados macro adyacentes | 41 |
| Porciones de 350 g o más | 44 |
| Aceites de semilla/tropical | 8 |
| Nombres extranjeros | 22 |
| Nombres ilegibles | 4 |
| Deriva calórica superior al 35 % | 39 |
| TOP 5 sin diversidad | 256 |
| Tarjetas «Elección prioritaria» | 4.059 de 4.284 (94,7 %) |

El recorrido de intención encuentra 418 alimentos con pregunta y ejecuta sus
911 respuestas. Este dato corrige el antiguo test exhaustivo, que solo medía
`usageMode = "any"`.

## Regla de trabajo

Toda mejora cambia primero su política o sus datos y después actualiza la puerta
con un criterio de aceptación explícito. La candidata se compara contra
producción, no solo contra la v2.3. Ningún cambio se despliega si mejora una
métrica a costa de empeorar otra crítica sin una decisión documentada.
