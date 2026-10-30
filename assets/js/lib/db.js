// Browser "database": one localStorage key per table, synced across tabs via the `storage` event.
// Every write reloads the table first, so two tabs editing different rows don't overwrite each other.
import { buildSeed } from './seed.js';

const PREFIX = 'ride.v1.';
export const TABLES = [
  'settings', 'cities', 'zones', 'vehicleTypes', 'pricingRules', 'surgeRules', 'surgeState', 'commissionRules',
  'cancellation', 'promotions', 'customers', 'drivers', 'trips', 'wallets', 'walletTx', 'tickets', 'sos',
  'notifications', 'audit', 'roles', 'admins', 'payouts', 'payments', 'meta',
];

const memory = new Map(); // fallback when localStorage is blocked
const cache = new Map();
const listeners = new Set();
let storageOk = true;

function rawGet(key) {
  if (storageOk) {
    try { return localStorage.getItem(key); } catch { storageOk = false; }
  }
  return memory.get(key) ?? null;
}

function rawSet(key, value) {
  if (storageOk) {
    try { localStorage.setItem(key, value); return; } catch (e) {
      if (e?.name === 'QuotaExceededError') { trimHistory(); try { localStorage.setItem(key, value); return; } catch { /* fall through */ } }
      storageOk = false;
    }
  }
  memory.set(key, value);
}

function load(table) {
  const raw = rawGet(PREFIX + table);
  try { return raw ? JSON.parse(raw) : undefined; } catch { return undefined; }
}

export function read(table) {
  if (!cache.has(table)) cache.set(table, load(table));
  return cache.get(table);
}

/** Read-modify-write. `fn` mutates the fresh value or returns a replacement. */
export function update(table, fn) {
  const fresh = load(table) ?? read(table);
  const result = fn(fresh);
  const next = result === undefined ? fresh : result;
  cache.set(table, next);
  rawSet(PREFIX + table, JSON.stringify(next));
  emit([table]);
  return next;
}

/**
 * Transaction over several tables. Tables are loaded fresh on first access through `S`
 * and written back together when `fn` returns. If `fn` throws, nothing is written.
 */
export function tx(fn) {
  const loaded = {};
  const S = new Proxy({}, {
    get(_, table) {
      if (!(table in loaded)) loaded[table] = load(table) ?? structuredClone(read(table));
      return loaded[table];
    },
    set(_, table, v) { loaded[table] = v; return true; },
  });
  const result = fn(S);
  for (const [table, v] of Object.entries(loaded)) {
    cache.set(table, v);
    rawSet(PREFIX + table, JSON.stringify(v));
  }
  if (Object.keys(loaded).length) emit(Object.keys(loaded));
  return result;
}

export function write(table, value) {
  return update(table, () => value);
}

export const uid = (p = '') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

/** Update one row in an array table by id. */
export function patch(table, id, fn) {
  let row;
  update(table, (rows) => {
    row = rows.find((r) => r.id === id);
    if (row) fn(row);
  });
  return row;
}

export function insert(table, row) {
  update(table, (rows) => { rows.push(row); });
  return row;
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(tables) {
  for (const fn of listeners) {
    try { fn(tables); } catch (e) { console.error(e); }
  }
}

window.addEventListener('storage', (e) => {
  if (!e.key?.startsWith(PREFIX)) return;
  const table = e.key.slice(PREFIX.length);
  cache.delete(table);
  emit([table]);
});

function trimHistory() {
  // Drop the oldest notifications, audit rows and finished-trip routes to make room.
  for (const [table, keep] of [['notifications', 200], ['audit', 300], ['walletTx', 1500]]) {
    const rows = load(table);
    if (Array.isArray(rows) && rows.length > keep) {
      try { localStorage.setItem(PREFIX + table, JSON.stringify(rows.slice(-keep))); } catch { /* ignore */ }
      cache.delete(table);
    }
  }
  const trips = load('trips');
  if (Array.isArray(trips)) {
    for (const tr of trips.slice(0, -40)) { delete tr.route; delete tr.approach; delete tr.path; }
    try { localStorage.setItem(PREFIX + 'trips', JSON.stringify(trips)); } catch { /* ignore */ }
    cache.delete('trips');
  }
}

export function ensureSeed() {
  const meta = read('meta');
  if (meta?.seededAt) return false;
  resetAll();
  return true;
}

export function resetAll() {
  const seed = buildSeed();
  for (const table of TABLES) {
    cache.set(table, seed[table]);
    rawSet(PREFIX + table, JSON.stringify(seed[table]));
  }
  emit(TABLES);
}

export const persistent = () => storageOk;

// ── Leader election: exactly one open tab runs the dispatcher and the simulation ──
const TAB_ID = uid('tab');
const LEADER_KEY = 'ride.leader';
export function heartbeat() {
  const now = Date.now();
  const hidden = document.hidden;
  let cur = null;
  try { cur = JSON.parse(rawGet(LEADER_KEY) || 'null'); } catch { /* ignore */ }
  // Background tabs get throttled timers, so a visible tab takes over from a hidden leader.
  if (!cur || cur.id === TAB_ID || now - cur.ts > 3500 || (cur.hidden && !hidden)) {
    rawSet(LEADER_KEY, JSON.stringify({ id: TAB_ID, ts: now, hidden }));
    try { cur = JSON.parse(rawGet(LEADER_KEY)); } catch { cur = { id: TAB_ID }; }
  }
  return cur?.id === TAB_ID;
}

window.addEventListener('beforeunload', () => {
  try {
    const cur = JSON.parse(rawGet(LEADER_KEY) || 'null');
    if (cur?.id === TAB_ID) localStorage.removeItem(LEADER_KEY);
  } catch { /* ignore */ }
});
