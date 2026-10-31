// Driver app
import { boot, installCard, attempt, notificationText, watchNotifications, initials, readSession, writeSession, changeLanguage, relayout } from './lib/common.js';
import { t, tr } from './lib/i18n.js';
import { h, mount, money, km, minutes, dateTime, toast, modal, confirmBox, field, select, badge, langSwitcher, fileToThumb, num } from './lib/ui.js';
import { read, onChange } from './lib/db.js';
import * as E from './lib/engine.js';
import { createMap, icons, markerLayer, polyline, fit, L } from './lib/map.js';
import { dist, remainingM, googleMapsLink, zonesAt } from './lib/geo.js';
import { DOC_TYPES } from './lib/seed.js';
import { renderTickets } from './lib/support.js';
import { cancellationRate } from './core/index.js';

const SKEY = 'ride.session.driver';
const DKEY = 'ride.driver.dismissed';
const SPEED = 9;
const st = { driverId: readSession(SKEY), tab: 'home', sheetSig: '', dismissed: new Set(JSON.parse(readSession(DKEY) || '[]')) };
const me = () => read('drivers').find((d) => d.id === st.driverId);
const userKey = () => (st.driverId ? `d:${st.driverId}` : null);
let root; let els = {}; let map; let layer; let lines = []; let follow = true; let gpsWatch = null;


function start() {
  if (!me()) { writeSession(SKEY, null); st.driverId = null; return renderAuth(); }
  renderShell();
}

// ───────────────────────────── auth & registration ─────────────────────────────

function renderAuth() {
  let phone = '';
  const body = h('div', { class: 'page' });
  const phoneStep = () => {
    const input = h('input', { class: 'input ltr', type: 'tel', inputmode: 'tel', placeholder: '0750 000 0000' });
    mount(body,
      h('div', { class: 'center', style: { padding: '20px 0 6px' } }, h('div', { style: { fontSize: '3rem' } }, '🧑‍✈️'), h('h1', {}, t('app.driver')), h('p', { class: 'text-2' }, t('driver.welcome'))),
      field(t('auth.enter_phone'), input, t('auth.phone_hint')),
      h('button', { class: 'btn primary lg block', onclick: () => attempt(() => { phone = E.normalizePhone(input.value); otpStep(E.sendOtp(phone)); }) }, t('common.continue')),
      h('button', { class: 'btn ghost block', onclick: () => attempt(() => { phone = '+9647501111111'; otpStep(E.sendOtp(phone)); }) }, t('driver.demo_login')),
      h('div', { class: 'sep' }),
      h('div', { class: 'row between' }, h('a', { href: './' }, `← ${t('app.home')}`), langSwitcher(changeLanguage)));
  };
  const otpStep = (code) => {
    const input = h('input', { class: 'input otp', inputmode: 'numeric', maxlength: 6 });
    const verify = () => attempt(() => {
      E.verifyOtp(phone, input.value);
      const d = read('drivers').find((x) => x.phone === phone);
      if (d) login(d.id); else registerWizard(phone, body);
    });
    input.addEventListener('keydown', (e) => e.key === 'Enter' && verify());
    mount(body, h('h2', {}, t('auth.otp_title')), h('p', { class: 'text-2' }, t('auth.otp_sent', { phone })), h('div', { class: 'notice' }, t('auth.demo_code', { code })), input,
      h('button', { class: 'btn primary lg block', onclick: verify }, t('auth.verify')), h('button', { class: 'btn ghost', onclick: phoneStep }, t('auth.change_number')));
    input.focus();
  };
  mount(root, h('div', { class: 'app' }, h('div', { class: 'app-body' }, body)));
  phoneStep();
}

function registerWizard(phone, body) {
  const data = { phone, name: '', email: '', cityId: 'erbil', photo: null, cls: 'ECONOMY', make: '', model: '', year: '', color: '', plate: '', documents: DOC_TYPES.map((d) => ({ type: d.id, file: null, fileName: '', expiresAt: '', status: 'PENDING', reason: null })) };
  let step = 1;
  const draw = () => {
    const head = h('div', {}, h('small', {}, t('driver.step', { n: step, total: 3 })), h('h2', {}, t(`driver.step${step}`)));
    if (step === 1) {
      const name = h('input', { class: 'input', value: data.name, oninput: (e) => { data.name = e.target.value; } });
      const email = h('input', { class: 'input ltr', type: 'email', value: data.email, oninput: (e) => { data.email = e.target.value; } });
      const city = select(read('cities').filter((c) => c.active).map((c) => [c.id, tr(c.name)]), data.cityId, (v) => { data.cityId = v; });
      const photo = h('input', { type: 'file', accept: 'image/*', capture: 'user', onchange: async (e) => { if (e.target.files[0]) data.photo = await fileToThumb(e.target.files[0], 200); } });
      mount(body, head, field(t('profile.name'), name), field(`${t('profile.email')} (${t('common.optional')})`, email), field(t('driver.city'), city), field(t('profile.photo'), photo),
        h('button', { class: 'btn primary lg block', onclick: () => { if (data.name.trim().length < 2) return toast(t('err.name_required'), 'error'); step = 2; draw(); } }, t('common.next')));
    } else if (step === 2) {
      const inp = (k, attrs = {}) => h('input', { class: 'input', value: data[k], oninput: (e) => { data[k] = e.target.value; }, ...attrs });
      mount(body, head,
        field(t('driver.vehicle_class'), select(read('vehicleTypes').filter((v) => v.active).map((v) => [v.id, `${v.icon} ${tr(v.name)}`]), data.cls, (v) => { data.cls = v; })),
        h('div', { class: 'grid grid-2' }, field(t('driver.make'), inp('make', { placeholder: 'Toyota' })), field(t('driver.model'), inp('model', { placeholder: 'Corolla' }))),
        h('div', { class: 'grid grid-2' }, field(t('driver.year'), inp('year', { type: 'number', min: 2000, max: 2027 })), field(t('driver.color'), inp('color'))),
        field(t('driver.plate'), inp('plate', { class: 'input ltr' }), t('driver.plate_hint')),
        h('div', { class: 'row' }, h('button', { class: 'btn grow', onclick: () => { step = 1; draw(); } }, t('common.back')),
          h('button', { class: 'btn primary grow', onclick: () => {
            const y = Number(data.year);
            if (!data.make || !data.model || !data.color || !data.plate) return toast(t('err.fill_all'), 'error');
            if (!(y >= 2005 && y <= new Date().getFullYear() + 1)) return toast(t('err.bad_year'), 'error');
            step = 3; draw();
          } }, t('common.next'))));
    } else {
      mount(body, head, h('p', { class: 'text-2' }, t('driver.docs_hint')),
        DOC_TYPES.map((dt) => {
          const doc = data.documents.find((x) => x.type === dt.id);
          const thumb = h('div', { class: 'doc-thumb' }, doc.file ? h('img', { src: doc.file, class: 'doc-thumb', alt: '' }) : '📄');
          return h('div', { class: 'card col' }, h('b', {}, tr(dt.name)),
            h('div', { class: 'row' }, thumb, h('input', { type: 'file', accept: 'image/*', capture: 'environment', onchange: async (e) => {
              const f = e.target.files[0];
              if (!f) return;
              doc.file = await fileToThumb(f, 360);
              doc.fileName = f.name;
              mount(thumb, h('img', { src: doc.file, class: 'doc-thumb', alt: '' }));
            } })),
            dt.expiry ? field(t('driver.expiry'), h('input', { class: 'input', type: 'date', value: doc.expiresAt, oninput: (e) => { doc.expiresAt = e.target.value; } })) : null);
        }),
        h('div', { class: 'row' }, h('button', { class: 'btn grow', onclick: () => { step = 2; draw(); } }, t('common.back')),
          h('button', { class: 'btn primary grow', onclick: () => attempt(() => {
            const today = E.localParts().date;
            for (const dt of DOC_TYPES) {
              const doc = data.documents.find((x) => x.type === dt.id);
              if (!doc.file) throw new E.AppError('err.doc_missing', { doc: tr(dt.name) });
              if (dt.expiry && (!doc.expiresAt || doc.expiresAt <= today)) throw new E.AppError('err.doc_expiry', { doc: tr(dt.name) });
            }
            const d = E.registerDriver(data);
            toast(t('driver.submitted'), 'good');
            login(d.id);
          }) }, t('driver.submit'))));
    }
    body.scrollTop = 0;
  };
  draw();
}

function login(id) {
  // always land on the main screen, whatever tab the previous session ended on
  st.tab = 'home';
  st.driverId = id;
  writeSession(SKEY, id);
  renderShell();
}

function logout() {
  attempt(() => E.setAvailability(st.driverId, false));
  stopGps();
  writeSession(SKEY, null);
  st.driverId = null;
  map = null;
  renderAuth();
}

// ───────────────────────────── shell ─────────────────────────────

function renderShell() {
  els = { top: h('div', { class: 'app-top' }), home: h('div', { class: 'app-body' }), page: h('div', { class: 'app-body hidden' }), tabs: h('nav', { class: 'tabs' }) };
  els.mapEl = h('div', { class: 'map' });
  els.float = h('div', { class: 'float-top' });
  els.sheet = h('div', { class: 'sheet' });
  els.home.append(els.mapEl, els.float, els.sheet);
  mount(root, h('div', { class: 'app' }, els.top, els.home, els.page, els.tabs));
  const d = me();
  map = createMap(els.mapEl, d.loc, 15);
  layer = markerLayer(map);
  map.on('dragstart', () => { follow = false; });
  map.on('click', (e) => {
    // In simulated-driving mode an idle driver can tap the map to move the car (handy for testing)
    const cur = me();
    if (cur.autoDrive && cur.availability !== 'ON_TRIP') E.updateDriver(cur.id, (x) => { x.loc = [e.latlng.lat, e.latlng.lng]; });
  });
  if (!d.autoDrive) startGps();
  renderTop();
  renderTabs();
  render(true);
  onChange(relayout(() => render(false)));
  setInterval(() => render(false), 1000);
}

function renderTop() {
  if (!els.top) return;
  const unread = (read('notifications') ?? []).some((n) => n.to === userKey() && !n.read);
  mount(els.top,
    h('a', { href: './', class: 'icon-btn', style: { display: 'grid', placeItems: 'center', textDecoration: 'none' }, 'aria-label': t('app.home') }, '⌂'),
    h('div', { class: 'title' }, t('app.driver')),
    h('button', { class: 'icon-btn bell', 'aria-label': t('nav.notifications'), onclick: showNotifications }, '🔔', unread ? h('span', { class: 'dotn' }) : null),
    langSwitcher(changeLanguage));
}

function renderTabs() {
  const tabs = [['home', '🚗', t('nav.drive')], ['earnings', '📊', t('nav.earnings')], ['wallet', '👛', t('nav.wallet')], ['account', '👤', t('nav.account')]];
  mount(els.tabs, tabs.map(([id, i, label]) => h('button', { class: st.tab === id ? 'on' : '', onclick: () => { st.tab = id; renderTabs(); render(true); } }, h('span', { class: 'i' }, i), label)));
}

function startGps() {
  if (!navigator.geolocation || gpsWatch != null) return;
  gpsWatch = navigator.geolocation.watchPosition((p) => {
    if (p.coords.accuracy > 80) return; // ignore poor fixes
    E.driverGps(st.driverId, [p.coords.latitude, p.coords.longitude]);
  }, () => toast(t('driver.gps_error'), 'error'), { enableHighAccuracy: true, maximumAge: 3000 });
}

function stopGps() {
  if (gpsWatch != null) navigator.geolocation.clearWatch(gpsWatch);
  gpsWatch = null;
}

// ───────────────────────────── data helpers ─────────────────────────────

const myActiveTrip = () => read('trips').find((x) => x.driverId === st.driverId && E.WITH_DRIVER.includes(x.status));
const myOffer = () => {
  for (const trip of read('trips')) {
    if (trip.status !== 'SEARCHING') continue;
    const o = trip.offers.find((x) => x.driverId === st.driverId && x.status === 'SENT');
    if (o) return { trip, offer: o };
  }
  return null;
};
const lastUnrated = () => {
  const trip = read('trips').filter((x) => x.driverId === st.driverId && x.status === 'COMPLETED' && !x.historical).at(-1);
  return trip && !trip.ratings.byDriver && !st.dismissed.has(trip.id) ? trip : null;
};
function dismiss(id) {
  st.dismissed.add(id);
  writeSession(DKEY, JSON.stringify([...st.dismissed].slice(-50)));
  render(true);
}

// ───────────────────────────── home ─────────────────────────────

function render(force) {
  const d = me();
  if (!els.home || !d) return;
  const onHome = st.tab === 'home';
  els.home.classList.toggle('hidden', !onHome);
  els.page.classList.toggle('hidden', onHome);
  if (!onHome) { if (force) renderPage(); return; }
  const trip = myActiveTrip();
  const offer = trip ? null : myOffer();
  const done = trip || offer ? null : lastUnrated();
  renderMap(d, trip, offer);
  const sig = `${d.status}|${d.availability}|${trip?.id}|${trip?.status}|${trip?.chat.length}|${offer?.trip.id}|${done?.id}|${d.autoDrive}`;
  if (force || sig !== st.sheetSig) {
    st.sheetSig = sig;
    renderSheet(d, trip, offer, done);
  } else updateLive(d, trip, offer);
}

function renderMap(d, trip, offer) {
  for (const l of lines) map.removeLayer(l);
  lines = [];
  const items = [{ id: 'me', pos: d.loc, icon: icons.car(`me mk-${d.availability === 'OFFLINE' ? 'offline' : 'online'}`), iconKey: d.availability }];
  const t0 = trip ?? offer?.trip;
  if (t0) {
    const pickup = [t0.pickup.lat, t0.pickup.lng];
    const drop = [t0.dropoff.lat, t0.dropoff.lng];
    items.push({ id: 'pickup', pos: pickup, icon: icons.pickup(), iconKey: 'a' }, { id: 'drop', pos: drop, icon: icons.dropoff(), iconKey: 'b' });
    if (trip?.status === 'DRIVER_ARRIVING' && trip.approach) lines.push(polyline(map, trip.approach.slice(trip.progress?.idx ?? 0), 'approach'));
    if (t0.route) lines.push(polyline(map, trip?.status === 'IN_PROGRESS' ? t0.route.slice(trip.progress?.idx ?? 0) : t0.route, 'route'));
    if (follow) fit(map, trip?.status === 'IN_PROGRESS' ? [d.loc, drop] : [d.loc, pickup], 70);
  } else {
    for (const z of read('zones').filter((x) => x.cityId === d.cityId && x.active)) {
      const state = read('surgeState')[read('surgeRules').find((r) => r.zoneId === z.id)?.id];
      if (state?.multiplier > 1) lines.push(L.circle(z.center, { radius: z.radiusM, className: 'circle-airport' }).addTo(map));
    }
    if (follow) map.setView(d.loc, map.getZoom());
  }
  layer.sync(items);
}

function renderSheet(d, trip, offer, done) {
  mount(els.float);
  if (d.status !== 'APPROVED') return renderStatusSheet(d);
  if (trip) return renderTripSheet(d, trip);
  if (offer) return renderOffer(d, offer);
  if (done) return renderDone(d, done);
  return renderIdle(d);
}

function renderStatusSheet(d) {
  const kind = { PENDING: 'warn', UNDER_REVIEW: 'info', CHANGES_REQUESTED: 'warn', REJECTED: 'bad', SUSPENDED: 'bad', BLOCKED: 'bad', DOCUMENTS_EXPIRED: 'warn' }[d.status];
  const last = d.history.at(-1);
  mount(els.sheet,
    h('div', { class: 'status-line' }, t(`driverStatus.${d.status}`)),
    h('div', { class: `notice ${kind}` }, t(`driverStatusText.${d.status}`), last?.reason ? h('div', {}, h('b', {}, `${t('driver.reason')}: `), last.reason) : null),
    documentsList(d, true),
    h('small', { class: 'muted' }, t('driver.review_hint')));
}

function documentsList(d, allowUpload) {
  return h('div', { class: 'list' }, DOC_TYPES.map((dt) => {
    const doc = d.documents.find((x) => x.type === dt.id);
    const k = { APPROVED: 'good', PENDING: 'warn', REJECTED: 'bad', EXPIRED: 'bad' }[doc.status];
    const canUpload = allowUpload && ['REJECTED', 'EXPIRED'].includes(doc.status) || allowUpload === 'always';
    return h('div', { class: 'list-item', style: { cursor: 'default', flexWrap: 'wrap' } },
      doc.file ? h('img', { src: doc.file, class: 'doc-thumb', alt: '' }) : h('div', { class: 'doc-thumb' }, '📄'),
      h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, tr(dt.name)), h('small', {}, doc.expiresAt ? `${t('driver.expiry')}: ${doc.expiresAt}` : ''),
        doc.reason ? h('div', { class: 'notice bad', style: { marginTop: '4px', padding: '4px 8px' } }, doc.reason) : null),
      badge(t(`docStatus.${doc.status}`), k),
      canUpload ? h('button', { class: 'btn sm', onclick: () => reuploadModal(d, dt) }, t('driver.reupload')) : null);
  }));
}

function reuploadModal(d, dt) {
  let file = null; let name = '';
  const exp = h('input', { class: 'input', type: 'date' });
  modal(tr(dt.name), h('div', { class: 'col' }, h('input', { type: 'file', accept: 'image/*', capture: 'environment', onchange: async (e) => { if (e.target.files[0]) { file = await fileToThumb(e.target.files[0], 360); name = e.target.files[0].name; } } }),
    dt.expiry ? field(t('driver.expiry'), exp) : null),
  [{ label: t('common.cancel'), value: () => null }, { label: t('driver.submit'), kind: 'primary', value: () => true }]).then((ok) => {
    if (!ok) return;
    attempt(() => {
      if (!file) throw new E.AppError('err.doc_missing', { doc: tr(dt.name) });
      if (dt.expiry && (!exp.value || exp.value <= E.localParts().date)) throw new E.AppError('err.doc_expiry', { doc: tr(dt.name) });
      E.resubmitDocument(d.id, dt.id, file, name, exp.value);
      toast(t('driver.submitted'), 'good');
    });
  });
}

function todayStats(d) {
  const today = E.localParts().date;
  const trips = read('trips').filter((x) => x.driverId === d.id && x.status === 'COMPLETED' && x.ts.completed && E.localParts(x.ts.completed).date === today);
  return { count: trips.length, earnings: trips.reduce((s, x) => s + (x.final?.driverEarning ?? 0), 0) };
}

function renderIdle(d) {
  const online = d.availability === 'ONLINE';
  const s = todayStats(d);
  const debt = E.cashDebt(d.id);
  const limit = read('settings').cashDebtLimit;
  const surge = E.surgeFor(d.cityId, d.loc);
  const incentive = read('promotions').find((p) => p.type === 'DRIVER_INCENTIVE' && p.isActive);
  mount(els.float, h('div', { class: 'grow' }), h('button', { class: 'float-btn', onclick: () => { follow = true; render(false); } }, '◎'));
  mount(els.sheet,
    h('div', { class: 'row between' }, h('div', {}, h('small', {}, t('driver.today')), h('div', { class: 'num', style: { fontWeight: 800, fontSize: '1.3rem' } }, money(s.earnings))),
      h('div', { style: { textAlign: 'end' } }, h('small', {}, t('driver.trips_today')), h('div', { class: 'num', style: { fontWeight: 800, fontSize: '1.3rem' } }, num(s.count)))),
    debt > limit ? h('div', { class: 'notice bad' }, t('driver.cash_debt_limit', { amount: money(debt) })) : debt > limit * 0.7 ? h('div', { class: 'notice warn' }, t('driver.debt_warn', { amount: money(debt), limit: money(limit) })) : null,
    surge > 1 ? h('div', { class: 'surge' }, '⚡ ', t('driver.surge_here', { x: num(surge, 1) })) : null,
    incentive ? h('div', { class: 'notice' }, '🎯 ', tr(incentive.title), ` (${num(s.count)}/${num(incentive.tripsPerDay)})`) : null,
    h('button', { class: `btn big-toggle ${online ? 'danger' : 'good'}`, onclick: () => attempt(() => { E.setAvailability(d.id, !online); toast(t(online ? 'driver.now_offline' : 'driver.now_online'), 'good'); }) },
      online ? t('driver.go_offline') : t('driver.go_online')),
    online ? h('div', { class: 'row' }, h('div', { class: 'progress grow' }, h('i')), h('small', {}, t('driver.waiting_requests'))) : null,
    h('small', { class: 'muted' }, d.autoDrive ? t('driver.sim_hint') : t('driver.gps_hint')));
}

function renderOffer(d, { trip, offer }) {
  const vt = read('vehicleTypes').find((v) => v.id === trip.vehicleTypeId);
  const customer = read('customers').find((c) => c.id === trip.customerId);
  els.timer = h('div', { class: 'timer-ring center' });
  mount(els.sheet,
    h('div', { class: 'row between' }, h('div', { class: 'status-line' }, t('driver.new_request')), els.timer),
    h('div', { class: 'row between' }, h('span', {}, `${vt.icon} ${tr(vt.name)}`), h('b', { class: 'num', style: { fontSize: '1.3rem' } }, money(trip.est.fare.total))),
    h('div', { class: 'kv' },
      h('span', {}, t('driver.to_pickup')), h('span', {}, `${km(offer.distanceM)} – ${minutes(offer.etaS)}`),
      h('span', {}, t('driver.trip_length')), h('span', {}, `${km(trip.est.distanceM)} – ${minutes(trip.est.durationS)}`),
      h('span', {}, t('trips.payment')), h('span', {}, t(`pay.${trip.paymentMethod}`)),
      h('span', {}, t('driver.rider')), h('span', {}, `${customer?.name.split(' ')[0] ?? ''} ★ ${num(customer?.rating ?? 5, 1)}`),
      trip.surge > 1 ? [h('span', {}, t('fare.surge', { x: num(trip.surge, 1) })), h('span', {}, '⚡')] : null),
    tripAddresses(trip),
    h('div', { class: 'row' },
      h('button', { class: 'btn lg grow', onclick: () => attempt(() => E.respondOffer(trip.id, d.id, false)) }, t('driver.reject')),
      h('button', { class: 'btn primary lg grow', style: { flex: 2 }, onclick: () => attempt(() => { E.respondOffer(trip.id, d.id, true); follow = true; }) }, t('driver.accept'))));
  updateLive(d, null, { trip, offer });
}

function tripAddresses(trip) {
  return h('div', { class: 'col' },
    h('div', { class: 'addr' }, h('span', { class: 'dot a' }), h('div', { class: 'grow' }, trip.pickup.address, trip.pickup.note ? h('small', { style: { display: 'block' } }, `📝 ${trip.pickup.note}`) : null)),
    h('div', { class: 'addr' }, h('span', { class: 'dot b' }), h('div', { class: 'grow' }, trip.dropoff.address)));
}

function renderTripSheet(d, trip) {
  const customer = read('customers').find((c) => c.id === trip.customerId);
  const s = trip.status;
  const pickup = [trip.pickup.lat, trip.pickup.lng];
  const drop = [trip.dropoff.lat, trip.dropoff.lng];
  mount(els.float, h('div', { class: 'grow' }), h('button', { class: 'float-btn', onclick: () => { follow = true; render(false); } }, '◎'),
    h('button', { class: 'sos-btn', onclick: () => sosModal(d, trip) }, 'SOS'));
  const riderRow = h('div', { class: 'row' }, h('div', { class: 'avatar' }, initials(customer?.name)),
    h('div', { class: 'grow' }, h('b', {}, customer?.name), h('br'), h('small', {}, `★ ${num(customer?.rating ?? 5, 1)} – ${t(`pay.${trip.paymentMethod}`)}`)),
    h('b', { class: 'num' }, money(trip.est.fare.total)));
  const contact = h('div', { class: 'row wrap' },
    h('a', { class: 'btn grow', href: googleMapsLink(s === 'IN_PROGRESS' ? drop : pickup), target: '_blank', rel: 'noopener' }, '🧭 ', t('driver.navigate')),
    h('button', { class: 'btn grow', onclick: () => modal(t('trip.call'), h('p', {}, t('trip.masked_note')), [{ label: t('common.close'), value: () => true }]) }, '📞'),
    h('button', { class: 'btn grow', onclick: () => chatModal(trip) }, '💬', trip.chat.length ? ` ${trip.chat.length}` : ''));
  els.live = h('div', { class: 'col' });
  const cancel = h('button', { class: 'btn ghost block', style: { color: 'var(--bad)' }, onclick: () => cancelModal(d, trip) }, t('trip.cancel'));
  if (s === 'DRIVER_ARRIVING' || s === 'DRIVER_ASSIGNED') {
    els.action = h('button', { class: 'btn primary lg block', onclick: () => attempt(() => E.driverArrived(trip.id, d.id)) }, t('driver.arrived'));
    mount(els.sheet, h('div', { class: 'status-line' }, t('driver.going_to_pickup')), els.live, riderRow, tripAddresses(trip), contact, els.action, cancel);
  } else if (s === 'DRIVER_ARRIVED') {
    const pin = h('input', { class: 'input otp', inputmode: 'numeric', maxlength: 4, placeholder: '••••' });
    const go = () => attempt(() => { E.startTrip(trip.id, d.id, pin.value); follow = true; });
    pin.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    mount(els.sheet, h('div', { class: 'status-line' }, t('driver.waiting_rider')), els.live, riderRow, contact,
      field(t('driver.enter_pin'), pin), h('button', { class: 'btn primary lg block', onclick: go }, t('driver.start_trip')), cancel);
  } else {
    els.action = h('button', { class: 'btn good lg block', onclick: async () => {
      const far = dist(me().loc, drop) > 300;
      if (far && !(await confirmBox(t('driver.end_early'), t('driver.complete')))) return;
      attempt(() => E.completeTrip(trip.id, d.id));
    } }, t('driver.complete'));
    mount(els.sheet, h('div', { class: 'status-line' }, t('driver.on_trip')), els.live, riderRow, tripAddresses(trip), contact, els.action);
  }
  updateLive(d, trip);
}

function updateLive(d, trip, offer) {
  if (offer && els.timer) {
    const left = Math.max(0, Math.ceil((offer.offer.expiresAt - Date.now()) / 1000));
    mount(els.timer, `${num(left)}s`);
  }
  if (!trip || !els.live) return;
  if (trip.status === 'DRIVER_ARRIVING') {
    const m = dist(d.loc, [trip.pickup.lat, trip.pickup.lng]);
    const rem = remainingM(trip.approach, trip.progress);
    mount(els.live, h('div', {}, t('driver.to_pickup_left', { km: num(rem / 1000, 1), min: num(Math.max(1, Math.round(rem / SPEED / 60))) })));
    if (els.action) {
      const ok = m <= read('settings').arriveRadiusM;
      els.action.disabled = !ok;
      els.action.textContent = ok ? t('driver.arrived') : t('driver.arrived_far', { m: num(Math.round(m)) });
    }
  } else if (trip.status === 'DRIVER_ARRIVED') {
    const rule = read('pricingRules').find((r) => r.id === trip.est.ruleId);
    const left = Math.max(0, (rule?.freeWaitingMinutes ?? 3) * 60 - trip.waitingS);
    const noShow = read('cancellation').policy.noShowAfterS;
    mount(els.live, h('div', { class: `notice ${left ? '' : 'warn'}` }, left ? t('trip.free_wait', { min: num(Math.ceil(left / 60)) }) : t('trip.wait_charging')),
      trip.waitingS >= noShow ? h('small', {}, t('driver.no_show_allowed')) : null);
  } else if (trip.status === 'IN_PROGRESS') {
    const rem = remainingM(trip.route, trip.progress);
    mount(els.live, h('div', {}, t('trip.in_progress', { min: num(Math.max(1, Math.round(rem / SPEED / 60))), km: num(rem / 1000, 1) })), h('small', {}, `${t('driver.traveled')}: ${km(trip.traveledM)}`));
  }
}

function renderDone(d, trip) {
  let starsVal = 5;
  const row = h('div', { class: 'row', style: { justifyContent: 'center' } });
  const draw = () => mount(row, [1, 2, 3, 4, 5].map((n) => h('button', { class: 'btn ghost', style: { fontSize: '2rem', color: 'var(--accent)', padding: '0 4px' }, onclick: () => { starsVal = n; draw(); } }, n <= starsVal ? '★' : '☆')));
  draw();
  const f = trip.final;
  mount(els.sheet,
    h('div', { class: 'status-line' }, t('driver.trip_done')),
    trip.paymentMethod === 'CASH' ? h('div', { class: 'notice warn', style: { fontSize: '1.1rem', fontWeight: 700 } }, t('driver.collect_cash', { amount: money(f.fare.total) })) : h('div', { class: 'notice good' }, t('driver.paid_online', { amount: money(f.fare.total) })),
    h('div', { class: 'kv' }, h('span', {}, t('fare.total')), h('span', {}, money(f.fare.gross)), h('span', {}, t('driver.commission')), h('span', {}, `− ${money(f.commission)}`),
      f.fare.discount ? [h('span', {}, t('driver.promo_reimbursed')), h('span', {}, money(f.fare.discount))] : null,
      h('span', {}, t('driver.your_earning')), h('span', { style: { color: 'var(--good)' } }, money(f.driverEarning))),
    h('h3', { class: 'center', style: { justifyContent: 'center' } }, t('driver.rate_rider')), row,
    h('button', { class: 'btn primary lg block', onclick: () => attempt(() => { E.rateTrip(trip.id, 'DRIVER', starsVal); dismiss(trip.id); }) }, t('rating.submit')),
    h('button', { class: 'btn block', onclick: () => dismiss(trip.id) }, t('rating.skip')));
}

function chatModal(trip) {
  const box = h('div', { class: 'chat' });
  const draw = () => {
    const cur = read('trips').find((x) => x.id === trip.id);
    mount(box, (cur?.chat ?? []).map((m) => h('div', { class: `bubble ${m.from === 'DRIVER' ? 'me' : ''}` }, m.key ? t(m.key) : m.text)));
    box.scrollTop = box.scrollHeight;
  };
  const input = h('input', { class: 'input', placeholder: t('chat.placeholder') });
  const send = (text) => { attempt(() => E.sendChat(trip.id, 'DRIVER', text)); input.value = ''; };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && send(input.value));
  const off = onChange((tables) => tables.includes('trips') && draw());
  draw();
  modal(t('trip.chat'), h('div', { class: 'col' }, box,
    h('div', { class: 'chips' }, ['chat.bot_coming', 'chat.quick_arrived', 'chat.bot_traffic'].map((k) => h('button', { class: 'chip', onclick: () => send(t(k)) }, t(k)))),
    h('div', { class: 'row' }, input, h('button', { class: 'btn primary', onclick: () => send(input.value) }, t('chat.send'))))).then(off);
}

function cancelModal(d, trip) {
  const reasons = read('cancellation').reasons.DRIVER;
  let idx = 0;
  modal(t('trip.cancel'), h('div', { class: 'col' }, h('div', { class: 'notice warn' }, t('driver.cancel_warn')),
    reasons.map((r, i) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'r', checked: i === 0, onchange: () => { idx = i; } }), tr(r)))),
  [{ label: t('common.back'), value: () => null }, { label: t('trip.cancel_confirm'), kind: 'danger', value: () => true }]).then((ok) => {
    if (ok) attempt(() => E.cancelTrip(trip.id, 'DRIVER', d.id, idx));
  });
}

function sosModal(d, trip) {
  const city = read('cities').find((c) => c.id === d.cityId);
  modal(t('sos.title'), h('div', { class: 'col' }, h('p', {}, t('sos.body')),
    h('a', { class: 'btn danger block', href: `tel:${city.emergency.police}` }, `🚓 ${t('sos.police')} ${city.emergency.police}`),
    h('button', { class: 'btn primary block', onclick: (e) => { E.triggerSos(userKey(), 'DRIVER', trip.id, d.loc); e.currentTarget.disabled = true; toast(t('sos.sent_admin'), 'good'); } }, t('sos.alert'))),
  [{ label: t('common.close'), value: () => true }]);
}

// ───────────────────────────── other tabs ─────────────────────────────

function renderPage() {
  const d = me();
  const page = h('div', { class: 'page' });
  mount(els.page, page);
  if (st.tab === 'earnings') return renderEarnings(page, d);
  if (st.tab === 'wallet') return renderWallet(page, d);
  return renderAccount(page, d);
}

function renderEarnings(page, d) {
  const trips = read('trips').filter((x) => x.driverId === d.id && x.status === 'COMPLETED');
  const now = Date.now();
  const sum = (since) => trips.filter((x) => x.ts.completed >= since).reduce((s, x) => s + (x.final?.driverEarning ?? 0), 0);
  const cnt = (since) => trips.filter((x) => x.ts.completed >= since).length;
  const startToday = now - (E.localParts().minutes * 60_000);
  const week = now - 7 * 86_400_000;
  const bonuses = read('walletTx').filter((x) => x.owner === `d:${d.id}` && x.type === 'DRIVER_BONUS').reduce((s, x) => s + x.amount, 0);
  mount(page, h('h2', {}, t('nav.earnings')),
    h('div', { class: 'grid grid-2' },
      h('div', { class: 'card kpi' }, h('span', { class: 'label' }, t('driver.today')), h('span', { class: 'value' }, money(sum(startToday))), h('small', {}, t('account.trips', { n: num(cnt(startToday)) }))),
      h('div', { class: 'card kpi' }, h('span', { class: 'label' }, t('driver.last7')), h('span', { class: 'value' }, money(sum(week))), h('small', {}, t('account.trips', { n: num(cnt(week)) }))),
      h('div', { class: 'card kpi' }, h('span', { class: 'label' }, t('driver.bonuses')), h('span', { class: 'value' }, money(bonuses)))),
    h('h3', {}, t('nav.trips')),
    h('div', { class: 'card', style: { padding: '4px 12px' } }, h('div', { class: 'list' }, trips.slice().reverse().slice(0, 40).map((x) => h('div', { class: 'list-item', style: { cursor: 'default' } },
      h('div', { class: 'grow' }, h('div', {}, `${x.code} – ${t(`pay.${x.paymentMethod}`)}`), h('small', {}, `${dateTime(x.ts.completed)} – ${km(x.final?.distanceM)}`)),
      h('div', { style: { textAlign: 'end' } }, h('b', { class: 'num' }, money(x.final?.driverEarning)), h('br'), h('small', {}, money(x.final?.fare.total))))))));
}

function renderWallet(page, d) {
  const key = `d:${d.id}`;
  const bal = E.balance(key);
  const limit = read('settings').cashDebtLimit;
  const txs = read('walletTx').filter((x) => x.owner === key).slice().reverse();
  const payouts = read('payouts').filter((p) => p.driverId === d.id).slice().reverse();
  mount(page, h('h2', {}, t('nav.wallet')),
    h('div', { class: 'card col' },
      h('small', {}, t('wallet.balance')), h('div', { class: 'num', style: { fontSize: '2rem', fontWeight: 800, color: bal < 0 ? 'var(--bad)' : 'var(--text)' } }, money(bal)),
      bal < 0 ? h('div', { class: `notice ${-bal > limit ? 'bad' : 'warn'}` }, t('driver.debt_explain', { amount: money(-bal), limit: money(limit) })) : null,
      h('div', { class: 'row' },
        bal < 0 ? h('button', { class: 'btn primary grow', onclick: () => payDebtModal(d, -bal) }, t('driver.pay_debt')) : null,
        h('button', { class: 'btn grow', disabled: bal < 5000, onclick: () => payoutModal(d, bal) }, t('driver.withdraw')))),
    payouts.length ? [h('h3', {}, t('driver.payouts')), h('div', { class: 'card', style: { padding: '4px 12px' } }, payouts.map((p) => h('div', { class: 'list-item', style: { cursor: 'default' } },
      h('div', { class: 'grow' }, `${t(`pay.${p.method}`)} – ${p.destination}`, h('br'), h('small', {}, dateTime(p.createdAt))), h('b', {}, money(p.amount)), badge(t(`payoutStatus.${p.status}`), { PAID: 'good', REJECTED: 'bad', REQUESTED: 'warn' }[p.status]))))] : null,
    h('h3', {}, t('wallet.history')),
    txs.length ? h('div', { class: 'card', style: { padding: '4px 12px' } }, txs.slice(0, 80).map((x) => h('div', { class: 'list-item', style: { cursor: 'default' } },
      h('div', { class: 'grow' }, t(`tx.${x.type}`), h('br'), h('small', {}, dateTime(x.ts))),
      h('b', { class: 'num', style: { color: x.amount < 0 ? 'var(--bad)' : 'var(--good)' } }, `${x.amount > 0 ? '+' : ''}${money(x.amount)}`)))) : h('p', { class: 'muted' }, t('wallet.empty')));
}

function payDebtModal(d, debt) {
  let method = 'ZAINCASH';
  const amount = h('input', { class: 'input num', type: 'number', value: debt, min: 1000 });
  modal(t('driver.pay_debt'), h('div', { class: 'col' }, field(t('wallet.amount'), amount),
    field(t('wallet.method'), select(['ZAINCASH', 'FIB', 'FASTPAY', 'CASH_OFFICE'].map((m) => [m, t(`pay.${m}`)]), method, (v) => { method = v; })),
    h('small', { class: 'muted' }, t('pay.gateway_demo_short'))),
  [{ label: t('common.cancel'), value: () => null }, { label: t('pay.authorize'), kind: 'primary', value: () => true }]).then((ok) => {
    if (ok) attempt(() => { E.payDebt(d.id, amount.value, method); toast(t('driver.debt_paid'), 'good'); renderPage(); });
  });
}

function payoutModal(d, bal) {
  let method = 'ZAINCASH';
  const amount = h('input', { class: 'input num', type: 'number', value: bal, min: 5000 });
  const dest = h('input', { class: 'input ltr', value: d.phone });
  modal(t('driver.withdraw'), h('div', { class: 'col' }, field(t('wallet.amount'), amount),
    field(t('wallet.method'), select(['ZAINCASH', 'FIB', 'FASTPAY', 'BANK', 'CASH_OFFICE'].map((m) => [m, t(`pay.${m}`)]), method, (v) => { method = v; })),
    field(t('driver.destination'), dest), h('small', { class: 'muted' }, t('driver.payout_note'))),
  [{ label: t('common.cancel'), value: () => null }, { label: t('driver.request_payout'), kind: 'primary', value: () => true }]).then((ok) => {
    if (ok) attempt(() => { E.requestPayout(d.id, amount.value, method, dest.value); toast(t('driver.payout_requested'), 'good'); renderPage(); });
  });
}

function renderAccount(page, d) {
  const vt = read('vehicleTypes').find((v) => v.id === d.vehicle.cls);
  const acc = d.offersReceived ? Math.round((d.offersAccepted / d.offersReceived) * 100) : 100;
  const total = d.trips + d.cancelled;
  mount(page,
    h('div', { class: 'row' }, h('div', { class: 'avatar', style: { width: '64px', height: '64px' } }, d.photo ? h('img', { src: d.photo, alt: '' }) : initials(d.name)),
      h('div', { class: 'grow' }, h('h2', { style: { margin: 0 } }, d.name), h('div', { class: 'ltr text-2' }, d.phone), badge(t(`driverStatus.${d.status}`), d.status === 'APPROVED' ? 'good' : 'warn'))),
    h('div', { class: 'grid grid-2' },
      h('div', { class: 'card kpi' }, h('span', { class: 'label' }, t('driver.rating')), h('span', { class: 'value' }, `★ ${num(d.rating, 2)}`), h('small', {}, t('driver.ratings_count', { n: num(d.ratingCount) }))),
      h('div', { class: 'card kpi' }, h('span', { class: 'label' }, t('driver.acceptance')), h('span', { class: 'value' }, `${num(acc)}%`)),
      h('div', { class: 'card kpi' }, h('span', { class: 'label' }, t('driver.cancellation')), h('span', { class: 'value' }, `${num(cancellationRate(d.cancelled, total), 1)}%`)),
      h('div', { class: 'card kpi' }, h('span', { class: 'label' }, t('driver.total_trips')), h('span', { class: 'value' }, num(d.trips)))),
    installCard(),
    h('div', { class: 'card col' }, h('h3', {}, '🚘 ', t('driver.vehicle')),
      h('div', { class: 'kv' }, h('span', {}, t('driver.vehicle_class')), h('span', {}, `${vt?.icon ?? ''} ${tr(vt?.name)}`), h('span', {}, t('driver.car')), h('span', {}, `${d.vehicle.make} ${d.vehicle.model} ${d.vehicle.year}`),
        h('span', {}, t('driver.color')), h('span', {}, tr(d.vehicle.color)), h('span', {}, t('driver.plate')), h('span', {}, h('span', { class: 'plate' }, d.vehicle.plate)),
        h('span', {}, t('driver.serves')), h('span', {}, d.vehicle.serves.map((id) => tr(read('vehicleTypes').find((v) => v.id === id)?.name)).join('، ')))),
    h('div', { class: 'card col' }, h('h3', {}, '📄 ', t('driver.documents')), documentsList(d, 'always')),
    h('div', { class: 'card col' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: d.autoDrive, onchange: (e) => {
        E.updateDriver(d.id, (x) => { x.autoDrive = e.target.checked; });
        if (e.target.checked) stopGps(); else startGps();
      } }), t('driver.sim_mode')),
      h('small', { class: 'muted' }, t('driver.sim_mode_hint')),
      h('button', { class: 'list-item', onclick: () => { const b = h('div', { class: 'col' }); renderTickets(b, userKey(), 'DRIVER', read('trips').filter((x) => x.driverId === d.id)); modal(t('account.support'), b, [{ label: t('common.close'), value: () => true }]); } }, '🎧 ', t('account.support')),
      h('div', { class: 'row between' }, h('span', {}, t('account.language')), langSwitcher(changeLanguage)),
      h('button', { class: 'btn block', onclick: logout }, t('account.logout'))));
}

function showNotifications() {
  const list = (read('notifications') ?? []).filter((n) => n.to === userKey()).slice().reverse();
  E.markNotificationsRead(userKey());
  renderTop();
  modal(t('nav.notifications'), list.length ? h('div', { class: 'list' }, list.slice(0, 60).map((n) => h('div', { class: 'list-item', style: { cursor: 'default' } },
    h('div', { class: 'grow' }, h('div', { style: { fontWeight: n.read ? 400 : 700 } }, notificationText(n)), h('small', {}, dateTime(n.ts)))))) : h('p', { class: 'muted' }, t('notifications.empty')),
  [{ label: t('common.close'), value: () => true }]);
}

// ── startup (kept last so every declaration above is initialised) ──
await boot();
root = document.getElementById('root');
watchNotifications(userKey, () => renderTop());
start();
