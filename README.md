# 🎯 RevolucionaT - Intercambiador de Alimentos

## 📋 DESCRIPCIÓN

Aplicación web para intercambiar alimentos manteniendo macros equivalentes.
Diseñada para mujeres +40 años del programa RevolucionaT.

## 🎨 CARACTERÍSTICAS

- ✅ Catálogo Premium 2.2: 5.324 registros trazables, 1.203 alimentos núcleo y 238 referencias
- ✅ Fuentes: BEDCA + mercado español controlado + Open Food Facts curado
- ✅ Búsqueda inteligente con autocomplete
- ✅ Intercambios nutricionales con compatibilidad culinaria y raciones prácticas
- ✅ Preguntas adaptativas solo cuando cambian de verdad las alternativas
- ✅ 487 alimentos con pregunta culinaria validada; el resto evita preguntas que no aportan
- ✅ NOVA 4, edulcorantes, ultraprocesados y alimentos ambiguos fuera del núcleo
- ✅ Diseño Neumorphism premium
- ✅ Mobile-first responsive
- ✅ PWA instalable
- ✅ Funciona offline

## 📁 ESTRUCTURA

```
Nutricionista/
├── index.html          # App principal
├── styles.css          # Estilos Neumorphism
├── js/                 # Interfaz, política, intención culinaria y algoritmo
├── database.json       # Catálogo activo y perfiles culinarios versionados
├── config/             # Política de raciones y decisiones auditadas
├── scripts/            # Auditorías, regresión y gate de release
├── manifest.json       # PWA config
└── service-worker.js   # Offline support
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

---

**Versión:** Premium 2.2
**Fecha:** Julio 2026
**Creado para:** Jonathan - RevolucionaT
