# Deploy del microservicio semántico

> Cómo desplegar el microservicio FastAPI en una plataforma separada de Vercel.
> Última actualización: 2026-05-01

---

## Por qué no en Vercel

Vercel sirve **archivos estáticos + funciones serverless** (cortas, < 10s, sin estado).
El microservicio carga un modelo de IA de ~120MB en memoria al arrancar y mantiene
embeddings de 5.307 alimentos en RAM (~7MB). Eso requiere un servicio que:

- Tenga estado en memoria (modelo cargado)
- Soporte arranque lento (< 60s para cargar el modelo la primera vez)
- Dé al menos 512MB de RAM

Plataformas recomendadas (todas tienen plan gratis o muy barato):

| Plataforma | Plan gratis | Auto-deploy desde GitHub | Recomendación |
|---|---|---|---|
| **Coolify** | ✅ self-hosted | ✅ | Si tenés VPS propio |
| **Railway** | ✅ $5 USD crédito/mes | ✅ | Más simple, recomendado |
| **Render** | ✅ pero servicio se duerme | ✅ | OK pero el cold-start es feo |
| **Fly.io** | ✅ 3 VMs gratis | ✅ | Buena performance |

---

## Arquitectura

```
github.com/tu-usuario/Nutricionista (UN repo, dos servicios)
              │
              ├──→ VERCEL  (frontend)
              │    Lee: / (root del repo)
              │    Ignora: microservicio/ (vía .vercelignore)
              │    Sirve: index.html + database.json + service-worker
              │    URL: https://app.entrenatucorazon.es
              │
              └──→ COOLIFY/RAILWAY/RENDER  (backend Python)
                   Lee: microservicio/ (subdirectorio)
                   Construye: Dockerfile
                   Sirve: FastAPI en puerto 8000
                   URL: https://nutricion-rerank.coolify.app
```

Cuando hacés `git push`:
1. GitHub Action ejecuta `actualizar.sh` y commitea los embeddings actualizados.
2. Vercel detecta el push y re-despliega el frontend (segundos).
3. Coolify/Railway detectan el push y re-construyen el contenedor del microservicio (1-3 min).
4. Service worker del frontend (Network-First en database.json) sirve la versión nueva.

---

## Deploy en Coolify (lo de la captura)

Lo que vi en tu screenshot es Coolify (o un fork tipo Dokploy). Estas son las opciones:

```
What would you like to create?
├── GitHub Repository  ← USAR ESTA
├── Database
├── Template
├── Docker Image
├── Function
├── Bucket
└── Empty Project
```

### Pasos en Coolify

1. **New Resource → GitHub Repository**
2. Elegir el repositorio `Nutricionista` (autorizar GitHub si hace falta).
3. **Branch:** `main` (o el branch que estés usando en producción).
4. **Build Pack:** `Dockerfile` (Coolify lo detecta solo si encuentra el archivo).
5. **Base Directory:** `/microservicio` ← **ESTE ES EL CAMPO CLAVE**
6. **Dockerfile Location:** `./Dockerfile` (relativo al base directory).
7. **Port:** `8000`
8. **Health Check Path:** `/health`
9. **Environment Variables:** ninguna obligatoria (el `PORT` lo inyecta Coolify).
10. **Deploy**.

**Resultado:** Coolify clona el repo, entra a `microservicio/`, construye la imagen Docker (1-3 min la primera vez), y publica el servicio. Te da una URL tipo `https://nutricion-rerank.tu-dominio.com`.

### Cómo verificar que funciona

```bash
curl https://nutricion-rerank.tu-dominio.com/health
```

Debe responder:

```json
{"status":"ok","model_loaded":true,"n_foods":5307,"model":"paraphrase-multilingual-MiniLM-L12-v2"}
```

---

## Deploy en Railway (alternativa más simple)

1. **railway.com → New Project → Deploy from GitHub repo**
2. Elegir el repositorio `Nutricionista`.
3. Settings → **Root Directory:** `/microservicio`
4. Railway auto-detecta el `Dockerfile`.
5. Variables → **PORT:** `8000` (Railway puede asignar otro, lee del env).
6. Health Checks → **Path:** `/health`, **Port:** `8000`.
7. Deploy.

URL pública: Settings → **Generate Domain** → Railway te da `https://X.up.railway.app`.

---

## Deploy en Render (alternativa)

1. **render.com → New → Web Service → Build and deploy from a Git repository**
2. Conectar el repositorio `Nutricionista`.
3. **Root Directory:** `microservicio`
4. **Runtime:** Docker
5. **Plan:** Free (ojo: se duerme tras 15 min sin tráfico, primer request puede tardar 1 min).
6. Deploy.

---

## Configurar el frontend para usar el microservicio desplegado

Después de desplegar, anotá la URL pública (ej: `https://nutricion-rerank.coolify.app`).

Editá `index.html` y cambiá el meta tag:

```html
<!-- Antes -->
<meta name="rerank-api-url" content="http://localhost:8000" />

<!-- Después -->
<meta name="rerank-api-url" content="https://nutricion-rerank.coolify.app" />
```

Hacé `git push`. Vercel re-despliega y el frontend de producción ya empieza a usar el microservicio remoto.

---

## CORS — el frontend en Vercel hablando con microservicio en otro dominio

El microservicio ya tiene CORS configurado para aceptar cualquier origen (`main.py` usa `CORSMiddleware` con `allow_origins=["*"]`). Si querés restringirlo solo a tu dominio de producción:

Editar `microservicio/main.py`:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://app.entrenatucorazon.es",
        "https://nutricionista.vercel.app",
        "http://localhost:3000",  # dev
    ],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)
```

---

## Sincronización de embeddings entre frontend y microservicio

El microservicio carga los embeddings desde `microservicio/data/` en el momento del arranque. Cuando se ejecuta `bash scripts/actualizar.sh`:

1. Se regenera `microservicio/data/embeddings.npz` localmente.
2. `git push` sube los embeddings al repo.
3. Coolify/Railway detectan el cambio en `microservicio/` y re-despliegan el contenedor.
4. El nuevo contenedor arranca con los embeddings actualizados.
5. Mientras tanto, el contenedor viejo sigue sirviendo (zero-downtime).

**Si el hash de la BD cambia y los embeddings no se actualizaron:**

`/health` devuelve un warning. Ejecutar `bash scripts/actualizar.sh` y `git push`.

---

## Costos esperados

| Plataforma | Costo mensual | Para qué uso |
|---|---|---|
| Vercel (frontend) | $0 | 100 GB bandwidth/mes — sobra |
| Coolify (self-hosted en Hetzner CX22) | ~5€/mes | VPS te alcanza para varios servicios |
| Railway | $5 USD/mes (después del crédito gratis) | Si no querés mantener VPS |
| Render Free | $0 | Si tolerás el cold-start de 1 min |

Para una app de 100 clientas: cualquiera de las opciones soporta sin sudar.

---

## Troubleshooting

### El microservicio arranca pero `/health` da error

Revisar logs en la plataforma. Suele ser:
- Falta `microservicio/data/embeddings.npz` → ejecutar `bash scripts/actualizar.sh` y push
- Memoria insuficiente → cambiar a plan con ≥512MB RAM
- Modelo no descargado → en el Dockerfile el modelo se pre-descarga, si tu plataforma cachea aggressivamente puede saltarse el step

### El frontend dice "rerank fallback" en consola

Significa que el frontend intentó llamar al microservicio y no respondió en 500ms. Causas:
- URL del meta tag incorrecta
- CORS bloqueado (revisar consola del navegador)
- Microservicio dormido (Render Free tarda 1 min en despertar)

La app sigue funcionando — solo pierde el rerank semántico, ordena por matchScore matemático puro.

### Deploy falla por falta de memoria al cargar el modelo

`paraphrase-multilingual-MiniLM-L12-v2` necesita ~500MB durante la carga. Coolify/Railway/Render con plan más bajo (256MB) crashea. Subir a 512MB o 1GB.

---

## Resumen

```
ESTRUCTURA:           1 repo GitHub
                      2 servicios desplegados (frontend + microservicio)

DEPLOYS:              Vercel automático (push → root)
                      Coolify/Railway automático (push → microservicio/)

CONFIG FRONTEND:      meta tag rerank-api-url en index.html

CONFIG MICROSERVICIO: Dockerfile en microservicio/
                      Plataforma con base directory = microservicio
```

Una sola fuente de verdad (GitHub), dos deploys automáticos.
