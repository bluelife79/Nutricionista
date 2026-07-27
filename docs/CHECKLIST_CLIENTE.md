# Checklist para el cliente — Cuentas necesarias

> Este documento es para el dueño del proyecto (la nutricionista).
> Explica qué cuentas tiene que tener a su nombre para que la app funcione
> de forma autónoma y nadie pueda "secuestrarla".

---

## Regla de oro

**Todo lo crítico debe estar a tu nombre.** El desarrollador (Nakea) puede ser colaborador, pero la propiedad de las cuentas es tuya. Si algún día dejás de trabajar con el desarrollador, el negocio sigue funcionando porque vos sos el dueño de la infraestructura.

---

## Las 3 cuentas que necesitás

### 1. GitHub — donde vive el código

```
Estado:     ✅ Ya creada (sos owner del repo Nutricionista)
Costo:      Gratis
Plan:       Free (alcanza para todo)
```

**Verificá que sos owner:**
1. Ir a `github.com/tu-usuario/Nutricionista`
2. Settings → General
3. En "Danger Zone" debe aparecer "Transfer ownership" (eso confirma que sos owner)

**El desarrollador (Nakea) debe estar como Collaborator, no como Owner:**
1. Settings → Collaborators and teams
2. Verificar que está como **Collaborator** (puede commitear y pushear pero no puede borrar el repo)

---

### 2. Vercel — donde se sirve el frontend (la app web)

```
Estado:     ✅ Ya creada (Nakea tiene acceso compartido)
Costo:      Gratis (Hobby plan)
Plan:       Hobby — alcanza para 100 GB bandwidth/mes
```

**Verificá que el proyecto está a tu nombre:**
1. Ir a `vercel.com/dashboard`
2. Click en el proyecto Nutricionista
3. Settings → General → Owner debe ser tu cuenta personal o tu equipo

**Permisos que tiene el desarrollador:**
- Puede ver deploys, logs y configurar dominios
- No puede transferir ni borrar el proyecto

---

### 3. Railway — donde corre el microservicio de IA (NUEVA)

```
Estado:     ❌ Falta crear
Costo:      $5 USD/mes (Hobby Plan, viene con $5 de crédito incluido)
Costo neto real: ~$0/mes (el uso de la app entra dentro del crédito)
```

#### Por qué hace falta Railway

La app tiene dos partes:
- **Frontend** (Vercel): la web que ven las clientas
- **Microservicio de IA** (Railway): un servicio aparte que mejora el orden de los intercambios usando inteligencia artificial

Vercel solo sirve archivos estáticos. El microservicio carga un modelo de IA que necesita 500MB de RAM permanente. Por eso necesita una plataforma diferente.

#### Pasos para crear la cuenta (5 minutos)

1. **Ir a [railway.com](https://railway.com)**.
2. Click en **Login with GitHub** → autorizar con TU cuenta de GitHub (la misma donde está el repo).
3. Una vez logueada, agregar tarjeta de crédito en **Account Settings → Billing → Add Payment Method**.
   > **Importante:** sin tarjeta, Railway solo da $5 USD de crédito una vez. Con tarjeta, te da plan Hobby ($5/mes) que incluye $5 de crédito mensual. Ese crédito alcanza para esta app.

4. **New Project → Deploy from GitHub repo**.
5. Te aparece la lista de tus repos → seleccioná **Nutricionista**.
6. Railway empieza a construir. **Va a fallar la primera vez** porque no sabe que tiene que mirar la subcarpeta `microservicio/`. Eso lo arreglamos en el paso siguiente.

7. Click en el servicio (cuadro morado) → **Settings → Source**.
8. **Root Directory:** escribir `microservicio` (sin barras).
9. Click en **Deployments → Redeploy** (o esperar al próximo push).
10. Esta vez tarda 2-3 minutos (descarga el modelo de IA durante el build).

11. Cuando aparece "Active" en verde, ir a **Settings → Networking → Public Networking → Generate Domain**.
12. Railway te da una URL pública tipo: `https://nutricion-rerank-production.up.railway.app`.

13. **Copiá esa URL.** El desarrollador la va a usar para conectar el frontend.

#### Invitar al desarrollador como colaborador (opcional)

Si querés que el desarrollador pueda ver logs, redesplegar manualmente y ajustar configuración:

1. **Settings (del proyecto) → Members → Invite Member**
2. Email del desarrollador → **Role: Member** (no Owner).
3. El desarrollador acepta la invitación.

**Lo que el desarrollador puede hacer como Member:**
- Ver logs y deploys
- Redesplegar manualmente
- Configurar variables de entorno

**Lo que NO puede hacer:**
- Borrar el proyecto
- Transferir el proyecto
- Cambiar el método de pago

---

## Costos totales mensuales

```
GitHub:                   $0
Vercel (Hobby):           $0  (100 GB bandwidth gratis, sobra para 100 clientas)
Railway (Hobby Plan):     $5/mes (con $5 crédito incluido = neto ~$0)
Dominio custom (opcional): ~$10/año si querés app.entrenatucorazon.es
─────────────────────────────────────────
TOTAL:                    ~$0–5/mes
```

Para una clientela paga de nutricionista, esto es trivial.

---

## Después de crear Railway — qué le pasás al desarrollador

```
1. La URL pública que te dio Railway:
   https://nutricion-rerank-production.up.railway.app

2. (Opcional) Invitarlo como Member del proyecto Railway
   con su email de Railway/GitHub.
```

El desarrollador edita el frontend con esa URL, hace push, y la app queda conectada.

---

## Resumen visual

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   TU NEGOCIO (RevolucionaT) — todo a tu nombre               │
│                                                              │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐               │
│   │  GitHub  │    │  Vercel  │    │ Railway  │               │
│   │  Owner   │    │  Owner   │    │  Owner   │               │
│   │  (vos)   │    │  (vos)   │    │  (vos)   │               │
│   └─────┬────┘    └─────┬────┘    └─────┬────┘               │
│         │               │               │                    │
│         │  Collaborator │  Member       │  Member            │
│         ↓               ↓               ↓                    │
│   ┌──────────────────────────────────────────────┐           │
│   │         Desarrollador (Nakea)                │           │
│   │   Trabaja para vos, no es dueño de nada      │           │
│   └──────────────────────────────────────────────┘           │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## Si dejás de trabajar con el desarrollador

Como sos owner de todo, basta con:

1. **GitHub**: Settings → Collaborators → Remove Nakea
2. **Vercel**: Settings → Members → Remove Nakea
3. **Railway**: Settings → Members → Remove Nakea
4. (Opcional) Cambiar contraseña de tu cuenta GitHub si compartiste algo sensible

La app sigue funcionando exactamente igual porque la infraestructura sigue activa a tu nombre. Si querés contratar a otro desarrollador, le das los mismos permisos.

---

*Documento para entregar al cliente final junto con el código.*
