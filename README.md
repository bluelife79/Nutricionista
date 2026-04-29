# 🎯 RevolucionaT - Intercambiador de Alimentos

## 📋 DESCRIPCIÓN

Aplicación web para intercambiar alimentos manteniendo macros equivalentes.
Diseñada para mujeres +40 años del programa RevolucionaT.

## 🎨 CARACTERÍSTICAS

- ✅ Base de datos: 200 alimentos verificados (BEDCA + Mercadona/Lidl/Carrefour/Aldi)
- ✅ Búsqueda inteligente con autocomplete
- ✅ Algoritmo de equivalencias matemático preciso
- ✅ Diseño Neumorphism premium
- ✅ Mobile-first responsive
- ✅ PWA instalable
- ✅ Funciona offline

## 📁 ESTRUCTURA

```
revolucionat-app/
├── index.html          # App principal
├── styles.css          # Estilos Neumorphism
├── app.js              # Lógica + algoritmo
├── database.json       # 200 alimentos verificados
├── manifest.json       # PWA config
├── service-worker.js   # Offline support
└── icons/              # Iconos app (generados)
```

## 🚀 DEPLOYMENT (VERCEL)

1. Instala Vercel CLI: `npm install -g vercel`
2. En la carpeta: `vercel`
3. Sigue instrucciones
4. Deploy en ~2 minutos

## 🔧 MANTENIMIENTO

Para añadir alimentos:

1. Edita `database.json`
2. Añade entrada con mismo formato
3. Redeploy: `vercel --prod`

## 📊 PRÓXIMO PASO: BASE DATOS COMPLETA (1500+ alimentos)

Ver archivo: `CLAUDE_CODE_INSTRUCTIONS.md`

---

**Versión:** 1.0.0
**Fecha:** Febrero 2026
**Creado para:** Jonathan - RevolucionaT
