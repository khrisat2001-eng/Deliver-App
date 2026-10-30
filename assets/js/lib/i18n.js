// One localization source: assets/locales/<locale>.json. RTL for ar/ckb, LTR for en.
const META = {
  ar: { dir: 'rtl', fallback: 'en' },
  ckb: { dir: 'rtl', fallback: 'ar' },
  en: { dir: 'ltr', fallback: null },
};
const KEY = 'ride.locale';
let locale = 'ar';
const dicts = {};

function readSaved() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function getLocale() {
  return locale;
}

export async function initI18n() {
  const saved = readSaved();
  const nav = (navigator.language || 'ar').slice(0, 2);
  locale = META[saved] ? saved : nav === 'en' ? 'en' : 'ar';
  await Promise.all(Object.keys(META).map(async (l) => {
    const res = await fetch(new URL(`../../locales/${l}.json`, import.meta.url));
    dicts[l] = await res.json();
  }));
  applyDir();
}

export function setLocale(l) {
  if (!META[l]) return;
  locale = l;
  try { localStorage.setItem(KEY, l); } catch { /* private mode */ }
  applyDir();
}

function applyDir() {
  document.documentElement.lang = locale;
  document.documentElement.dir = META[locale].dir;
}

export function t(key, vars) {
  let l = locale;
  let s;
  while (l && s == null) {
    s = dicts[l]?.[key];
    l = META[l].fallback;
  }
  if (s == null) s = key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`)) : s;
}

/** Pick the current-locale value from a { ar, en, ckb } object. */
export function tr(obj) {
  if (obj == null) return '';
  if (typeof obj === 'string') return obj;
  return obj[locale] ?? obj.ar ?? obj.en ?? Object.values(obj)[0] ?? '';
}
