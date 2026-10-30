// Leaflet + OpenStreetMap tiles (no API key needed). Leaflet is vendored in assets/vendor and loaded as a global.
const L = window.L;

export function createMap(el, center, zoom = 13) {
  const map = L.map(el, { zoomControl: false, attributionControl: true }).setView(center, zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, subdomains: 'abc', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  return map;
}

function div(cls, html, size = 34) {
  return L.divIcon({ className: '', html: `<div class="mk ${cls}">${html}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

export const icons = {
  car: (state = 'online') => div(`mk-car mk-${state}`, '🚗', 30),
  pickup: () => L.divIcon({ className: '', html: '<div class="mk-pin mk-pin-a"></div>', iconSize: [26, 36], iconAnchor: [13, 34] }),
  dropoff: () => L.divIcon({ className: '', html: '<div class="mk-pin mk-pin-b"></div>', iconSize: [26, 36], iconAnchor: [13, 34] }),
  request: () => div('mk-req', '🙋', 28),
  sos: () => div('mk-sos', 'SOS', 40),
};

/** Keep a set of markers in sync with a list of items keyed by id. */
export function markerLayer(map) {
  const markers = new Map();
  const group = L.layerGroup().addTo(map);
  return {
    sync(items) {
      const seen = new Set();
      for (const it of items) {
        seen.add(it.id);
        let m = markers.get(it.id);
        if (!m) {
          m = L.marker(it.pos, { icon: it.icon, keyboard: false }).addTo(group);
          if (it.onclick) m.on('click', it.onclick);
          markers.set(it.id, m);
          m._iconKey = it.iconKey;
        } else {
          m.setLatLng(it.pos);
          if (it.iconKey !== m._iconKey) { m.setIcon(it.icon); m._iconKey = it.iconKey; }
        }
        if (it.tooltip) m.bindTooltip(it.tooltip, { direction: 'top', offset: [0, -14] });
      }
      for (const [id, m] of markers) if (!seen.has(id)) { group.removeLayer(m); markers.delete(id); }
    },
    clear() { group.clearLayers(); markers.clear(); },
  };
}

export function polyline(map, points, cls = 'route') {
  return L.polyline(points, { className: `line-${cls}`, weight: cls === 'route' ? 5 : 4, opacity: 0.9 }).addTo(map);
}

export function circle(map, center, radius, cls = 'zone') {
  return L.circle(center, { radius, className: `circle-${cls}`, weight: 1.5 }).addTo(map);
}

export function fit(map, points, pad = 60) {
  if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [pad, pad], maxZoom: 16 });
}

export { L };
