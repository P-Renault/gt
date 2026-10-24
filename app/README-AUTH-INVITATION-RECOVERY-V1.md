# GEOTRACIA — Activación de invitaciones y recuperación de contraseña

## Cambios incluidos

- `auth.js`: distingue inicio de sesión, registro, activación de invitación y recuperación de contraseña.
- `index.html`: actualiza la versión de caché de `auth.js` y `auth.css`.
- `auth.css`: estilo de campo de correo bloqueado durante activación/recuperación.
- `supabase/functions/geotracia-invitations/index.ts`: usa `operators_limit` y redirige la invitación a `/app/?auth=invite`.

## Publicación

1. Publica el contenido de `app/` en el mismo directorio de despliegue que ya utiliza Geotracia; no cambies la arquitectura de carpetas.
2. Despliega la Edge Function incluida en `app/supabase/functions/geotracia-invitations/` con el nombre `geotracia-invitations`.
3. Mantén `GEOTRACIA_SITE_URL=https://geotracia.cl`. La función normaliza el destino para abrir `/app/?auth=invite`.
4. En Supabase Auth, confirma que la URL de redirección `https://geotracia.cl/app/**` esté permitida.
5. Prueba con una invitación NUEVA después del despliegue. Los enlaces de invitación ya consumidos o expirados no sirven para validar el flujo nuevo.

## Pruebas manuales obligatorias

1. **Invitación nueva:** abrir el correo → aparece “Activa tu cuenta” → crear y confirmar contraseña → Edge Function `accept` confirma la invitación → se carga la sesión autenticada.
2. **Inicio de sesión:** cerrar sesión → iniciar con el correo invitado y la contraseña creada.
3. **Recuperación:** desde login seleccionar “¿Olvidaste tu contraseña?” → abrir correo → aparece “Crea una contraseña nueva” → guardar → se cierra la sesión de recuperación y vuelve al login con mensaje de éxito.
4. **Seguridad:** no debe aceptarse la invitación si no hay sesión válida, si expiró o si no existe invitación pendiente.

## Alcance y limitaciones conocidas

La aceptación de invitación actual crea la membresía de organización y devuelve la organización. El esquema/función incluido no asigna un `project_id` concreto a la invitación. Si el producto requiere asignación a un proyecto específico, se debe implementar explícitamente ese vínculo en la tabla de invitaciones y validarlo en el servidor; no debe inferirse ni autorizarse desde parámetros del navegador.
