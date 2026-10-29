# Reconstrucción automática vial — Geotracia

Esta versión usa los datos ya registrados del camino. El operador no ingresa coordenadas.

## Instalación
1. Ejecuta en Supabase SQL Editor el archivo `supabase/migrations/202610290002_geotracia_rebuild_road_geometry_auto.sql`.
2. Despliega `roads.js` junto con el resto de la aplicación.
3. En Caminos y tramos, selecciona el camino y pulsa **Reconstruir camino**.
4. Revisa la vista previa antes de confirmar el guardado.

La función utiliza nombre, código/referencia, progresivas, longitud declarada y geometría existente como corredor espacial. La geometría registrada se conserva si faltan datos, no hay ruta conectada, la ruta contiene ciclos o la longitud candidata difiere demasiado de la longitud objetivo.

Importante: ejecutar primero en entorno de prueba. El algoritmo depende de la calidad y cobertura de `geotracia_national_roads`; una candidata debe revisarse en el mapa antes de aplicarla.
