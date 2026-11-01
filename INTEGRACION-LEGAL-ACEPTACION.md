# GEOTRACIA · Paquete SEO + Fase 4 legal + aceptación de registro

## Contenido
- SEO de la landing, Open Graph, imagen social, favicon, `robots.txt` y `sitemap.xml`.
- Documentos públicos: condiciones de uso, privacidad y contrato del servicio.
- Registro de aceptación versionada en Supabase.
- Aceptación obligatoria de los tres documentos al crear cuenta.
- Comprobación al iniciar sesión: si faltan aceptaciones o cambió una versión activa, el usuario debe aceptar antes de entrar.
- Registro histórico de versiones, fecha/hora del servidor, método y user-agent. No se almacena IP para reducir datos personales.

## Despliegue obligatorio

1. **Antes de desplegar el frontend**, abrir Supabase SQL Editor y ejecutar:
   `app/supabase/migrations/202611010001_geotracia_legal_acceptance.sql`
2. Verificar que existen las tablas `geotracia_legal_document_versions` y `geotracia_legal_acceptances`, y las funciones RPC `geotracia_legal_acceptance_current` y `geotracia_accept_legal_documents`.
3. Desplegar los archivos del paquete conservando sus rutas.
4. Probar alta con un correo nuevo: deben exigirse las tres casillas. Si Supabase requiere confirmación de correo, el trigger registra la aceptación declarada en el alta y la valida al primer inicio de sesión.
5. Probar inicio de sesión con una cuenta preexistente: debe aparecer la pantalla de actualización legal y no debe entrar a la aplicación hasta aceptar los tres documentos.
6. Confirmar que el historial se registra en `public.geotracia_legal_acceptances` y que cada usuario solo puede consultar sus propios registros.
7. Revisar el sitio publicado y solicitar indexación de la landing y documentos públicos desde Google Search Console.

## Versionado futuro
Cuando se publique una nueva versión:
- Actualizar el documento HTML correspondiente.
- Actualizar su `version` en `geotracia_legal_document_versions`.
- Actualizar la versión correspondiente en `app/auth.js` (`selectedLegalVersions` y metadatos de signup).
- Para cambios de esta migración, generar una nueva migración SQL; no editar migraciones ya aplicadas en producción.

## Consideraciones legales previas a producción
Los documentos son una base funcional de publicación, no un dictamen jurídico. Antes de ofrecer el servicio comercialmente, completar y validar la identidad legal del proveedor y del cliente en la orden comercial; definir correo y domicilio de privacidad; confirmar proveedores/subencargados y países de tratamiento; inventariar cookies reales; establecer plazos concretos de conservación, SLA, exportación y eliminación; y obtener revisión de abogado en Chile. La política contempla la operación de la plataforma, pero el cliente puede ser responsable de los datos personales que incorpora sobre terceros.
