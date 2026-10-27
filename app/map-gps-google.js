/* GEOTRACIA · Google Maps independiente para mediciones manuales de caminos.
 * No sustituye Leaflet/OSM ni consulta, altera o elimina la red vial existente.
 * Las longitudes se calculan geodésicamente con Google Maps Geometry library.
 */
(() => {
  'use strict';
  if (window.__geotraciaGoogleMeasureInstalled) return;
  window.__geotraciaGoogleMeasureInstalled = true;

  const state = {
    map: null,
    mapElement: null,
    loaderPromise: null,
    measuring: false,
    currentPath: [],
    currentMarkers: [],
    currentLine: null,
    measurements: [],
    nextId: 1,
    listeners: []
  };

  const API_KEY = () => String(window.GEOTRACIA_GOOGLE_MAPS_API_KEY || '').trim();
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const fmtMeters = value => {
    const meters = Number(value) || 0;
    if (meters >= 1000) return `${new Intl.NumberFormat('es-CL', {minimumFractionDigits: 3, maximumFractionDigits: 3}).format(meters / 1000)} km`;
    return `${new Intl.NumberFormat('es-CL', {maximumFractionDigits: 1}).format(meters)} m`;
  };

  function status(message, isError = false) {
    const element = $('#geoGoogleMapStatus');
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('is-error', isError);
  }

  function ensureUi() {
    const mapElement = $('#geoLeafletMap');
    if (!mapElement) return null;
    const panel = mapElement.closest('.geo-map-layout > .panel');
    if (!panel) return null;
    if ($('#geoGoogleMeasurePanel', panel)) return panel;

    const header = $('.panel-head', panel);
    if (!header) return null;

    const tabs = document.createElement('div');
    tabs.className = 'geo-map-provider-switch';
    tabs.setAttribute('role', 'group');
    tabs.setAttribute('aria-label', 'Proveedor cartográfico');
    tabs.innerHTML = `
      <button type="button" class="geo-map-provider-button is-active" data-geo-map-provider="current" aria-pressed="true">Mapa actual · OSM / MOP</button>
      <button type="button" class="geo-map-provider-button" data-geo-map-provider="google" aria-pressed="false">Google Maps · Medir caminos</button>`;
    header.insertAdjacentElement('afterend', tabs);

    const googlePanel = document.createElement('div');
    googlePanel.className = 'geo-google-measure-panel';
    googlePanel.id = 'geoGoogleMeasurePanel';
    googlePanel.hidden = true;
    googlePanel.innerHTML = `
      <div id="geoGoogleMapStatus" class="geo-google-measure-live" role="status" aria-live="polite">Google Maps se cargará al activar esta vista.</div>
      <div id="geoGoogleConfigHelp" class="geo-google-config-help" hidden>
        <h3>Configurar Google Maps Platform</h3>
        <p>La nueva capa ya está integrada en la aplicación, pero requiere una clave API válida para mostrar el mapa.</p>
        <p>1. En Google Cloud Console, habilita <b>Maps JavaScript API</b> y la facturación del proyecto.</p>
        <p>2. Restringe la clave por HTTP referrer a los dominios autorizados de Geotracia.</p>
        <p>3. Añade la clave en <code>google-maps-config.js</code>, en la variable <code>GEOTRACIA_GOOGLE_MAPS_API_KEY</code>, y vuelve a desplegar.</p>
        <p>No hace falta habilitar Routes API para las mediciones manuales de esta vista.</p>
      </div>
      <div id="geoGoogleMapToolbar" class="geo-google-measure-toolbar" hidden>
        <button type="button" class="btn primary" data-geo-measure="start">＋ Nueva medición</button>
        <button type="button" class="btn" data-geo-measure="undo" disabled>↶ Deshacer punto</button>
        <button type="button" class="btn" data-geo-measure="finish" disabled>✓ Finalizar tramo</button>
        <button type="button" class="btn" data-geo-measure="clear">Limpiar mediciones</button>
        <button type="button" class="btn" data-geo-measure="export">↓ Exportar CSV</button>
      </div>
      <div id="geoGoogleMapCanvas" class="geo-google-measure-map" aria-label="Google Maps para medir trazados de caminos" hidden></div>
      <div id="geoGoogleMeasureResults" class="geo-google-measure-results" hidden>
        <div class="geo-google-measure-results-head"><h3>Mediciones de esta sesión</h3><span id="geoGoogleMeasureTotal" class="geo-google-measure-total">Total: 0 m</span></div>
        <ul id="geoGoogleMeasureList" class="geo-google-measure-list"><li class="geo-google-measure-empty">Todavía no hay tramos medidos.</li></ul>
      </div>
      <p class="geo-google-measure-footnote">La longitud se calcula sobre la línea que dibujas al marcar puntos consecutivos. Para seguir curvas del camino, marca suficientes puntos sobre su eje. Esta medición no equivale a una ruta automática ajustada a la red vial ni se guarda en Supabase.</p>`;
    mapElement.insertAdjacentElement('afterend', googlePanel);
    return panel;
  }

  function setProvider(provider) {
    const panel = ensureUi();
    if (!panel) return;
    const currentMap = $('#geoLeafletMap', panel);
    const googlePanel = $('#geoGoogleMeasurePanel', panel);
    const legend = $('.geo-map-legend', panel);
    const attribution = $('.geo-map-attribution', panel);
    const googleMode = provider === 'google';
    const subtitle = $('.panel-head .sub', panel);
    if (subtitle) subtitle.textContent = googleMode ? 'Google Maps · medición manual de trazados' : 'Cartografía de OpenStreetMap y consultas OSM/MOP';

    if (currentMap) currentMap.hidden = googleMode;
    if (legend) legend.hidden = googleMode;
    if (attribution) attribution.hidden = googleMode;
    if (googlePanel) googlePanel.hidden = !googleMode;
    $$('[data-geo-map-provider]', panel).forEach(button => {
      const selected = button.dataset.geoMapProvider === provider;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });

    if (!googleMode) {
      window.__geotraciaMapGpsMap?.invalidateSize?.({pan: false});
      window.dispatchEvent(new Event('resize'));
      return;
    }
    initGoogleMap().catch(error => {
      console.error('[GEOTRACIA Google Maps]', error);
      showConfigurationError(error?.message || 'No se pudo cargar Google Maps. Revisa la clave API y la configuración del proyecto.');
    });
    window.setTimeout(() => state.map?.setOptions?.({gestureHandling: 'greedy'}), 120);
  }

  function showConfigurationError(message) {
    const help = $('#geoGoogleConfigHelp');
    const canvas = $('#geoGoogleMapCanvas');
    const toolbar = $('#geoGoogleMapToolbar');
    if (help) help.hidden = false;
    if (canvas) canvas.hidden = true;
    if (toolbar) toolbar.hidden = true;
    status(message, true);
  }

  function loadGoogleMaps() {
    if (window.google?.maps?.geometry?.spherical) return Promise.resolve(window.google.maps);
    if (state.loaderPromise) return state.loaderPromise;
    const key = API_KEY();
    if (!key) return Promise.reject(new Error('Falta configurar la clave API de Google Maps en google-maps-config.js.'));

    window.gm_authFailure = () => showConfigurationError('Google rechazó la clave API. Revisa Maps JavaScript API, las restricciones por dominio y la facturación.');
    state.loaderPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-geotracia-google-maps-loader]');
      if (existing) {
        existing.addEventListener('load', () => window.google?.maps?.geometry?.spherical ? resolve(window.google.maps) : reject(new Error('Google Maps cargó sin la biblioteca geometry.')),{once:true});
        existing.addEventListener('error', () => reject(new Error('No se pudo cargar Google Maps. Revisa la clave API, las APIs habilitadas y la conexión.')),{once:true});
        return;
      }
      const script = document.createElement('script');
      script.dataset.geotraciaGoogleMapsLoader = 'true';
      script.async = true;
      script.defer = true;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&libraries=geometry&loading=async`;
      script.onload = () => window.google?.maps?.geometry?.spherical
        ? resolve(window.google.maps)
        : reject(new Error('Google Maps cargó sin la biblioteca geometry. Revisa la configuración de la API.'));
      script.onerror = () => reject(new Error('No se pudo cargar Google Maps. Revisa la clave API, las APIs habilitadas y la conexión.'));
      document.head.appendChild(script);
    }).catch(error => {
      state.loaderPromise = null;
      document.querySelector('script[data-geotracia-google-maps-loader]')?.remove();
      throw error;
    });
    return state.loaderPromise;
  }

  async function initGoogleMap() {
    ensureUi();
    const help = $('#geoGoogleConfigHelp');
    const canvas = $('#geoGoogleMapCanvas');
    const toolbar = $('#geoGoogleMapToolbar');
    if (!canvas) return;
    if (state.map && state.mapElement === canvas && window.google?.maps?.geometry?.spherical) {
      canvas.hidden = false;
      if (help) help.hidden = true;
      if (toolbar) toolbar.hidden = false;
      window.google.maps.event.trigger(state.map, 'resize');
      return;
    }
    status('Conectando con Google Maps…');
    const maps = await loadGoogleMaps();
    canvas.hidden = false;
    if (help) help.hidden = true;
    if (toolbar) toolbar.hidden = false;

    state.map = new maps.Map(canvas, {
      center: {lat: -38.7359, lng: -72.5904},
      zoom: 11,
      mapTypeId: 'roadmap',
      mapTypeControl: true,
      mapTypeControlOptions: {style: maps.MapTypeControlStyle.HORIZONTAL_BAR, position: maps.ControlPosition.TOP_RIGHT},
      fullscreenControl: true,
      streetViewControl: true,
      clickableIcons: false,
      gestureHandling: 'greedy'
    });
    state.mapElement = canvas;
    state.currentPath = [];
    state.currentMarkers = [];
    state.currentLine = new maps.Polyline({map: state.map, path: [], geodesic: true, strokeColor: '#087f8c', strokeOpacity: 0.95, strokeWeight: 4, clickable: false});
    state.map.addListener('click', event => {
      if (!state.measuring || !event.latLng) return;
      addPoint({lat: event.latLng.lat(), lng: event.latLng.lng()});
    });
    updateControls();
    renderMeasurements();
    status('Google Maps listo. Pulsa “Nueva medición” y luego marca puntos consecutivos sobre el eje del camino.');
    window.setTimeout(() => maps.event.trigger(state.map, 'resize'), 150);
  }

  function lineLength(coords) {
    if (!window.google?.maps?.geometry?.spherical || coords.length < 2) return 0;
    const path = coords.map(point => new google.maps.LatLng(point.lat, point.lng));
    return google.maps.geometry.spherical.computeLength(path);
  }

  function addPoint(point) {
    if (!state.map || !window.google?.maps) return;
    state.currentPath.push({lat: Number(point.lat), lng: Number(point.lng)});
    const marker = new google.maps.Marker({
      position: point,
      map: state.map,
      title: `Punto ${state.currentPath.length}`,
      label: {text: String(state.currentPath.length), color: '#ffffff', fontSize: '10px', fontWeight: '700'},
      icon: {path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#087f8c', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2},
      zIndex: 1000 + state.currentPath.length
    });
    state.currentMarkers.push(marker);
    state.currentLine.setPath(state.currentPath);
    const meters = lineLength(state.currentPath);
    status(`${state.currentPath.length} punto(s) · Longitud provisional: ${fmtMeters(meters)}. Sigue marcando el trazado o finaliza el tramo.`);
    updateControls();
  }

  function startMeasurement() {
    if (!state.map) return;
    clearCurrentPath();
    state.measuring = true;
    status('Medición activa: marca el primer punto y continúa siguiendo las curvas del camino.');
    state.map.setOptions({draggableCursor: 'crosshair'});
    updateControls();
  }

  function finishMeasurement() {
    if (!state.measuring || state.currentPath.length < 2) {
      status('Marca al menos dos puntos para calcular la longitud.', true);
      return;
    }
    const coords = state.currentPath.map(point => ({lat: point.lat, lng: point.lng}));
    const meters = lineLength(coords);
    const line = new google.maps.Polyline({map: state.map, path: coords, geodesic: true, strokeColor: '#1769ee', strokeOpacity: 0.95, strokeWeight: 4, clickable: true});
    line.addListener('click', () => {
      const bounds = new google.maps.LatLngBounds();
      coords.forEach(point => bounds.extend(point));
      state.map.fitBounds(bounds, 40);
    });
    const markers = state.currentMarkers.slice();
    const measurement = {id: state.nextId++, name: `Tramo ${state.nextId - 1}`, coords, meters, line, markers};
    state.measurements.push(measurement);
    state.currentMarkers = [];
    state.currentPath = [];
    state.currentLine?.setPath([]);
    state.measuring = false;
    state.map.setOptions({draggableCursor: null});
    renderMeasurements();
    updateControls();
    status(`${measurement.name} finalizado: ${fmtMeters(meters)}. La longitud corresponde al trazado marcado.`);
  }

  function clearCurrentPath() {
    state.currentMarkers.forEach(marker => marker.setMap(null));
    state.currentMarkers = [];
    state.currentPath = [];
    if (state.currentLine) state.currentLine.setPath([]);
  }

  function undoPoint() {
    if (!state.currentPath.length) return;
    state.currentPath.pop();
    const marker = state.currentMarkers.pop();
    marker?.setMap(null);
    state.currentLine?.setPath(state.currentPath);
    status(state.currentPath.length ? `${state.currentPath.length} punto(s) · Longitud provisional: ${fmtMeters(lineLength(state.currentPath))}.` : 'No hay puntos marcados.');
    updateControls();
  }

  function clearAll() {
    clearCurrentPath();
    state.measurements.forEach(item => {
      item.line?.setMap(null);
      item.markers?.forEach(marker => marker.setMap(null));
    });
    state.measurements = [];
    state.measuring = false;
    state.map?.setOptions({draggableCursor: null});
    renderMeasurements();
    updateControls();
    status('Se limpiaron las mediciones de esta sesión.');
  }

  function renderMeasurements() {
    const list = $('#geoGoogleMeasureList');
    const results = $('#geoGoogleMeasureResults');
    const totalElement = $('#geoGoogleMeasureTotal');
    if (!list || !results || !totalElement) return;
    const total = state.measurements.reduce((sum, item) => sum + item.meters, 0);
    totalElement.textContent = `Total: ${fmtMeters(total)}`;
    results.hidden = false;
    if (!state.measurements.length) {
      list.innerHTML = '<li class="geo-google-measure-empty">Todavía no hay tramos finalizados. Las mediciones se mantienen en esta sesión.</li>';
      return;
    }
    list.innerHTML = state.measurements.map(item => `
      <li class="geo-google-measure-item">
        <div class="geo-google-measure-item-copy"><b>${esc(item.name)} · ${esc(fmtMeters(item.meters))}</b><small>${item.coords.length} puntos · longitud geodésica de la polilínea dibujada</small></div>
        <div class="geo-google-measure-item-actions"><button type="button" data-geo-measure="focus" data-measure-id="${item.id}">Ver tramo</button><button type="button" data-geo-measure="delete" data-measure-id="${item.id}">Eliminar</button></div>
      </li>`).join('');
  }

  function updateControls() {
    const panel = $('#geoGoogleMeasurePanel');
    if (!panel) return;
    const undo = $('[data-geo-measure="undo"]', panel);
    const finish = $('[data-geo-measure="finish"]', panel);
    const start = $('[data-geo-measure="start"]', panel);
    const clear = $('[data-geo-measure="clear"]', panel);
    const exportButton = $('[data-geo-measure="export"]', panel);
    if (undo) undo.disabled = !state.measuring || state.currentPath.length === 0;
    if (finish) finish.disabled = !state.measuring || state.currentPath.length < 2;
    if (start) start.disabled = state.measuring;
    if (clear) clear.disabled = !state.measurements.length && !state.currentPath.length;
    if (exportButton) exportButton.disabled = !state.measurements.length;
  }

  function focusMeasurement(id) {
    const item = state.measurements.find(measurement => measurement.id === Number(id));
    if (!item || !state.map || !window.google?.maps) return;
    const bounds = new google.maps.LatLngBounds();
    item.coords.forEach(point => bounds.extend(point));
    state.map.fitBounds(bounds, 40);
  }

  function deleteMeasurement(id) {
    const index = state.measurements.findIndex(measurement => measurement.id === Number(id));
    if (index < 0) return;
    const [item] = state.measurements.splice(index, 1);
    item.line?.setMap(null);
    item.markers?.forEach(marker => marker.setMap(null));
    renderMeasurements();
    updateControls();
    status(`${item.name} eliminado de esta sesión.`);
  }

  function exportCsv() {
    if (!state.measurements.length) {
      status('No hay mediciones finalizadas para exportar.', true);
      return;
    }
    const rows = [['tramo', 'longitud_m', 'longitud_km', 'orden_punto', 'latitud', 'longitud']];
    state.measurements.forEach(item => item.coords.forEach((point, index) => rows.push([
      item.name, item.meters.toFixed(2), (item.meters / 1000).toFixed(6), index + 1, point.lat.toFixed(7), point.lng.toFixed(7)
    ])));
    const csv = '\uFEFF' + rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'}));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'geotracia-mediciones-google-maps.csv';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    status('CSV exportado. Incluye longitud total y coordenadas de cada punto del trazado.');
  }

  document.addEventListener('click', event => {
    const providerButton = event.target.closest('[data-geo-map-provider]');
    if (providerButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setProvider(providerButton.dataset.geoMapProvider);
      return;
    }
    const measureButton = event.target.closest('[data-geo-measure]');
    if (!measureButton || !$('#geoGoogleMeasurePanel')?.contains(measureButton)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const action = measureButton.dataset.geoMeasure;
    if (action === 'start') startMeasurement();
    else if (action === 'undo') undoPoint();
    else if (action === 'finish') finishMeasurement();
    else if (action === 'clear') clearAll();
    else if (action === 'export') exportCsv();
    else if (action === 'focus') focusMeasurement(measureButton.dataset.measureId);
    else if (action === 'delete') deleteMeasurement(measureButton.dataset.measureId);
  }, true);

  const observer = new MutationObserver(() => {
    if ($('#geoLeafletMap')) {
      ensureUi();
      return;
    }
    // El módulo Mapa y GPS se desmontó: limpiar las líneas del mapa anterior,
    // ya que las mediciones son de sesión y no deben aparentar estar guardadas.
    if (state.mapElement && !state.mapElement.isConnected) {
      state.measurements.forEach(item => item.line?.setMap(null));
      state.currentMarkers.forEach(marker => marker.setMap(null));
      state.currentLine?.setMap(null);
      state.map = null;
      state.mapElement = null;
      state.currentPath = [];
      state.currentMarkers = [];
      state.currentLine = null;
      state.measurements = [];
      state.measuring = false;
      state.nextId = 1;
    }
  });
  observer.observe(document.documentElement, {childList: true, subtree: true});
})();
