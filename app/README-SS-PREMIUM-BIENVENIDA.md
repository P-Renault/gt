# Geotracia — SS Premium Welcome V1

## Archivos incluidos
- `app.js`: incorpora la vista premium de bienvenida cuando la cuenta no tiene una organización activa, abre un modal para crearla y muestra el resultado dentro del modal.
- `premium-ui.css`: estilos de presentación SS Premium, responsive para escritorio y móvil.
- `index.html`: actualiza el identificador de caché de `premium-ui.css`.
- `geotracia-welcome-territory.png`: recurso visual del hero.

## Instalación
1. Realiza una copia de seguridad de los archivos actuales.
2. Reemplaza `app.js`, `premium-ui.css` e `index.html` conservando sus rutas.
3. Coloca `geotracia-welcome-territory.png` en el mismo directorio público donde está `index.html`.
4. Publica los cambios.
5. Recarga la aplicación sin caché e inicia sesión con una cuenta sin organización activa.
6. Pulsa `Crear organización`, escribe el nombre y comprueba el mensaje de resultado.

## Integración funcional
El modal llama a la función existente `createGeoOrganization()` y conserva la llamada RPC actual `create_my_organization`. No se modifica el contrato de backend ni se inventa una suscripción: la prueba de 14 días depende de la lógica que esté desplegada en Supabase. El modal presenta el resultado de la llamada y vuelve a cargar el espacio tras un alta confirmada.

## Validación
`app.js` pasó `node --check`. No se ejecutaron operaciones contra Supabase ni se validó el sitio desplegado. Antes de producción, confirmar que el RPC `create_my_organization` existe en el proyecto Supabase y crea la organización, la membresía `owner` y la suscripción de prueba de forma transaccional.
