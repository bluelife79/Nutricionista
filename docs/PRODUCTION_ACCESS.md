# Acceso de producción

## Objetivo

El intercambiador usa cuentas individuales de Supabase Auth y mantiene en la
tabla `users` únicamente el perfil necesario para la aplicación: nombre,
email, estado activo y fecha de creación. La contraseña no se guarda ni se
devuelve desde esa tabla.

## Roles

- `member`: puede iniciar sesión en el intercambiador si su perfil está activo.
- `admin`: puede entrar en `/admin.html` y gestionar clientas. No puede abrir
  la herramienta como si fuera una clienta.

Los roles se guardan en `app_metadata`, que sólo puede modificar el backend con
la clave de servicio.

## Sesiones

- Clienta: cookie firmada, `HttpOnly`, `Secure`, `SameSite=Strict`, 12 horas.
- Administración: cookie diferente con las mismas protecciones y 4 horas.
- La aplicación vuelve a comprobar en Supabase que la cuenta existe, conserva
  su rol y sigue activa. Una baja impide continuar con la siguiente petición,
  aunque todavía exista una cookie anterior.
- Ni la contraseña de la clienta ni la del administrador se guardan en
  `localStorage` o `sessionStorage`.

## Operativa del panel

El panel permite:

1. crear una clienta con nombre, email y contraseña segura;
2. editar nombre y email;
3. establecer una contraseña nueva sin mostrar la anterior;
4. activar o desactivar el acceso.

Una contraseña nueva debe tener entre 12 y 128 caracteres e incluir mayúscula,
minúscula y número.

## Alta inicial

El script `scripts/provision_production_users.js`:

- valida cantidad, formato y duplicados antes de escribir;
- crea las cuentas confirmadas en Supabase Auth;
- crea o actualiza sus perfiles activos;
- crea el rol administrador;
- puede desactivar perfiles antiguos que no estén en la lista autorizada;
- genera un CSV privado con permisos de lectura restringidos.

La lista de clientas, el manifiesto reanudable y el CSV de credenciales viven
en `.private/`, que está excluido de Git. No deben adjuntarse a incidencias,
commits ni pull requests.

## Comprobaciones de lanzamiento

Antes de producción:

1. ejecutar `npm test`;
2. desplegar una preview;
3. comprobar login de clienta y de administración por HTTP;
4. comprobar que una baja devuelve `403` y que una reactivación restaura el
   acceso;
5. desplegar producción y repetir login, sesión y logout;
6. confirmar que `intercambio.entrenatucorazon.es` responde con HTTPS.

## Recuperación

- Contraseña olvidada de clienta: establecer una nueva desde el panel.
- Clienta que sale del programa: desactivar; no es necesario borrar su ficha.
- Cambio de email: editarlo desde el panel para mantener Auth y perfil
  sincronizados.
- Sospecha sobre la cuenta administradora: cambiar la contraseña desde
  Supabase Auth y cerrar las sesiones activas.
