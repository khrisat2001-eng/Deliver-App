// Admin dashboard
import { boot, attempt, readSession, writeSession, changeLanguage, relayout, initials } from './lib/common.js';
import { t, tr } from './lib/i18n.js';
import { h, mount, money, km, minutes, num, dateTime, toast, modal, confirmBox, field, select, badge, stars, langSwitcher, downloadCsv } from './lib/ui.js';
import { read, onChange, resetAll, uid } from './lib/db.js';
import * as E from './lib/engine.js';
import { createMap, icons, markerLayer, polyline, circle, fit, L } from './lib/map.js';
import { dist } from './lib/geo.js';
import { DOC_TYPES, PERMISSIONS } from './lib/seed.js';
import { CATEGORIES, TICKET_KIND } from './lib/support.js';
import { barChart } from './lib/chart.js';
import { calculateFare, cancellationRate } from './core/index.js';

const SKEY = 'ride.session.admin';
const st = { role: readSession(SKEY), page: 'dashboard', filters: {} };
const admin = () => (st.role && read('roles')[st.role] ? { role: st.role } : null);
const can = (p) => E.can(admin(), p);
let root; let els = {}; let cleanup = [];

const NAV = [
  ['overview', [['dashboard', '📊', 'dashboard.view'], ['livemap', '🗺️', 'livemap.view']]],
  ['operations', [['approvals', '🪪', 'drivers.approve'], ['drivers', '🧑‍✈️', 'drivers.view'], ['customers', '👥', 'customers.view'], ['trips', '🧾', 'trips.view'], ['sos', '🆘', 'sos.handle'], ['tickets', '🎧', 'tickets.view']]],
  ['pricingGroup', [['geo', '🏙️', 'cities.manage'], ['vehicles', '🚙', 'vehicle_types.manage'], ['pricing', '💲', 'pricing.update'], ['surge', '⚡', 'surge.override'], ['commission', '％', 'commission.update'], ['cancellation', '⛔', 'cancellation_policy.update'], ['promotions', '🏷️', 'promotions.manage']]],
  ['financeGroup', [['finance', '💰', 'payments.view'], ['payouts', '🏦', 'payouts.approve']]],
  ['analytics', [['reports', '📈', 'reports.operations']]],
  ['system', [['broadcast', '📣', 'notifications.broadcast'], ['roles', '🔐', 'roles.manage'], ['audit', '📜', 'audit.view'], ['settings', '⚙️', 'settings.manage']]],
];

function start() {
  if (!admin()) return renderLogin();
  renderShell();
}

function renderLogin() {
  const roles = read('roles');
  let role = 'SUPER_ADMIN';
  mount(root, h('div', { class: 'landing', style: { maxWidth: '460px' } },
    h('div', { class: 'card col', style: { marginTop: '8vh' } },
      h('div', { class: 'center' }, h('div', { style: { fontSize: '2.6rem' } }, '🛡️'), h('h1', {}, t('app.admin'))),
      h('div', { class: 'notice' }, t('admin.demo_login')),
      field(t('admin.role'), select(Object.entries(roles).map(([k, r]) => [k, tr(r.name)]), role, (v) => { role = v; })),
      h('button', { class: 'btn primary lg block', onclick: () => { st.role = role; writeSession(SKEY, role); E.adminAudit({ role }, 'admin.login', 'admin', role); renderShell(); } }, t('admin.sign_in')),
      h('div', { class: 'row between' }, h('a', { href: './' }, `← ${t('app.home')}`), langSwitcher(changeLanguage)))));
}

function renderShell() {
  els.side = h('aside', { class: 'side' });
  els.main = h('main', { class: 'main' });
  mount(root, h('div', { class: 'admin' }, els.side, els.main));
  const first = NAV.flatMap(([, items]) => items).find(([, , p]) => can(p));
  if (!NAV.flatMap(([, i]) => i).some(([id, , p]) => id === st.page && can(p))) st.page = first?.[0] ?? 'dashboard';
  renderSide();
  renderPage();
  onChange(relayout((tables) => liveRefresh(tables)));
}

function renderSide() {
  mount(els.side,
    h('div', { class: 'brand' }, '🚕', t('app.name')),
    NAV.map(([group, items]) => {
      const visible = items.filter(([, , p]) => can(p));
      if (!visible.length) return null;
      return [h('div', { class: 'group' }, t(`adminNav.${group}`)), visible.map(([id, icon]) => h('button', { class: st.page === id ? 'on' : '', onclick: () => go(id) }, h('span', {}, icon), t(`adminNav.${id}`), id === 'approvals' ? countBadge(pendingDrivers().length) : id === 'sos' ? countBadge(read('sos').filter((x) => x.status !== 'RESOLVED').length, 'bad') : id === 'tickets' ? countBadge(read('tickets').filter((x) => ['OPEN', 'IN_PROGRESS'].includes(x.status)).length) : null))];
    }),
    h('div', { class: 'grow' }),
    h('div', { class: 'sep' }),
    h('div', { style: { padding: '0 10px' } }, h('small', {}, t('admin.signed_in_as')), h('div', { style: { fontWeight: 700 } }, tr(read('roles')[st.role].name))),
    h('div', { class: 'row', style: { padding: '8px 10px' } }, langSwitcher(changeLanguage), h('button', { class: 'btn sm', onclick: () => { writeSession(SKEY, null); st.role = null; renderLogin(); } }, t('account.logout'))));
}

const countBadge = (n, kind = 'warn') => (n ? badge(num(n), kind) : null);

function go(id) {
  st.page = id;
  els.side.classList.remove('open');
  renderSide();
  renderPage();
}

const sigs = {};
function changed(key, value) {
  const v = JSON.stringify(value);
  if (sigs[key] === v) return false;
  sigs[key] = v;
  return true;
}

function liveRefresh(tables) {
  if (changed('side', [pendingDrivers().length, read('sos').map((x) => x.status), read('tickets').map((x) => x.status)])) renderSide();
  if (document.querySelector('dialog[open]')) return; // never re-render under an open form
  if (st.page === 'dashboard' || st.page === 'livemap') return updateLive?.();
  const watch = PAGE_WATCH[st.page];
  if (watch && changed(`page:${st.page}`, watch())) renderPage();
}

// Pages that refresh themselves when (and only when) their own data changes
const PAGE_WATCH = {
  sos: () => read('sos').map((x) => [x.id, x.status]),
  approvals: () => pendingDrivers().map((d) => [d.id, d.status, d.documents.map((x) => x.status)]),
  payouts: () => [read('payouts').map((x) => [x.id, x.status]), read('walletTx').length],
};
let updateLive = null;

function header(title, ...actions) {
  return h('div', { class: 'main-head' }, h('button', { class: 'icon-btn menu-btn', 'aria-label': 'Menu', onclick: () => els.side.classList.toggle('open') }, '☰'), h('h1', {}, title), ...actions);
}

function renderPage() {
  if (PAGE_WATCH[st.page]) sigs[`page:${st.page}`] = JSON.stringify(PAGE_WATCH[st.page]());
  for (const fn of cleanup) fn();
  cleanup = [];
  updateLive = null;
  const pages = { dashboard, livemap, approvals, drivers, customers, trips, sos, tickets, geo, vehicles, pricing, surge, commission, cancellation, promotions, finance, payouts, reports, broadcast, roles, audit, settings };
  mount(els.main);
  (pages[st.page] ?? dashboard)();
  window.scrollTo(0, 0);
}

// ───────────────────────────── shared helpers ─────────────────────────────

const cityName = (id) => tr(read('cities').find((c) => c.id === id)?.name) || '—';
const vtName = (id) => tr(read('vehicleTypes').find((v) => v.id === id)?.name) || id;
const driverById = (id) => read('drivers').find((d) => d.id === id);
const customerById = (id) => read('customers').find((c) => c.id === id);
const maskPhone = (p) => (can('drivers.view_pii') ? p : `${p.slice(0, 6)}•••${p.slice(-3)}`);
const pendingDrivers = () => read('drivers').filter((d) => ['PENDING', 'UNDER_REVIEW', 'CHANGES_REQUESTED'].includes(d.status));
const STATUS_KIND = { COMPLETED: 'good', NO_DRIVER_FOUND: 'warn', SEARCHING: 'info', IN_PROGRESS: 'brand', DRIVER_ARRIVING: 'info', DRIVER_ARRIVED: 'info', DRIVER_ASSIGNED: 'info' };
const DRIVER_KIND = { APPROVED: 'good', PENDING: 'warn', UNDER_REVIEW: 'info', CHANGES_REQUESTED: 'warn', REJECTED: 'bad', SUSPENDED: 'bad', BLOCKED: 'bad', DOCUMENTS_EXPIRED: 'warn' };
const tripBadge = (s) => badge(t(`status.${s}`), STATUS_KIND[s] ?? (s.startsWith('CANCELLED') ? 'bad' : ''));
const startOfToday = () => Date.now() - E.localParts().minutes * 60_000 - (new Date().getSeconds() * 1000);
const fareOf = (x) => x.final?.fare.total ?? 0;
const grossOf = (x) => x.final?.fare.gross ?? 0;

/** Sortable table. columns: [{ label, get, render?, num? }] */
function table(columns, rows, { onRow, limit = 300, empty } = {}) {
  let sortIdx = -1; let dir = 1;
  const wrap = h('div', { class: 'table-wrap' });
  const draw = () => {
    let list = rows;
    if (sortIdx >= 0) {
      const g = columns[sortIdx].get;
      list = rows.slice().sort((a, b) => { const x = g(a); const y = g(b); return (x > y ? 1 : x < y ? -1 : 0) * dir; });
    }
    mount(wrap, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, columns.map((c, i) => h('th', { class: c.get ? 'sort' : '', onclick: () => { if (!c.get) return; dir = sortIdx === i ? -dir : 1; sortIdx = i; draw(); } }, c.label, sortIdx === i ? (dir > 0 ? ' ▲' : ' ▼') : '')))),
      h('tbody', {}, list.length ? list.slice(0, limit).map((r) => h('tr', { class: onRow ? 'click' : '', onclick: onRow ? () => onRow(r) : null }, columns.map((c) => h('td', { class: c.num ? 'num' : '' }, c.render ? c.render(r) : c.get(r))))) : h('tr', {}, h('td', { colspan: columns.length, class: 'muted center' }, empty ?? t('admin.no_rows'))))),
    list.length > limit ? h('div', { class: 'muted', style: { padding: '8px 12px' } }, t('admin.showing', { n: limit, total: list.length })) : null);
  };
  draw();
  return wrap;
}

function kpi(label, value, sub) {
  return h('div', { class: 'card kpi' }, h('span', { class: 'label' }, label), h('span', { class: 'value' }, value), sub ? h('small', {}, sub) : null);
}

const numIn = (value, attrs = {}) => h('input', { class: 'input num', type: 'number', value, ...attrs });
const textIn = (value = '', attrs = {}) => h('input', { class: 'input', value, ...attrs });
const ok = (msg = t('admin.saved')) => toast(msg, 'good');

function guard(perm, el) {
  if (!can(perm) && el instanceof HTMLElement) { el.disabled = true; el.title = t('err.forbidden'); }
  return el;
}

// ───────────────────────────── dashboard & live map ─────────────────────────────

function computeToday() {
  const trips = read('trips');
  const since = startOfToday();
  const today = trips.filter((x) => x.ts.requested >= since);
  const done = today.filter((x) => x.status === 'COMPLETED');
  return {
    trips: today.length, active: trips.filter((x) => E.ACTIVE.includes(x.status)).length,
    online: read('drivers').filter((d) => d.availability !== 'OFFLINE' && d.status === 'APPROVED').length,
    newCustomers: read('customers').filter((c) => c.createdAt >= since).length,
    newDrivers: read('drivers').filter((d) => d.createdAt >= since).length,
    revenue: done.reduce((s, x) => s + grossOf(x), 0), commission: done.reduce((s, x) => s + (x.final?.commission ?? 0), 0),
    cancelled: today.filter((x) => x.status.startsWith('CANCELLED')).length,
  };
}

function dashboard() {
  const box = h('div', { class: 'col' });
  mount(els.main, header(t('adminNav.dashboard'), h('small', { class: 'muted' }, t('admin.live'))), box);
  const mapEl = h('div', { class: 'live-map' });
  let mapApi;
  const draw = () => {
    const td = computeToday();
    const trips = read('trips');
    const done = trips.filter((x) => x.status === 'COMPLETED');
    const drivers = read('drivers');
    const rated = done.filter((x) => x.ratings?.byCustomer);
    const sosOpen = read('sos').filter((x) => x.status === 'OPEN');
    const expSoon = drivers.filter((d) => d.status === 'APPROVED' && d.documents.some((doc) => doc.expiresAt && doc.expiresAt <= E.localParts(Date.now() + 30 * 86_400_000).date)).length;
    const revenue = done.reduce((s, x) => s + grossOf(x), 0);
    mount(box,
      sosOpen.length ? h('div', { class: 'alert-bar' }, '🆘 ', t('admin.sos_alert', { n: num(sosOpen.length) }), h('button', { class: 'btn sm', onclick: () => go('sos') }, t('admin.open'))) : null,
      h('h3', {}, t('admin.today')),
      h('div', { class: 'grid grid-kpi' },
        kpi(t('kpi.trips'), num(td.trips)), kpi(t('kpi.active_trips'), num(td.active)), kpi(t('kpi.online_drivers'), num(td.online)),
        kpi(t('kpi.new_customers'), num(td.newCustomers)), kpi(t('kpi.new_drivers'), num(td.newDrivers)), kpi(t('kpi.revenue'), money(td.revenue)),
        kpi(t('kpi.commission'), money(td.commission)), kpi(t('kpi.cancelled'), num(td.cancelled))),
      h('h3', {}, t('admin.totals')),
      h('div', { class: 'grid grid-kpi' },
        kpi(t('kpi.total_customers'), num(read('customers').filter((c) => c.status !== 'DELETED').length)),
        kpi(t('kpi.total_drivers'), num(drivers.length)), kpi(t('kpi.active_drivers'), num(drivers.filter((d) => d.status === 'APPROVED').length)),
        kpi(t('kpi.total_trips'), num(trips.length)), kpi(t('kpi.completed'), num(done.length)), kpi(t('kpi.cancelled'), num(trips.filter((x) => x.status.startsWith('CANCELLED')).length)),
        kpi(t('kpi.revenue'), money(revenue)), kpi(t('kpi.driver_earnings'), money(done.reduce((s, x) => s + (x.final?.driverEarning ?? 0), 0))),
        kpi(t('kpi.commission'), money(done.reduce((s, x) => s + (x.final?.commission ?? 0), 0))), kpi(t('kpi.avg_trip'), money(done.length ? revenue / done.length : 0)),
        kpi(t('kpi.avg_rating'), `★ ${num(rated.length ? rated.reduce((s, x) => s + x.ratings.byCustomer.stars, 0) / rated.length : 0, 2)}`),
        h('button', { class: 'card kpi', style: { cursor: 'pointer', textAlign: 'start', font: 'inherit', color: 'inherit' }, onclick: () => go('approvals') }, h('span', { class: 'label' }, t('kpi.pending_approvals')), h('span', { class: 'value' }, num(pendingDrivers().length)), expSoon ? h('small', {}, t('admin.docs_expiring', { n: num(expSoon) })) : null)),
      h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, t('adminNav.livemap')), mapLegend()),
      mapEl);
    if (!mapApi) mapApi = liveMap(mapEl, null);
    mapApi.update();
  };
  draw();
  updateLive = draw;
  const iv = setInterval(() => mapApi?.update(), 1500);
  cleanup.push(() => clearInterval(iv));
}

function mapLegend() {
  return h('div', { class: 'legend' }, h('span', {}, h('i', { style: { background: '#16a34a' } }), t('map.online')), h('span', {}, h('i', { style: { background: '#2a78d6' } }), t('map.on_trip')),
    h('span', {}, '🙋 ', t('map.requests')), h('span', {}, h('i', { style: { background: '#f59e0b' } }), t('map.zones')));
}

function liveMap(el, cityId) {
  const city = read('cities').find((c) => c.id === (cityId ?? 'erbil'));
  const m = createMap(el, city.center, cityId ? 13 : 7);
  if (!cityId) fit(m, read('cities').map((c) => c.center), 30);
  const layer = markerLayer(m);
  for (const z of read('zones').filter((x) => x.active)) circle(m, z.center, z.radiusM, z.kind === 'airport' ? 'airport' : 'zone').bindTooltip(tr(z.name));
  let lines = [];
  return {
    map: m,
    update() {
      for (const l of lines) m.removeLayer(l);
      lines = [];
      const items = [];
      for (const d of read('drivers').filter((x) => x.status === 'APPROVED' && x.availability !== 'OFFLINE' && (!cityId || x.cityId === cityId))) {
        const state = d.availability === 'ON_TRIP' ? 'ontrip' : 'online';
        items.push({ id: d.id, pos: d.loc, icon: icons.car(state), iconKey: state, tooltip: `${d.name} – ${d.vehicle.plate}`, onclick: () => driverDetail(d.id) });
      }
      for (const tr0 of read('trips').filter((x) => E.ACTIVE.includes(x.status) && (!cityId || x.cityId === cityId))) {
        if (tr0.status === 'SEARCHING') items.push({ id: `r-${tr0.id}`, pos: [tr0.pickup.lat, tr0.pickup.lng], icon: icons.request(), iconKey: 'req', tooltip: tr0.code, onclick: () => tripDetail(tr0.id) });
        if (tr0.status === 'IN_PROGRESS' && tr0.route) lines.push(polyline(m, tr0.route.slice(tr0.progress?.idx ?? 0), 'route'));
        if (tr0.status === 'DRIVER_ARRIVING' && tr0.approach) lines.push(polyline(m, tr0.approach.slice(tr0.progress?.idx ?? 0), 'approach'));
      }
      for (const s0 of read('sos').filter((x) => x.status !== 'RESOLVED' && x.lat)) items.push({ id: s0.id, pos: [s0.lat, s0.lng], icon: icons.sos(), iconKey: 'sos', onclick: () => go('sos') });
      layer.sync(items);
    },
  };
}

function livemap() {
  let cityId = st.filters.mapCity ?? 'erbil';
  const el = h('div', { class: 'live-map', style: { height: 'calc(100vh - 180px)' } });
  const stats = h('div', { class: 'row wrap' });
  mount(els.main, header(t('adminNav.livemap'), select(read('cities').map((c) => [c.id, tr(c.name)]), cityId, (v) => { st.filters.mapCity = v; renderPage(); })),
    h('div', { class: 'row between', style: { marginBottom: '10px' } }, stats, mapLegend()), el);
  const api = liveMap(el, cityId);
  const draw = () => {
    api.update();
    const drivers = read('drivers').filter((d) => d.cityId === cityId && d.status === 'APPROVED');
    const rule = read('surgeRules').find((r) => r.cityId === cityId && !r.zoneId);
    const s = read('surgeState')[rule?.id];
    mount(stats, badge(`${t('map.online')}: ${num(drivers.filter((d) => d.availability === 'ONLINE').length)}`, 'good'), badge(`${t('map.on_trip')}: ${num(drivers.filter((d) => d.availability === 'ON_TRIP').length)}`, 'info'),
      badge(`${t('map.requests')}: ${num(read('trips').filter((x) => x.cityId === cityId && x.status === 'SEARCHING').length)}`, 'warn'), badge(`⚡ ×${num(s?.multiplier ?? 1, 1)}`, (s?.multiplier ?? 1) > 1 ? 'warn' : ''));
  };
  draw();
  updateLive = draw;
  const iv = setInterval(draw, 1500);
  cleanup.push(() => clearInterval(iv));
}

// ───────────────────────────── drivers ─────────────────────────────

function driverColumns() {
  return [
    { label: t('admin.name'), get: (d) => d.name, render: (d) => h('div', { class: 'row' }, h('div', { class: 'avatar', style: { width: '32px', height: '32px', fontSize: '.85rem' } }, d.photo ? h('img', { src: d.photo, alt: '' }) : initials(d.name)), d.name, d.bot ? h('small', { class: 'muted' }, ' (sim)') : null) },
    { label: t('admin.phone'), get: (d) => d.phone, render: (d) => h('span', { class: 'ltr' }, maskPhone(d.phone)) },
    { label: t('admin.city'), get: (d) => cityName(d.cityId) },
    { label: t('admin.vehicle'), get: (d) => `${d.vehicle.make} ${d.vehicle.model}`, render: (d) => h('span', {}, `${d.vehicle.make} ${d.vehicle.model} `, h('span', { class: 'plate' }, d.vehicle.plate)) },
    { label: t('admin.status'), get: (d) => d.status, render: (d) => badge(t(`driverStatus.${d.status}`), DRIVER_KIND[d.status]) },
    { label: t('admin.availability'), get: (d) => d.availability, render: (d) => badge(t(`availability.${d.availability}`), d.availability === 'ONLINE' ? 'good' : d.availability === 'ON_TRIP' ? 'info' : '') },
    { label: t('admin.rating'), get: (d) => d.rating, render: (d) => `★ ${num(d.rating, 2)}`, num: true },
    { label: t('admin.trips'), get: (d) => d.trips, num: true },
    { label: t('admin.debt'), get: (d) => E.cashDebt(d.id), render: (d) => (E.cashDebt(d.id) ? h('span', { style: { color: 'var(--bad)' } }, money(E.cashDebt(d.id))) : '—'), num: true },
    { label: t('admin.registered'), get: (d) => d.createdAt, render: (d) => dateTime(d.createdAt) },
  ];
}

function approvals() {
  const list = pendingDrivers().sort((a, b) => a.createdAt - b.createdAt);
  mount(els.main, header(t('adminNav.approvals')), h('p', { class: 'text-2' }, t('admin.approvals_hint')),
    table(driverColumns(), list, { onRow: (d) => driverDetail(d.id), empty: t('admin.no_pending') }));
}

function drivers() {
  const f = (st.filters.drivers ??= { q: '', status: '', city: '', avail: '' });
  const out = h('div');
  const draw = () => {
    const q = f.q.trim().toLowerCase();
    const rows = read('drivers').filter((d) => (!f.status || d.status === f.status) && (!f.city || d.cityId === f.city) && (!f.avail || d.availability === f.avail)
      && (!q || d.name.toLowerCase().includes(q) || d.phone.includes(q) || d.vehicle.plate.includes(q)));
    mount(out, table(driverColumns(), rows, { onRow: (d) => driverDetail(d.id) }));
  };
  mount(els.main, header(t('adminNav.drivers'), h('button', { class: 'btn', onclick: () => downloadCsv('drivers.csv', [['id', 'name', 'phone', 'city', 'status', 'rating', 'trips'], ...read('drivers').map((d) => [d.id, d.name, maskPhone(d.phone), d.cityId, d.status, d.rating, d.trips])]) }, '⬇ CSV')),
    h('div', { class: 'toolbar' },
      h('input', { class: 'input', placeholder: t('admin.search_driver'), value: f.q, oninput: (e) => { f.q = e.target.value; draw(); } }),
      select([['', t('admin.all_statuses')], ...Object.keys(DRIVER_KIND).map((s) => [s, t(`driverStatus.${s}`)])], f.status, (v) => { f.status = v; draw(); }),
      select([['', t('admin.all_cities')], ...read('cities').map((c) => [c.id, tr(c.name)])], f.city, (v) => { f.city = v; draw(); }),
      select([['', t('admin.all_availability')], ...['ONLINE', 'ON_TRIP', 'OFFLINE'].map((s) => [s, t(`availability.${s}`)])], f.avail, (v) => { f.avail = v; draw(); })),
    out);
  draw();
}

function driverDetail(id) {
  const body = h('div', { class: 'col' });
  const draw = () => {
    const d = driverById(id);
    const trips = read('trips').filter((x) => x.driverId === id);
    const done = trips.filter((x) => x.status === 'COMPLETED');
    const complaints = read('tickets').filter((tk) => tk.category === 'DRIVER_COMPLAINT' && trips.some((x) => x.id === tk.tripId)).length;
    const acc = d.offersReceived ? Math.round((d.offersAccepted / d.offersReceived) * 100) : 100;
    const act = (to, label, kind, perm) => guard(perm, h('button', { class: `btn sm ${kind}`, onclick: async () => {
      let reason = '';
      if (['REJECTED', 'SUSPENDED', 'BLOCKED', 'CHANGES_REQUESTED'].includes(to)) {
        const input = h('textarea', { class: 'input' });
        reason = await modal(label, field(t('driver.reason'), input), [{ label: t('common.cancel'), value: () => null }, { label, kind: 'primary', value: () => input.value.trim() || false }]);
        if (!reason) return;
      }
      attempt(() => { E.setDriverStatus(admin(), id, to, reason); ok(); draw(); });
    } }, label));
    const s = d.status;
    mount(body,
      h('div', { class: 'row' }, h('div', { class: 'avatar', style: { width: '60px', height: '60px' } }, d.photo ? h('img', { src: d.photo, alt: '' }) : initials(d.name)),
        h('div', { class: 'grow' }, h('h3', { style: { margin: 0 } }, d.name), h('div', { class: 'ltr text-2' }, maskPhone(d.phone)), badge(t(`driverStatus.${s}`), DRIVER_KIND[s]), ' ', badge(t(`availability.${d.availability}`)))),
      h('div', { class: 'row wrap' },
        ['PENDING', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'REJECTED', 'DOCUMENTS_EXPIRED'].includes(s) ? act('APPROVED', t('admin.approve'), 'good', 'drivers.approve') : null,
        ['PENDING', 'UNDER_REVIEW', 'CHANGES_REQUESTED'].includes(s) ? [act('CHANGES_REQUESTED', t('admin.request_changes'), '', 'drivers.approve'), act('REJECTED', t('admin.reject'), 'danger', 'drivers.approve')] : null,
        s === 'APPROVED' ? act('SUSPENDED', t('admin.suspend'), '', 'drivers.suspend') : null,
        ['SUSPENDED', 'BLOCKED'].includes(s) ? act('APPROVED', t('admin.activate'), 'good', 'drivers.suspend') : null,
        s !== 'BLOCKED' ? act('BLOCKED', t('admin.block'), 'danger', 'drivers.suspend') : null),
      h('div', { class: 'grid grid-2' },
        h('div', { class: 'kv' }, h('span', {}, t('admin.city')), h('span', {}, cityName(d.cityId)), h('span', {}, t('profile.email')), h('span', {}, d.email ?? '—'),
          h('span', {}, t('admin.vehicle')), h('span', {}, `${d.vehicle.make} ${d.vehicle.model} ${d.vehicle.year} – ${tr(d.vehicle.color)}`),
          h('span', {}, t('driver.plate')), h('span', {}, h('span', { class: 'plate' }, d.vehicle.plate), ` ${cityName(d.vehicle.plateRegion)}`),
          h('span', {}, t('driver.serves')), h('span', {}, d.vehicle.serves.map(vtName).join('، ')), h('span', {}, t('admin.registered')), h('span', {}, dateTime(d.createdAt))),
        h('div', { class: 'kv' }, h('span', {}, t('admin.rating')), h('span', {}, `★ ${num(d.rating, 2)} (${num(d.ratingCount)})`), h('span', {}, t('admin.trips')), h('span', {}, num(d.trips)),
          h('span', {}, t('driver.acceptance')), h('span', {}, `${num(acc)}%`), h('span', {}, t('driver.cancellation')), h('span', {}, `${num(cancellationRate(d.cancelled, d.trips + d.cancelled), 1)}%`),
          h('span', {}, t('admin.earnings')), h('span', {}, money(done.reduce((sum, x) => sum + (x.final?.driverEarning ?? 0), 0))), h('span', {}, t('admin.wallet')), h('span', {}, money(E.balance(`d:${id}`))),
          h('span', {}, t('admin.complaints')), h('span', {}, num(complaints)))),
      h('h3', {}, t('driver.documents')),
      can('drivers.view_pii') ? h('div', { class: 'list' }, DOC_TYPES.map((dt) => {
        const doc = d.documents.find((x) => x.type === dt.id);
        return h('div', { class: 'list-item', style: { cursor: 'default', flexWrap: 'wrap' } },
          doc.file ? h('a', { href: doc.file, target: '_blank', rel: 'noopener' }, h('img', { src: doc.file, class: 'doc-thumb', alt: tr(dt.name), style: { width: '96px', height: '72px' } })) : h('div', { class: 'doc-thumb', style: { width: '96px', height: '72px' } }, '📄'),
          h('div', { class: 'grow' }, h('b', {}, tr(dt.name)), h('br'), h('small', {}, doc.expiresAt ? `${t('driver.expiry')}: ${doc.expiresAt}` : doc.fileName), doc.reason ? h('div', { class: 'notice bad', style: { padding: '2px 8px' } }, doc.reason) : null),
          badge(t(`docStatus.${doc.status}`), { APPROVED: 'good', PENDING: 'warn', REJECTED: 'bad', EXPIRED: 'bad' }[doc.status]),
          guard('drivers.approve', h('button', { class: 'btn sm good', onclick: () => attempt(() => { E.reviewDocument(admin(), id, dt.id, 'APPROVED'); draw(); }) }, '✓')),
          guard('drivers.approve', h('button', { class: 'btn sm danger', onclick: async () => {
            const input = h('input', { class: 'input' });
            const reason = await modal(t('admin.reject_doc'), field(t('driver.reason'), input), [{ label: t('common.cancel'), value: () => null }, { label: t('admin.reject'), kind: 'danger', value: () => input.value.trim() || false }]);
            if (reason) attempt(() => { E.reviewDocument(admin(), id, dt.id, 'REJECTED', reason); draw(); });
          } }, '✕')));
      })) : h('p', { class: 'muted' }, t('admin.pii_hidden')),
      h('h3', {}, t('admin.recent_trips')),
      table([{ label: '#', get: (x) => x.code }, { label: t('admin.status'), get: (x) => x.status, render: (x) => tripBadge(x.status) }, { label: t('admin.fare'), get: fareOf, render: (x) => money(fareOf(x)), num: true }, { label: t('admin.date'), get: (x) => x.ts.requested, render: (x) => dateTime(x.ts.requested) }],
        trips.slice(-30).reverse(), { onRow: (x) => tripDetail(x.id), limit: 30 }),
      h('h3', {}, t('admin.history')),
      h('div', { class: 'list' }, d.history.slice().reverse().map((x) => h('div', { class: 'list-item', style: { cursor: 'default' } }, h('div', { class: 'grow' }, `${x.from ? `${t(`driverStatus.${x.from}`)} → ` : ''}${t(`driverStatus.${x.to}`)}`, x.reason ? h('small', {}, ` – ${x.reason}`) : null), h('small', {}, `${x.by} – ${dateTime(x.ts)}`)))),
      h('div', { class: 'row wrap' },
        guard('wallets.adjust', h('button', { class: 'btn sm', onclick: () => adjustModal(`d:${id}`, draw) }, t('admin.adjust_wallet'))),
        guard('commission.update', h('button', { class: 'btn sm', onclick: () => commissionModal({ driverId: id }) }, t('admin.custom_commission')))));
  };
  draw();
  const off = onChange(relayout(() => {
    const d = driverById(id);
    if (body.isConnected && changed(`drv:${id}`, [d.status, d.availability, d.documents, d.history.length, E.balance(`d:${id}`), d.trips])) draw();
  }));
  modal(t('admin.driver'), body, [{ label: t('common.close'), value: () => true }]).then(off);
}

function adjustModal(key, after) {
  const amount = numIn(0, { step: 250 });
  const note = textIn('');
  modal(t('admin.adjust_wallet'), h('div', { class: 'col' }, h('p', { class: 'text-2' }, `${key} – ${t('wallet.balance')}: ${money(E.balance(key))}`), field(t('admin.adjust_amount'), amount, t('admin.adjust_hint')), field(t('admin.note'), note)),
    [{ label: t('common.cancel'), value: () => null }, { label: t('common.save'), kind: 'primary', value: () => true }]).then((v) => {
    if (v) attempt(() => { if (!note.value.trim()) throw new E.AppError('err.note_required'); E.adjustWallet(admin(), key, amount.value, note.value.trim()); ok(); after?.(); });
  });
}

// ───────────────────────────── customers ─────────────────────────────

function customers() {
  const f = (st.filters.customers ??= { q: '', status: '' });
  const out = h('div');
  const trips = read('trips');
  const spend = new Map();
  for (const x of trips) if (x.status === 'COMPLETED') spend.set(x.customerId, (spend.get(x.customerId) ?? 0) + fareOf(x));
  const complaints = (id) => read('tickets').filter((tk) => tk.userKey === `c:${id}`).length;
  const cols = [
    { label: t('admin.name'), get: (c) => c.name },
    { label: t('admin.phone'), get: (c) => c.phone, render: (c) => h('span', { class: 'ltr' }, can('drivers.view_pii') ? c.phone : `${c.phone.slice(0, 6)}•••${c.phone.slice(-3)}`) },
    { label: t('profile.email'), get: (c) => c.email ?? '' },
    { label: t('admin.registered'), get: (c) => c.createdAt, render: (c) => dateTime(c.createdAt) },
    { label: t('admin.trips'), get: (c) => c.trips, num: true },
    { label: t('admin.spending'), get: (c) => spend.get(c.id) ?? 0, render: (c) => money(spend.get(c.id) ?? 0), num: true },
    { label: t('admin.rating'), get: (c) => c.rating, render: (c) => `★ ${num(c.rating, 2)}`, num: true },
    { label: t('admin.status'), get: (c) => c.status, render: (c) => badge(t(`customerStatus.${c.status}`), c.status === 'ACTIVE' ? 'good' : 'bad') },
    { label: t('admin.complaints'), get: (c) => complaints(c.id), num: true },
  ];
  const draw = () => {
    const q = f.q.trim().toLowerCase();
    mount(out, table(cols, read('customers').filter((c) => (!f.status || c.status === f.status) && (!q || c.name.toLowerCase().includes(q) || c.phone.includes(q) || (c.email ?? '').includes(q))), { onRow: (c) => customerDetail(c.id) }));
  };
  mount(els.main, header(t('adminNav.customers')), h('div', { class: 'toolbar' },
    h('input', { class: 'input', placeholder: t('admin.search_customer'), value: f.q, oninput: (e) => { f.q = e.target.value; draw(); } }),
    select([['', t('admin.all_statuses')], ...['ACTIVE', 'SUSPENDED', 'BLOCKED', 'DELETED'].map((s) => [s, t(`customerStatus.${s}`)])], f.status, (v) => { f.status = v; draw(); })), out);
  draw();
}

function customerDetail(id) {
  const body = h('div', { class: 'col' });
  const draw = () => {
    const c = customerById(id);
    const trips = read('trips').filter((x) => x.customerId === id);
    const pays = read('payments').filter((p) => p.userKey === `c:${id}`);
    mount(body,
      h('div', { class: 'row' }, h('div', { class: 'avatar' }, initials(c.name)), h('div', { class: 'grow' }, h('h3', { style: { margin: 0 } }, c.name), h('span', { class: 'ltr text-2' }, c.phone)), badge(t(`customerStatus.${c.status}`), c.status === 'ACTIVE' ? 'good' : 'bad')),
      h('div', { class: 'row wrap' },
        c.status === 'ACTIVE' ? [guard('customers.suspend', h('button', { class: 'btn sm', onclick: () => attempt(() => { E.setCustomerStatus(admin(), id, 'SUSPENDED'); draw(); }) }, t('admin.suspend'))),
          guard('customers.suspend', h('button', { class: 'btn sm danger', onclick: () => attempt(() => { E.setCustomerStatus(admin(), id, 'BLOCKED'); draw(); }) }, t('admin.block')))]
          : c.status !== 'DELETED' ? guard('customers.suspend', h('button', { class: 'btn sm good', onclick: () => attempt(() => { E.setCustomerStatus(admin(), id, 'ACTIVE'); draw(); }) }, t('admin.activate'))) : null,
        guard('wallets.adjust', h('button', { class: 'btn sm', onclick: () => adjustModal(`c:${id}`, draw) }, t('admin.adjust_wallet')))),
      h('div', { class: 'kv' }, h('span', {}, t('profile.email')), h('span', {}, c.email ?? '—'), h('span', {}, t('admin.registered')), h('span', {}, dateTime(c.createdAt)),
        h('span', {}, t('admin.wallet')), h('span', {}, money(E.balance(`c:${id}`))), h('span', {}, t('admin.rating')), h('span', {}, `★ ${num(c.rating, 2)}`),
        h('span', {}, t('admin.trips')), h('span', {}, num(c.trips)), h('span', {}, t('driver.cancellation')), h('span', {}, `${num(cancellationRate(c.cancelled, c.trips + c.cancelled), 1)}%`),
        h('span', {}, t('auth.referral')), h('span', {}, c.referralCode), h('span', {}, t('account.emergency_contacts')), h('span', {}, num(c.emergency.length))),
      h('h3', {}, t('admin.recent_trips')),
      table([{ label: '#', get: (x) => x.code }, { label: t('admin.status'), get: (x) => x.status, render: (x) => tripBadge(x.status) }, { label: t('admin.fare'), get: fareOf, render: (x) => money(fareOf(x) || x.est.fare.total), num: true }, { label: t('admin.payment'), get: (x) => t(`pay.${x.paymentMethod}`) }, { label: t('admin.date'), get: (x) => x.ts.requested, render: (x) => dateTime(x.ts.requested) }],
        trips.slice().reverse(), { onRow: (x) => tripDetail(x.id), limit: 30 }),
      h('h3', {}, t('admin.payment_history')),
      table([{ label: t('admin.method'), get: (p) => t(`pay.${p.method}`) }, { label: t('wallet.amount'), get: (p) => p.amount, render: (p) => money(p.amount), num: true }, { label: t('admin.status'), get: (p) => p.status }, { label: t('admin.date'), get: (p) => p.ts, render: (p) => dateTime(p.ts) }], pays.slice().reverse(), { limit: 30 }));
  };
  draw();
  modal(t('admin.customer'), body, [{ label: t('common.close'), value: () => true }]);
}

// ───────────────────────────── trips ─────────────────────────────

function trips() {
  const f = (st.filters.trips ??= { q: '', status: '', city: '', vt: '', from: '', to: '' });
  const out = h('div');
  const rows = () => {
    const q = f.q.trim().toUpperCase();
    const from = f.from ? new Date(`${f.from}T00:00:00+03:00`).getTime() : 0;
    const to = f.to ? new Date(`${f.to}T23:59:59+03:00`).getTime() : Infinity;
    return read('trips').filter((x) => (!f.status || (f.status === 'ACTIVE' ? E.ACTIVE.includes(x.status) : f.status === 'CANCELLED' ? x.status.startsWith('CANCELLED') : x.status === f.status))
      && (!f.city || x.cityId === f.city) && (!f.vt || x.vehicleTypeId === f.vt) && x.ts.requested >= from && x.ts.requested <= to && (!q || x.code.includes(q))).reverse();
  };
  const cols = [
    { label: '#', get: (x) => x.code },
    { label: t('admin.customer'), get: (x) => customerById(x.customerId)?.name ?? '' },
    { label: t('admin.driver'), get: (x) => driverById(x.driverId)?.name ?? '—' },
    { label: t('admin.city'), get: (x) => cityName(x.cityId) },
    { label: t('admin.vehicle'), get: (x) => vtName(x.vehicleTypeId) },
    { label: t('booking.pickup'), get: (x) => x.pickup.address || `${x.pickup.lat.toFixed(3)}, ${x.pickup.lng.toFixed(3)}` },
    { label: t('booking.destination'), get: (x) => x.dropoff.address || `${x.dropoff.lat.toFixed(3)}, ${x.dropoff.lng.toFixed(3)}` },
    { label: t('admin.distance'), get: (x) => x.final?.distanceM ?? x.est.distanceM, render: (x) => km(x.final?.distanceM ?? x.est.distanceM), num: true },
    { label: t('admin.duration'), get: (x) => x.final?.durationS ?? x.est.durationS, render: (x) => minutes(x.final?.durationS ?? x.est.durationS), num: true },
    { label: t('admin.est_price'), get: (x) => x.est.fare.total, render: (x) => money(x.est.fare.total), num: true },
    { label: t('admin.final_price'), get: fareOf, render: (x) => (x.final ? money(fareOf(x)) : '—'), num: true },
    { label: t('admin.payment'), get: (x) => t(`pay.${x.paymentMethod}`) },
    { label: t('admin.status'), get: (x) => x.status, render: (x) => tripBadge(x.status) },
    { label: t('admin.date'), get: (x) => x.ts.requested, render: (x) => dateTime(x.ts.requested) },
  ];
  const draw = () => mount(out, table(cols, rows(), { onRow: (x) => tripDetail(x.id) }));
  const exportCsv = () => downloadCsv('trips.csv', [['code', 'customer', 'driver', 'city', 'vehicle', 'distance_km', 'duration_min', 'est_price', 'final_price', 'payment', 'status', 'requested_at'],
    ...rows().map((x) => [x.code, customerById(x.customerId)?.name, driverById(x.driverId)?.name ?? '', x.cityId, x.vehicleTypeId, ((x.final?.distanceM ?? x.est.distanceM) / 1000).toFixed(1), Math.round((x.final?.durationS ?? x.est.durationS) / 60), x.est.fare.total, x.final?.fare.total ?? '', x.paymentMethod, x.status, new Date(x.ts.requested).toISOString()])]);
  mount(els.main, header(t('adminNav.trips'), h('button', { class: 'btn', onclick: exportCsv }, '⬇ Excel (CSV)')),
    h('div', { class: 'toolbar' },
      h('input', { class: 'input', placeholder: t('admin.search_trip'), value: f.q, oninput: (e) => { f.q = e.target.value; draw(); } }),
      select([['', t('admin.all_statuses')], ['ACTIVE', t('admin.active')], ['COMPLETED', t('status.COMPLETED')], ['CANCELLED', t('admin.cancelled')], ['NO_DRIVER_FOUND', t('status.NO_DRIVER_FOUND')]], f.status, (v) => { f.status = v; draw(); }),
      select([['', t('admin.all_cities')], ...read('cities').map((c) => [c.id, tr(c.name)])], f.city, (v) => { f.city = v; draw(); }),
      select([['', t('admin.all_vehicles')], ...read('vehicleTypes').map((v) => [v.id, tr(v.name)])], f.vt, (v) => { f.vt = v; draw(); }),
      h('input', { class: 'input', type: 'date', value: f.from, onchange: (e) => { f.from = e.target.value; draw(); } }),
      h('input', { class: 'input', type: 'date', value: f.to, onchange: (e) => { f.to = e.target.value; draw(); } })),
    out);
  draw();
}

function tripDetail(id) {
  const x = read('trips').find((tt) => tt.id === id);
  if (!x) return;
  const mapEl = h('div', { class: 'mini-map', style: { height: '320px' } });
  const f = x.final?.fare ?? x.est.fare;
  const driver = driverById(x.driverId);
  const body = h('div', { class: 'col' },
    h('div', { class: 'row between' }, tripBadge(x.status), h('small', {}, dateTime(x.ts.requested))),
    mapEl,
    h('div', { class: 'grid grid-2' },
      h('div', { class: 'kv' }, h('span', {}, t('admin.customer')), h('span', {}, customerById(x.customerId)?.name ?? ''), h('span', {}, t('admin.driver')), h('span', {}, driver?.name ?? '—'),
        h('span', {}, t('admin.vehicle')), h('span', {}, `${vtName(x.vehicleTypeId)}${driver ? ` – ${driver.vehicle.plate}` : ''}`), h('span', {}, t('admin.payment')), h('span', {}, t(`pay.${x.paymentMethod}`)),
        h('span', {}, t('booking.pickup')), h('span', {}, x.pickup.address || '—'), h('span', {}, t('booking.destination')), h('span', {}, x.dropoff.address || '—'),
        x.promoCode ? [h('span', {}, t('admin.promo')), h('span', {}, x.promoCode)] : null),
      h('div', { class: 'kv' }, h('span', {}, t('admin.est_price')), h('span', {}, money(x.est.fare.total)), h('span', {}, t('admin.final_price')), h('span', {}, x.final ? money(f.total) : '—'),
        h('span', {}, t('fare.base')), h('span', {}, money(f.baseFare)), h('span', {}, t('admin.distance')), h('span', {}, `${km(x.final?.distanceM ?? x.est.distanceM)} → ${money(f.distanceFare)}`),
        h('span', {}, t('admin.duration')), h('span', {}, `${minutes(x.final?.durationS ?? x.est.durationS)} → ${money(f.timeFare)}`), h('span', {}, t('fare.waiting')), h('span', {}, money(f.waitingFare)),
        h('span', {}, t('fare.surge', { x: num(x.surge, 1) })), h('span', {}, money(f.surgeAmount)), h('span', {}, t('fare.fees')), h('span', {}, money(f.fees)), h('span', {}, t('fare.discount')), h('span', {}, money(f.discount)),
        x.final ? [h('span', {}, t('driver.commission')), h('span', {}, money(x.final.commission)), h('span', {}, t('kpi.driver_earnings')), h('span', {}, money(x.final.driverEarning))] : null)),
    x.ratings?.byCustomer ? h('div', {}, t('admin.rating_by_customer'), ': ', stars(x.ratings.byCustomer.stars), x.ratings.byCustomer.comment ? ` — ${x.ratings.byCustomer.comment}` : '') : null,
    x.offers?.length ? [h('h3', {}, t('admin.dispatch_log')), table([{ label: t('admin.driver'), get: (o) => driverById(o.driverId)?.name ?? o.driverId }, { label: t('admin.round'), get: (o) => o.round + 1, num: true },
      { label: t('admin.score'), get: (o) => o.score, num: true }, { label: 'ETA', get: (o) => o.etaS, render: (o) => minutes(o.etaS), num: true }, { label: t('admin.status'), get: (o) => t(`offer.${o.status}`) }], x.offers)] : null,
    x.events?.length ? [h('h3', {}, t('admin.timeline')), h('div', { class: 'list' }, x.events.map((e) => h('div', { class: 'list-item', style: { cursor: 'default' } }, h('span', { class: 'grow' }, t(`status.${e.to}`), e.redispatch ? ` (${t('admin.redispatch')})` : ''), h('small', {}, `${t(`actor.${e.by}`)} – ${dateTime(e.ts)}`))))] : null,
    E.ACTIVE.includes(x.status) ? guard('trips.cancel', h('button', { class: 'btn danger', onclick: async () => {
      if (await confirmBox(t('admin.cancel_trip_confirm'), t('trip.cancel'), 'danger')) attempt(() => { E.cancelTrip(id, 'ADMIN', admin(), 0, 'admin'); ok(); });
    } }, t('admin.cancel_trip'))) : null);
  modal(`${t('trips.trip')} ${x.code}`, body, [{ label: t('common.close'), value: () => true }]);
  setTimeout(() => {
    const m = createMap(mapEl, [x.pickup.lat, x.pickup.lng], 13);
    L.marker([x.pickup.lat, x.pickup.lng], { icon: icons.pickup() }).addTo(m);
    L.marker([x.dropoff.lat, x.dropoff.lng], { icon: icons.dropoff() }).addTo(m);
    const pts = x.route ?? [[x.pickup.lat, x.pickup.lng], [x.dropoff.lat, x.dropoff.lng]];
    polyline(m, pts, 'route');
    if (x.path?.length > 1) polyline(m, x.path, 'path');
    if (driver && E.WITH_DRIVER.includes(x.status)) L.marker(driver.loc, { icon: icons.car('ontrip') }).addTo(m);
    fit(m, pts, 30);
  }, 60);
}

// ───────────────────────────── SOS & tickets ─────────────────────────────

function sos() {
  const rows = read('sos').slice().sort((a, b) => (a.status === 'RESOLVED') - (b.status === 'RESOLVED') || b.createdAt - a.createdAt);
  const who = (k) => (k.startsWith('c:') ? customerById(k.slice(2))?.name : driverById(k.slice(2))?.name) ?? k;
  const setStatus = (id, status) => attempt(() => E.adminSave(admin(), 'sos.handle', 'sos', `sos.${status.toLowerCase()}`, (list) => { const s0 = list.find((x) => x.id === id); s0.status = status; s0.handledBy = st.role; if (status === 'RESOLVED') s0.resolvedAt = Date.now(); }));
  mount(els.main, header(t('adminNav.sos')), h('p', { class: 'text-2' }, t('admin.sos_hint')),
    table([
      { label: t('admin.time'), get: (x) => x.createdAt, render: (x) => dateTime(x.createdAt) },
      { label: t('admin.reporter'), get: (x) => who(x.userKey), render: (x) => `${who(x.userKey)} (${t(`actor.${x.actor}`)})` },
      { label: t('trips.trip'), get: (x) => read('trips').find((tt) => tt.id === x.tripId)?.code ?? '—', render: (x) => (x.tripId ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); tripDetail(x.tripId); } }, read('trips').find((tt) => tt.id === x.tripId)?.code) : '—') },
      { label: t('admin.location'), get: (x) => x.lat, render: (x) => (x.lat ? h('a', { href: `https://www.openstreetmap.org/?mlat=${x.lat}&mlon=${x.lng}#map=17/${x.lat}/${x.lng}`, target: '_blank', rel: 'noopener' }, '📍 OSM') : '—') },
      { label: t('admin.status'), get: (x) => x.status, render: (x) => badge(t(`sosStatus.${x.status}`), { OPEN: 'bad', ACKNOWLEDGED: 'warn', ESCALATED: 'bad', RESOLVED: 'good' }[x.status]) },
      { label: '', render: (x) => (x.status === 'RESOLVED' ? '' : h('div', { class: 'row' }, x.status === 'OPEN' ? h('button', { class: 'btn sm', onclick: () => setStatus(x.id, 'ACKNOWLEDGED') }, t('admin.acknowledge')) : null,
        h('button', { class: 'btn sm danger', onclick: () => setStatus(x.id, 'ESCALATED') }, t('admin.escalate')), h('button', { class: 'btn sm good', onclick: () => setStatus(x.id, 'RESOLVED') }, t('admin.resolve')))) },
    ], rows, { empty: t('admin.no_sos') }));
}

function tickets() {
  const f = (st.filters.tickets ??= { status: '', category: '' });
  const out = h('div');
  const who = (k) => (k.startsWith('c:') ? customerById(k.slice(2))?.name : driverById(k.slice(2))?.name) ?? k;
  const draw = () => mount(out, table([
    { label: '#', get: (x) => x.code },
    { label: t('ticket.subject'), get: (x) => x.subject },
    { label: t('ticket.category'), get: (x) => t(`ticket.${x.category}`) },
    { label: t('admin.reporter'), get: (x) => who(x.userKey) },
    { label: t('admin.priority'), get: (x) => x.priority, render: (x) => badge(t(`priority.${x.priority}`), { URGENT: 'bad', HIGH: 'warn' }[x.priority]) },
    { label: t('admin.assignee'), get: (x) => x.assignee ?? '', render: (x) => (x.assignee ? tr(read('roles')[x.assignee]?.name) : '—') },
    { label: t('admin.status'), get: (x) => x.status, render: (x) => badge(t(`ticketStatus.${x.status}`), TICKET_KIND[x.status]) },
    { label: t('admin.date'), get: (x) => x.createdAt, render: (x) => dateTime(x.createdAt) },
  ], read('tickets').filter((x) => (!f.status || x.status === f.status) && (!f.category || x.category === f.category)).reverse(), { onRow: (x) => ticketDetail(x.id) }));
  mount(els.main, header(t('adminNav.tickets')), h('div', { class: 'toolbar' },
    select([['', t('admin.all_statuses')], ...Object.keys(TICKET_KIND).map((s) => [s, t(`ticketStatus.${s}`)])], f.status, (v) => { f.status = v; draw(); }),
    select([['', t('admin.all_categories')], ...CATEGORIES.map((c) => [c, t(`ticket.${c}`)])], f.category, (v) => { f.category = v; draw(); })), out);
  draw();
  const off = onChange(relayout((tables) => tables.includes('tickets') && !document.querySelector('dialog[open]') && draw()));
  cleanup.push(off);
}

function ticketDetail(id) {
  const body = h('div', { class: 'col' });
  const draw = () => {
    const tk = read('tickets').find((x) => x.id === id);
    const input = h('textarea', { class: 'input', placeholder: t('admin.reply_placeholder') });
    const internal = h('input', { type: 'checkbox' });
    const save = (fn, action) => attempt(() => { E.adminSave(admin(), 'tickets.reply', 'tickets', action, (list) => fn(list.find((x) => x.id === id))); draw(); });
    mount(body,
      h('div', { class: 'row between wrap' }, h('b', {}, `${tk.code} – ${tk.subject}`), badge(t(`ticket.${tk.category}`))),
      h('div', { class: 'row wrap' },
        field(t('admin.status'), select(Object.keys(TICKET_KIND).map((s) => [s, t(`ticketStatus.${s}`)]), tk.status, (v) => save((x) => { x.status = v; if (v === 'CLOSED') x.closedAt = Date.now(); }, 'ticket.status'))),
        field(t('admin.assignee'), select([['', '—'], ...Object.entries(read('roles')).map(([k, r]) => [k, tr(r.name)])], tk.assignee ?? '', (v) => save((x) => { x.assignee = v || null; if (v && x.status === 'OPEN') x.status = 'ASSIGNED'; }, 'ticket.assign'))),
        field(t('admin.priority'), select(['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => [p, t(`priority.${p}`)]), tk.priority, (v) => save((x) => { x.priority = v; }, 'ticket.priority')))),
      tk.tripId ? h('button', { class: 'btn sm', onclick: () => tripDetail(tk.tripId) }, `${t('trips.trip')} ${read('trips').find((x) => x.id === tk.tripId)?.code ?? ''}`) : null,
      h('div', { class: 'chat', style: { maxHeight: '340px' } }, tk.messages.map((m) => h('div', { class: `bubble ${m.from === 'ADMIN' ? 'me' : ''}`, style: m.internal ? { background: 'var(--warn-soft)', color: 'var(--warn)' } : {} },
        m.internal ? `🔒 ${m.text}` : m.text, h('div', {}, h('small', { style: { opacity: 0.75 } }, `${t(`actor.${m.from}`)} – ${dateTime(m.ts)}`))))),
      input, h('div', { class: 'row between' }, h('label', { class: 'check' }, internal, t('admin.internal_note')),
        guard('tickets.reply', h('button', { class: 'btn primary', onclick: () => attempt(() => { if (!input.value.trim()) return; E.replyTicket(id, 'ADMIN', input.value.trim(), internal.checked, admin()); draw(); }) }, t('chat.send')))));
  };
  draw();
  modal(t('admin.ticket'), body, [{ label: t('common.close'), value: () => true }]);
}

// ───────────────────────────── geo, vehicles ─────────────────────────────

function geo() {
  let cityId = st.filters.geoCity ?? 'erbil';
  const mapEl = h('div', { class: 'live-map' });
  const cityTable = h('div');
  const zoneTable = h('div');
  const drawCities = () => mount(cityTable, table([
    { label: t('admin.name'), get: (c) => tr(c.name) }, { label: 'ID', get: (c) => c.id },
    { label: t('admin.emergency'), get: (c) => c.emergency.police, render: (c) => `🚓 ${c.emergency.police} – 🚑 ${c.emergency.ambulance}` },
    { label: t('admin.drivers'), get: (c) => read('drivers').filter((d) => d.cityId === c.id).length, num: true },
    { label: t('admin.active'), get: (c) => c.active, render: (c) => h('input', { type: 'checkbox', checked: c.active, disabled: !can('cities.manage'), onclick: (e) => e.stopPropagation(), onchange: (e) => attempt(() => { E.adminSave(admin(), 'cities.manage', 'cities', 'city.toggle', (list) => { list.find((x) => x.id === c.id).active = e.target.checked; }); ok(); }) }) },
  ], read('cities'), { onRow: (c) => cityModal(c) }));
  const drawZones = () => mount(zoneTable, table([
    { label: t('admin.name'), get: (z) => tr(z.name) }, { label: t('admin.kind'), get: (z) => t(`zoneKind.${z.kind}`) },
    { label: t('admin.radius'), get: (z) => z.radiusM, render: (z) => km(z.radiusM), num: true }, { label: t('fare.special_fee'), get: (z) => z.specialFee, render: (z) => money(z.specialFee), num: true },
    { label: t('admin.active'), get: (z) => z.active, render: (z) => (z.active ? '✓' : '—') },
  ], read('zones').filter((z) => z.cityId === cityId), { onRow: (z) => zoneModal(z), empty: t('admin.no_zones') }));
  mount(els.main, header(t('adminNav.geo'), guard('cities.manage', h('button', { class: 'btn', onclick: () => cityModal(null) }, '+ ', t('admin.add_city')))),
    h('h3', {}, t('admin.cities')), cityTable,
    h('div', { class: 'row between', style: { margin: '18px 0 8px' } }, h('h3', { style: { margin: 0 } }, t('admin.zones')),
      select(read('cities').map((c) => [c.id, tr(c.name)]), cityId, (v) => { st.filters.geoCity = v; renderPage(); })),
    h('p', { class: 'text-2' }, t('admin.zones_hint')), mapEl, h('div', { style: { height: '12px' } }), zoneTable);
  drawCities(); drawZones();
  const city = read('cities').find((c) => c.id === cityId);
  const m = createMap(mapEl, city.center, 12);
  for (const z of read('zones').filter((x) => x.cityId === cityId)) circle(m, z.center, z.radiusM, z.kind === 'airport' ? 'airport' : 'zone').bindTooltip(tr(z.name)).on('click', () => zoneModal(z));
  m.on('click', (e) => can('zones.manage') && zoneModal({ id: null, cityId, kind: 'standard', name: { ar: '', en: '', ckb: '' }, center: [e.latlng.lat, e.latlng.lng], radiusM: 1500, specialFee: 0, active: true }));
}

function namesFields(name) {
  const ar = textIn(name?.ar ?? ''); const en = textIn(name?.en ?? '', { class: 'input ltr' }); const ckb = textIn(name?.ckb ?? '');
  return { el: h('div', { class: 'grid grid-2' }, field('العربية', ar), field('English', en), field('کوردی', ckb)), get: () => ({ ar: ar.value.trim(), en: en.value.trim() || ar.value.trim(), ckb: ckb.value.trim() || ar.value.trim() }) };
}

function cityModal(c) {
  const names = namesFields(c?.name);
  const idIn = textIn(c?.id ?? '', { class: 'input ltr', disabled: !!c, placeholder: 'kirkuk' });
  const lat = numIn(c?.center[0] ?? 35.4681, { step: 0.0001 }); const lng = numIn(c?.center[1] ?? 44.3922, { step: 0.0001 });
  const police = textIn(c?.emergency.police ?? '104', { class: 'input ltr' }); const amb = textIn(c?.emergency.ambulance ?? '122', { class: 'input ltr' });
  modal(c ? tr(c.name) : t('admin.add_city'), h('div', { class: 'col' }, names.el, field('ID', idIn), h('div', { class: 'grid grid-2' }, field(t('admin.lat'), lat), field(t('admin.lng'), lng)),
    h('div', { class: 'grid grid-2' }, field(t('sos.police'), police), field(t('sos.ambulance'), amb)), !c ? h('small', { class: 'muted' }, t('admin.new_city_hint')) : null),
  [{ label: t('common.cancel'), value: () => null }, { label: t('common.save'), kind: 'primary', value: () => true }]).then((v) => {
    if (!v) return;
    attempt(() => {
      const nm = names.get();
      if (!nm.ar) throw new E.AppError('err.fill_all');
      const id = c?.id ?? idIn.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (!id) throw new E.AppError('err.fill_all');
      E.adminSave(admin(), 'cities.manage', 'cities', c ? 'city.update' : 'city.create', (list, S) => {
        const row = list.find((x) => x.id === id);
        const data = { name: nm, center: [Number(lat.value), Number(lng.value)], emergency: { police: police.value.trim(), ambulance: amb.value.trim(), fire: row?.emergency.fire ?? '115' } };
        if (row) Object.assign(row, data);
        else {
          if (list.some((x) => x.id === id)) throw new E.AppError('err.exists');
          list.push({ id, countryId: 'IQ', active: true, plate: nm, ...data });
          // copy Erbil prices and the default surge rule so the new city works immediately
          for (const r of S.pricingRules.filter((x) => x.cityId === 'erbil' && !x.zoneId)) S.pricingRules.push({ ...r, id: `pr-${id}-${r.vehicleTypeId}`, cityId: id });
          const sr = S.surgeRules.find((x) => x.cityId === 'erbil' && !x.zoneId);
          S.surgeRules.push({ ...structuredClone(sr), id: `sr-${id}`, cityId: id });
        }
      });
      ok(); renderPage();
    });
  });
}

function zoneModal(z) {
  const names = namesFields(z.name);
  const kind = select(['standard', 'downtown', 'airport'].map((k) => [k, t(`zoneKind.${k}`)]), z.kind);
  const radius = numIn(z.radiusM, { step: 100, min: 200 });
  const fee = numIn(z.specialFee, { step: 250, min: 0 });
  const active = h('input', { type: 'checkbox', checked: z.active });
  modal(z.id ? tr(z.name) : t('admin.add_zone'), h('div', { class: 'col' }, names.el, h('div', { class: 'grid grid-2' }, field(t('admin.kind'), kind), field(`${t('admin.radius')} (m)`, radius)),
    field(t('fare.special_fee'), fee, t('admin.special_fee_hint')), h('label', { class: 'check' }, active, t('admin.active')), h('small', { class: 'muted' }, `${z.center[0].toFixed(4)}, ${z.center[1].toFixed(4)}`)),
  [z.id ? { label: t('common.delete'), kind: 'danger', value: () => 'delete' } : null, { label: t('common.cancel'), value: () => null }, { label: t('common.save'), kind: 'primary', value: () => 'save' }].filter(Boolean)).then((v) => {
    if (!v) return;
    attempt(() => {
      E.adminSave(admin(), 'zones.manage', 'zones', v === 'delete' ? 'zone.delete' : z.id ? 'zone.update' : 'zone.create', (list) => {
        if (v === 'delete') return list.filter((x) => x.id !== z.id);
        const nm = names.get();
        if (!nm.ar) throw new E.AppError('err.fill_all');
        const data = { name: nm, kind: kind.value, radiusM: Math.max(200, Number(radius.value)), specialFee: Math.max(0, Math.round(Number(fee.value))), active: active.checked };
        if (z.id) Object.assign(list.find((x) => x.id === z.id), data);
        else list.push({ id: uid('z-'), cityId: z.cityId, center: z.center, ...data });
        return undefined;
      });
      ok(); renderPage();
    });
  });
}

function vehicles() {
  mount(els.main, header(t('adminNav.vehicles'), guard('vehicle_types.manage', h('button', { class: 'btn', onclick: () => vehicleModal(null) }, '+ ', t('admin.add_vehicle')))),
    table([
      { label: '', get: (v) => v.sortOrder, render: (v) => h('span', { style: { fontSize: '1.4rem' } }, v.icon) },
      { label: t('admin.name'), get: (v) => tr(v.name) }, { label: 'ID', get: (v) => v.id },
      { label: t('admin.description'), get: (v) => tr(v.desc) }, { label: t('admin.seats'), get: (v) => v.seats, num: true },
      { label: t('admin.active'), get: (v) => v.active, render: (v) => (v.active ? badge(t('admin.active'), 'good') : badge(t('admin.inactive'))) },
    ], read('vehicleTypes').slice().sort((a, b) => a.sortOrder - b.sortOrder), { onRow: (v) => vehicleModal(v) }));
}

function vehicleModal(v) {
  const names = namesFields(v?.name);
  const desc = namesFields(v?.desc);
  const id = textIn(v?.id ?? '', { class: 'input ltr', disabled: !!v, placeholder: 'LADY' });
  const icon = textIn(v?.icon ?? '🚗'); const seats = numIn(v?.seats ?? 4, { min: 1, max: 14 }); const order = numIn(v?.sortOrder ?? 9);
  const active = h('input', { type: 'checkbox', checked: v?.active ?? true });
  modal(v ? tr(v.name) : t('admin.add_vehicle'), h('div', { class: 'col' }, h('b', {}, t('admin.name')), names.el, h('b', {}, t('admin.description')), desc.el,
    h('div', { class: 'grid grid-2' }, field('ID', id), field(t('admin.icon'), icon), field(t('admin.seats'), seats), field(t('admin.order'), order)), h('label', { class: 'check' }, active, t('admin.active'))),
  [{ label: t('common.cancel'), value: () => null }, { label: t('common.save'), kind: 'primary', value: () => true }]).then((okk) => {
    if (!okk) return;
    attempt(() => {
      const code = v?.id ?? id.value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
      if (!code || !names.get().ar) throw new E.AppError('err.fill_all');
      E.adminSave(admin(), 'vehicle_types.manage', 'vehicleTypes', v ? 'vehicle_type.update' : 'vehicle_type.create', (list, S) => {
        const data = { name: names.get(), desc: desc.get(), icon: icon.value.trim() || '🚗', seats: Number(seats.value), sortOrder: Number(order.value), active: active.checked };
        if (v) Object.assign(list.find((x) => x.id === code), data);
        else {
          if (list.some((x) => x.id === code)) throw new E.AppError('err.exists');
          list.push({ id: code, serviceType: 'RIDE', factor: 1, ...data });
          // start from Economy prices in every city; the price page can change them
          for (const r of S.pricingRules.filter((x) => x.vehicleTypeId === 'ECONOMY' && !x.zoneId)) S.pricingRules.push({ ...r, id: `pr-${r.cityId}-${code}`, vehicleTypeId: code });
        }
      });
      ok(); renderPage();
    });
  });
}

// ───────────────────────────── pricing ─────────────────────────────

const PRICE_FIELDS = ['baseFare', 'perKm', 'perMinute', 'minimumFare', 'bookingFee', 'freeWaitingMinutes', 'waitingPerMinute', 'airportFee', 'specialFee', 'roundingStep'];

function pricing() {
  const f = (st.filters.pricing ??= { city: 'erbil', zone: '' });
  const vts = read('vehicleTypes').slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const rules = read('pricingRules');
  const inputs = {};
  const ruleFor = (vt) => rules.find((r) => r.cityId === f.city && r.vehicleTypeId === vt && (f.zone ? r.zoneId === f.zone : !r.zoneId));
  const cityRule = (vt) => rules.find((r) => r.cityId === f.city && r.vehicleTypeId === vt && !r.zoneId);
  const rows = vts.map((vt) => {
    const r = ruleFor(vt.id) ?? cityRule(vt.id);
    const isOverride = !!f.zone && !!ruleFor(vt.id);
    inputs[vt.id] = Object.fromEntries(PRICE_FIELDS.map((k) => [k, numIn(r?.[k] ?? 0, { min: 0, step: k.includes('Minutes') ? 1 : 50, style: { width: '96px' } })]));
    inputs[vt.id].active = h('input', { type: 'checkbox', checked: r?.active ?? false });
    return h('tr', {}, h('td', {}, `${vt.icon} ${tr(vt.name)}`, f.zone ? h('div', {}, h('small', { class: 'muted' }, isOverride ? t('admin.zone_override') : t('admin.inherits_city'))) : null),
      PRICE_FIELDS.map((k) => h('td', {}, inputs[vt.id][k])), h('td', {}, inputs[vt.id].active));
  });
  const save = () => attempt(() => {
    E.adminSave(admin(), 'pricing.update', 'pricingRules', 'pricing.update', (list) => {
      for (const vt of vts) {
        const vals = Object.fromEntries(PRICE_FIELDS.map((k) => [k, Math.max(0, Math.round(Number(inputs[vt.id][k].value) || 0))]));
        if (vals.roundingStep < 1) vals.roundingStep = 1;
        let r = list.find((x) => x.cityId === f.city && x.vehicleTypeId === vt.id && (f.zone ? x.zoneId === f.zone : !x.zoneId));
        if (!r) { r = { id: uid('pr-'), cityId: f.city, zoneId: f.zone || null, vehicleTypeId: vt.id }; list.push(r); }
        Object.assign(r, vals, { active: inputs[vt.id].active.checked });
      }
    });
    ok(); renderPage();
  });
  const removeOverride = () => attempt(() => { E.adminSave(admin(), 'pricing.update', 'pricingRules', 'pricing.zone_reset', (list) => list.filter((x) => !(x.cityId === f.city && x.zoneId === f.zone))); ok(); renderPage(); });
  mount(els.main, header(t('adminNav.pricing')),
    h('div', { class: 'toolbar' },
      select(read('cities').map((c) => [c.id, tr(c.name)]), f.city, (v) => { f.city = v; f.zone = ''; renderPage(); }),
      select([['', t('admin.city_default')], ...read('zones').filter((z) => z.cityId === f.city).map((z) => [z.id, `${t('admin.zone')}: ${tr(z.name)}`])], f.zone, (v) => { f.zone = v; renderPage(); }),
      h('div', { class: 'grow' }),
      f.zone ? guard('pricing.update', h('button', { class: 'btn', onclick: removeOverride }, t('admin.remove_override'))) : null,
      guard('pricing.update', h('button', { class: 'btn primary', onclick: save }, t('common.save')))),
    h('p', { class: 'text-2' }, t('admin.pricing_hint')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, t('admin.vehicle')), PRICE_FIELDS.map((k) => h('th', {}, t(`price.${k}`))), h('th', {}, t('admin.active')))), h('tbody', {}, rows))),
    h('h3', { style: { marginTop: '22px' } }, '🧮 ', t('admin.simulator')),
    simulator(f.city, () => Object.fromEntries(vts.map((vt) => [vt.id, Object.fromEntries(PRICE_FIELDS.map((k) => [k, Number(inputs[vt.id][k].value) || 0]))]))));
}

function simulator(cityId, getRules) {
  const kmIn = numIn(8, { step: 0.5, min: 0 }); const minIn = numIn(20, { min: 0 }); const waitIn = numIn(0, { min: 0 }); const surgeIn = numIn(1, { step: 0.1, min: 1 });
  const airport = h('input', { type: 'checkbox' });
  const out = h('div');
  const run = () => {
    const rules = getRules();
    const vts = read('vehicleTypes').filter((v) => rules[v.id]);
    mount(out, table([
      { label: t('admin.vehicle'), get: (r) => r.name }, { label: t('fare.base'), get: (r) => r.f.baseFare, render: (r) => money(r.f.baseFare), num: true },
      { label: t('fare.distance', { km: num(Number(kmIn.value), 1) }), get: (r) => r.f.distanceFare, render: (r) => money(r.f.distanceFare), num: true },
      { label: t('fare.time', { min: num(Number(minIn.value)) }), get: (r) => r.f.timeFare, render: (r) => money(r.f.timeFare), num: true },
      { label: t('fare.waiting'), get: (r) => r.f.waitingFare, render: (r) => money(r.f.waitingFare), num: true },
      { label: t('fare.surge', { x: num(Number(surgeIn.value), 1) }), get: (r) => r.f.surgeAmount, render: (r) => money(r.f.surgeAmount), num: true },
      { label: t('fare.fees'), get: (r) => r.f.fees, render: (r) => money(r.f.fees), num: true },
      { label: t('fare.total'), get: (r) => r.f.total, render: (r) => h('b', {}, money(r.f.total), r.f.minimumApplied ? ' *' : ''), num: true },
    ], vts.map((v) => {
      try { return { name: `${v.icon} ${tr(v.name)}`, f: calculateFare(rules[v.id], { distanceM: Number(kmIn.value) * 1000, durationS: Number(minIn.value) * 60, waitingS: Number(waitIn.value) * 60, surgeMultiplier: Math.max(1, Number(surgeIn.value)), touchesAirport: airport.checked }) }; } catch { return null; }
    }).filter(Boolean)), h('small', { class: 'muted' }, `* ${t('fare.minimum_applied')}`));
  };
  for (const el of [kmIn, minIn, waitIn, surgeIn, airport]) el.addEventListener('input', run);
  setTimeout(run);
  return h('div', { class: 'card col' }, h('div', { class: 'row wrap' }, field(t('admin.sim_km'), kmIn), field(t('admin.sim_min'), minIn), field(t('admin.sim_wait'), waitIn), field(t('admin.sim_surge'), surgeIn), h('label', { class: 'check' }, airport, t('admin.sim_airport'))), out);
}

function surge() {
  const f = (st.filters.surge ??= { city: 'erbil' });
  const list = read('surgeRules').filter((r) => r.cityId === f.city);
  const state = read('surgeState');
  const zones = read('zones').filter((z) => z.cityId === f.city);
  const DAYS = [0, 1, 2, 3, 4, 5, 6];
  const editor = (rule) => {
    const en = h('input', { type: 'checkbox', checked: rule.isEnabled });
    const mn = numIn(rule.minMultiplier, { step: 0.1, min: 1 }); const mx = numIn(rule.maxMultiplier, { step: 0.1, min: 1 });
    const th = numIn(rule.ratioThreshold, { step: 0.1, min: 0 }); const sens = numIn(rule.sensitivity, { step: 0.05, min: 0 }); const step = numIn(rule.stepSize, { step: 0.05, min: 0.05 });
    const manual = numIn(rule.manualMultiplier ?? '', { step: 0.1, min: 1, placeholder: '—' });
    const windows = structuredClone(rule.schedule ?? []);
    const winBox = h('div', { class: 'col' });
    const drawWin = () => mount(winBox, windows.map((w, i) => h('div', { class: 'row wrap card flat', style: { padding: '8px' } },
      DAYS.map((d) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !w.days?.length || w.days.includes(d), onchange: (e) => { const set = new Set(w.days?.length ? w.days : DAYS); e.target.checked ? set.add(d) : set.delete(d); w.days = [...set].sort(); } }), t(`day.${d}`))),
      h('input', { class: 'input', type: 'time', value: w.from, style: { width: 'auto' }, onchange: (e) => { w.from = e.target.value; } }), '→',
      h('input', { class: 'input', type: 'time', value: w.to, style: { width: 'auto' }, onchange: (e) => { w.to = e.target.value; } }), '×',
      h('input', { class: 'input num', type: 'number', step: 0.1, min: 1, value: w.multiplier, style: { width: '80px' }, onchange: (e) => { w.multiplier = Number(e.target.value); } }),
      h('button', { class: 'btn sm ghost', onclick: () => { windows.splice(i, 1); drawWin(); } }, '✕'))),
    h('button', { class: 'btn sm', onclick: () => { windows.push({ days: [0, 1, 2, 3, 4], from: '07:00', to: '09:00', multiplier: 1.2 }); drawWin(); } }, '+ ', t('admin.add_window')));
    drawWin();
    const s = state[rule.id];
    const save = () => attempt(() => {
      const lo = Number(mn.value); const hi = Number(mx.value);
      if (!(lo >= 1 && hi >= lo)) throw new E.AppError('err.surge_range');
      const perm = can('surge.update') ? 'surge.update' : 'surge.override';
      E.adminSave(admin(), perm, 'surgeRules', 'surge.update', (rs) => {
        const r = rs.find((x) => x.id === rule.id);
        r.manualMultiplier = manual.value === '' ? null : Math.max(1, Number(manual.value));
        if (perm === 'surge.update') Object.assign(r, { isEnabled: en.checked, minMultiplier: lo, maxMultiplier: hi, ratioThreshold: Number(th.value), sensitivity: Number(sens.value), stepSize: Number(step.value), schedule: windows });
        else r.isEnabled = en.checked;
      });
      E.adminSave(admin(), perm, 'surgeState', 'surge.recalc', (ss) => { delete ss[rule.id]; });
      ok(); renderPage();
    });
    const full = can('surge.update');
    for (const el of [mn, mx, th, sens, step]) el.disabled = !full;
    return h('div', { class: 'card col' },
      h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, rule.zoneId ? `${t('admin.zone')}: ${tr(zones.find((z) => z.id === rule.zoneId)?.name)}` : t('admin.city_default')),
        h('div', { class: 'row' }, badge(`${t('admin.demand')}: ${num(s?.demand ?? 0)}`), badge(`${t('admin.supply')}: ${num(s?.supply ?? 0)}`), badge(`×${num(s?.multiplier ?? 1, 1)}`, (s?.multiplier ?? 1) > 1 ? 'warn' : 'good'))),
      h('label', { class: 'check' }, en, t('admin.surge_enabled')),
      h('div', { class: 'grid grid-kpi' }, field(t('surge.min'), mn), field(t('surge.max'), mx), field(t('surge.threshold'), th), field(t('surge.sensitivity'), sens), field(t('surge.step'), step), field(t('surge.manual'), manual, t('surge.manual_hint'))),
      h('b', {}, t('admin.peak_windows')), full ? winBox : h('small', { class: 'muted' }, t('admin.only_override')),
      h('div', { class: 'row' }, rule.zoneId ? guard('surge.update', h('button', { class: 'btn', onclick: () => attempt(() => { E.adminSave(admin(), 'surge.update', 'surgeRules', 'surge.delete', (rs) => rs.filter((x) => x.id !== rule.id)); renderPage(); }) }, t('common.delete'))) : null,
        h('div', { class: 'grow' }), guard(full ? 'surge.update' : 'surge.override', h('button', { class: 'btn primary', onclick: save }, t('common.save')))));
  };
  const freeZones = zones.filter((z) => !list.some((r) => r.zoneId === z.id));
  mount(els.main, header(t('adminNav.surge'), select(read('cities').map((c) => [c.id, tr(c.name)]), f.city, (v) => { f.city = v; renderPage(); })),
    h('p', { class: 'text-2' }, t('admin.surge_hint')),
    h('div', { class: 'col' }, list.sort((a, b) => (a.zoneId ? 1 : 0) - (b.zoneId ? 1 : 0)).map(editor)),
    freeZones.length && can('surge.update') ? h('div', { class: 'row', style: { marginTop: '12px' } }, t('admin.add_zone_surge'), select(freeZones.map((z) => [z.id, tr(z.name)]), freeZones[0].id, (v) => {
      E.adminSave(admin(), 'surge.update', 'surgeRules', 'surge.create', (rs) => { const base = rs.find((x) => x.cityId === f.city && !x.zoneId); rs.push({ ...structuredClone(base), id: uid('sr-'), zoneId: v, manualMultiplier: null }); });
      renderPage();
    }, { id: 'zone-surge' })) : null);
}

function commission() {
  const rules = read('commissionRules');
  const scope = (r) => [r.driverId ? `${t('admin.driver')}: ${driverById(r.driverId)?.name ?? r.driverId}` : null, r.zoneId ? `${t('admin.zone')}: ${tr(read('zones').find((z) => z.id === r.zoneId)?.name)}` : null,
    r.vehicleTypeId ? vtName(r.vehicleTypeId) : null, r.cityId ? cityName(r.cityId) : null].filter(Boolean).join(' – ') || t('admin.global');
  mount(els.main, header(t('adminNav.commission'), guard('commission.update', h('button', { class: 'btn', onclick: () => commissionModal({}) }, '+ ', t('admin.add_rule')))),
    h('p', { class: 'text-2' }, t('admin.commission_hint')),
    table([
      { label: t('admin.scope'), get: scope },
      { label: t('admin.type'), get: (r) => t(`commissionType.${r.type}`) },
      { label: '%', get: (r) => r.percent ?? 0, render: (r) => (r.type === 'FIXED' ? '—' : `${num(r.percent, 1)}%`), num: true },
      { label: t('admin.fixed'), get: (r) => r.fixed ?? 0, render: (r) => (r.type === 'PERCENTAGE' ? '—' : money(r.fixed)), num: true },
      { label: t('admin.validity'), get: (r) => r.validFrom ?? '', render: (r) => (r.validFrom || r.validTo ? `${r.validFrom ?? '…'} → ${r.validTo ?? '…'}` : t('admin.always')) },
      { label: t('admin.active'), get: (r) => r.isActive, render: (r) => (r.isActive ? '✓' : '—') },
      { label: t('admin.example'), render: (r) => { const fare = 20000; const pct = r.type === 'FIXED' ? 0 : r.percent ?? 0; const fx = r.type === 'PERCENTAGE' ? 0 : r.fixed ?? 0; const c = Math.min(fare, Math.round((fare * pct) / 100) + fx); return `${money(fare)} → ${money(fare - c)}`; } },
    ], rules, { onRow: (r) => commissionModal(r) }));
}

function commissionModal(r) {
  const type = select(['PERCENTAGE', 'FIXED', 'PERCENTAGE_PLUS_FIXED'].map((x) => [x, t(`commissionType.${x}`)]), r.type ?? 'PERCENTAGE');
  const pct = numIn(r.percent ?? 20, { step: 0.5, min: 0, max: 100 }); const fixed = numIn(r.fixed ?? 0, { step: 250, min: 0 });
  const city = select([['', '—'], ...read('cities').map((c) => [c.id, tr(c.name)])], r.cityId ?? '');
  const zone = select([['', '—'], ...read('zones').map((z) => [z.id, `${cityName(z.cityId)} – ${tr(z.name)}`])], r.zoneId ?? '');
  const vt = select([['', '—'], ...read('vehicleTypes').map((v) => [v.id, tr(v.name)])], r.vehicleTypeId ?? '');
  const drv = select([['', '—'], ...read('drivers').filter((d) => d.status === 'APPROVED').map((d) => [d.id, d.name])], r.driverId ?? '');
  const from = h('input', { class: 'input', type: 'date', value: r.validFrom ?? '' }); const to = h('input', { class: 'input', type: 'date', value: r.validTo ?? '' });
  const active = h('input', { type: 'checkbox', checked: r.isActive ?? true });
  modal(r.id ? t('admin.edit_rule') : t('admin.add_rule'), h('div', { class: 'col' }, h('div', { class: 'grid grid-2' }, field(t('admin.type'), type), field('%', pct), field(t('admin.fixed'), fixed)),
    h('b', {}, t('admin.scope')), h('div', { class: 'grid grid-2' }, field(t('admin.city'), city), field(t('admin.zone'), zone), field(t('admin.vehicle'), vt), field(t('admin.driver'), drv)),
    h('div', { class: 'grid grid-2' }, field(t('admin.valid_from'), from), field(t('admin.valid_to'), to)), h('label', { class: 'check' }, active, t('admin.active'))),
  [r.id ? { label: t('common.delete'), kind: 'danger', value: () => 'delete' } : null, { label: t('common.cancel'), value: () => null }, { label: t('common.save'), kind: 'primary', value: () => 'save' }].filter(Boolean)).then((v) => {
    if (!v) return;
    attempt(() => {
      if (v === 'delete' && r.id === 'cm-global') throw new E.AppError('err.keep_global');
      E.adminSave(admin(), 'commission.update', 'commissionRules', v === 'delete' ? 'commission.delete' : r.id ? 'commission.update' : 'commission.create', (list) => {
        if (v === 'delete') return list.filter((x) => x.id !== r.id);
        const data = { type: type.value, percent: Number(pct.value), fixed: Math.round(Number(fixed.value)), cityId: city.value || null, zoneId: zone.value || null, vehicleTypeId: vt.value || null, driverId: drv.value || null, validFrom: from.value || null, validTo: to.value || null, isActive: active.checked };
        if (!(data.percent >= 0 && data.percent <= 100)) throw new E.AppError('err.bad_percent');
        if (r.id) Object.assign(list.find((x) => x.id === r.id), data); else list.push({ id: uid('cm-'), ...data });
        return undefined;
      });
      ok(); if (st.page === 'commission') renderPage();
    });
  });
}

function cancellation() {
  const c = read('cancellation');
  const p = c.policy;
  const fields = { freeWindowS: numIn(p.freeWindowS), fee: numIn(p.fee, { step: 250 }), feeAfterArrived: numIn(p.feeAfterArrived, { step: 250 }), noShowAfterS: numIn(p.noShowAfterS), driverWarnRatePct: numIn(p.driverWarnRatePct) };
  const reasons = structuredClone(c.reasons);
  const box = h('div', { class: 'grid grid-2' });
  const drawReasons = () => mount(box, ['CUSTOMER', 'DRIVER'].map((actor) => h('div', { class: 'card col' }, h('h3', {}, t(`actor.${actor}`)),
    reasons[actor].map((r, i) => h('div', { class: 'row' }, h('input', { class: 'input', value: r.ar, oninput: (e) => { r.ar = e.target.value; } }), h('input', { class: 'input ltr', value: r.en, oninput: (e) => { r.en = e.target.value; } }),
      h('button', { class: 'btn sm ghost', onclick: () => { reasons[actor].splice(i, 1); drawReasons(); } }, '✕'))),
    h('button', { class: 'btn sm', onclick: () => { reasons[actor].push({ ar: '', en: '', ckb: '' }); drawReasons(); } }, '+ ', t('common.add')))));
  drawReasons();
  mount(els.main, header(t('adminNav.cancellation'), guard('cancellation_policy.update', h('button', { class: 'btn primary', onclick: () => attempt(() => {
    E.adminSave(admin(), 'cancellation_policy.update', 'cancellation', 'cancellation.update', () => ({
      policy: Object.fromEntries(Object.entries(fields).map(([k, el]) => [k, Math.max(0, Math.round(Number(el.value)))])),
      reasons: Object.fromEntries(Object.entries(reasons).map(([k, list]) => [k, list.filter((r) => r.ar.trim()).map((r) => ({ ar: r.ar.trim(), en: r.en.trim() || r.ar.trim(), ckb: r.ckb || r.ar.trim() }))])),
    }));
    ok(); renderPage();
  }) }, t('common.save')))),
  h('div', { class: 'card col' }, h('h3', {}, t('admin.policy')), h('div', { class: 'grid grid-kpi' }, Object.entries(fields).map(([k, el]) => field(t(`cancel.${k}`), el))), h('small', { class: 'muted' }, t('admin.cancel_hint'))),
  h('h3', { style: { marginTop: '16px' } }, t('admin.reasons')), box);
}

function promotions() {
  mount(els.main, header(t('adminNav.promotions'), guard('promotions.manage', h('button', { class: 'btn', onclick: () => promoModal({}) }, '+ ', t('admin.add_promo')))),
    table([
      { label: t('admin.code'), get: (p) => p.code ?? '', render: (p) => (p.code ? h('span', { class: 'plate' }, p.code) : '—') },
      { label: t('admin.title'), get: (p) => tr(p.title) }, { label: t('admin.type'), get: (p) => t(`promoType.${p.type}`) },
      { label: t('admin.value'), get: (p) => p.percent ?? p.amount ?? p.bonus ?? 0, render: (p) => (p.type === 'DRIVER_INCENTIVE' ? `${num(p.tripsPerDay)} → ${money(p.bonus)}` : p.percent != null ? `${num(p.percent)}%${p.maxDiscount ? ` (≤ ${money(p.maxDiscount)})` : ''}` : money(p.amount)) },
      { label: t('admin.validity'), get: (p) => p.endsAt, render: (p) => `${p.startsAt} → ${p.endsAt}` },
      { label: t('admin.usage'), get: (p) => p.usedCount, render: (p) => `${num(p.usedCount)}${p.totalLimit ? ` / ${num(p.totalLimit)}` : ''}`, num: true },
      { label: t('admin.active'), get: (p) => p.isActive, render: (p) => (p.isActive ? badge(t('admin.active'), 'good') : badge(t('admin.inactive'))) },
    ], read('promotions'), { onRow: (p) => promoModal(p) }),
    h('div', { class: 'card col', style: { marginTop: '16px' } }, h('h3', {}, '🎁 ', t('account.referral')),
      h('p', { class: 'text-2' }, t('admin.referral_hint', { a: money(read('settings').referrerBonus), b: money(read('settings').refereeBonus) })),
      h('button', { class: 'btn sm', onclick: () => go('settings') }, t('adminNav.settings'))));
}

function promoModal(p) {
  const title = namesFields(p.title);
  const code = textIn(p.code ?? '', { class: 'input ltr' });
  const type = select(['PERCENTAGE', 'FIXED', 'FIRST_TRIP', 'DRIVER_INCENTIVE'].map((x) => [x, t(`promoType.${x}`)]), p.type ?? 'PERCENTAGE');
  const pct = numIn(p.percent ?? ''); const amount = numIn(p.amount ?? '', { step: 250 }); const maxD = numIn(p.maxDiscount ?? '', { step: 250 }); const minF = numIn(p.minFare ?? '', { step: 250 });
  const tripsPerDay = numIn(p.tripsPerDay ?? 10); const bonus = numIn(p.bonus ?? 10000, { step: 1000 });
  const start = h('input', { class: 'input', type: 'date', value: p.startsAt ?? E.localParts().date }); const end = h('input', { class: 'input', type: 'date', value: p.endsAt ?? E.localParts(Date.now() + 30 * 86_400_000).date });
  const total = numIn(p.totalLimit ?? ''); const perUser = numIn(p.perUserLimit ?? 1, { min: 1 });
  const cities = h('div', { class: 'row wrap' }, read('cities').map((c) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: c.id, checked: (p.cityIds ?? []).includes(c.id) }), tr(c.name))));
  const active = h('input', { type: 'checkbox', checked: p.isActive ?? true });
  modal(p.id ? tr(p.title) : t('admin.add_promo'), h('div', { class: 'col' }, title.el, h('div', { class: 'grid grid-2' }, field(t('admin.code'), code), field(t('admin.type'), type), field('%', pct), field(t('admin.fixed'), amount), field(t('admin.max_discount'), maxD), field(t('admin.min_fare'), minF)),
    h('div', { class: 'grid grid-2' }, field(t('admin.incentive_trips'), tripsPerDay), field(t('admin.incentive_bonus'), bonus)),
    h('div', { class: 'grid grid-2' }, field(t('admin.valid_from'), start), field(t('admin.valid_to'), end), field(t('admin.total_limit'), total), field(t('admin.per_user'), perUser)),
    field(t('admin.cities_all_if_empty'), cities), h('label', { class: 'check' }, active, t('admin.active'))),
  [p.id ? { label: t('common.delete'), kind: 'danger', value: () => 'delete' } : null, { label: t('common.cancel'), value: () => null }, { label: t('common.save'), kind: 'primary', value: () => 'save' }].filter(Boolean)).then((v) => {
    if (!v) return;
    attempt(() => {
      E.adminSave(admin(), 'promotions.manage', 'promotions', v === 'delete' ? 'promo.delete' : p.id ? 'promo.update' : 'promo.create', (list) => {
        if (v === 'delete') return list.filter((x) => x.id !== p.id);
        const n = (el) => (el.value === '' ? null : Number(el.value));
        const ty = type.value;
        const c0 = code.value.trim().toUpperCase() || null;
        if (ty !== 'DRIVER_INCENTIVE' && !c0) throw new E.AppError('err.code_required');
        if (c0 && list.some((x) => x.code === c0 && x.id !== p.id)) throw new E.AppError('err.exists');
        if (start.value > end.value) throw new E.AppError('err.bad_dates');
        const data = { title: title.get(), code: ty === 'DRIVER_INCENTIVE' ? null : c0, type: ty, percent: ty === 'FIXED' ? null : n(pct), amount: ty === 'FIXED' ? n(amount) : null, maxDiscount: n(maxD), minFare: n(minF),
          tripsPerDay: n(tripsPerDay), bonus: n(bonus), startsAt: start.value, endsAt: end.value, totalLimit: n(total), perUserLimit: n(perUser) ?? 1,
          cityIds: [...cities.querySelectorAll('input:checked')].map((x) => x.value), vehicleTypeIds: p.vehicleTypeIds ?? [], isActive: active.checked };
        if (ty === 'FIXED' && !data.amount) throw new E.AppError('err.fill_all');
        if ((ty === 'PERCENTAGE' || ty === 'FIRST_TRIP') && !(data.percent > 0 && data.percent <= 100)) throw new E.AppError('err.bad_percent');
        if (p.id) Object.assign(list.find((x) => x.id === p.id), data); else list.push({ id: uid('pm-'), usedCount: 0, ...data });
        return undefined;
      });
      ok(); renderPage();
    });
  });
}

// ───────────────────────────── finance ─────────────────────────────

function finance() {
  const f = (st.filters.finance ??= { owner: '', type: '' });
  const trips = read('trips').filter((x) => x.status === 'COMPLETED');
  const wallets = read('wallets');
  const payments = read('payments');
  const debts = Object.entries(wallets).filter(([k, w]) => k.startsWith('d:') && w.balance < 0).reduce((s, [, w]) => s - w.balance, 0);
  const liabilities = Object.entries(wallets).filter(([k, w]) => k.startsWith('c:') && w.balance > 0).reduce((s, [, w]) => s + w.balance, 0);
  const out = h('div');
  const draw = () => mount(out, table([
    { label: t('admin.time'), get: (x) => x.ts, render: (x) => dateTime(x.ts) },
    { label: t('admin.owner'), get: (x) => x.owner, render: (x) => ownerName(x.owner) },
    { label: t('admin.type'), get: (x) => t(`tx.${x.type}`) },
    { label: t('wallet.amount'), get: (x) => x.amount, render: (x) => h('span', { style: { color: x.amount < 0 ? 'var(--bad)' : 'var(--good)' } }, money(x.amount)), num: true },
    { label: t('admin.balance_after'), get: (x) => x.balanceAfter, render: (x) => money(x.balanceAfter), num: true },
    { label: t('trips.trip'), get: (x) => x.tripId ?? '', render: (x) => (x.tripId ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); tripDetail(x.tripId); } }, read('trips').find((tt) => tt.id === x.tripId)?.code ?? '') : x.note ?? '') },
  ], read('walletTx').filter((x) => (!f.owner || x.owner.startsWith(f.owner)) && (!f.type || x.type === f.type)).reverse()));
  const cashTrips = trips.filter((x) => x.paymentMethod === 'CASH');
  mount(els.main, header(t('adminNav.finance'), h('button', { class: 'btn', onclick: () => downloadCsv('ledger.csv', [['time', 'owner', 'type', 'amount', 'balance_after', 'trip'], ...read('walletTx').map((x) => [new Date(x.ts).toISOString(), x.owner, x.type, x.amount, x.balanceAfter, x.tripId ?? ''])]) }, '⬇ CSV')),
    h('div', { class: 'grid grid-kpi' },
      kpi(t('fin.gross'), money(trips.reduce((s, x) => s + grossOf(x), 0))),
      kpi(t('fin.cash_collected'), money(cashTrips.reduce((s, x) => s + fareOf(x), 0)), t('fin.cash_share', { p: num(trips.length ? (cashTrips.length / trips.length) * 100 : 0) })),
      kpi(t('fin.online_collected'), money(payments.filter((p) => p.status === 'CAPTURED').reduce((s, p) => s + p.amount, 0))),
      kpi(t('kpi.commission'), money(trips.reduce((s, x) => s + (x.final?.commission ?? 0), 0))),
      kpi(t('fin.promo_cost'), money(trips.reduce((s, x) => s + (x.final?.fare.discount ?? 0), 0))),
      kpi(t('fin.cash_debts'), money(debts)), kpi(t('fin.liabilities'), money(liabilities)), kpi(t('fin.platform_wallet'), money(wallets.platform?.balance ?? 0))),
    h('div', { class: 'row between', style: { margin: '18px 0 8px' } }, h('h3', { style: { margin: 0 } }, t('fin.ledger')),
      guard('wallets.adjust', h('button', { class: 'btn sm', onclick: async () => {
        const key = await modal(t('admin.adjust_wallet'), field(t('admin.owner'), select([...read('customers').map((c) => [`c:${c.id}`, `${t('actor.CUSTOMER')} – ${c.name}`]), ...read('drivers').map((d) => [`d:${d.id}`, `${t('actor.DRIVER')} – ${d.name}`])], '', null, { id: 'owner-sel' })), [{ label: t('common.continue'), kind: 'primary', value: () => document.getElementById('owner-sel').value }]);
        if (key) adjustModal(key, () => renderPage());
      } }, t('admin.adjust_wallet')))),
    h('div', { class: 'toolbar' }, select([['', t('admin.all_owners')], ['c:', t('actor.CUSTOMER')], ['d:', t('actor.DRIVER')], ['platform', t('fin.platform')]], f.owner, (v) => { f.owner = v; draw(); }),
      select([['', t('admin.all_types')], ...['TOP_UP', 'TRIP_PAYMENT', 'TRIP_EARNING', 'COMMISSION', 'PROMO_REIMBURSEMENT', 'DEBT_SETTLEMENT', 'REFUND', 'REFERRAL_BONUS', 'DRIVER_BONUS', 'WITHDRAWAL', 'CANCELLATION_FEE', 'ADJUSTMENT'].map((x) => [x, t(`tx.${x}`)])], f.type, (v) => { f.type = v; draw(); })),
    out,
    h('h3', { style: { marginTop: '18px' } }, t('fin.payments')),
    table([{ label: t('admin.time'), get: (p) => p.ts, render: (p) => dateTime(p.ts) }, { label: t('admin.owner'), get: (p) => p.userKey, render: (p) => ownerName(p.userKey) }, { label: t('admin.method'), get: (p) => t(`pay.${p.method}`) },
      { label: t('wallet.amount'), get: (p) => p.amount, render: (p) => money(p.amount), num: true }, { label: t('admin.ref'), get: (p) => p.gatewayRef }, { label: t('admin.status'), get: (p) => p.status }], payments.slice().reverse()));
  draw();
}

function ownerName(key) {
  if (key === 'platform') return t('fin.platform');
  const id = key.slice(2);
  return key.startsWith('c:') ? `👤 ${customerById(id)?.name ?? id}` : `🧑‍✈️ ${driverById(id)?.name ?? id}`;
}

function payouts() {
  const list = read('payouts').slice().sort((a, b) => (a.status !== 'REQUESTED') - (b.status !== 'REQUESTED') || b.createdAt - a.createdAt);
  const debtors = read('drivers').filter((d) => E.cashDebt(d.id) > 0).sort((a, b) => E.cashDebt(b.id) - E.cashDebt(a.id));
  const limit = read('settings').cashDebtLimit;
  mount(els.main, header(t('adminNav.payouts')),
    h('h3', {}, t('fin.payout_requests')),
    table([
      { label: t('admin.driver'), get: (p) => driverById(p.driverId)?.name ?? '' }, { label: t('wallet.amount'), get: (p) => p.amount, render: (p) => money(p.amount), num: true },
      { label: t('admin.method'), get: (p) => t(`pay.${p.method}`) }, { label: t('driver.destination'), get: (p) => p.destination, render: (p) => h('span', { class: 'ltr' }, p.destination) },
      { label: t('wallet.balance'), get: (p) => E.balance(`d:${p.driverId}`), render: (p) => money(E.balance(`d:${p.driverId}`)), num: true },
      { label: t('admin.date'), get: (p) => p.createdAt, render: (p) => dateTime(p.createdAt) },
      { label: t('admin.status'), get: (p) => p.status, render: (p) => badge(t(`payoutStatus.${p.status}`), { PAID: 'good', REJECTED: 'bad', REQUESTED: 'warn' }[p.status]) },
      { label: '', render: (p) => (p.status === 'REQUESTED' ? h('div', { class: 'row' }, guard('payouts.approve', h('button', { class: 'btn sm good', onclick: () => attempt(() => { E.processPayout(admin(), p.id, true); ok(); }) }, t('admin.approve'))),
        guard('payouts.approve', h('button', { class: 'btn sm danger', onclick: () => attempt(() => { E.processPayout(admin(), p.id, false); ok(); }) }, t('admin.reject')))) : '') },
    ], list, { empty: t('admin.no_rows') }),
    h('h3', { style: { marginTop: '18px' } }, t('fin.cash_debts')),
    h('p', { class: 'text-2' }, t('fin.debt_hint', { limit: money(limit) })),
    table([
      { label: t('admin.driver'), get: (d) => d.name }, { label: t('admin.city'), get: (d) => cityName(d.cityId) },
      { label: t('admin.debt'), get: (d) => E.cashDebt(d.id), render: (d) => h('b', { style: { color: E.cashDebt(d.id) > limit ? 'var(--bad)' : 'var(--warn)' } }, money(E.cashDebt(d.id))), num: true },
      { label: t('admin.status'), get: (d) => E.cashDebt(d.id) > limit, render: (d) => (E.cashDebt(d.id) > limit * 2 ? badge(t('fin.blocked_online'), 'bad') : E.cashDebt(d.id) > limit ? badge(t('fin.no_cash_trips'), 'warn') : badge(t('fin.ok'), 'good')) },
      { label: '', render: (d) => guard('payouts.approve', h('button', { class: 'btn sm', onclick: async () => {
        const amount = numIn(E.cashDebt(d.id), { step: 250 });
        const v = await modal(t('fin.record_office'), field(t('wallet.amount'), amount), [{ label: t('common.cancel'), value: () => null }, { label: t('common.save'), kind: 'primary', value: () => amount.value }]);
        if (v) attempt(() => { E.payDebt(d.id, v, 'CASH_OFFICE'); E.adminAudit(admin(), 'debt.office_payment', 'driver', d.id, { amount: Number(v) }); ok(); renderPage(); });
      } }, t('fin.record_office'))) },
    ], debtors, { empty: t('fin.no_debts') }));
}

// ───────────────────────────── reports ─────────────────────────────

function reports() {
  const f = (st.filters.reports ??= { days: 30, city: '', vt: '', driver: '', from: '', to: '' });
  const now = Date.now();
  const from = f.from ? new Date(`${f.from}T00:00:00+03:00`).getTime() : now - f.days * 86_400_000;
  const to = f.to ? new Date(`${f.to}T23:59:59+03:00`).getTime() : now;
  const all = read('trips').filter((x) => x.ts.requested >= from && x.ts.requested <= to && (!f.city || x.cityId === f.city) && (!f.vt || x.vehicleTypeId === f.vt) && (!f.driver || x.driverId === f.driver));
  const done = all.filter((x) => x.status === 'COMPLETED');
  const cancelled = all.filter((x) => x.status.startsWith('CANCELLED'));
  const failed = all.filter((x) => x.status === 'NO_DRIVER_FOUND');
  const sum = (arr, g) => arr.reduce((s, x) => s + (g(x) ?? 0), 0);
  const avg = (arr, g) => (arr.length ? sum(arr, g) / arr.length : 0);

  // daily series
  const days = [];
  for (let d = from; d <= to; d += 86_400_000) days.push(E.localParts(d).date);
  const byDay = new Map(days.map((d) => [d, { trips: 0, done: 0, revenue: 0, commission: 0, cancelled: 0 }]));
  for (const x of all) {
    const row = byDay.get(E.localParts(x.ts.requested).date);
    if (!row) continue;
    row.trips++;
    if (x.status === 'COMPLETED') { row.done++; row.revenue += grossOf(x); row.commission += x.final?.commission ?? 0; }
    if (x.status.startsWith('CANCELLED')) row.cancelled++;
  }
  const dayRows = [...byDay.entries()].map(([date, r]) => ({ date, ...r }));
  const shortDate = (d) => d.slice(5).replace('-', '/');
  const every = Math.ceil(dayRows.length / 10);

  // peak hours
  const hours = Array.from({ length: 24 }, (_, hr) => ({ hr, req: 0, done: 0, wait: [], price: [], surge: [] }));
  for (const x of all) {
    const hrow = hours[E.localParts(x.ts.requested).hour];
    hrow.req++;
    if (x.status === 'COMPLETED') { hrow.done++; hrow.price.push(fareOf(x)); }
    hrow.surge.push(x.surge ?? 1);
    if (x.ts.accepted) hrow.wait.push(x.pickupWaitS ?? (x.ts.accepted - x.ts.requested) / 1000 * read('settings').simSpeed);
  }
  const nDays = Math.max(1, Math.round((to - from) / 86_400_000));
  const supplyHist = read('meta').supplyByHour ?? {};
  const approved = read('drivers').filter((d) => d.status === 'APPROVED' && (!f.city || d.cityId === f.city)).length;
  const CURVE = [0.25, 0.15, 0.1, 0.08, 0.08, 0.2, 0.45, 0.7, 0.8, 0.75, 0.7, 0.7, 0.75, 0.75, 0.7, 0.7, 0.75, 0.85, 0.9, 0.85, 0.75, 0.65, 0.5, 0.35];
  const supplyAt = (hr) => {
    const cities = f.city ? [f.city] : read('cities').map((c) => c.id);
    const measured = cities.map((c) => supplyHist[c]?.[hr]).filter((v) => v != null);
    return measured.length === cities.length ? measured.reduce((a, b) => a + b, 0) : Math.round(approved * CURVE[hr]);
  };
  const maxReq = Math.max(1, ...hours.map((x) => x.req));
  const level = (r) => (r / maxReq > 0.8 ? 'very_high' : r / maxReq > 0.55 ? 'high' : r / maxReq > 0.3 ? 'normal' : 'low');

  // peak areas
  const zones = read('zones').filter((z) => !f.city || z.cityId === f.city);
  const areaRows = [
    ...read('cities').filter((c) => !f.city || c.id === f.city).map((c) => ({ name: tr(c.name), kind: t('admin.city'), n: all.filter((x) => x.cityId === c.id).length })),
    ...zones.map((z) => ({ name: tr(z.name), kind: t(`zoneKind.${z.kind}`), n: all.filter((x) => x.cityId === z.cityId && dist([x.pickup.lat, x.pickup.lng], z.center) <= z.radiusM).length })),
  ].sort((a, b) => b.n - a.n);

  // growth & retention
  const customers = read('customers'); const driversAll = read('drivers');
  const newCust = customers.filter((c) => c.createdAt >= from && c.createdAt <= to).length;
  const newDrv = driversAll.filter((d) => d.createdAt >= from && d.createdAt <= to).length;
  const span = to - from;
  const prevRiders = new Set(read('trips').filter((x) => x.status === 'COMPLETED' && x.ts.requested >= from - span && x.ts.requested < from).map((x) => x.customerId));
  const curRiders = new Set(done.map((x) => x.customerId));
  const retained = [...prevRiders].filter((id) => curRiders.has(id)).length;

  const exportDaily = () => downloadCsv('report-daily.csv', [['date', 'trips', 'completed', 'cancelled', 'revenue', 'commission'], ...dayRows.map((r) => [r.date, r.trips, r.done, r.cancelled, r.revenue, r.commission])]);
  const exportHourly = () => downloadCsv('report-peak-hours.csv', [['hour', 'requests_per_day', 'completed', 'available_drivers', 'avg_wait_min', 'avg_price', 'avg_surge', 'demand'],
    ...hours.map((x) => [x.hr, (x.req / nDays).toFixed(1), x.done, supplyAt(x.hr), (avg(x.wait, (v) => v) / 60).toFixed(1), Math.round(avg(x.price, (v) => v)), avg(x.surge, (v) => v).toFixed(2), level(x.req)])]);

  const fin = can('reports.finance');
  mount(els.main, header(t('adminNav.reports'), h('button', { class: 'btn', onclick: exportDaily }, '⬇ Excel'), h('button', { class: 'btn', onclick: () => window.print() }, '⬇ PDF')),
    h('div', { class: 'toolbar' },
      select([[7, t('report.last7')], [30, t('report.last30')], [90, t('report.last90')]], f.days, (v) => { f.days = Number(v); f.from = ''; f.to = ''; renderPage(); }),
      h('input', { class: 'input', type: 'date', value: f.from, onchange: (e) => { f.from = e.target.value; renderPage(); } }),
      h('input', { class: 'input', type: 'date', value: f.to, onchange: (e) => { f.to = e.target.value; renderPage(); } }),
      select([['', t('admin.all_cities')], ...read('cities').map((c) => [c.id, tr(c.name)])], f.city, (v) => { f.city = v; renderPage(); }),
      select([['', t('admin.all_vehicles')], ...read('vehicleTypes').map((v) => [v.id, tr(v.name)])], f.vt, (v) => { f.vt = v; renderPage(); }),
      select([['', t('admin.all_drivers')], ...read('drivers').filter((d) => d.trips > 0).map((d) => [d.id, d.name])], f.driver, (v) => { f.driver = v; renderPage(); })),
    h('div', { class: 'grid grid-kpi' },
      kpi(t('kpi.total_trips'), num(all.length)), kpi(t('kpi.completed'), num(done.length)), kpi(t('kpi.cancelled'), num(cancelled.length), `${num(cancellationRate(cancelled.length, all.length), 1)}%`),
      kpi(t('report.failed'), num(failed.length)),
      fin ? [kpi(t('kpi.revenue'), money(sum(done, grossOf))), kpi(t('kpi.commission'), money(sum(done, (x) => x.final?.commission))), kpi(t('kpi.driver_earnings'), money(sum(done, (x) => x.final?.driverEarning)))] : null,
      kpi(t('report.avg_distance'), km(avg(done, (x) => x.final?.distanceM))), kpi(t('report.avg_duration'), minutes(avg(done, (x) => x.final?.durationS))),
      kpi(t('report.new_customers'), num(newCust)), kpi(t('report.new_drivers'), num(newDrv)),
      kpi(t('report.retention'), `${num(prevRiders.size ? (retained / prevRiders.size) * 100 : 0)}%`, t('report.retention_hint')),
      kpi(t('kpi.online_drivers'), num(read('drivers').filter((d) => d.availability !== 'OFFLINE' && (!f.city || d.cityId === f.city)).length))),
    h('div', { class: 'grid grid-2', style: { marginTop: '16px' } },
      h('div', { class: 'card' }, h('h3', {}, t('report.trips_per_day')), barChart(dayRows.map((r) => ({ label: shortDate(r.date), value: r.trips, tip: `${r.date}: ${num(r.trips)} – ${t('kpi.completed')} ${num(r.done)}` })), { format: (v) => num(v), labelEvery: every, ariaLabel: t('report.trips_per_day') })),
      fin ? h('div', { class: 'card' }, h('h3', {}, t('report.revenue_per_day')), barChart(dayRows.map((r) => ({ label: shortDate(r.date), value: r.revenue, tip: `${r.date}: ${money(r.revenue)}` })), { format: (v) => (v >= 1000 ? `${num(v / 1000)}k` : num(v)), labelEvery: every, ariaLabel: t('report.revenue_per_day') })) : null),
    h('div', { class: 'card', style: { marginTop: '16px' } }, h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, '⏰ ', t('report.peak_hours')), h('button', { class: 'btn sm', onclick: exportHourly }, '⬇ CSV')),
      h('p', { class: 'text-2' }, t('report.peak_hint')),
      barChart(hours.map((x) => ({ label: String(x.hr).padStart(2, '0'), value: Number((x.req / nDays).toFixed(2)), tip: `${String(x.hr).padStart(2, '0')}:00 — ${num(x.req / nDays, 1)} ${t('report.per_day')}` })), { format: (v) => num(v, 1), labelEvery: 2, ariaLabel: t('report.peak_hours') }),
      table([
        { label: t('report.hour'), get: (x) => x.hr, render: (x) => `${String(x.hr).padStart(2, '0')}:00–${String((x.hr + 1) % 24).padStart(2, '0')}:00` },
        { label: t('report.demand'), get: (x) => x.req, render: (x) => badge(t(`demand.${level(x.req)}`), { very_high: 'bad', high: 'warn', normal: 'info', low: '' }[level(x.req)]) },
        { label: t('report.requests_day'), get: (x) => x.req, render: (x) => num(x.req / nDays, 1), num: true },
        { label: t('report.available'), get: (x) => supplyAt(x.hr), num: true },
        { label: t('kpi.completed'), get: (x) => x.done, num: true },
        { label: t('report.avg_wait'), get: (x) => avg(x.wait, (v) => v), render: (x) => (x.wait.length ? minutes(avg(x.wait, (v) => v)) : '—'), num: true },
        { label: t('report.avg_price'), get: (x) => avg(x.price, (v) => v), render: (x) => (x.price.length ? money(avg(x.price, (v) => v)) : '—'), num: true },
        { label: t('report.avg_surge'), get: (x) => avg(x.surge, (v) => v), render: (x) => `×${num(avg(x.surge, (v) => v) || 1, 2)}`, num: true },
      ], hours, { limit: 24 })),
    h('div', { class: 'grid grid-2', style: { marginTop: '16px' } },
      h('div', { class: 'card' }, h('h3', {}, '📍 ', t('report.peak_areas')), table([{ label: t('admin.name'), get: (r) => r.name }, { label: t('admin.kind'), get: (r) => r.kind }, { label: t('report.requests'), get: (r) => r.n, num: true }], areaRows)),
      h('div', { class: 'card' }, h('h3', {}, '⚖️ ', t('report.supply_demand')), table([
        { label: t('admin.city'), get: (c) => tr(c.name) },
        { label: t('admin.supply'), get: (c) => read('drivers').filter((d) => d.cityId === c.id && d.availability === 'ONLINE').length, num: true },
        { label: t('map.on_trip'), get: (c) => read('drivers').filter((d) => d.cityId === c.id && d.availability === 'ON_TRIP').length, num: true },
        { label: t('admin.demand'), get: (c) => read('surgeState')[`sr-${c.id}`]?.demand ?? 0, num: true },
        { label: '⚡', get: (c) => read('surgeState')[`sr-${c.id}`]?.multiplier ?? 1, render: (c) => `×${num(read('surgeState')[`sr-${c.id}`]?.multiplier ?? 1, 1)}`, num: true },
      ], read('cities').filter((c) => !f.city || c.id === f.city)))),
    h('div', { class: 'card', style: { marginTop: '16px' } }, h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, t('report.daily_table')), h('button', { class: 'btn sm', onclick: exportDaily }, '⬇ CSV')),
      table([{ label: t('admin.date'), get: (r) => r.date }, { label: t('kpi.trips'), get: (r) => r.trips, num: true }, { label: t('kpi.completed'), get: (r) => r.done, num: true }, { label: t('kpi.cancelled'), get: (r) => r.cancelled, num: true },
        fin ? { label: t('kpi.revenue'), get: (r) => r.revenue, render: (r) => money(r.revenue), num: true } : null, fin ? { label: t('kpi.commission'), get: (r) => r.commission, render: (r) => money(r.commission), num: true } : null].filter(Boolean), dayRows.slice().reverse(), { limit: 120 })));
}

// ───────────────────────────── system ─────────────────────────────

function broadcast() {
  let audience = 'all';
  const title = textIn(''); const body = h('textarea', { class: 'input' });
  const history = read('audit').filter((a) => a.action === 'notification.broadcast').reverse();
  mount(els.main, header(t('adminNav.broadcast')),
    h('div', { class: 'card col', style: { maxWidth: '640px' } },
      field(t('admin.audience'), select([['all', t('admin.everyone')], ['customers', t('admin.customers_only')], ['drivers', t('admin.drivers_only')]], audience, (v) => { audience = v; })),
      field(t('admin.title'), title), field(t('ticket.message'), body),
      h('small', { class: 'muted' }, t('admin.broadcast_hint')),
      h('button', { class: 'btn primary', onclick: () => attempt(() => { if (!title.value.trim() || !body.value.trim()) throw new E.AppError('err.fill_all'); E.broadcast(admin(), audience, title.value.trim(), body.value.trim()); ok(t('admin.sent')); renderPage(); }) }, t('admin.send'))),
    h('h3', { style: { marginTop: '18px' } }, t('admin.history')),
    table([{ label: t('admin.time'), get: (a) => a.ts, render: (a) => dateTime(a.ts) }, { label: t('admin.title'), get: (a) => a.after?.title ?? '' }, { label: t('admin.audience'), get: (a) => a.after?.audience ?? '' }, { label: t('admin.count'), get: (a) => a.after?.count ?? 0, num: true }], history));
}

function roles() {
  const rs = structuredClone(read('roles'));
  const editable = can('roles.manage');
  const groups = Object.entries(PERMISSIONS);
  const tbl = h('table', { class: 'table perm-grid' },
    h('thead', {}, h('tr', {}, h('th', {}, t('admin.permission')), Object.entries(rs).map(([k, r]) => h('th', {}, tr(r.name))))),
    h('tbody', {}, groups.flatMap(([g, perms]) => [h('tr', {}, h('td', { colspan: Object.keys(rs).length + 1, style: { background: 'var(--surface-2)', fontWeight: 700 } }, t(`permGroup.${g}`))),
      ...perms.map((p) => h('tr', {}, h('td', {}, h('span', { class: 'ltr' }, p)), Object.entries(rs).map(([k, r]) => h('td', {}, h('input', { type: 'checkbox', checked: r.perms.includes(p), disabled: !editable || k === 'SUPER_ADMIN',
        onchange: (e) => { r.perms = e.target.checked ? [...new Set([...r.perms, p])] : r.perms.filter((x) => x !== p); } })))))])));
  mount(els.main, header(t('adminNav.roles'),
    guard('roles.manage', h('button', { class: 'btn', onclick: async () => {
      const name = textIn('');
      const v = await modal(t('admin.add_role'), field(t('admin.name'), name), [{ label: t('common.cancel'), value: () => null }, { label: t('common.save'), kind: 'primary', value: () => name.value.trim() || false }]);
      if (!v) return;
      attempt(() => { E.adminSave(admin(), 'roles.manage', 'roles', 'role.create', (all) => { all[`CUSTOM_${Date.now().toString(36).toUpperCase()}`] = { name: { ar: v, en: v, ckb: v }, perms: ['dashboard.view'] }; }); renderPage(); });
    } }, '+ ', t('admin.add_role'))),
    guard('roles.manage', h('button', { class: 'btn primary', onclick: () => attempt(() => { E.adminSave(admin(), 'roles.manage', 'roles', 'roles.update', () => rs); ok(); renderSide(); }) }, t('common.save')))),
  h('p', { class: 'text-2' }, t('admin.roles_hint')), h('div', { class: 'table-wrap' }, tbl));
}

function audit() {
  mount(els.main, header(t('adminNav.audit')),
    table([
      { label: t('admin.time'), get: (a) => a.ts, render: (a) => dateTime(a.ts) },
      { label: t('admin.role'), get: (a) => a.admin, render: (a) => tr(read('roles')[a.admin]?.name) || a.admin },
      { label: t('admin.action'), get: (a) => a.action, render: (a) => h('span', { class: 'ltr' }, a.action) },
      { label: t('admin.entity'), get: (a) => `${a.entity}${a.entityId ? `:${a.entityId}` : ''}`, render: (a) => h('span', { class: 'ltr' }, `${a.entity}${a.entityId ? `:${a.entityId}` : ''}`) },
    ], read('audit').slice().reverse(), { onRow: (a) => modal(a.action, h('div', { class: 'col' }, h('b', {}, t('admin.before')), h('pre', { class: 'ltr', style: { whiteSpace: 'pre-wrap', fontSize: '.8rem', maxHeight: '200px', overflow: 'auto' } }, JSON.stringify(a.before, null, 1) ?? '—'),
      h('b', {}, t('admin.after')), h('pre', { class: 'ltr', style: { whiteSpace: 'pre-wrap', fontSize: '.8rem', maxHeight: '200px', overflow: 'auto' } }, JSON.stringify(a.after, null, 1) ?? '—')), [{ label: t('common.close'), value: () => true }]) }));
}

function settings() {
  const s = read('settings');
  const n = (k, attrs) => numIn(s[k], attrs);
  const f = {
    offerTimeoutS: n('offerTimeoutS', { min: 5, max: 60 }), batchSize: n('batchSize', { min: 1, max: 5 }), maxSearchS: n('maxSearchS', { min: 30 }), maxPickupEtaMin: numIn(Math.round(s.maxPickupEtaS / 60), { min: 1 }),
    radii: textIn(s.radiiM.join(', '), { class: 'input ltr' }), cashDebtLimit: n('cashDebtLimit', { step: 1000 }), fareTolerancePct: n('fareTolerancePct', { min: 0, max: 100 }),
    quoteValidityS: n('quoteValidityS', { min: 60 }), referrerBonus: n('referrerBonus', { step: 250 }), refereeBonus: n('refereeBonus', { step: 250 }), arriveRadiusM: n('arriveRadiusM', { min: 30 }),
    simSpeed: n('simSpeed', { min: 1, max: 30 }), botAcceptRate: n('botAcceptRate', { step: 0.05, min: 0, max: 1 }),
    wEta: numIn(s.weights.eta, { step: 0.05 }), wRating: numIn(s.weights.rating, { step: 0.05 }), wAcc: numIn(s.weights.acceptance, { step: 0.05 }), wIdle: numIn(s.weights.idle, { step: 0.05 }),
  };
  const osrm = h('input', { type: 'checkbox', checked: s.useOsrm }); const nomi = h('input', { type: 'checkbox', checked: s.useNominatim });
  const save = () => attempt(() => {
    const radii = f.radii.value.split(/[,،\s]+/).map(Number).filter((x) => x > 0).sort((a, b) => a - b);
    if (!radii.length) throw new E.AppError('err.fill_all');
    E.adminSave(admin(), 'settings.manage', 'settings', 'settings.update', (cur) => ({
      ...cur, offerTimeoutS: Number(f.offerTimeoutS.value), batchSize: Number(f.batchSize.value), maxSearchS: Number(f.maxSearchS.value), maxPickupEtaS: Number(f.maxPickupEtaMin.value) * 60, radiiM: radii,
      cashDebtLimit: Number(f.cashDebtLimit.value), fareTolerancePct: Number(f.fareTolerancePct.value), quoteValidityS: Number(f.quoteValidityS.value), referrerBonus: Number(f.referrerBonus.value),
      refereeBonus: Number(f.refereeBonus.value), arriveRadiusM: Number(f.arriveRadiusM.value), simSpeed: Number(f.simSpeed.value), botAcceptRate: Number(f.botAcceptRate.value),
      weights: { eta: Number(f.wEta.value), rating: Number(f.wRating.value), acceptance: Number(f.wAcc.value), idle: Number(f.wIdle.value) }, useOsrm: osrm.checked, useNominatim: nomi.checked,
    }));
    ok();
  });
  const sec = (title, ...kids) => h('div', { class: 'card col' }, h('h3', {}, title), h('div', { class: 'grid grid-kpi' }, ...kids));
  mount(els.main, header(t('adminNav.settings'), guard('settings.manage', h('button', { class: 'btn primary', onclick: save }, t('common.save')))),
    h('div', { class: 'col' },
      sec(t('set.matching'), field(t('set.offerTimeoutS'), f.offerTimeoutS), field(t('set.batchSize'), f.batchSize), field(t('set.radii'), f.radii), field(t('set.maxPickupEtaMin'), f.maxPickupEtaMin), field(t('set.maxSearchS'), f.maxSearchS), field(t('set.arriveRadiusM'), f.arriveRadiusM)),
      sec(t('set.weights'), field('ETA', f.wEta), field(t('admin.rating'), f.wRating), field(t('driver.acceptance'), f.wAcc), field(t('set.idle'), f.wIdle)),
      sec(t('set.money'), field(t('set.cashDebtLimit'), f.cashDebtLimit), field(t('set.fareTolerancePct'), f.fareTolerancePct), field(t('set.quoteValidityS'), f.quoteValidityS), field(t('set.referrerBonus'), f.referrerBonus), field(t('set.refereeBonus'), f.refereeBonus)),
      sec(t('set.providers'), h('label', { class: 'check' }, osrm, t('set.useOsrm')), h('label', { class: 'check' }, nomi, t('set.useNominatim'))),
      sec(t('set.demo'), field(t('set.simSpeed'), f.simSpeed), field(t('set.botAcceptRate'), f.botAcceptRate)),
      h('div', { class: 'card col' }, h('h3', {}, t('set.reset')), h('p', { class: 'text-2' }, t('set.reset_hint')),
        guard('settings.manage', h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox(t('set.reset_confirm'), t('set.reset'), 'danger')) { resetAll(); location.reload(); } } }, t('set.reset'))))));
}

// ── startup (kept last so every declaration above is initialised) ──
await boot();
root = document.getElementById('root');
start();
