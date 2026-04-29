# 🚀 GUÍA DEPLOYMENT VERCEL

## 📋 PRE-REQUISITOS

1. **Cuenta Vercel** (gratis):
   - Ve a https://vercel.com
   - Sign up con GitHub/Google/Email

2. **Vercel CLI instalado**:

   ```bash
   npm install -g vercel
   ```

3. **Archivos del proyecto listos**:
   - index.html
   - database.json
   - manifest.json
   - service-worker.js
   - icon-192.png
   - icon-512.png

---

## ⚡ DEPLOYMENT RÁPIDO (5 MINUTOS)

### OPCIÓN 1: VIA WEB (MÁS FÁCIL)

1. **Sube carpeta a GitHub:**

   ```bash
   cd revolucionat-app
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/revolucionat-app.git
   git push -u origin main
   ```

2. **Importa en Vercel:**
   - Ve a https://vercel.com/new
   - Click "Import Git Repository"
   - Selecciona revolucionat-app
   - Click "Deploy"
   - **LISTO** ✅

### OPCIÓN 2: VIA CLI (MÁS RÁPIDO)

1. **Login Vercel:**

   ```bash
   vercel login
   ```

2. **Deploy:**

   ```bash
   cd revolucionat-app
   vercel
   ```

3. **Sigue el wizard:**

   ```
   ? Set up and deploy "revolucionat-app"? [Y/n] y
   ? Which scope? [tu-usuario]
   ? Link to existing project? [y/N] n
   ? What's your project's name? revolucionat-app
   ? In which directory is your code located? ./
   ```

4. **Production:**
   ```bash
   vercel --prod
   ```

**URL generada:** `https://revolucionat-app-xxxx.vercel.app`

---

## 🌐 DOMINIO CUSTOM (app.entrenatucorazon.es)

### CONFIGURACIÓN DNS

1. **En tu proveedor DNS (GoDaddy/Cloudflare/etc):**

   Añade registro CNAME:

   ```
   Tipo:   CNAME
   Name:   app
   Value:  cname.vercel-dns.com
   TTL:    Auto
   ```

2. **En Vercel Dashboard:**
   - Ve a tu proyecto
   - Settings → Domains
   - Add Domain: `app.entrenatucorazon.es`
   - Vercel verificará DNS (2-10 min)
   - **SSL automático** ✅

---

## 🔄 ACTUALIZAR APP

### CAMBIOS EN CÓDIGO:

```bash
# Edita archivos
# Luego:
vercel --prod
```

### ACTUALIZAR BASE DATOS:

```bash
# Reemplaza database.json
cp database-full.json database.json

# Deploy
vercel --prod
```

---

## ⚙️ CONFIGURACIÓN AVANZADA

### vercel.json (opcional):

```json
{
  "version": 2,
  "builds": [
    {
      "src": "index.html",
      "use": "@vercel/static"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "/index.html"
    }
  ],
  "headers": [
    {
      "source": "/service-worker.js",
      "headers": [
        {
          "key": "Service-Worker-Allowed",
          "value": "/"
        }
      ]
    }
  ]
}
```

---

## 🐛 TROUBLESHOOTING

### ERROR: "database.json not found"

```bash
# Verifica que el archivo existe
ls -la database.json

# Deploy de nuevo
vercel --prod --force
```

### ERROR: PWA no instala

- Verifica que manifest.json está en root
- Verifica que service-worker.js está en root
- Necesitas HTTPS (Vercel lo da automático)
- Prueba en Chrome incógnito

### ERROR: Dominio no verifica

- Espera 10-15 minutos propagación DNS
- Verifica CNAME con: `dig app.entrenatucorazon.es`
- Debe apuntar a Vercel

---

## 📊 MONITOREO

### Analytics (opcional):

Añade Vercel Analytics:

```bash
vercel env add NEXT_PUBLIC_ANALYTICS_ID production
```

### Logs:

```bash
vercel logs [deployment-url]
```

---

## ✅ CHECKLIST POST-DEPLOYMENT

- [ ] App accesible en URL Vercel
- [ ] Búsqueda de alimentos funciona
- [ ] Cálculo de equivalencias correcto
- [ ] Responsive en móvil
- [ ] PWA instalable
- [ ] Dominio custom configurado (opcional)
- [ ] SSL activo (candado verde)

---

## 🔐 SEGURIDAD

### Environment Variables (si añades backend):

```bash
vercel env add API_KEY production
vercel env add DATABASE_URL production
```

---

## 💰 COSTOS

**Plan gratuito Vercel:**

- ✅ 100 GB bandwidth/mes
- ✅ 100 deployments/día
- ✅ Dominio custom gratis
- ✅ SSL gratis
- ✅ Sin límite de usuarios

**Para tu caso (100 clientas):**

- Uso estimado: ~1-2 GB/mes
- **COSTO: $0/mes** ✅

---

## 🆘 SOPORTE

**Errores comunes:**

- https://vercel.com/docs/errors

**Documentación oficial:**

- https://vercel.com/docs

**Support:**

- https://vercel.com/support
