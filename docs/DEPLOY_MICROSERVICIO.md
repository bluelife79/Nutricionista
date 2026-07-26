# Deploy del microservicio en Railway

> Cómo desplegar el microservicio FastAPI en Railway, separado de Vercel.
> Última actualización: 2026-05-01

---

## Por qué Railway y no Vercel

Vercel sirve **archivos estáticos + funciones serverless** (cortas, < 10s, sin estado).
El microservicio carga un modelo de IA de ~120MB en memoria al arrancar y mantiene
embeddings de 5.307 alimentos en RAM (~7MB). Eso requiere un servicio que:

- Tenga estado en memoria (modelo cargado)
- Soporte arranque lento (< 60s para cargar el modelo la primera vez)
- Dé al menos 512MB de RAM

**Railway** lo resuelve nativo. Tiene plan gratis ($5 USD de crédito mensual que alcanza para una app de este tamaño), auto-deploy desde GitHub, healthchecks automáticos y zero-downtime deploys.

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
              └──→ RAILWAY  (backend Python)
                   Lee: microservicio/ (subdirectorio, vía Root Directory)
                   Construye: Dockerfile (configurado vía railway.json)
                   Sirve: FastAPI en puerto $PORT (Railway lo inyecta)
                   URL: https://nutricion-rerank.up.railway.app
```

Cuando hacés `git push`:
1. GitHub Action ejecuta `actualizar.sh` y commitea los embeddings actualizados.
2. Vercel detecta el push y re-despliega el frontend (segundos).
3. Railway detecta el push y re-construye el contenedor del microservicio (1-3 min).
4. Service worker del frontend (Network-First en database.json) sirve la versión nueva a las clientas.

---

## Deploy paso a paso en Railway

### 1. Crear cuenta y proyecto

1. Ir a [railway.com](https://railway.com) → **Login with GitHub**.
2. Autorizar acceso al repositorio `Nutricionista`.
3. Click en **New Project**.

### 2. Conectar el repositorio

```
New Project
  ↓
Deploy from GitHub repo
  ↓
Seleccionar:  tu-usuario/Nutricionista
  ↓
Branch:       main
```

Railway empieza a construir automáticamente — pero falla la primera vez porque no sabe que tiene que mirar el subdirectorio `microservicio/`. Eso lo arreglamos en el paso siguiente.

### 3. Configurar Root Directory

```
Service Settings (engranaje)
  ↓
Source / Service / Build
  ↓
Root Directory:   microservicio
```

**Este es el campo clave.** Una vez seteado, Railway lee `microservicio/railway.json` (que creamos) y aplica:
- Builder: Dockerfile
- Dockerfile path: `Dockerfile`
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Healthcheck path: `/health`
- Healthcheck timeout: 120s
- Restart policy: on-failure, max 3 retries

Hacé click en **Deploy** o **Redeploy** después de setear el Root Directory.

### 4. Generar dominio público

```
Service Settings → Networking → Public Networking
  ↓
Generate Domain
```

Railway te da una URL tipo: `https://nutricion-rerank-production-xxxx.up.railway.app`

(Opcional: configurar dominio custom como `rerank.entrenatucorazon.es` si tenés DNS).

### 5. Verificar que el microservicio responde

```bash
curl https://tu-app.up.railway.app/health
```

Debe responder:

```json
{
  "status": "ok",
  "model_loaded": true,
  "n_foods": 5307,
  "model": "paraphrase-multilingual-MiniLM-L12-v2"
}
```

Si en lugar de eso devuelve `503 Service Unavailable`, esperá 30-60s — el modelo todavía se está cargando en RAM.

### 6. Conectar el frontend al microservicio

Editar `index.html` y cambiar el meta tag con la URL pública de Railway:

```html
<!-- Antes (desarrollo local) -->
<meta name="rerank-api-url" content="http://localhost:8000" />

<!-- Después (producción) -->
<meta name="rerank-api-url" content="https://nutricion-rerank-production.up.railway.app" />
```

`git push`. Vercel re-despliega el frontend con la nueva URL. La app de producción ya usa el microservicio remoto.

---

## Variables de entorno

Railway inyecta automáticamente la variable `PORT`. No hay que configurarla.

Si en el futuro querés agregar otras (API keys, etc.):

```
Service → Variables → New Variable
```

---

## CORS — frontend en Vercel hablando con microservicio en Railway

El microservicio ya acepta requests de cualquier origen (`main.py` tiene `allow_origins=["*"]`). Una vez que esté en producción, conviene restringirlo solo a tus dominios:

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

`git push` → Railway re-despliega.

---

## Sincronización de embeddings frontend ↔ microservicio

El microservicio lee los embeddings de `microservicio/data/` al arrancar. Cuando ejecutás `bash scripts/actualizar.sh`:

1. Se regeneran `microservicio/data/embeddings.npz`, `index.json`, `meta.json` localmente.
2. `git push` sube los archivos al repo.
3. Railway detecta cambios en `microservicio/` (porque es el Root Directory) y re-construye el contenedor.
4. El nuevo contenedor arranca con los embeddings actualizados.
5. Railway hace el switch zero-downtime: mientras el nuevo carga el modelo, el viejo sigue sirviendo.

**Si el hash de la BD cambia y los embeddings no se actualizaron:**

`/health` devuelve un warning con el hash mismatch. Solución: ejecutar localmente `bash scripts/actualizar.sh` y push.

---

## Costos esperados en Railway

Railway cobra por uso real (CPU + RAM + bandwidth):

| Tier | Costo | Para qué uso |
|---|---|---|
| **Trial** (sin tarjeta) | $5 USD crédito gratis (un solo uso) | Para probar el deploy |
| **Hobby Plan** ($5 USD/mes) | $5 USD crédito incluido + pago por uso | **Recomendado para tu caso** |
| **Pro Plan** ($20 USD/mes) | $20 USD crédito + features extra | Innecesario para 100 clientas |

**Estimación real de uso para RevolucionaT:**

```
Modelo en RAM:        ~500MB constantes
Idle CPU:             casi 0
Request CPU:          picos cortos (50-200ms)
Bandwidth:            mínimo (responses son JSON pequeños)
Storage:              ~7MB (embeddings)
```

Para una app con 100 clientas activas: **gastás ~$2-3 USD/mes** dentro del crédito incluido del plan Hobby. Costo neto: **$0**.

---

## Troubleshooting

### El deploy falla con "exited with code 1"

Mirar los **Build Logs** de Railway. Causas comunes:

- **Falta `microservicio/data/embeddings.npz`** → ejecutar `bash scripts/actualizar.sh` localmente y `git push`. Sin los embeddings, el microservicio no arranca.
- **Out of memory durante el build** → Railway plan Hobby tiene 8GB RAM en build, no debería pasar. Si pasa, cambiar a plan superior.

### `/health` devuelve 503 después del deploy

El modelo todavía se está cargando. Esperar 30-60s más. Railway hace healthcheck cada 10s con timeout de 120s — si después de 2 min sigue 503, hay un problema:

- Mirar **Deploy Logs** → buscar errores Python
- Verificar que `microservicio/data/embeddings.npz` existe y no está corrupto

### El frontend dice "rerank fallback" en consola

El frontend intentó llamar al microservicio y no respondió en 500ms. Causas:

- **URL incorrecta** en el meta tag de `index.html`
- **CORS bloqueado** → revisar consola del navegador
- **Microservicio caído** → verificar `/health`

La app sigue funcionando en modo degradado: ordena los intercambios solo por matchScore matemático (sin rerank semántico). La clienta no ve un error, solo resultados ligeramente distintos.

### Railway muestra "service unhealthy" en el dashboard

Lo mismo que `/health` 503. El microservicio está vivo pero no terminó de cargar el modelo. Si persiste, redeploy:

```
Service → Deployments → [click en último deploy] → Redeploy
```

### Cambié `microservicio/main.py` pero Railway no se entera

Railway detecta cambios solo en archivos dentro del Root Directory. Si el cambio fue dentro de `microservicio/`, debería redeployar solo. Si no:

```
Service → Settings → Source → Watch Paths
```

Asegurarse de que esté `**/*` (todo).

---

## Comandos útiles para desarrollo local

```bash
# Arrancar el microservicio en local (puerto 8000):
uv run --directory microservicio uvicorn main:app --host 0.0.0.0 --port 8000

# Verificar /health local:
curl http://localhost:8000/health

# Test de rerank con un alimento:
curl -X POST http://localhost:8000/rerank \
  -H "Content-Type: application/json" \
  -d '{"query":"pollo pechuga","candidates":[{"id":"bedca_0001","tier":2}]}'
```

---

## Resumen

```
ESTRUCTURA:           1 repo GitHub
                      2 servicios desplegados (Vercel + Railway)

DEPLOYS:              Vercel automático (push → root)
                      Railway automático (push → microservicio/)

CONFIG FRONTEND:      meta tag rerank-api-url en index.html

CONFIG RAILWAY:       Root Directory = microservicio
                      railway.json hace el resto (builder, healthcheck, etc.)
```

Una sola fuente de verdad (GitHub), dos deploys automáticos, costo aproximado **$0/mes** dentro del Hobby Plan.
