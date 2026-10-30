// Tiny DOM helpers. User-provided text always goes through textContent, never innerHTML.
import { t, getLocale } from './i18n.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function mount(root, ...children) {
  root.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
}

const numLocale = () => (getLocale() === 'en' ? 'en-US' : 'ar-IQ');

export function money(amount) {
  const n = Math.round(amount ?? 0);
  return t('common.currency_iqd', { amount: n.toLocaleString(numLocale()) });
}

export function num(n, digits = 0) {
  return Number(n ?? 0).toLocaleString(numLocale(), { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function km(m) {
  return t('common.km', { value: num((m ?? 0) / 1000, 1) });
}

export function minutes(s) {
  return t('common.min', { value: num(Math.max(1, Math.round((s ?? 0) / 60))) });
}

export function dateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(getLocale() === 'en' ? 'en-GB' : 'ar-IQ', {
    timeZone: 'Asia/Baghdad', dateStyle: 'short', timeStyle: 'short',
  });
}

export function toast(message, kind = 'info') {
  let box = $('#toasts');
  if (!box) {
    box = h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(box);
  }
  const el = h('div', { class: `toast toast-${kind}` }, message);
  box.append(el);
  setTimeout(() => el.classList.add('out'), 3800);
  setTimeout(() => el.remove(), 4300);
}

/** Modal dialog. `body` is a node; resolves with the value passed to close(). */
export function modal(title, body, actions = []) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'modal' });
    const close = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.append(
      h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { class: 'icon-btn', 'aria-label': t('common.close'), onclick: () => close(null) }, '✕')),
      h('div', { class: 'modal-body' }, body),
      actions.length ? h('div', { class: 'modal-actions' }, actions.map((a) =>
        h('button', { class: `btn ${a.kind ?? ''}`, onclick: () => { const v = a.value ? a.value() : true; if (v !== false) close(v); } }, a.label))) : null,
    );
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function confirmBox(text, okLabel, kind = 'primary') {
  return modal(t('common.confirm'), h('p', {}, text), [
    { label: t('common.cancel'), value: () => null },
    { label: okLabel ?? t('common.confirm'), kind, value: () => true },
  ]);
}

export function promptBox(title, label, initial = '') {
  const input = h('input', { class: 'input', value: initial });
  setTimeout(() => input.focus(), 50);
  return modal(title, h('label', { class: 'field' }, h('span', {}, label), input), [
    { label: t('common.cancel'), value: () => null },
    { label: t('common.save'), kind: 'primary', value: () => input.value.trim() || false },
  ]);
}

export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', {}, label), control, hint ? h('small', { class: 'muted' }, hint) : null);
}

export function select(options, value, onchange, attrs = {}) {
  return h('select', { class: 'input', onchange: (e) => onchange?.(e.target.value), ...attrs },
    options.map(([v, label]) => h('option', { value: v, selected: String(v) === String(value) }, label)));
}

export function badge(text, kind = '') {
  return h('span', { class: `badge ${kind}` }, text);
}

export function stars(n) {
  const r = Math.round(n ?? 0);
  return h('span', { class: 'stars', 'aria-label': `${num(n, 1)} / 5` }, '★'.repeat(r) + '☆'.repeat(5 - r));
}

/** Escape a CSV cell; prefix formula-looking values so spreadsheets don't execute them. */
export function downloadCsv(filename, rows) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\n');
  const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
}

/** Resize an image file to a small JPEG data URL so it fits in localStorage. */
export function fileToThumb(file, max = 320) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export function langSwitcher(onchange) {
  return select([['ar', 'العربية'], ['ckb', 'کوردی'], ['en', 'English']], getLocale(), onchange, { 'aria-label': 'Language', class: 'input lang' });
}
