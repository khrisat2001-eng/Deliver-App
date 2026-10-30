// Map-provider adapter. Uses public OSRM / Nominatim when enabled and reachable,
// and falls back to straight-line estimates so the demo still works offline.
import { haversineM } from '../core/index.js';
import { read } from './db.js';
import { POIS } from './seed.js';
import { getLocale, tr } from './i18n.js';

export const dist = (a, b) => haversineM({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });

async function fetchJson(url, ms = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Insert points so consecutive points are at most `stepM` apart (for smooth movement). */
export function densify(points, stepM = 60) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const d = dist(a, b);
    const n = Math.max(1, Math.ceil(d / stepM));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/** Keep at most `max` points so routes stay small in localStorage. */
function thin(points, max = 220) {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}

export function pathLength(points) {
  let m = 0;
  for (let i = 1; i < points.length; i++) m += dist(points[i - 1], points[i]);
  return m;
}

function fallbackRoute(from, to) {
  const s = read('settings');
  const distanceM = Math.round(dist(from, to) * 1.3);
  // a gentle bend so the straight line reads as a road on the map
  const mid = [(from[0] + to[0]) / 2 + (to[1] - from[1]) * 0.08, (from[1] + to[1]) / 2 - (to[0] - from[0]) * 0.08];
  return { distanceM, durationS: Math.round(distanceM / s.fallbackSpeedMps), points: [from, mid, to], source: 'estimate' };
}

/** Driving route between [lat,lng] points. */
export async function route(from, to) {
  const s = read('settings');
  if (s.useOsrm && navigator.onLine !== false) {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;
      const j = await fetchJson(url, 5000);
      const r = j.routes?.[0];
      if (r) {
        const points = thin(r.geometry.coordinates.map(([lng, lat]) => [lat, lng]));
        // OSRM's free-flow durations are optimistic for Iraqi city traffic
        return { distanceM: Math.round(r.distance), durationS: Math.round(r.duration * 1.35), points, source: 'osrm' };
      }
    } catch { /* fall back */ }
  }
  return fallbackRoute(from, to);
}

/** Search places: local landmarks first, then OpenStreetMap Nominatim. */
export async function searchPlaces(query, cityId) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const local = POIS.filter((p) => Object.values(p.name).some((n) => n.toLowerCase().includes(q)))
    .sort((a, b) => (a.cityId === cityId ? -1 : 0) - (b.cityId === cityId ? -1 : 0))
    .map((p) => ({ title: tr(p.name), subtitle: tr(read('cities').find((c) => c.id === p.cityId)?.name), lat: p.lat, lng: p.lng }));
  const s = read('settings');
  if (!s.useNominatim) return local;
  try {
    const city = read('cities').find((c) => c.id === cityId);
    const [lat, lng] = city?.center ?? [33.3, 44.4];
    const box = [lng - 0.4, lat + 0.3, lng + 0.4, lat - 0.3].join(',');
    const lang = getLocale() === 'ckb' ? 'ckb,ar' : getLocale();
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=iq&accept-language=${lang}&viewbox=${box}&q=${encodeURIComponent(query)}`;
    const rows = await fetchJson(url, 6000);
    return [...local, ...rows.map((r) => ({ title: r.name || r.display_name.split(',')[0], subtitle: r.display_name, lat: Number(r.lat), lng: Number(r.lon) }))];
  } catch {
    return local;
  }
}

let lastReverse = 0;
/** Short address for a point; rate-limited to respect Nominatim's 1 request/second policy. */
export async function reverseGeocode(p) {
  const s = read('settings');
  const fallback = `${p[0].toFixed(4)}, ${p[1].toFixed(4)}`;
  const near = POIS.find((x) => dist(p, [x.lat, x.lng]) < 250);
  if (near) return tr(near.name);
  if (!s.useNominatim || Date.now() - lastReverse < 1100) return fallback;
  lastReverse = Date.now();
  try {
    const lang = getLocale() === 'ckb' ? 'ckb,ar' : getLocale();
    const j = await fetchJson(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&accept-language=${lang}&lat=${p[0]}&lon=${p[1]}`, 5000);
    const a = j.address ?? {};
    return [a.road, a.neighbourhood || a.suburb || a.quarter, a.city || a.town].filter(Boolean).slice(0, 2).join('، ') || j.display_name || fallback;
  } catch {
    return fallback;
  }
}

export function nearestCity(p) {
  const cities = read('cities').filter((c) => c.active);
  return cities.reduce((best, c) => (dist(p, c.center) < dist(p, best.center) ? c : best), cities[0]);
}

/** Zones containing a point, highest priority first (airport > downtown > standard). */
export function zonesAt(p, cityId) {
  const rank = { airport: 3, downtown: 2, standard: 1 };
  return read('zones')
    .filter((z) => z.active && z.cityId === cityId && dist(p, z.center) <= z.radiusM)
    .sort((a, b) => rank[b.kind] - rank[a.kind]);
}

/** Move along a polyline. Returns the new position and progress. */
export function advance(points, progress, meters) {
  let { idx, frac } = progress;
  let left = meters;
  while (idx < points.length - 1 && left > 0) {
    const seg = dist(points[idx], points[idx + 1]);
    const remain = seg * (1 - frac);
    if (left >= remain) { left -= remain; idx++; frac = 0; } else { frac += left / seg; left = 0; }
  }
  const done = idx >= points.length - 1;
  const a = points[Math.min(idx, points.length - 1)];
  const b = points[Math.min(idx + 1, points.length - 1)];
  const pos = done ? points[points.length - 1] : [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac];
  const heading = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  return { pos, progress: { idx, frac }, done, moved: meters - left, heading };
}

export function remainingM(points, progress) {
  if (!points?.length) return 0;
  const { idx, frac } = progress;
  if (idx >= points.length - 1) return 0;
  let m = dist(points[idx], points[idx + 1]) * (1 - frac);
  for (let i = idx + 1; i < points.length - 1; i++) m += dist(points[i], points[i + 1]);
  return m;
}

export const googleMapsLink = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p[0]},${p[1]}&travelmode=driving`;
