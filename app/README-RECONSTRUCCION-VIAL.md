# Reconstrucción vial entre dos puntos (V1)

## Cambios incluidos
- `roads.js`: el botón Reconstruir abre un formulario con coordenadas de inicio y término, ancho de corredor y distancia máxima de ajuste.
- La primera llamada genera vista previa (`p_apply=false`) y dibuja la ruta candidata en violeta.
- El usuario debe revisar la ruta y confirmar antes de volver a llamar la RPC con `p_apply=true`.
- La geometría existente no se modifica en la vista previa.
- Migración SQL: `supabase/migrations/202610290001_geotracia_rebuild_route_between_points.sql`.

## Instalación
1. Respaldar la base de datos y el ZIP actual.
2. Ejecutar la migración SQL en Supabase SQL Editor.
3. Desplegar los archivos web actualizados.
4. Abrir Caminos y tramos, seleccionar un camino y pulsar Reconstruir camino.
5. Revisar coordenadas de inicio/término; pueden editarse. Pulsar Calcular vista previa.
6. Revisar la línea violeta y las distancias de ajuste. Solo si el trazado es correcto, pulsar Validar y guardar.

## Consideraciones
- La función nueva coexiste con `geotracia_rebuild_road_geometry`; no elimina ni reemplaza la función anterior.
- Las coordenadas iniciales se sugieren a partir de los extremos de la geometría almacenada. Si esa geometría está mal, corríjalas antes de calcular.
- El grafo se crea con los segmentos dentro de un corredor espacial; un corredor demasiado estrecho puede omitir conexiones y uno demasiado ancho puede incluir alternativas.
- Esta versión necesita validación en la base de datos real y no garantiza por sí sola que el camino elegido sea el oficial. No usar `p_apply=true` sin revisar la vista previa.
