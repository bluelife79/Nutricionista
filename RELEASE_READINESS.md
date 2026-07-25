# Intercambiador RevolucionaT — entrega de estabilización

Fecha de validación: 25 de julio de 2026

Rama: `codex/stabilize-production`

## Dictamen

No hace falta rehacer la herramienta. El motor, la base y la interfaz actual son recuperables y han quedado estabilizados en esta rama.

La preview y producción fueron desplegadas y validadas el 25 de julio de 2026. El dominio activo es `https://intercambio.entrenatucorazon.es` y el código de producción corresponde al commit `f86f933`.

La afirmación correcta no es “se han probado todos los alimentos posibles”, sino esta: los 5.324 registros pasan validación estructural, el motor pasa una regresión automática reproducible de 60 alimentos y, además, los mismos 60 recorridos se ejecutaron por la interfaz web real de producción. El último ajuste lácteo se volvió a comprobar en producción sobre las tres rutas afectadas: yogur natural, kéfir y Skyr.

## Objetivo de producto aplicado

La herramienta calcula cantidades nutricionalmente equivalentes, pero no trata todos los alimentos con macros parecidos como intercambios igual de útiles. El orden visible sigue esta jerarquía:

1. contexto culinario y forma de consumo;
2. familia o ingrediente base cuando aporta valor práctico;
3. compatibilidad dietética y categoría clínica;
4. equivalencia de macros y cantidad practicable;
5. variedad, sin permitir que la variedad empeore el TOP.

Cuando no existe un sustituto honesto, se muestran pocos resultados o ninguno. No se rellena la pantalla con alimentos que sólo “cuadran números”.

## Cinco fallos rojos corregidos

| Caso | Resultado exigido y validado |
|---|---|
| Avena en copos | El primer bloque muestra avenas, copos y salvado; se excluyen cereales industriales. |
| Pan integral | Los cinco primeros intercambios son panes, hogazas, panecillos o tortillas/wraps funcionales antes de otros hidratos. |
| Tempeh | El TOP queda en soja texturizada, tofu, seitán y legumbres cocidas; no aparecen alimentos animales ni legumbres secas. |
| Merluza | El TOP contiene pescado blanco limpio; se excluyen rebozados, salsas, palitos y preparados. |
| Picada de pavo | El TOP contiene carnes frescas o picadas; se excluyen fiambres, lonchas, fajitas y carnes preparadas. |

## Cambios estructurales

- Se eliminó la partición rígida por procedencia que colocaba productos de peor calidad antes que equivalentes mejores.
- La procedencia queda como señal suave, nunca como puerta de entrada.
- Se añadieron reglas de forma culinaria para avena, pan, legumbres, pescado y proteína fresca/picada.
- Las recetas compuestas, zumos, purés y mezclas comerciales ya no desplazan a los ingredientes simples del bloque de intercambio real.
- Los grupos culinarios se hicieron más estrictos en tubérculos, proteína vegetal, crucíferas, fruta entera, lácteos y sopas frías.
- Los fermentados naturales (yogur, kéfir y Skyr), los quesos frescos y los postres proteicos de cuchara quedan separados aunque sus macros se parezcan.
- Se ocultaron etiquetas descatalogadas y un pequeño grupo de leches rumanas no localizadas; la pera recuperó su clasificación correcta de fruta.
- Se corrigió la penalización que expulsaba tempeh, tofu y seitán por su grasa natural.
- La diversidad sólo actúa después de la calidad; ya no altera el orden del bloque principal.
- Los registros sin subgrupo quedan en cuarentena de ejecución.
- La base y los embeddings tienen exactamente los mismos 5.324 IDs y el mismo hash de base.
- Los dos alimentos manuales sin vector se sincronizaron con centroides del mismo modelo; el script rechaza cualquier alta nueva no soportada.
- Se retiraron los endpoints rotos de judge/rerank y la interfaz ya no afirma que un resultado fue “refinado por IA”.
- Los embeddings locales continúan activos como señal semántica determinista y sin servicio externo.

## Acceso y administración

- La sesión de usuaria se guarda en una cookie firmada, `HttpOnly`, `SameSite=Strict`, de 12 horas.
- La aplicación ya no guarda email ni código de acceso en `localStorage`.
- Sin conexión con el servidor la autenticación falla cerrada.
- El login limita intentos y responde sin exponer detalles innecesarios.
- El panel no descarga, busca ni muestra códigos existentes.
- Editar una clienta conserva el código salvo que se introduzca expresamente uno nuevo.
- El panel se deshabilita si `ADMIN_PASSWORD` tiene menos de 12 caracteres.

## Evidencia automática

Comando único:

```bash
npm test
```

Resultado validado:

- 5.324 alimentos con IDs únicos y esquema mínimo válido.
- 5.324 embeddings sincronizados.
- 85 registros incompletos aislados por cuarentena de ejecución.
- 21 de 21 casos dorados ejecutados sobre `js/algorithm.js` real.
- 60 de 60 casos contextuales ejecutados automáticamente sobre el motor real.
- filtros vegetariano y sin lactosa comprobados por integración.
- cookies firmadas y manipulaciones rechazadas;
- panel sin códigos expuestos;
- 0 vulnerabilidades conocidas en `npm audit --omit=dev`.

## Auditoría de 60 alimentos en producción

La matriz está versionada en `scripts/contextual_matrix.json` y su contrato en `scripts/test_contextual_matrix.js`.

| Grupo | Casos | Resultado funcional |
|---|---:|---|
| Hidratos | 10 | 10/10 |
| Proteínas animales y vegetales | 18 | 18/18 |
| Lácteos | 8 | 8/8 |
| Frutas | 8 | 8/8 |
| Verduras | 8 | 8/8 |
| Grasas | 6 | 6/6 |
| Casos difíciles | 2 | 2/2 |
| **Total** | **60** | **60/60** |

Cada recorrido real incluyó búsqueda, selección del alimento, introducción de gramos, cálculo y lectura de los tres bloques visibles: misma familia, intercambios reales y referencias preparadas. Se revisaron navegación, cantidades, puntuaciones, contexto culinario, estados sin coincidencia y ausencia de mensajes falsos de IA.

La prueba manual en navegador cubrió, entre otros:

- login, logout y reentrada;
- los 60 alimentos de la matriz mediante la interfaz completa;
- orden de bloques y contenido del TOP;
- casos representativos corregidos: patata, picada de pavo, tofu, leche, Skyr, brócoli, zanahoria, pera, chocolate y salmorejo;
- ausencia de mensajes falsos de IA;
- panel de administración con campos de contraseña;
- vista móvil de 390 px sin desbordamiento horizontal;
- cero errores de consola.

Tras detectar que “Budino Proteico Cioccolato” podía aparecer con Skyr, se corrigió la causa general —la mezcla histórica entre fermentados, queso fresco y postres proteicos— y se repitieron en producción las tres rutas afectadas. Skyr termina con yogures naturales/griegos/proteicos, sin cottage, pudding ni chocolate.

## Semáforo final

### Verde

- 60/60 recorridos web completados sin bloqueo, error de cálculo o fallo de navegación.
- 60/60 contratos contextuales y 21/21 casos dorados pasan sobre el motor publicado.
- No se encontró ningún rojo abierto después de la corrección láctea final.
- Cuando no existe un intercambio honesto, la herramienta muestra pocas opciones o un estado sin coincidencia en vez de inventar variedad.

### Amarillo no bloqueante

- En verduras con muy pocas calorías, igualar energía puede producir raciones grandes; por ejemplo, varios cientos de gramos de pepino. El cálculo es correcto, pero requiere criterio práctico de la nutricionista.
- Algunos aceites conservan nombres en francés o alemán procedentes de OpenFoodFacts. Son alimentos correctos, pero queda una mejora de localización del catálogo.
- Mozzarella tiene un intercambio real limitado y concentra la variedad en formatos de la misma familia. Es más honesto que rellenar el TOP con quesos culinariamente distintos.
- La cobertura aporta alta confianza sobre los patrones principales, no una garantía matemática sobre todas las combinaciones posibles de 5.324 alimentos, cantidades y preferencias personales.

### Rojo

- Ninguno abierto en la matriz y versión publicadas.

## Decisiones conscientes frente al borrador de tests V2

Hay dos decisiones de producto que no deben “corregirse” de nuevo:

- En avena, el contexto se resuelve mostrando primero el bloque de la misma familia. El bloque de intercambio real puede ser más amplio porque representa sustituciones, no marcas equivalentes.
- En chocolate 85 %, se prefiere un único chocolate limpio a completar ocho tarjetas con galletas, postres o alimentos que sólo igualan calorías.

## Despliegue completado

1. `SESSION_SECRET` aleatorio configurado en Vercel para Preview y Production.
2. `ADMIN_PASSWORD` rotado por una clave aleatoria de 36 caracteres y guardado en el llavero de macOS como `RevolucionaT Admin Vercel`.
3. Preview desplegada y comprobada con una cuenta real.
4. Login, recarga de sesión, matriz de 60 alimentos y panel administrativo validados sin errores.
5. La misma versión fue promovida a producción.
6. El token temporal de Vercel utilizado para el despliegue fue revocado.

### Sincronización pendiente de GitHub

Vercel conserva y ejecuta el snapshot del commit `f86f933`, pero la rama local todavía no pudo subirse a GitHub porque este Mac no tenía una sesión de GitHub autorizada. Esto no afecta a la producción activa. Antes del próximo despliegue automático desde Git debe iniciarse sesión en GitHub y publicarse `codex/stabilize-production`, para evitar que una actualización posterior desde `main` vuelva a una versión antigua.

## Rollback

- Conservar el identificador del despliegue de producción anterior.
- Si el smoke test falla, restaurar ese despliegue desde Vercel.
- En Git, revertir el commit de estabilización en lugar de copiar archivos sueltos.
- No mezclar una reversión del motor con cambios de base o embeddings: los tres artefactos deben viajar juntos.

## Deuda conocida, no bloqueante para producción

- 85 registros incompletos siguen en el catálogo, pero quedan invisibles para búsqueda e intercambios.
- Persisten subgrupos heredados y nombres de OpenFoodFacts que conviene normalizar por lotes; el validador los informa sin permitir que rompan los 21 contratos.
- Los códigos heredados permanecen almacenados en la tabla de Supabase. Ya no se exponen al navegador, pero una migración posterior debería guardarlos con hash.
- El límite de intentos actual es suficiente como defensa inicial, pero en un despliegue de mayor tráfico debe moverse a un almacén compartido y persistente.

## Criterio de cierre

La estabilización técnica, la regresión de 60 alimentos y el despliegue están cerrados. La aprobación clínica final de los intercambios y de las raciones excepcionalmente grandes sigue correspondiendo a la nutricionista responsable.
