# 🎯 RevolucionaT - Intercambiador de Alimentos

## 📋 DESCRIPCIÓN

Aplicación web para intercambiar alimentos manteniendo macros equivalentes.
Diseñada para mujeres +40 años del programa RevolucionaT.

## 🎨 CARACTERÍSTICAS

- ✅ Catálogo Premium 2.2: 5.324 registros trazables, 1.267 alimentos núcleo y 315 referencias
- ✅ Fuentes: BEDCA + mercado español controlado + Open Food Facts curado
- ✅ Búsqueda inteligente con autocomplete
- ✅ Intercambios nutricionales con compatibilidad culinaria y raciones prácticas
- ✅ Preguntas adaptativas solo cuando cambian de verdad las alternativas
- ✅ 528 alimentos con pregunta culinaria validada; el resto evita preguntas que no aportan
- ✅ NOVA 4 y edulcorantes tratados como señales explicables, no como veto universal
- ✅ 64 alternativas compatibles con aviso; comida cotidiana priorizada en el ranking
- ✅ Diseño Neumorphism premium
- ✅ Mobile-first responsive
- ℹ️ Manifest e iconos disponibles; la instalación PWA y el modo offline no se anuncian hasta registrar y validar el service worker
- ✅ Acceso individual con Supabase Auth y contraseñas no almacenadas en la tabla de perfiles
- ✅ Panel de administración con alta, edición, cambio de contraseña y activación/baja inmediata
- ✅ Acceso recordado mientras la clienta forma parte del programa, con sesión revocable desde administración
- ✅ Caché técnica de cálculos repetidos sin guardar un historial alimentario personal
- ✅ Experiencia visual alineada con la identidad oficial de RevolucionaT

## 📁 ESTRUCTURA

```
Nutricionista/
├── index.html          # App principal
├── styles.css          # Estilos Neumorphism
├── js/                 # Interfaz, política, intención culinaria y algoritmo
├── database.json       # Catálogo activo y perfiles culinarios versionados
├── config/             # Política de raciones y decisiones auditadas
├── scripts/            # Auditorías, regresión y gate de release
├── api/                # Autenticación y administración del acceso
├── manifest.json       # Metadatos e iconos de aplicación
└── service-worker.js   # Preparado, todavía no registrado en producción
```

## 🚀 DEPLOYMENT (VERCEL)

1. Instala Vercel CLI: `npm install -g vercel`
2. En la carpeta: `vercel`
3. Sigue instrucciones
4. Deploy en ~2 minutos

## 🔧 MANTENIMIENTO

Para añadir o corregir alimentos:

1. Edita `database.json`
2. Conserva trazabilidad, macros, clasificación y estado de preparación
3. Regenera el índice nutricional
4. Ejecuta la regresión completa y valida una preview antes de producción

## ✅ CONTROL DE RELEASE

```text
npm test
npm run audit:catalog
npm run audit:intent
```

El contrato verificable de producto está en
`docs/PREMIUM_PRODUCT_CONTRACT.md`.

La arquitectura de acceso de producción y su operativa están en
`docs/PRODUCTION_ACCESS.md`.

---

**Versión:** Premium 2.2
**Fecha:** Julio 2026
**Creado para:** Jonathan - RevolucionaT
