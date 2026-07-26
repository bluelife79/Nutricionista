# Premium 2.1 — informe de candidata

Estado: **candidata para preview, no promovida todavía a producción**

## Objetivo

Convertir el intercambiador en una herramienta nutricional y culinariamente
coherente para mujeres de más de 40 años del programa RevolucionaT en España,
sin añadir complejidad cuando no aporta valor.

La 2.1 mantiene el cálculo determinista de equivalencias y añade una capa
estructurada de intención: solo pregunta cómo se utilizará un alimento cuando
la respuesta cambia de forma comprobable las alternativas que puede mostrar.

## Alcance de datos

| Control | Resultado |
|---|---:|
| Registros trazables conservados | 5.324 |
| Alimentos publicables | 3.929 |
| Ocultos o en cuarentena | 1.395 |
| Registros Open Food Facts | 1.354 |
| OFF visible fuera del control de mercado español | 0 |
| Nombres extranjeros detectados en catálogo visible | 0 |
| Contradicciones críticas de metadatos visibles | 0 |
| Contextos desconocidos visibles | 0 |
| Macros esenciales inválidos visibles | 0 |

Los registros aislados no se borran. Permanecen en el fichero para conservar
la procedencia y poder recuperarlos si se corrigen con evidencia.

## Intención culinaria

Versión servida: `premium-v2.1-intent-5`.

| Control | Resultado |
|---|---:|
| Perfiles culinarios generados | 5.324 |
| Alimentos visibles con pregunta validada | 877 |
| Alimentos visibles deliberadamente simples | 3.052 |
| Familias adaptativas | 10 |
| Alimentos candidatos ejecutados en auditoría | 1.213 |
| Modalidades ejecutadas con el algoritmo real | 2.634 |
| Modalidades sin alternativas | 0 |
| Resultados incompatibles con la modalidad | 0 |
| Preguntas descartadas por no cambiar el resultado | 336 |

Familias cubiertas: queso, avena, pan, carne, pescado, proteína vegetal,
legumbre, tubérculo, fermentado lácteo y verdura.

La pregunta se almacena junto a las modalidades que superaron la auditoría. La
interfaz no improvisa preguntas en producción. “Me da igual” siempre conserva
el recorrido sencillo.

## Cambios de producto

- La pregunta de contexto ya no está codificada solo para mozzarella.
- El orden distingue uso principal y uso secundario.
- Al elegir una modalidad proteica se prioriza la familia culinaria de origen;
  por ejemplo, pollo para guiso prioriza carnes adecuadas antes que marisco.
- Los formatos de mozzarella rallada o en lonchas se priorizan para fundir,
  mientras que bolitas y queso fresco se priorizan en frío.
- Se añadieron contextos cerrados para bebidas, salsas, condimentos,
  repostería, dulces, alcohol y pescado procesado.
- Los dulces y condimentos solo pueden competir cuando el origen pertenece a
  esa misma clase.
- Se ampliaron los límites de ración versionados para todos los contextos
  visibles.

## Reparaciones de catálogo relevantes

La limpieza conserva trazabilidad y evita interpretar una palabra aislada como
identidad del alimento. Entre otros casos:

- Pijota vuelve a ser pescado blanco y no lácteo.
- Yatekomo Pollo es plato preparado, no pechuga de pollo.
- Avecrem de pollo es condimento, no carne.
- Escalivada es un plato preparado de verdura, no verdura simple.
- Berberechos al natural se tratan como conserva lista para consumir.
- Cabecero de lomo no se etiqueta como carne magra.
- Haba frita se trata como snack de grasa predominante, no como legumbre
  cocida.
- Los lácteos con fruta no preguntan si se usarán para fundir o untar.
- Se localizaron nombres inequívocos como pepinos, crema agria, palitos de
  queso y hamburguesa vegetal; las identidades no comprensibles se aislaron.

## Validación automática

Resultado final de `npm test`:

- 5.324 identificadores y esquema mínimo válidos;
- catálogo e índice nutricional sincronizados;
- 21 casos dorados del algoritmo;
- 60 casos contextuales con filtros vegetariano y sin lactosa;
- curador Open Food Facts España;
- 3.929/3.929 perfiles visibles completos;
- 10 familias adaptativas representativas;
- gate Premium: 100/100 orígenes, 87/87 con cobertura;
- 0 contextos críticos;
- 0 raciones críticas;
- seguridad: cookie firmada, sesión cerrada, limitación de intentos y
  administración sin códigos expuestos.

## Validación web manual

Se verificaron recorridos reales con autenticación en la preview local:

- mozzarella en frío y para fundir;
- avena en desayuno y uso salado;
- pechuga de pollo como pieza y para guiso;
- manzana y yogur saborizado sin preguntas innecesarias;
- cantidad, cálculo, bloques de resultados y nueva búsqueda;
- diseño móvil a 375 × 812 sin desbordamiento horizontal;
- consola del navegador sin errores ni avisos.

El cambio de contexto alteró materialmente los resultados. En pollo para guiso,
las primeras posiciones quedaron en pavo, pollo, cerdo y ternera, sin marisco
en el primer bloque expuesto.

## Decisión de release

La candidata cumple los gates técnicos y de catálogo definidos para Premium
2.1. Debe desplegarse como preview asociada a un commit inmutable y mantenerse
separada de producción hasta realizar una última aceptación visual breve.

No se afirma que exista una base universal de todos los alimentos presentes y
futuros. Sí se garantiza que la cobertura publicable es explícita, auditable y
cerrada ante datos dudosos: cuando falta evidencia, el producto se aísla en vez
de fabricar una equivalencia.

