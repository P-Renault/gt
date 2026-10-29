# Geotracia — reconstrucción vial automática FIX 3

## Archivos del paquete

- `app/roads.js` — elimina el toast que quedaba detrás de los diálogos y limpia vistas previas antiguas al comenzar una nueva reconstrucción.
- `app/supabase/migrations/202610290003_geotracia_rebuild_road_geometry_auto_topology.sql` — reemplaza `public.geotracia_rebuild_road_geometry_auto(uuid, boolean)` por una versión que crea una red topológica usando `ST_Node(ST_UnaryUnion(...))`, de modo que las líneas se dividan en intersecciones interiores antes de ejecutar Dijkstra.

## Instalación

1. En Supabase SQL Editor, ejecuta el contenido completo de la migración `202610290003_geotracia_rebuild_road_geometry_auto_topology.sql`.
2. Reemplaza `app/roads.js` por el archivo de este paquete, respetando la ruta.
3. Despliega el sitio y fuerza recarga en el navegador móvil.
4. Ejecuta reconstrucción en vista previa. No se guarda si no se encuentra una ruta continua, si la geometría tiene ciclos o si la longitud difiere más del 25% de la longitud objetivo.

## Seguridad y limitaciones

- La reconstrucción usa la geometría existente como corredor espacial para localizar el catálogo nacional y usa longitud/progresivas para validar la candidata.
- La geometría guardada no se modifica durante la vista previa.
- Si los extremos de la geometría de referencia están mal ubicados, el sistema puede seguir devolviendo `anchors_too_far` o una ruta que requiere revisión. No se debe forzar el guardado para saltarse estas validaciones.
- La migración debe probarse en Supabase real antes de producción; no se ejecutó contra la base de datos del usuario desde este entorno.
