// Passenger app
import { boot, installCard, attempt, notificationText, watchNotifications, initials, readSession, writeSession, changeLanguage, relayout } from './lib/common.js';
import { t, tr } from './lib/i18n.js';
import { h, mount, money, km, minutes, dateTime, toast, modal, confirmBox, field, select, badge, stars, langSwitcher, fileToThumb, num } from './lib/ui.js';
import { read, onChange } from './lib/db.js';
import * as E from './lib/engine.js';
import { createMap, icons, markerLayer, polyline, fit, L } from './lib/map.js';
import { reverseGeocode, searchPlaces, nearestCity, dist, remainingM } from './lib/geo.js';
import { renderTickets } from './lib/support.js';
import { POIS } from './lib/seed.js';

const SKEY = 'ride.session.passenger';
const DKEY = 'ride.passenger.dismissed';
const PAY_METHODS = ['CASH', 'WALLET', 'ZAINCASH', 'FIB', 'FASTPAY', 'CARD'];
const SPEED = 9; // matches the simulator, metres per simulated second

const st = {
  customerId: readSession(SKEY), tab: 'ride', stage: 'home',
  pickup: null, pickupAddr: '', dest: null, destAddr: '', quote: null, vt: 'ECONOMY', pay: 'CASH', promo: '', note: '',
  dismissed: new Set(JSON.parse(readSession(DKEY) || '[]')), sheetSig: '', pickOnMap: false,
};

const me = () => read('customers').find((c) => c.id === st.customerId);
const userKey = () => (st.customerId ? `c:${st.customerId}` : null);
let map; let layer; let lines = []; let follow = true;
let root;


function start() {
  const c = me();
  if (!c || c.status === 'DELETED') { writeSession(SKEY, null); st.customerId = null; return renderAuth(); }
  renderShell();
}

// ───────────────────────────── auth ─────────────────────────────

function renderAuth() {
  let phone = '';
  const body = h('div', { class: 'page' });
  const phoneStep = () => {
    const input = h('input', { class: 'input ltr', type: 'tel', inputmode: 'tel', placeholder: '0750 000 0000', autocomplete: 'tel' });
    mount(body,
      h('div', { class: 'center', style: { padding: '20px 0 6px' } }, h('div', { style: { fontSize: '3rem' } }, '🚕'), h('h1', {}, t('app.passenger')), h('p', { class: 'text-2' }, t('auth.welcome'))),
      field(t('auth.enter_phone'), input, t('auth.phone_hint')),
      h('button', { class: 'btn primary lg block', onclick: () => attempt(() => { phone = E.normalizePhone(input.value); otpStep(E.sendOtp(phone)); }) }, t('common.continue')),
      h('button', { class: 'btn ghost block', onclick: () => attempt(() => { phone = '+9647500000000'; otpStep(E.sendOtp(phone)); }) }, t('auth.demo_login')),
      h('button', { class: 'btn block', onclick: emailStep }, '✉️ ', t('auth.email_login')),
      h('div', { class: 'sep' }),
      h('div', { class: 'row between' }, h('a', { href: './' }, `← ${t('app.home')}`), langSwitcher(changeLanguage)),
    );
    input.focus();
  };
  const otpStep = (code) => {
    const input = h('input', { class: 'input otp', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code' });
    const verify = () => attempt(() => {
      E.verifyOtp(phone, input.value);
      const c = read('customers').find((x) => x.phone === phone);
      if (c?.status === 'DELETED') throw new E.AppError('err.account_inactive');
      if (c) login(c.id); else registerStep();
    });
    mount(body,
      h('h2', {}, t('auth.otp_title')),
      h('p', { class: 'text-2' }, t('auth.otp_sent', { phone })),
      h('div', { class: 'notice' }, t('auth.demo_code', { code })),
      input,
      h('button', { class: 'btn primary lg block', onclick: verify }, t('auth.verify')),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn sm', onclick: () => otpStep(E.sendOtp(phone)) }, t('auth.otp_resend')),
        h('button', { class: 'btn sm', onclick: () => { toast(t('auth.whatsapp_sent')); otpStep(E.sendOtp(phone)); } }, t('auth.otp_whatsapp')),
        h('button', { class: 'btn sm ghost', onclick: phoneStep }, t('auth.change_number'))),
    );
    input.addEventListener('keydown', (e) => e.key === 'Enter' && verify());
    input.focus();
  };
  const emailStep = () => {
    const email = h('input', { class: 'input ltr', type: 'email', autocomplete: 'username' });
    const pw = h('input', { class: 'input ltr', type: 'password', autocomplete: 'current-password' });
    const go = () => attempt(async () => login((await E.loginWithEmail(email.value, pw.value)).id));
    pw.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    mount(body,
      h('h2', {}, t('auth.email_login')),
      field(t('profile.email'), email), field(t('auth.password'), pw),
      h('button', { class: 'btn primary lg block', onclick: go }, t('auth.sign_in')),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn sm', onclick: () => forgotStep(email.value) }, t('auth.forgot')),
        h('button', { class: 'btn sm ghost', onclick: phoneStep }, t('auth.use_phone'))),
      h('small', { class: 'muted' }, t('auth.email_hint')));
    email.focus();
  };
  const forgotStep = (prefill = '') => {
    const email = h('input', { class: 'input ltr', type: 'email', value: prefill });
    const box = h('div', { class: 'col' });
    mount(body, h('h2', {}, t('auth.forgot_title')), field(t('profile.email'), email),
      h('button', { class: 'btn primary block', onclick: () => {
        if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) { toast(t('err.fill_all'), 'error'); return; }
        const code = E.sendResetCode(email.value);
        const otp = h('input', { class: 'input otp', inputmode: 'numeric', maxlength: 6 });
        const pw = h('input', { class: 'input ltr', type: 'password', autocomplete: 'new-password' });
        mount(box, h('div', { class: 'notice' }, t('auth.reset_sent', { code })), field(t('auth.otp_title'), otp), field(t('auth.new_password'), pw, t('auth.password_hint')),
          h('button', { class: 'btn primary lg block', onclick: () => attempt(async () => {
            const c = await E.resetPassword(email.value, otp.value, pw.value);
            toast(t('auth.reset_done'), 'good');
            login(c.id);
          }) }, t('common.save')));
      } }, t('auth.send_code')),
      box, h('button', { class: 'btn ghost', onclick: emailStep }, t('common.back')));
    email.focus();
  };
  const registerStep = () => {
    const name = h('input', { class: 'input', autocomplete: 'name' });
    const email = h('input', { class: 'input ltr', type: 'email', autocomplete: 'email' });
    const birth = h('input', { class: 'input', type: 'date' });
    const gender = select([['UNSPECIFIED', t('gender.UNSPECIFIED')], ['MALE', t('gender.MALE')], ['FEMALE', t('gender.FEMALE')]], 'UNSPECIFIED');
    const ref = h('input', { class: 'input ltr', placeholder: 'DEMO2026' });
    const pw = h('input', { class: 'input ltr', type: 'password', autocomplete: 'new-password' });
    const terms = h('input', { type: 'checkbox' });
    mount(body,
      h('h2', {}, t('auth.create_account')),
      field(t('profile.name'), name),
      field(`${t('profile.email')} (${t('common.optional')})`, email),
      field(`${t('auth.password')} (${t('common.optional')})`, pw, t('auth.password_hint')),
      h('div', { class: 'grid grid-2' }, field(`${t('profile.birth')} (${t('common.optional')})`, birth), field(t('profile.gender'), gender)),
      field(`${t('auth.referral')} (${t('common.optional')})`, ref),
      h('label', { class: 'check' }, terms, t('auth.terms')),
      h('button', { class: 'btn primary lg block', onclick: () => attempt(async () => {
        if (name.value.trim().length < 2) throw new E.AppError('err.name_required');
        if (pw.value && !email.value.trim()) throw new E.AppError('err.need_email');
        if (pw.value && pw.value.length < 8) throw new E.AppError('err.weak_password');
        if (!terms.checked) throw new E.AppError('err.terms');
        const c = E.registerCustomer({ phone, name: name.value, email: email.value, birthDate: birth.value, gender: gender.value, referralCode: ref.value });
        if (pw.value) await E.setPassword(c.id, pw.value);
        login(c.id);
      }) }, t('auth.create_account')),
    );
    name.focus();
  };
  mount(root, h('div', { class: 'app' }, h('div', { class: 'app-body' }, body)));
  phoneStep();
}

function login(id) {
  // always land on the main screen, whatever tab the previous session ended on
  st.tab = 'ride';
  st.stage = 'home';
  st.quote = null;
  st.customerId = id;
  writeSession(SKEY, id);
  map = null;
  renderShell();
}

function logout() {
  writeSession(SKEY, null);
  st.customerId = null;
  map = null;
  renderAuth();
}

// ───────────────────────────── shell ─────────────────────────────

let els = {};
function renderShell() {
  els = {
    top: h('div', { class: 'app-top' }),
    ride: h('div', { class: 'app-body', id: 'ride' }),
    page: h('div', { class: 'app-body hidden' }),
    tabs: h('nav', { class: 'tabs' }),
  };
  els.mapEl = h('div', { class: 'map' });
  els.float = h('div', { class: 'float-top' });
  els.pin = h('div', { class: 'center-pin' }, h('div', { class: 'mk-pin mk-pin-a' }));
  els.sheet = h('div', { class: 'sheet' });
  els.ride.append(els.mapEl, els.float, els.pin, els.sheet);
  mount(root, h('div', { class: 'app' }, els.top, els.ride, els.page, els.tabs));

  const c = me();
  const city = read('cities').find((x) => x.id === c.cityId) ?? read('cities')[0];
  st.pickup = st.pickup ?? city.center;
  map = createMap(els.mapEl, st.pickup, 15);
  layer = markerLayer(map);
  map.on('moveend', onMapMove);
  map.on('dragstart', () => { follow = false; });
  map.on('click', onMapClick);
  locate();
  onMapMove();
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
    h('div', { class: 'title' }, t('app.passenger')),
    h('button', { class: 'icon-btn bell', 'aria-label': t('nav.notifications'), onclick: showNotifications }, '🔔', unread ? h('span', { class: 'dotn' }) : null),
    langSwitcher(changeLanguage),
  );
}

function renderTabs() {
  const tabs = [['ride', '🚗', t('nav.ride')], ['trips', '🧾', t('nav.trips')], ['wallet', '👛', t('nav.wallet')], ['account', '👤', t('nav.account')]];
  mount(els.tabs, tabs.map(([id, i, label]) => h('button', { class: st.tab === id ? 'on' : '', onclick: () => { st.tab = id; renderTabs(); render(true); } }, h('span', { class: 'i' }, i), label)));
}

function locate() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((p) => {
    const here = [p.coords.latitude, p.coords.longitude];
    const city = nearestCity(here);
    // Only jump to the device location if it is inside a service city
    if (dist(here, city.center) < 40_000 && st.stage === 'home' && !activeTrip()) map.setView(here, 16);
  }, () => {}, { timeout: 6000, maximumAge: 60_000 });
}

let reverseTimer;
function onMapMove() {
  if (st.stage !== 'home' || activeTrip()) return;
  const c = map.getCenter();
  st.pickup = [c.lat, c.lng];
  clearTimeout(reverseTimer);
  reverseTimer = setTimeout(async () => {
    st.pickupAddr = await reverseGeocode(st.pickup);
    if (st.stage === 'home') render(true);
  }, 900);
}

function onMapClick(e) {
  if (!st.pickOnMap) return;
  st.pickOnMap = false;
  setDestination([e.latlng.lat, e.latlng.lng]);
}

async function setDestination(p, title) {
  st.dest = p;
  st.destAddr = title || (await reverseGeocode(p));
  st.stage = 'options';
  st.quote = null;
  render(true);
  await refreshQuote();
}

async function refreshQuote() {
  st.quoting = true;
  render(true);
  try {
    st.quote = await E.quote(st.customerId, st.pickup, st.dest, st.promo);
    const avail = st.quote.options.filter((o) => o.available);
    if (!st.quote.options.some((o) => o.vehicleTypeId === st.vt && o.available) && avail[0]) st.vt = avail[0].vehicleTypeId;
  } catch (e) {
    attempt(() => { throw e; });
    st.stage = 'dest';
  }
  st.quoting = false;
  render(true);
}

// ───────────────────────────── state helpers ─────────────────────────────

function myTrips() {
  return read('trips').filter((x) => x.customerId === st.customerId);
}

/** The trip the ride tab should show: an active one, or a finished one the rider hasn't dismissed yet. */
function activeTrip() {
  const trips = myTrips().filter((x) => !x.historical);
  const live = trips.find((x) => E.ACTIVE.includes(x.status));
  if (live) return live;
  const last = trips.at(-1);
  if (!last || st.dismissed.has(last.id)) return null;
  if (last.status === 'COMPLETED' && !last.ratings.byCustomer) return last;
  if (['NO_DRIVER_FOUND', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_ADMIN'].includes(last.status) && Date.now() - (last.ts.cancelled ?? 0) < 15 * 60_000) return last;
  return null;
}

function dismiss(id) {
  st.dismissed.add(id);
  writeSession(DKEY, JSON.stringify([...st.dismissed].slice(-50)));
  st.stage = 'home';
  st.quote = null;
  follow = true;
  render(true);
}

const driverOf = (trip) => (trip?.driverId ? read('drivers').find((d) => d.id === trip.driverId) : null);

// ───────────────────────────── render ─────────────────────────────

function render(force) {
  if (!els.ride || !me()) return;
  const onRide = st.tab === 'ride';
  els.ride.classList.toggle('hidden', !onRide);
  els.page.classList.toggle('hidden', onRide);
  if (!onRide) {
    if (force) renderPage();
    return;
  }
  const trip = activeTrip();
  renderMap(trip);
  const sig = trip ? `${trip.id}|${trip.status}|${trip.chat.length}|${trip.driverId}|${trip.ratings.byCustomer ? 1 : 0}` : `book|${st.stage}`;
  if (force || sig !== st.sheetSig) {
    st.sheetSig = sig;
    renderSheet(trip);
  } else if (trip) updateLive(trip);
  els.pin.classList.toggle('hidden', !!trip || st.stage !== 'home');
}

function renderMap(trip) {
  if (!map) return;
  for (const l of lines) map.removeLayer(l);
  lines = [];
  const items = [];
  if (trip) {
    const driver = driverOf(trip);
    const pickup = [trip.pickup.lat, trip.pickup.lng];
    const drop = [trip.dropoff.lat, trip.dropoff.lng];
    items.push({ id: 'pickup', pos: pickup, icon: icons.pickup(), iconKey: 'a' }, { id: 'drop', pos: drop, icon: icons.dropoff(), iconKey: 'b' });
    if (trip.status === 'DRIVER_ARRIVING' && trip.approach) lines.push(polyline(map, trip.approach.slice(trip.progress?.idx ?? 0), 'approach'));
    if (trip.route && ['SEARCHING', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS'].includes(trip.status)) lines.push(polyline(map, trip.status === 'IN_PROGRESS' ? trip.route.slice(trip.progress?.idx ?? 0) : trip.route, 'route'));
    if (driver && E.WITH_DRIVER.includes(trip.status)) {
      items.push({ id: 'driver', pos: driver.loc, icon: icons.car('ontrip'), iconKey: 'car' });
      if (follow) fit(map, trip.status === 'IN_PROGRESS' ? [driver.loc, drop] : [driver.loc, pickup], 70);
    } else if (trip.status === 'SEARCHING') {
      // nearby cars while searching
      for (const d of read('drivers').filter((x) => x.availability === 'ONLINE' && x.cityId === trip.cityId && dist(x.loc, pickup) < 4000)) items.push({ id: d.id, pos: d.loc, icon: icons.car('online'), iconKey: 'on' });
      if (follow) { map.setView(pickup, 15); follow = false; }
    }
  } else if (st.stage === 'options' && st.dest) {
    items.push({ id: 'pickup', pos: st.pickup, icon: icons.pickup(), iconKey: 'a' }, { id: 'drop', pos: st.dest, icon: icons.dropoff(), iconKey: 'b' });
    if (st.quote?.points) lines.push(polyline(map, st.quote.points, 'route'));
    if (follow) { fit(map, st.quote?.points ?? [st.pickup, st.dest], 80); follow = false; }
  } else {
    const center = st.pickup;
    for (const d of read('drivers').filter((x) => x.availability === 'ONLINE' && x.status === 'APPROVED' && dist(x.loc, center) < 3500)) {
      items.push({ id: d.id, pos: d.loc, icon: icons.car('online'), iconKey: 'on' });
    }
  }
  layer.sync(items);
}

function sheetHeader(title, back) {
  return h('div', { class: 'row' }, back ? h('button', { class: 'icon-btn', 'aria-label': t('common.back'), onclick: back }, document.dir === 'rtl' ? '→' : '←') : null, h('h3', { style: { margin: 0 }, class: 'grow' }, title));
}

function renderSheet(trip) {
  mount(els.float);
  if (trip) return renderTripSheet(trip);
  if (st.stage === 'home') return renderHome();
  if (st.stage === 'dest') return renderDest();
  if (st.stage === 'options') return renderOptions();
}

function renderHome() {
  const c = me();
  const cities = read('cities').filter((x) => x.active);
  const recent = [];
  for (const tr0 of myTrips().filter((x) => !x.historical && x.dropoff.address).reverse()) {
    if (!recent.some((r) => dist([r.lat, r.lng], [tr0.dropoff.lat, tr0.dropoff.lng]) < 150)) recent.push(tr0.dropoff);
    if (recent.length >= 3) break;
  }
  mount(els.float,
    select(cities.map((x) => [x.id, tr(x.name)]), nearestCity(st.pickup).id, (id) => map.setView(cities.find((x) => x.id === id).center, 15), { class: 'float-btn', 'aria-label': t('booking.city') }),
    h('div', { class: 'grow' }),
    h('button', { class: 'float-btn', onclick: () => { locate(); } }, '◎'),
  );
  mount(els.sheet,
    h('div', { class: 'addr' }, h('span', { class: 'dot a' }), h('div', { class: 'grow' }, h('small', {}, t('booking.pickup')), h('div', { style: { fontWeight: 600 } }, st.pickupAddr || '…'))),
    h('button', { class: 'where', onclick: () => { st.stage = 'dest'; render(true); } }, '🔍', t('home.where_to')),
    h('div', { class: 'chips' },
      ['home', 'work'].map((k) => h('button', { class: 'chip', onclick: () => (c.saved[k] ? setDestination([c.saved[k].lat, c.saved[k].lng], c.saved[k].address) : toast(t('home.save_hint'))) }, k === 'home' ? '🏠 ' : '💼 ', t(`home.${k}`))),
      recent.map((r) => h('button', { class: 'chip', onclick: () => setDestination([r.lat, r.lng], r.address) }, '🕘 ', r.address.slice(0, 26)))),
    h('small', { class: 'muted' }, t('home.drag_hint')),
  );
}

function renderDest() {
  const input = h('input', { class: 'input', placeholder: t('booking.search_placeholder'), enterkeyhint: 'search' });
  const results = h('div', { class: 'list' });
  const c = me();
  const cityId = nearestCity(st.pickup).id;
  const showResults = (rows) => mount(results, rows.length ? rows.map((r) => h('button', { class: 'list-item', onclick: () => setDestination([r.lat, r.lng], r.title) },
    h('span', {}, '📍'), h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, r.title), h('small', {}, r.subtitle?.slice(0, 90) ?? '')))) : h('p', { class: 'muted' }, t('booking.no_results')));
  const run = async () => {
    mount(results, h('div', { class: 'progress' }, h('i')));
    showResults(await searchPlaces(input.value, cityId));
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && run());
  const saved = ['home', 'work'].filter((k) => c.saved[k]).map((k) => ({ title: `${t(`home.${k}`)} — ${c.saved[k].address}`, lat: c.saved[k].lat, lng: c.saved[k].lng }));
  mount(els.sheet,
    sheetHeader(t('booking.choose_destination'), () => { st.stage = 'home'; render(true); }),
    h('div', { class: 'row' }, input, h('button', { class: 'btn primary', onclick: run }, t('common.search'))),
    h('button', { class: 'btn block', onclick: () => { st.pickOnMap = true; toast(t('booking.tap_map')); } }, '🗺️ ', t('booking.choose_on_map')),
    results,
  );
  showResults([...saved, ...searchLocal(cityId)]);
  setTimeout(() => input.focus(), 50);
}

function searchLocal(cityId) {
  return POIS.filter((p) => p.cityId === cityId).map((p) => ({ title: tr(p.name), subtitle: t('booking.landmark'), lat: p.lat, lng: p.lng }));
}

function renderOptions() {
  const q = st.quote;
  const c = me();
  const vts = read('vehicleTypes');
  const wallet = E.balance(`c:${c.id}`);
  const promoInput = h('input', { class: 'input ltr', placeholder: 'WELCOME', value: st.promo });
  const note = h('input', { class: 'input', placeholder: t('booking.pickup_note'), value: st.note, oninput: (e) => { st.note = e.target.value; } });
  const opts = q?.options ?? [];
  const sel = opts.find((o) => o.vehicleTypeId === st.vt);
  mount(els.sheet,
    sheetHeader(t('booking.choose_ride'), () => { st.stage = 'dest'; st.quote = null; follow = true; render(true); }),
    h('div', { class: 'addr' }, h('span', { class: 'dot a' }), h('div', { class: 'grow' }, st.pickupAddr)),
    h('div', { class: 'addr' }, h('span', { class: 'dot b' }), h('div', { class: 'grow' }, st.destAddr)),
    st.quoting || !q ? h('div', { class: 'progress' }, h('i')) : [
      h('div', { class: 'row between' }, h('small', {}, `${km(q.distanceM)} – ${minutes(q.durationS)}`), q.routeSource !== 'osrm' ? h('small', {}, t('booking.estimated_route')) : null),
      q.surge > 1 ? h('div', { class: 'surge' }, '⚡ ', t('booking.surge_badge', { multiplier: num(q.surge, 1) })) : null,
      h('div', { class: 'vt-list' }, opts.map((o) => {
        const vt = vts.find((v) => v.id === o.vehicleTypeId);
        return h('button', { class: `vt ${o.vehicleTypeId === st.vt ? 'on' : ''} ${o.available ? '' : 'off'}`, onclick: () => { st.vt = o.vehicleTypeId; render(true); } },
          h('span', { class: 'ico' }, vt.icon),
          h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700 } }, tr(vt.name), ' ', h('small', {}, `– ${num(vt.seats)} 👤`)),
            h('small', {}, o.available ? t('booking.eta_away', { min: num(Math.max(1, Math.round(o.etaS / 60))) }) : t('booking.no_cars'))),
          h('div', { style: { textAlign: 'end' } }, h('div', { class: 'price' }, money(o.fare.total)), o.fare.discount ? h('div', { class: 'strike' }, money(o.fare.gross)) : null));
      })),
      q.promoCode ? h('div', { class: `notice ${opts.some((o) => o.promo?.ok) ? 'good' : 'warn'}` }, opts.some((o) => o.promo?.ok) ? t('booking.promo_applied', { code: q.promoCode }) : t(`promo.${opts[0]?.promo?.reason ?? 'not_found'}`)) : null,
      h('div', { class: 'row' }, h('span', { style: { fontSize: '1.3rem' } }, '💳'),
        select(PAY_METHODS.map((m) => [m, m === 'WALLET' ? `${t(`pay.${m}`)} (${money(wallet)})` : t(`pay.${m}`)]), st.pay, (v) => { st.pay = v; }),
      ),
      h('div', { class: 'row' }, promoInput, h('button', { class: 'btn', onclick: () => { st.promo = promoInput.value.trim(); refreshQuote(); } }, t('booking.apply'))),
      note,
      h('button', { class: 'btn primary lg block', disabled: !sel?.available, onclick: requestRide }, t('booking.request', { vehicle: tr(vts.find((v) => v.id === st.vt)?.name) })),
    ],
  );
}

async function requestRide() {
  const q = st.quote;
  const opt = q.options.find((o) => o.vehicleTypeId === st.vt);
  if (Date.now() > q.expiresAt) { toast(t('err.quote_expired')); return refreshQuote(); }
  if (['ZAINCASH', 'FIB', 'FASTPAY', 'CARD'].includes(st.pay)) {
    const ok = await modal(t(`pay.${st.pay}`), h('div', { class: 'col' },
      h('p', {}, t('pay.gateway_demo', { amount: money(opt.fare.total), gateway: t(`pay.${st.pay}`) })),
      h('small', { class: 'muted' }, t(st.pay === 'CARD' ? 'pay.card_note' : 'pay.wallet_note'))),
    [{ label: t('common.cancel'), value: () => null }, { label: t('pay.authorize'), kind: 'primary', value: () => true }]);
    if (!ok) return;
  }
  attempt(() => {
    E.requestTrip(st.customerId, q, st.vt, st.pay, st.pickupAddr, st.destAddr, st.note);
    follow = true;
    st.note = '';
    render(true);
  });
}

// ── active trip ──

function driverCard(driver, trip) {
  const vt = read('vehicleTypes').find((v) => v.id === trip.vehicleTypeId);
  return h('div', { class: 'row' },
    h('div', { class: 'avatar' }, driver.photo ? h('img', { src: driver.photo, alt: '' }) : initials(driver.name)),
    h('div', { class: 'grow' },
      h('div', { style: { fontWeight: 700 } }, driver.name, ' ', h('small', {}, '★ ', num(driver.rating, 1))),
      h('small', {}, `${driver.vehicle.make} ${driver.vehicle.model} – ${tr(driver.vehicle.color)} – ${tr(vt?.name)}`)),
    h('span', { class: 'plate' }, driver.vehicle.plate));
}

function renderTripSheet(trip) {
  const driver = driverOf(trip);
  const s = trip.status;
  const sosBtn = h('button', { class: 'sos-btn', onclick: () => sosModal(trip) }, 'SOS');
  if (E.ACTIVE.includes(s)) mount(els.float, h('div', { class: 'grow' }), h('button', { class: 'float-btn', onclick: () => { follow = true; render(false); } }, '◎'), sosBtn);
  const actions = () => h('div', { class: 'row wrap' },
    h('button', { class: 'btn grow', onclick: () => callModal(driver) }, '📞 ', t('trip.call')),
    h('button', { class: 'btn grow', onclick: () => chatModal(trip) }, '💬 ', t('trip.chat'), trip.chat.length ? ` (${trip.chat.length})` : ''),
    h('button', { class: 'btn grow', onclick: () => shareTrip(trip, driver) }, '🔗 ', t('trip.share')));
  const cancelBtn = h('button', { class: 'btn danger block', onclick: () => cancelModal(trip) }, t('trip.cancel'));
  els.live = h('div', { class: 'status-line' });

  if (s === 'SEARCHING') {
    return mount(els.sheet, h('div', { class: 'status-line' }, t('trip.searching')), h('div', { class: 'progress' }, h('i')),
      h('small', {}, t('trip.search_round', { km: num((read('settings').radiiM[trip.round] ?? 0) / 1000, 0) })),
      tripAddresses(trip), h('div', { class: 'row between' }, h('span', {}, t(`pay.${trip.paymentMethod}`)), h('b', {}, money(trip.est.fare.total))), cancelBtn);
  }
  if (s === 'DRIVER_ARRIVING') {
    mount(els.sheet, els.live, driverCard(driver, trip), actions(), tripAddresses(trip), cancelBtn);
    return updateLive(trip);
  }
  if (s === 'DRIVER_ARRIVED') {
    mount(els.sheet, h('div', { class: 'status-line' }, t('trip.driver_arrived')), driverCard(driver, trip),
      h('div', { class: 'card flat center' }, h('small', {}, t('trip.give_pin')), h('div', { class: 'pin-code' }, trip.pin)),
      els.live, actions(), cancelBtn);
    return updateLive(trip);
  }
  if (s === 'IN_PROGRESS') {
    mount(els.sheet, els.live, driverCard(driver, trip), actions(), tripAddresses(trip),
      h('div', { class: 'row between' }, h('span', {}, t(`pay.${trip.paymentMethod}`)), h('b', {}, money(trip.est.fare.total))));
    return updateLive(trip);
  }
  if (s === 'COMPLETED') return renderRating(trip, driver);
  // ended without a ride
  const msg = s === 'NO_DRIVER_FOUND' ? t('trip.no_driver') : s === 'CANCELLED_BY_ADMIN' ? t('trip.cancelled_admin') : t('trip.cancelled_driver');
  mount(els.sheet, h('div', { class: 'status-line' }, msg), trip.cancel?.fee ? h('div', { class: 'notice warn' }, t('trip.fee_charged', { fee: money(trip.cancel.fee) })) : null,
    h('button', { class: 'btn primary lg block', onclick: () => { dismiss(trip.id); st.pickup = [trip.pickup.lat, trip.pickup.lng]; st.pickupAddr = trip.pickup.address; setDestination([trip.dropoff.lat, trip.dropoff.lng], trip.dropoff.address); } }, t('trip.try_again')),
    h('button', { class: 'btn block', onclick: () => dismiss(trip.id) }, t('common.close')));
}

function updateLive(trip) {
  if (!els.live) return;
  const s = trip.status;
  if (s === 'DRIVER_ARRIVING') {
    const m = remainingM(trip.approach, trip.progress);
    mount(els.live, t('trip.driver_arriving', { name: driverOf(trip)?.name ?? '', minutes: num(Math.max(1, Math.round(m / SPEED / 60))) }));
  } else if (s === 'DRIVER_ARRIVED') {
    const free = read('pricingRules').find((r) => r.id === trip.est.ruleId)?.freeWaitingMinutes ?? 3;
    const left = Math.max(0, free * 60 - trip.waitingS);
    mount(els.live, h('div', { class: `notice ${left ? '' : 'warn'}` }, left ? t('trip.free_wait', { min: num(Math.ceil(left / 60)) }) : t('trip.wait_charging')));
  } else if (s === 'IN_PROGRESS') {
    const m = remainingM(trip.route, trip.progress);
    mount(els.live, t('trip.in_progress', { min: num(Math.max(1, Math.round(m / SPEED / 60))), km: num(m / 1000, 1) }));
  }
}

function tripAddresses(trip) {
  return h('div', { class: 'col' },
    h('div', { class: 'addr' }, h('span', { class: 'dot a' }), h('div', { class: 'grow' }, trip.pickup.address, trip.pickup.note ? h('small', { style: { display: 'block' } }, `📝 ${trip.pickup.note}`) : null)),
    h('div', { class: 'addr' }, h('span', { class: 'dot b' }), h('div', { class: 'grow' }, trip.dropoff.address)));
}

function fareTable(trip) {
  const f = trip.final?.fare ?? trip.est.fare;
  // when the upfront price was kept, the amounts are the estimate's, so label them with the estimate's distance/time
  const billed = trip.final && !trip.final.keptEstimate ? trip.final : trip.est;
  const rows = [
    [t('fare.base'), f.baseFare], [t('fare.distance', { km: num(billed.distanceM / 1000, 1) }), f.distanceFare],
    [t('fare.time', { min: num(Math.round(billed.durationS / 60)) }), f.timeFare],
  ];
  if (f.waitingFare) rows.push([t('fare.waiting'), f.waitingFare]);
  if (f.surgeAmount) rows.push([t('fare.surge', { x: num(trip.surge, 1) }), f.surgeAmount]);
  if (f.fees) rows.push([t('fare.fees'), f.fees]);
  const adjust = f.gross - rows.reduce((sum, [, v]) => sum + v, 0);
  if (adjust) rows.push([t(f.minimumApplied ? 'fare.minimum_topup' : 'fare.rounding'), adjust]);
  if (f.discount) rows.push([t('fare.discount'), -f.discount]);
  return h('div', { class: 'kv' }, rows.flatMap(([k, v]) => [h('span', {}, k), h('span', { class: 'num' }, money(v))]),
    h('span', { style: { fontWeight: 800, color: 'var(--text)' } }, t('fare.total')), h('span', { class: 'num', style: { fontSize: '1.15rem' } }, money(f.total)),
    f.minimumApplied ? h('small', { style: { gridColumn: '1 / -1', textAlign: 'start' } }, t('fare.minimum_applied')) : null,
    trip.final?.keptEstimate ? h('small', { style: { gridColumn: '1 / -1', textAlign: 'start' } }, t('fare.kept_estimate')) : null);
}

function renderRating(trip, driver) {
  let starsVal = 5;
  const tags = new Set();
  const TAGS = ['clean', 'polite', 'safe', 'route', 'music'];
  const starRow = h('div', { class: 'row', style: { justifyContent: 'center', fontSize: '2.2rem' } });
  const drawStars = () => mount(starRow, [1, 2, 3, 4, 5].map((n) => h('button', { class: 'btn ghost', style: { fontSize: '2rem', color: 'var(--accent)', padding: '0 4px' }, 'aria-label': `${n}`, onclick: () => { starsVal = n; drawStars(); } }, n <= starsVal ? '★' : '☆')));
  drawStars();
  const comment = h('textarea', { class: 'input', placeholder: t('rating.comment') });
  mount(els.sheet,
    h('div', { class: 'status-line' }, t('trip.completed')),
    h('div', { class: 'notice good' }, t(`pay.paid_${trip.paymentMethod === 'CASH' ? 'cash' : 'online'}`, { amount: money(trip.final.fare.total) })),
    fareTable(trip),
    h('div', { class: 'sep' }),
    h('h3', { class: 'center', style: { justifyContent: 'center' } }, t('rating.title', { name: driver?.name ?? '' })),
    starRow,
    h('div', { class: 'chips', style: { flexWrap: 'wrap' } }, TAGS.map((k) => h('button', { class: 'chip', onclick: (e) => { tags.has(k) ? tags.delete(k) : tags.add(k); e.currentTarget.classList.toggle('on'); } }, t(`rating.tag_${k}`)))),
    comment,
    h('button', { class: 'btn primary lg block', onclick: () => attempt(() => { E.rateTrip(trip.id, 'CUSTOMER', starsVal, [...tags], comment.value); toast(t('rating.thanks'), 'good'); dismiss(trip.id); }) }, t('rating.submit')),
    h('div', { class: 'row' },
      h('button', { class: 'btn grow', onclick: () => dismiss(trip.id) }, t('rating.skip')),
      h('button', { class: 'btn grow', onclick: () => newTicket(trip) }, t('trip.report_problem'))),
  );
}

function callModal(driver) {
  const masked = `+964 7•• ••• ${driver.phone.slice(-3)}`;
  modal(t('trip.call'), h('div', { class: 'col center' }, h('div', { class: 'avatar', style: { margin: '0 auto', width: '64px', height: '64px' } }, initials(driver.name)),
    h('b', {}, driver.name), h('div', { class: 'ltr' }, masked), h('small', { class: 'muted' }, t('trip.masked_note'))), [{ label: t('common.close'), value: () => true }]);
}

function chatModal(trip) {
  const box = h('div', { class: 'chat' });
  const draw = () => {
    const tNow = read('trips').find((x) => x.id === trip.id);
    mount(box, (tNow?.chat ?? []).map((m) => h('div', { class: `bubble ${m.from === 'CUSTOMER' ? 'me' : ''}` }, m.key ? t(m.key) : m.text)));
    box.scrollTop = box.scrollHeight;
  };
  const input = h('input', { class: 'input', placeholder: t('chat.placeholder') });
  const send = (text) => { attempt(() => E.sendChat(trip.id, 'CUSTOMER', text)); input.value = ''; };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && send(input.value));
  const off = onChange((tables) => tables.includes('trips') && draw());
  draw();
  modal(t('trip.chat'), h('div', { class: 'col' }, box,
    h('div', { class: 'chips' }, ['chat.quick_here', 'chat.quick_coming', 'chat.quick_wait'].map((k) => h('button', { class: 'chip', onclick: () => send(t(k)) }, t(k)))),
    h('div', { class: 'row' }, input, h('button', { class: 'btn primary', onclick: () => send(input.value) }, t('chat.send'))))).then(off);
}

async function shareTrip(trip, driver) {
  const text = `${t('trip.share_text')}\n${E.shareText(trip, driver)}`;
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); toast(t('trip.share_copied'), 'good'); }
  } catch { /* cancelled */ }
}

function sosModal(trip) {
  const city = read('cities').find((c) => c.id === trip.cityId);
  const c = me();
  modal(t('sos.title'), h('div', { class: 'col' },
    h('p', {}, t('sos.body')),
    h('div', { class: 'row wrap' },
      h('a', { class: 'btn danger grow', href: `tel:${city.emergency.police}` }, `🚓 ${t('sos.police')} ${city.emergency.police}`),
      h('a', { class: 'btn danger grow', href: `tel:${city.emergency.ambulance}` }, `🚑 ${t('sos.ambulance')} ${city.emergency.ambulance}`)),
    h('small', { class: 'muted' }, t('sos.numbers_note')),
    h('button', { class: 'btn primary block', onclick: (e) => {
      E.triggerSos(userKey(), 'CUSTOMER', trip.id, driverOf(trip)?.loc ?? [trip.pickup.lat, trip.pickup.lng]);
      e.currentTarget.disabled = true;
      toast(t('sos.sent', { n: c.emergency.length }), 'good');
    } }, t('sos.alert'))),
  [{ label: t('common.close'), value: () => true }]);
}

function cancelModal(trip) {
  const reasons = read('cancellation').reasons.CUSTOMER;
  const policy = read('cancellation').policy;
  let idx = 0;
  const sinceAccepted = trip.ts.accepted ? ((Date.now() - trip.ts.accepted) / 1000) * read('settings').simSpeed : 0;
  const mayCharge = trip.status === 'DRIVER_ARRIVED' || (trip.ts.accepted && sinceAccepted > policy.freeWindowS);
  modal(t('trip.cancel'), h('div', { class: 'col' },
    mayCharge ? h('div', { class: 'notice warn' }, t('trip.cancel_fee_warn', { fee: money(trip.status === 'DRIVER_ARRIVED' && trip.waitingS >= policy.noShowAfterS ? policy.feeAfterArrived : policy.fee) })) : h('div', { class: 'notice good' }, t('trip.cancel_free')),
    reasons.map((r, i) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'reason', checked: i === 0, onchange: () => { idx = i; } }), tr(r)))),
  [{ label: t('common.back'), value: () => null }, { label: t('trip.cancel_confirm'), kind: 'danger', value: () => true }]).then((ok) => {
    if (!ok) return;
    attempt(() => {
      const r = E.cancelTrip(trip.id, 'CUSTOMER', st.customerId, idx);
      if (r.cancel?.fee) toast(t('trip.fee_charged', { fee: money(r.cancel.fee) }), 'error');
      dismiss(trip.id);
    });
  });
}

// ───────────────────────────── other tabs ─────────────────────────────

function renderPage() {
  const c = me();
  const page = h('div', { class: 'page' });
  mount(els.page, page);
  if (st.tab === 'trips') return renderTripsTab(page);
  if (st.tab === 'wallet') return renderWalletTab(page, c);
  return renderAccountTab(page, c);
}

const STATUS_KIND = { COMPLETED: 'good', NO_DRIVER_FOUND: 'warn', CANCELLED_BY_CUSTOMER: 'bad', CANCELLED_BY_DRIVER: 'bad', CANCELLED_BY_ADMIN: 'bad' };

function renderTripsTab(page) {
  const trips = myTrips().slice().reverse();
  mount(page, h('h2', {}, t('nav.trips')),
    trips.length ? h('div', { class: 'card', style: { padding: '4px 12px' } }, h('div', { class: 'list' }, trips.map((x) => h('button', { class: 'list-item', onclick: () => tripDetail(x) },
      h('span', { style: { fontSize: '1.5rem' } }, read('vehicleTypes').find((v) => v.id === x.vehicleTypeId)?.icon ?? '🚗'),
      h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, x.dropoff.address || tr(read('cities').find((c) => c.id === x.cityId)?.name)), h('small', {}, dateTime(x.ts.requested))),
      h('div', { style: { textAlign: 'end' } }, h('div', { class: 'num', style: { fontWeight: 700 } }, money(x.final?.fare.total ?? x.est.fare.total)), badge(t(`status.${x.status}`), STATUS_KIND[x.status] ?? 'info')))))) : h('p', { class: 'muted center' }, t('trips.empty')));
}

function tripDetail(trip) {
  const driver = driverOf(trip);
  const mapEl = h('div', { class: 'mini-map' });
  modal(`${t('trips.trip')} ${trip.code}`, h('div', { class: 'col' },
    mapEl, h('div', { class: 'row between' }, badge(t(`status.${trip.status}`), STATUS_KIND[trip.status] ?? 'info'), h('small', {}, dateTime(trip.ts.requested))),
    tripAddresses(trip),
    driver ? h('div', {}, h('small', {}, t('trips.driver')), h('div', {}, `${driver.name} – ${driver.vehicle.make} ${driver.vehicle.model} – ${driver.vehicle.plate}`)) : null,
    h('div', { class: 'kv' }, h('span', {}, t('trips.payment')), h('span', {}, t(`pay.${trip.paymentMethod}`)),
      trip.ratings.byCustomer ? [h('span', {}, t('trips.your_rating')), h('span', {}, stars(trip.ratings.byCustomer.stars))] : null),
    fareTable(trip),
    h('button', { class: 'btn block', onclick: () => newTicket(trip) }, t('trip.report_problem'))),
  [{ label: t('common.close'), value: () => true }]);
  setTimeout(() => {
    const m = createMap(mapEl, [trip.pickup.lat, trip.pickup.lng], 13);
    L.marker([trip.pickup.lat, trip.pickup.lng], { icon: icons.pickup() }).addTo(m);
    L.marker([trip.dropoff.lat, trip.dropoff.lng], { icon: icons.dropoff() }).addTo(m);
    const pts = trip.path?.length > 1 ? [[trip.pickup.lat, trip.pickup.lng], ...trip.path] : trip.route ?? [[trip.pickup.lat, trip.pickup.lng], [trip.dropoff.lat, trip.dropoff.lng]];
    polyline(m, pts, trip.path?.length > 1 ? 'path' : 'route');
    fit(m, pts, 30);
  }, 60);
}

function renderWalletTab(page, c) {
  const key = `c:${c.id}`;
  const bal = E.balance(key);
  const txs = read('walletTx').filter((x) => x.owner === key).slice().reverse();
  mount(page,
    h('h2', {}, t('nav.wallet')),
    h('div', { class: 'card' }, h('small', {}, t('wallet.balance')), h('div', { class: 'num', style: { fontSize: '2rem', fontWeight: 800, color: bal < 0 ? 'var(--bad)' : 'var(--text)' } }, money(bal)),
      bal < 0 ? h('div', { class: 'notice bad' }, t('wallet.negative')) : null,
      h('button', { class: 'btn primary block', style: { marginTop: '10px' }, onclick: topUpModal }, '+ ', t('wallet.add_money'))),
    h('h3', {}, t('wallet.history')),
    txs.length ? h('div', { class: 'card', style: { padding: '4px 12px' } }, h('div', { class: 'list' }, txs.map((x) => h('div', { class: 'list-item', style: { cursor: 'default' } },
      h('div', { class: 'grow' }, h('div', {}, t(`tx.${x.type}`)), h('small', {}, dateTime(x.ts), x.note ? ` – ${x.note}` : '')),
      h('b', { class: 'num', style: { color: x.amount < 0 ? 'var(--bad)' : 'var(--good)' } }, `${x.amount > 0 ? '+' : ''}${money(x.amount)}`))))) : h('p', { class: 'muted' }, t('wallet.empty')),
  );
}

function topUpModal() {
  let method = 'ZAINCASH';
  const amount = h('input', { class: 'input num', type: 'number', min: 1000, step: 250, value: 10000 });
  modal(t('wallet.add_money'), h('div', { class: 'col' },
    h('div', { class: 'chips', style: { flexWrap: 'wrap' } }, [5000, 10000, 25000, 50000].map((v) => h('button', { class: 'chip', onclick: () => { amount.value = v; } }, money(v)))),
    field(t('wallet.amount'), amount),
    field(t('wallet.method'), select(['ZAINCASH', 'FIB', 'FASTPAY', 'CARD'].map((m) => [m, t(`pay.${m}`)]), method, (v) => { method = v; })),
    h('small', { class: 'muted' }, t('pay.gateway_demo_short'))),
  [{ label: t('common.cancel'), value: () => null }, { label: t('pay.authorize'), kind: 'primary', value: () => true }]).then((ok) => {
    if (ok) attempt(() => { E.topUp(st.customerId, amount.value, method); toast(t('wallet.topped_up'), 'good'); render(true); });
  });
}

function renderAccountTab(page, c) {
  const promos = read('promotions').filter((p) => p.isActive && p.code && p.type !== 'DRIVER_INCENTIVE');
  mount(page,
    h('div', { class: 'row' }, h('div', { class: 'avatar', style: { width: '64px', height: '64px' } }, c.photo ? h('img', { src: c.photo, alt: '' }) : initials(c.name)),
      h('div', { class: 'grow' }, h('h2', { style: { margin: 0 } }, c.name), h('div', { class: 'ltr text-2' }, c.phone), h('small', {}, '★ ', num(c.rating, 2), ` – ${t('account.trips', { n: num(c.trips) })}`))),
    h('div', { class: 'card col' },
      h('button', { class: 'list-item', onclick: () => profileModal(c) }, '✏️ ', t('account.edit_profile')),
      h('button', { class: 'list-item', onclick: () => changePhoneModal(c) }, '📱 ', t('account.change_phone')),
      h('button', { class: 'list-item', onclick: () => passwordModal(c) }, '🔑 ', t(c.pwd ? 'account.change_password' : 'account.set_password')),
      h('button', { class: 'list-item', onclick: () => savedPlacesModal(c) }, '📍 ', t('account.saved_places')),
      h('button', { class: 'list-item', onclick: () => emergencyModal(c) }, '🆘 ', t('account.emergency_contacts')),
      h('button', { class: 'list-item', onclick: () => supportModal() }, '🎧 ', t('account.support')),
      h('button', { class: 'list-item', onclick: showNotifications }, '🔔 ', t('nav.notifications'))),
    installCard(),
    h('div', { class: 'card' }, h('h3', {}, '🎁 ', t('account.referral')), h('p', { class: 'text-2' }, t('account.referral_text', { amount: money(read('settings').refereeBonus) })),
      h('div', { class: 'row' }, h('span', { class: 'plate grow center', style: { fontSize: '1.2rem' } }, c.referralCode),
        h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(t('account.referral_share', { code: c.referralCode })); toast(t('trip.share_copied'), 'good'); } catch { /* ignore */ } } }, t('common.copy')))),
    h('div', { class: 'card' }, h('h3', {}, '🏷️ ', t('account.offers')), promos.map((p) => h('div', { class: 'row between', style: { padding: '6px 0' } }, h('span', {}, tr(p.title)), h('span', { class: 'plate' }, p.code)))),
    h('div', { class: 'card col' },
      h('div', { class: 'row between' }, h('span', {}, t('account.language')), langSwitcher(changeLanguage)),
      h('button', { class: 'btn block', onclick: logout }, t('account.logout')),
      h('button', { class: 'btn ghost block', style: { color: 'var(--bad)' }, onclick: async () => {
        if (await confirmBox(t('account.delete_confirm'), t('account.delete'), 'danger')) { E.updateCustomer(c.id, (x) => { x.status = 'DELETED'; x.name = '—'; x.email = null; x.photo = null; }); logout(); }
      } }, t('account.delete'))),
  );
}

function profileModal(c) {
  const name = h('input', { class: 'input', value: c.name });
  const email = h('input', { class: 'input ltr', type: 'email', value: c.email ?? '' });
  const birth = h('input', { class: 'input', type: 'date', value: c.birthDate ?? '' });
  const addr = h('input', { class: 'input', value: c.address ?? '' });
  const gender = select(['UNSPECIFIED', 'MALE', 'FEMALE'].map((g) => [g, t(`gender.${g}`)]), c.gender);
  let photo = c.photo;
  const file = h('input', { type: 'file', accept: 'image/*', onchange: async (e) => { if (e.target.files[0]) photo = await fileToThumb(e.target.files[0], 200); } });
  modal(t('account.edit_profile'), h('div', { class: 'col' }, field(t('profile.name'), name), field(t('profile.email'), email), field(t('profile.birth'), birth),
    field(t('profile.gender'), gender), field(t('profile.address'), addr), field(t('profile.photo'), file)),
  [{ label: t('common.cancel'), value: () => null }, { label: t('common.save'), kind: 'primary', value: () => true }]).then((ok) => {
    if (!ok) return;
    if (name.value.trim().length < 2) return toast(t('err.name_required'), 'error');
    const newEmail = email.value.trim().toLowerCase() || null;
    if (newEmail && read('customers').some((x) => x.id !== c.id && x.email?.toLowerCase() === newEmail)) return toast(t('err.email_taken'), 'error');
    if (!newEmail && c.pwd) return toast(t('err.email_needed_for_password'), 'error');
    E.updateCustomer(c.id, (x) => Object.assign(x, { name: name.value.trim().slice(0, 80), email: newEmail, birthDate: birth.value || null, gender: gender.value, address: addr.value.trim(), photo }));
    renderPage();
  });
}

function passwordModal(c) {
  if (!c.email) { toast(t('err.need_email'), 'error'); return profileModal(c); }
  const cur = h('input', { class: 'input ltr', type: 'password', autocomplete: 'current-password' });
  const pw = h('input', { class: 'input ltr', type: 'password', autocomplete: 'new-password' });
  modal(t(c.pwd ? 'account.change_password' : 'account.set_password'), h('div', { class: 'col' },
    h('small', { class: 'muted' }, t('account.password_for', { email: c.email })),
    c.pwd ? field(t('account.current_password'), cur) : null, field(t('auth.new_password'), pw, t('auth.password_hint'))),
  [{ label: t('common.cancel'), value: () => null }, { label: t('common.save'), kind: 'primary', value: () => true }]).then((ok) => {
    if (ok) attempt(async () => { await E.setPassword(c.id, pw.value, c.pwd ? cur.value : undefined); toast(t('account.password_set'), 'good'); renderPage(); });
  });
}

function changePhoneModal(c) {
  const input = h('input', { class: 'input ltr', type: 'tel', placeholder: '0770 000 0000' });
  modal(t('account.change_phone'), field(t('account.new_phone'), input), [{ label: t('common.cancel'), value: () => null }, { label: t('common.continue'), kind: 'primary', value: () => input.value }]).then((v) => {
    if (!v) return;
    attempt(() => {
      const phone = E.normalizePhone(v);
      if (read('customers').some((x) => x.phone === phone)) throw new E.AppError('err.exists');
      const code = E.sendOtp(phone);
      const otp = h('input', { class: 'input otp', inputmode: 'numeric', maxlength: 6 });
      modal(t('auth.otp_title'), h('div', { class: 'col' }, h('p', {}, t('auth.otp_sent', { phone })), h('div', { class: 'notice' }, t('auth.demo_code', { code })), otp),
        [{ label: t('auth.verify'), kind: 'primary', value: () => otp.value }]).then((code2) => {
        if (code2 == null) return;
        attempt(() => { E.verifyOtp(phone, code2); E.updateCustomer(c.id, (x) => { x.phone = phone; }); toast(t('account.phone_changed'), 'good'); renderPage(); });
      });
    });
  });
}

function savedPlacesModal(c) {
  const body = h('div', { class: 'col' });
  const draw = () => {
    const cur = me();
    mount(body, h('p', { class: 'text-2' }, t('account.saved_hint')), ['home', 'work'].map((k) => h('div', { class: 'row' },
      h('span', { class: 'grow' }, h('b', {}, t(`home.${k}`)), h('br'), h('small', {}, cur.saved[k]?.address ?? t('account.not_set'))),
      h('button', { class: 'btn sm', onclick: () => { E.updateCustomer(c.id, (x) => { x.saved[k] = { lat: st.pickup[0], lng: st.pickup[1], address: st.pickupAddr || `${st.pickup[0].toFixed(4)}, ${st.pickup[1].toFixed(4)}` }; }); draw(); } }, t('account.set_here')),
      cur.saved[k] ? h('button', { class: 'btn sm ghost', onclick: () => { E.updateCustomer(c.id, (x) => { delete x.saved[k]; }); draw(); } }, '✕') : null)));
  };
  draw();
  modal(t('account.saved_places'), body, [{ label: t('common.close'), value: () => true }]);
}

function emergencyModal(c) {
  const body = h('div', { class: 'col' });
  const name = h('input', { class: 'input', placeholder: t('profile.name') });
  const phone = h('input', { class: 'input ltr', type: 'tel', placeholder: '0750 000 0000' });
  const draw = () => mount(body, h('p', { class: 'text-2' }, t('account.emergency_hint')), me().emergency.map((e, i) => h('div', { class: 'row' }, h('span', { class: 'grow' }, e.name, ' – ', h('span', { class: 'ltr' }, e.phone)),
    h('button', { class: 'btn sm ghost', onclick: () => { E.updateCustomer(c.id, (x) => { x.emergency.splice(i, 1); }); draw(); } }, '✕'))),
  h('div', { class: 'row' }, name, phone), h('button', { class: 'btn', onclick: () => attempt(() => {
    const p = E.normalizePhone(phone.value);
    if (!name.value.trim()) throw new E.AppError('err.name_required');
    if (me().emergency.length >= 5) throw new E.AppError('err.limit');
    E.updateCustomer(c.id, (x) => { x.emergency.push({ name: name.value.trim().slice(0, 60), phone: p }); });
    name.value = ''; phone.value = '';
    draw();
  }) }, '+ ', t('common.add')));
  draw();
  modal(t('account.emergency_contacts'), body, [{ label: t('common.close'), value: () => true }]);
}

function supportModal() {
  const body = h('div', { class: 'col' });
  renderTickets(body, userKey(), 'CUSTOMER', myTrips());
  modal(t('account.support'), body, [{ label: t('common.close'), value: () => true }]);
}

function newTicket(trip) {
  const body = h('div', { class: 'col' });
  renderTickets(body, userKey(), 'CUSTOMER', myTrips(), trip);
  modal(t('account.support'), body, [{ label: t('common.close'), value: () => true }]);
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
