# Intercambiador RevolucionaT — entrega de estabilización

Fecha de validación: 25 de julio de 2026

Rama: `codex/stabilize-production`

## Dictamen

No hace falta rehacer la herramienta. El motor, la base y la interfaz actual son recuperables y han quedado estabilizados en esta rama.

La preview y producción fueron desplegadas y validadas el 25 de julio de 2026. El dominio activo es `https://intercambio.entrenatucorazon.es` y el código de producción corresponde al commit `4aaa2df`.

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
- cookies firmadas y manipulaciones rechazadas;
- panel sin códigos expuestos;
- 0 vulnerabilidades conocidas en `npm audit --omit=dev`.

La prueba manual en navegador cubrió:

- login, logout y reentrada;
- avena y merluza mediante la interfaz completa;
- orden de bloques y contenido del TOP;
- ausencia de mensajes falsos de IA;
- panel de administración con campos de contraseña;
- vista móvil de 390 px sin desbordamiento horizontal;
- cero errores de consola.

## Decisiones conscientes frente al borrador de tests V2

Hay dos decisiones de producto que no deben “corregirse” de nuevo:

- En avena, el contexto se resuelve mostrando primero el bloque de la misma familia. El bloque de intercambio real puede ser más amplio porque representa sustituciones, no marcas equivalentes.
- En chocolate 85 %, se prefiere un único chocolate limpio a completar ocho tarjetas con galletas, postres o alimentos que sólo igualan calorías.

## Despliegue completado

1. `SESSION_SECRET` aleatorio configurado en Vercel para Preview y Production.
2. `ADMIN_PASSWORD` rotado por una clave aleatoria de 36 caracteres y guardado en el llavero de macOS como `RevolucionaT Admin Vercel`.
3. Preview desplegada y comprobada con una cuenta real.
4. Login, recarga de sesión, avena y panel administrativo validados sin errores.
5. La misma versión fue promovida a producción.
6. El token temporal de Vercel utilizado para el despliegue fue revocado.

## Rollback

- Conservar el identificador del despliegue de producción anterior.
- Si el smoke test falla, restaurar ese despliegue desde Vercel.
- En Git, revertir el commit de estabilización en lugar de copiar archivos sueltos.
- No mezclar una reversión del motor con cambios de base o embeddings: los tres artefactos deben viajar juntos.

## Deuda conocida, no bloqueante para la preview

- 85 registros incompletos siguen en el catálogo, pero quedan invisibles para búsqueda e intercambios.
- Persisten subgrupos heredados y nombres de OpenFoodFacts que conviene normalizar por lotes; el validador los informa sin permitir que rompan los 21 contratos.
- Los códigos heredados permanecen almacenados en la tabla de Supabase. Ya no se exponen al navegador, pero una migración posterior debería guardarlos con hash.
- El límite de intentos actual es suficiente como defensa inicial, pero en un despliegue de mayor tráfico debe moverse a un almacén compartido y persistente.

## Criterio de cierre

La estabilización técnica y el despliegue están cerrados. La aprobación clínica final de los intercambios sigue correspondiendo a la nutricionista responsable.
