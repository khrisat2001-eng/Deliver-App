import { initI18n, t, setLocale } from './i18n.js';
import { ensureSeed, heartbeat, onChange, read, persistent } from './db.js';
import { startLoop, AppError } from './engine.js';
import { toast, money, h } from './ui.js';

let leader = false;

// ── Installable app (PWA) ──
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });

export function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
}

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/** "Install the app" card for the account tab; null when already installed. */
export function installCard() {
  if (isStandalone()) return null;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return h('div', { class: 'card col' }, h('h3', {}, '📲 ', t('pwa.title')),
    h('p', { class: 'text-2' }, t(ios ? 'pwa.ios_hint' : 'pwa.text')),
    ios ? null : h('button', { class: 'btn primary', onclick: async () => {
      if (!deferredInstall) { toast(t('pwa.manual_hint')); return; }
      deferredInstall.prompt();
      await deferredInstall.userChoice;
      deferredInstall = null;
    } }, t('pwa.install')));
}
export const isLeader = () => leader;

/** Load translations, seed the demo database on first visit and start the shared simulation loop. */
export async function boot() {
  await initI18n();
  registerServiceWorker();
  const seeded = ensureSeed();
  leader = heartbeat();
  setInterval(() => { leader = heartbeat(); }, 1000);
  startLoop(isLeader);
  if (!persistent()) toast(t('common.no_storage'), 'error');
  return { seeded };
}

export function showError(e) {
  if (e instanceof AppError) toast(t(e.key, formatVars(e.vars)), 'error');
  else { console.error(e); toast(t('err.generic'), 'error'); }
}

/** Run an action and toast any error. Returns the action's result, or undefined on error. */
export function attempt(fn) {
  try {
    const r = fn();
    if (r instanceof Promise) return r.catch((e) => { showError(e); });
    return r;
  } catch (e) {
    showError(e);
    return undefined;
  }
}

function formatVars(vars = {}) {
  const out = { ...vars };
  for (const k of ['amount', 'fee']) if (typeof out[k] === 'number') out[k] = money(out[k]);
  return out;
}

export function notificationText(n) {
  if (n.key === 'notify.broadcast') return `${n.vars.title}: ${n.vars.body}`;
  const vars = formatVars(n.vars);
  if (n.key === 'notify.trip_cancelled') return t(n.vars.fee ? 'notify.trip_cancelled_fee' : 'notify.trip_cancelled', vars);
  if (n.key === 'notify.account_status') vars.status = t(`customerStatus.${n.vars.status}`);
  return t(n.key, vars);
}

/** Toast notifications addressed to `userKey` that arrive while the page is open. */
export function watchNotifications(getUserKey, onNew) {
  let seen = Date.now();
  onChange((tables) => {
    if (!tables.includes('notifications')) return;
    const key = getUserKey();
    if (!key) return;
    const fresh = (read('notifications') ?? []).filter((n) => n.to === key && n.ts > seen);
    if (fresh.length) {
      seen = Math.max(...fresh.map((n) => n.ts));
      for (const n of fresh.slice(-2)) toast(notificationText(n));
      onNew?.();
    }
  });
}

/** Coalesce bursts of change events into one call per animation frame, with the union of changed tables. */
export function relayout(fn) {
  let pending = null;
  return (tables = []) => {
    if (pending) { for (const t0 of tables) pending.add(t0); return; }
    pending = new Set(tables);
    requestAnimationFrame(() => { const set = pending; pending = null; fn([...set]); });
  };
}

export function changeLanguage(l) {
  setLocale(l);
  location.reload();
}

export function demoBanner() {
  return h('div', { class: 'notice' }, t('common.demo_banner'));
}

export const initials = (name = '?') => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('');

export function readSession(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function writeSession(key, value) {
  try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* ignore */ }
}
