# Geotracia FIX 4 — selección vial

## Qué cambia
- Sustituye la función `public.geotracia_rebuild_road_geometry_auto(uuid, boolean)`.
- Usa el nombre exacto de la vía como señal principal, la referencia vial como señal secundaria y penaliza otros caminos.
- Reduce el corredor de búsqueda a 900 m alrededor de la geometría registrada.
- Penaliza los segmentos que se alejan de la geometría de referencia.
- Rechaza extremos que deban ajustarse a más de 250 m.
- Conserva la vista previa y no guarda automáticamente.

## Instalación
1. Ejecutar el SQL completo en Supabase SQL Editor.
2. No reemplaza archivos de interfaz; el módulo actual ya llama a esta función RPC.
3. Probar con `p_apply=false` desde Geotracia y revisar el trazado antes de confirmar el guardado.

## Alcance
Esta migración no se ha ejecutado contra la base real del proyecto. Valida la lógica de selección, pero el resultado debe comprobarse en el mapa antes de guardarse.
