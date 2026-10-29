# Geotracia — corrección de reconstrucción automática

1. Ejecuta la migración SQL incluida en Supabase SQL Editor.
2. Reemplaza `app/roads.js` por este archivo y despliega el sitio.
3. En Caminos, pulsa Reconstruir. No se solicitan coordenadas manuales.
4. La vista previa se dibuja en violeta; solo se guarda tras confirmación.

La RPC usa los extremos del registro existente y busca en un corredor de 5 km alrededor de la geometría guardada. Esto mejora la cobertura cuando los extremos guardados están desplazados, pero si la geometría base es radicalmente incorrecta, la ruta seguirá requiriendo una fuente de referencia confiable. Prueba primero en vista previa; no se garantiza la ruta oficial sin verificar los datos reales de Supabase.
