# Cambios · aceptación legal GEOTRACIA

- Se agregan tres documentos públicos versionados (Condiciones de uso, Privacidad, Contrato del servicio).
- El formulario de alta exige aceptar expresamente los tres documentos.
- La aceptación del alta se registra mediante trigger sobre `auth.users` usando metadatos de consentimiento.
- Las cuentas existentes validan el estado legal al iniciar sesión y deben aceptar las versiones activas cuando corresponda.
- Se agrega historial append-only con RLS, lectura propia y RPC de aceptación.
- Se minimizan datos: no se registra IP; se conserva user-agent limitado a 500 caracteres.
- Se agregan enlaces legales al pie de la landing y al acceso de la aplicación.
