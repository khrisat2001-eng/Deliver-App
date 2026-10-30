// Business operations. In a real deployment this file is the backend API; here it runs in the browser.
// Every operation is one transaction (`tx`) over fresh data, so open tabs never overwrite each other.
import {
  calculateFare, finalizeFare, calculateSurge, resolveCommissionRule, settleTrip, evaluatePromotion,
  nextDispatchStep, rankDrivers, assertTransition, isTerminal, customerCancellationFee, DEFAULT_MATCHING_CONFIG,
} from '../core/index.js';
import { read, tx, uid } from './db.js';
import { DOC_TYPES } from './seed.js';
import { route, densify, dist, advance, nearestCity, zonesAt, pathLength } from './geo.js';

export class AppError extends Error {
  constructor(key, vars) {
    super(key);
    this.key = key;
    this.vars = vars;
  }
}

const settings = () => read('settings');
const now = () => Date.now();
export const ACTIVE = ['SEARCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS'];
export const WITH_DRIVER = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS'];

/** Baghdad time is UTC+3 all year (no daylight saving). */
export function localParts(ts = now()) {
  const d = new Date(ts + 3 * 3600_000);
  return { day: d.getUTCDay(), hour: d.getUTCHours(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), date: d.toISOString().slice(0, 10) };
}

// ───────────────────────────── helpers on a transaction state S ─────────────────────────────

function nextSeq(S, key) {
  S.meta[key] = (S.meta[key] ?? 1000) + 1;
  return S.meta[key];
}

export function balance(key, S) {
  return (S ? S.wallets : read('wallets'))[key]?.balance ?? 0;
}

function postTx(S, owner, type, amount, extra = {}) {
  if (!amount) return;
  const w = (S.wallets[owner] ??= { balance: 0 });
  w.balance += amount;
  S.walletTx.push({ id: uid('wt'), owner, type, amount, balanceAfter: w.balance, ts: now(), ...extra });
}

function notify(S, to, key, vars = {}) {
  S.notifications.push({ id: uid('n'), to, key, vars, ts: now(), read: false });
  if (S.notifications.length > 400) S.notifications.splice(0, S.notifications.length - 400);
}

function audit(S, admin, action, entity, entityId, before, after) {
  S.audit.push({ id: uid('au'), admin: admin?.role ?? 'system', action, entity, entityId, before: before ?? null, after: after ?? null, ts: now() });
  if (S.audit.length > 600) S.audit.splice(0, S.audit.length - 600);
}

function setStatus(trip, to, actor, extra = {}) {
  assertTransition(trip.status, to, actor);
  (trip.events ??= []).push({ from: trip.status, to, by: actor, ts: now(), ...extra });
  trip.status = to;
}

export function documentsValid(driver) {
  const today = localParts().date;
  return DOC_TYPES.every((dt) => {
    const d = driver.documents.find((x) => x.type === dt.id);
    return d && d.status === 'APPROVED' && (!d.expiresAt || d.expiresAt >= today);
  });
}

export function cashDebt(driverId, S) {
  return Math.max(0, -balance(`d:${driverId}`, S));
}

function matchingConfig() {
  const s = settings();
  return {
    ...DEFAULT_MATCHING_CONFIG, radiiM: s.radiiM, batchSize: s.batchSize, offerTimeoutS: s.offerTimeoutS,
    maxPickupEtaS: s.maxPickupEtaS, cashDebtLimit: s.cashDebtLimit, fallbackSpeedMps: s.fallbackSpeedMps, weights: s.weights,
  };
}

function candidates(drivers, S) {
  const t = now();
  return drivers.map((d) => ({
    driverId: d.id, location: { lat: d.loc[0], lng: d.loc[1] }, cityId: d.cityId, vehicleTypeIds: d.vehicle.serves,
    approvalStatus: d.status, availability: d.availability, rating: d.rating,
    acceptanceRate: d.offersReceived >= 5 ? d.offersAccepted / d.offersReceived : 0.9,
    idleSeconds: Math.max(0, (t - (d.idleSince ?? t)) / 1000), cashDebt: cashDebt(d.id, S), documentsValid: documentsValid(d),
  }));
}

// ───────────────────────────── pricing ─────────────────────────────

export function resolvePricingRule(cityId, vehicleTypeId, zones = []) {
  const rules = read('pricingRules').filter((r) => r.active && r.cityId === cityId && r.vehicleTypeId === vehicleTypeId);
  for (const z of zones) {
    const zr = rules.find((r) => r.zoneId === z.id);
    if (zr) return zr;
  }
  return rules.find((r) => !r.zoneId);
}

function surgeRuleFor(cityId, zones) {
  const rules = read('surgeRules');
  for (const z of zones) {
    const r = rules.find((x) => x.zoneId === z.id);
    if (r) return r;
  }
  return rules.find((x) => x.cityId === cityId && !x.zoneId);
}

/** Demand and supply for a surge scope (city, or a zone circle). */
function demandSupply(rule, trips, drivers) {
  const zone = rule.zoneId ? read('zones').find((z) => z.id === rule.zoneId) : null;
  const inScope = (p) => !zone || dist(p, zone.center) <= zone.radiusM;
  const since = now() - 10 * 60_000;
  const demand = trips.filter((t) => t.cityId === rule.cityId && !t.historical && t.ts.requested >= since && inScope([t.pickup.lat, t.pickup.lng])).length;
  const supply = drivers.filter((d) => d.cityId === rule.cityId && d.availability === 'ONLINE' && d.status === 'APPROVED' && inScope(d.loc)).length;
  return { demand, supply };
}

export function surgeFor(cityId, pickup) {
  const zones = zonesAt(pickup, cityId);
  const rule = surgeRuleFor(cityId, zones);
  if (!rule) return 1;
  const state = read('surgeState')[rule.id];
  if (state && now() - state.ts < 60_000) return state.multiplier;
  const { demand, supply } = demandSupply(rule, read('trips'), read('drivers'));
  const lp = localParts();
  return calculateSurge(rule, { demand, supply, localDay: lp.day, localMinutes: lp.minutes });
}

function promoFor(code, customer, fareGross, cityId, vehicleTypeId, trips) {
  if (!code) return null;
  const p = read('promotions').find((x) => x.code && x.code.toUpperCase() === code.trim().toUpperCase() && x.type !== 'DRIVER_INCENTIVE');
  if (!p) return { ok: false, reason: 'not_found' };
  const userUses = trips.filter((t) => t.customerId === customer.id && t.promoId === p.id && !t.status.startsWith('CANCELLED')).length;
  const r = evaluatePromotion(
    { ...p, startsAt: new Date(`${p.startsAt}T00:00:00+03:00`), endsAt: new Date(`${p.endsAt}T23:59:59+03:00`), percent: p.percent ?? undefined, amount: p.amount ?? undefined, maxDiscount: p.maxDiscount ?? undefined, minFare: p.minFare ?? undefined, totalLimit: p.totalLimit ?? undefined },
    { fare: fareGross, cityId, vehicleTypeId, at: new Date(), userUses, userCompletedTrips: customer.trips },
  );
  return { ...r, promoId: p.id };
}

/** Upfront quote for every vehicle type in the city. */
export async function quote(customerId, pickup, dropoff, promoCode) {
  const city = nearestCity(pickup);
  if (dist(pickup, city.center) > 40_000) throw new AppError('err.out_of_area');
  if (dist(pickup, dropoff) < 200) throw new AppError('err.too_short');
  if (nearestCity(dropoff).id !== city.id || dist(dropoff, city.center) > 45_000) throw new AppError('err.intercity');
  const r = await route(pickup, dropoff);
  const zones = zonesAt(pickup, city.id);
  const dropZones = zonesAt(dropoff, city.id);
  const touchesAirport = [...zones, ...dropZones].some((z) => z.kind === 'airport');
  const extraFees = [...new Set([...zones, ...dropZones])].map((z) => z.specialFee || 0).filter(Boolean);
  const surge = surgeFor(city.id, pickup);
  const customer = read('customers').find((c) => c.id === customerId);
  const trips = read('trips');
  const cfg = matchingConfig();
  const cands = candidates(read('drivers'));
  const options = [];
  for (const vt of read('vehicleTypes').filter((v) => v.active).sort((a, b) => a.sortOrder - b.sortOrder)) {
    const rule = resolvePricingRule(city.id, vt.id, zones);
    if (!rule) continue;
    const base = calculateFare(rule, { distanceM: r.distanceM, durationS: r.durationS, surgeMultiplier: surge, touchesAirport, extraFees });
    const promo = promoFor(promoCode, customer, base.gross, city.id, vt.id, trips);
    const fare = promo?.ok ? calculateFare(rule, { distanceM: r.distanceM, durationS: r.durationS, surgeMultiplier: surge, touchesAirport, extraFees, discount: promo.discount }) : base;
    const ranked = rankDrivers(cands, { pickup: { lat: pickup[0], lng: pickup[1] }, cityId: city.id, vehicleTypeId: vt.id, isCash: false, excludedDriverIds: new Set() }, cfg.radiiM.at(-1), cfg);
    options.push({ vehicleTypeId: vt.id, ruleId: rule.id, fare, surge, promo, etaS: ranked[0]?.pickupEtaS ?? null, available: ranked.length > 0 });
  }
  return {
    cityId: city.id, pickup, dropoff, distanceM: r.distanceM, durationS: r.durationS, points: r.points, routeSource: r.source,
    touchesAirport, extraFees, zoneIds: zones.map((z) => z.id), surge, options, promoCode: promoCode?.trim() || null,
    expiresAt: now() + settings().quoteValidityS * 1000,
  };
}

// ───────────────────────────── trip lifecycle ─────────────────────────────

export function requestTrip(customerId, q, vehicleTypeId, paymentMethod, pickupAddress, dropoffAddress, pickupNote) {
  if (now() > q.expiresAt) throw new AppError('err.quote_expired');
  const opt = q.options.find((o) => o.vehicleTypeId === vehicleTypeId);
  if (!opt) throw new AppError('err.no_vehicle');
  return tx((S) => {
    const c = S.customers.find((x) => x.id === customerId);
    if (!c || c.status !== 'ACTIVE') throw new AppError('err.account_inactive');
    if (S.trips.some((t) => t.customerId === customerId && ACTIVE.includes(t.status))) throw new AppError('err.active_trip');
    if (paymentMethod === 'WALLET' && balance(`c:${customerId}`, S) < opt.fare.total) throw new AppError('err.insufficient_wallet');
    const seq = nextSeq(S, 'tripSeq');
    const trip = {
      id: uid('t'), code: `R${seq}`, customerId, driverId: null, cityId: q.cityId, vehicleTypeId, status: 'REQUESTED',
      pickup: { lat: q.pickup[0], lng: q.pickup[1], address: pickupAddress, note: pickupNote || '' },
      dropoff: { lat: q.dropoff[0], lng: q.dropoff[1], address: dropoffAddress },
      est: { distanceM: q.distanceM, durationS: q.durationS, fare: opt.fare, surge: opt.surge, ruleId: opt.ruleId, touchesAirport: q.touchesAirport, extraFees: q.extraFees },
      surge: opt.surge, route: q.points, paymentMethod, promoCode: opt.promo?.ok ? q.promoCode : null, promoId: opt.promo?.ok ? opt.promo.promoId : null,
      pin: String(1000 + Math.floor(Math.random() * 9000)), offers: [], excluded: [], round: 0,
      ts: { requested: now(), searchStarted: now() }, rideS: 0, waitingS: 0, traveledM: 0, ratings: {}, chat: [], events: [],
    };
    setStatus(trip, 'SEARCHING', 'SYSTEM');
    S.trips.push(trip);
    notify(S, `c:${customerId}`, 'notify.trip_created', { code: trip.code });
    return trip;
  });
}

function sendOffers(S, trip) {
  const cfg = matchingConfig();
  const customer = S.customers.find((c) => c.id === trip.customerId);
  const busy = new Set(S.trips.filter((t) => t.status === 'SEARCHING' && t.id !== trip.id).flatMap((t) => t.offers.filter((o) => o.status === 'SENT').map((o) => o.driverId)));
  const excluded = new Set([...trip.excluded, ...busy]);
  const step = nextDispatchStep(candidates(S.drivers, S), {
    pickup: { lat: trip.pickup.lat, lng: trip.pickup.lng }, cityId: trip.cityId, vehicleTypeId: trip.vehicleTypeId,
    isCash: trip.paymentMethod === 'CASH', excludedDriverIds: excluded, blockedDriverIds: new Set(customer?.blockedDrivers ?? []),
  }, trip.round, cfg);
  if (step.kind === 'no_driver_found') return noDriver(S, trip);
  trip.round = step.round;
  for (const d of step.drivers) {
    const driver = S.drivers.find((x) => x.id === d.driverId);
    driver.offersReceived++;
    trip.offers.push({
      driverId: d.driverId, round: step.round, score: d.score, etaS: d.pickupEtaS, distanceM: d.distanceM, status: 'SENT',
      sentAt: now(), expiresAt: now() + step.timeoutS * 1000, decideAt: now() + (2 + Math.random() * 5) * 1000,
    });
    if (!driver.bot) notify(S, `d:${driver.id}`, 'notify.new_request', { code: trip.code });
  }
}

function noDriver(S, trip) {
  setStatus(trip, 'NO_DRIVER_FOUND', 'SYSTEM');
  trip.ts.cancelled = now();
  notify(S, `c:${trip.customerId}`, 'notify.no_driver', { code: trip.code });
}

function assignDriver(S, trip, driver) {
  setStatus(trip, 'DRIVER_ASSIGNED', 'DRIVER');
  trip.driverId = driver.id;
  trip.ts.accepted = now();
  trip.vehicle = { ...driver.vehicle };
  for (const o of trip.offers) if (o.status === 'SENT') o.status = o.driverId === driver.id ? 'ACCEPTED' : 'CANCELLED';
  driver.offersAccepted++;
  driver.availability = 'ON_TRIP';
  setStatus(trip, 'DRIVER_ARRIVING', 'DRIVER');
  trip.approach = densify([driver.loc, [trip.pickup.lat, trip.pickup.lng]], 80);
  trip.approachSource = 'estimate';
  trip.progress = { idx: 0, frac: 0 };
  notify(S, `c:${trip.customerId}`, 'notify.trip_accepted', { name: driver.name, code: trip.code });
}

/** Ask the map provider for the real approach route after acceptance (async, best effort). */
async function refineApproach(tripId) {
  const trip = read('trips').find((t) => t.id === tripId);
  const driver = trip && read('drivers').find((d) => d.id === trip.driverId);
  if (!driver) return;
  const r = await route(driver.loc, [trip.pickup.lat, trip.pickup.lng]);
  if (r.source !== 'osrm') return;
  tx((S) => {
    const t = S.trips.find((x) => x.id === tripId);
    if (t?.status === 'DRIVER_ARRIVING' && t.approachSource === 'estimate' && t.progress.idx < 4) {
      const d = S.drivers.find((x) => x.id === t.driverId);
      t.approach = densify([d.loc, ...r.points.slice(1)], 80);
      t.approachSource = 'osrm';
      t.progress = { idx: 0, frac: 0 };
    }
  });
}

export function respondOffer(tripId, driverId, accept) {
  const res = tx((S) => {
    const trip = S.trips.find((t) => t.id === tripId);
    const offer = trip?.offers.find((o) => o.driverId === driverId && o.status === 'SENT');
    if (!trip || trip.status !== 'SEARCHING' || !offer) throw new AppError('err.offer_gone');
    if (!accept) {
      offer.status = 'REJECTED';
      offer.respondedAt = now();
      trip.excluded.push(driverId);
      return null;
    }
    const driver = S.drivers.find((d) => d.id === driverId);
    if (driver.availability !== 'ONLINE') throw new AppError('err.offer_gone');
    offer.respondedAt = now();
    assignDriver(S, trip, driver);
    return trip.id;
  });
  if (res) refineApproach(res);
  return res;
}

export function driverArrived(tripId, driverId) {
  tx((S) => {
    const trip = S.trips.find((t) => t.id === tripId && t.driverId === driverId);
    if (!trip) throw new AppError('err.not_found');
    const driver = S.drivers.find((d) => d.id === driverId);
    if (dist(driver.loc, [trip.pickup.lat, trip.pickup.lng]) > settings().arriveRadiusM) throw new AppError('err.not_at_pickup', { m: settings().arriveRadiusM });
    setStatus(trip, 'DRIVER_ARRIVED', 'DRIVER');
    trip.ts.arrived = now();
    notify(S, `c:${trip.customerId}`, 'notify.driver_arrived', { name: driver.name });
  });
}

export function startTrip(tripId, driverId, pin) {
  tx((S) => {
    const trip = S.trips.find((t) => t.id === tripId && t.driverId === driverId);
    if (!trip) throw new AppError('err.not_found');
    if (String(pin).trim() !== trip.pin) throw new AppError('err.wrong_pin');
    beginRide(S, trip);
  });
}

function beginRide(S, trip) {
  setStatus(trip, 'IN_PROGRESS', 'DRIVER');
  trip.ts.started = now();
  trip.progress = { idx: 0, frac: 0 };
  trip.route = densify(trip.route, 80);
  trip.path = [];
  notify(S, `c:${trip.customerId}`, 'notify.trip_started', { code: trip.code });
}

export function completeTrip(tripId, driverId) {
  return tx((S) => {
    const trip = S.trips.find((t) => t.id === tripId && t.driverId === driverId);
    if (!trip) throw new AppError('err.not_found');
    finishRide(S, trip);
    return trip;
  });
}

function finishRide(S, trip) {
  setStatus(trip, 'COMPLETED', 'DRIVER');
  trip.ts.completed = now();
  const s = settings();
  const rule = read('pricingRules').find((r) => r.id === trip.est.ruleId) ?? resolvePricingRule(trip.cityId, trip.vehicleTypeId);
  const actual = {
    distanceM: Math.round(trip.traveledM || trip.est.distanceM), durationS: Math.round(trip.rideS || trip.est.durationS),
    waitingS: Math.round(trip.waitingS), surgeMultiplier: trip.surge, touchesAirport: trip.est.touchesAirport, extraFees: trip.est.extraFees,
  };
  const noDiscount = finalizeFare(rule, { ...trip.est.fare, discount: 0, total: trip.est.fare.gross }, actual, s.fareTolerancePct);
  const customer = S.customers.find((c) => c.id === trip.customerId);
  const driver = S.drivers.find((d) => d.id === trip.driverId);
  let discount = 0;
  if (trip.promoId) {
    const p = promoFor(trip.promoCode, { ...customer, trips: customer.trips }, noDiscount.fare.gross, trip.cityId, trip.vehicleTypeId, S.trips.filter((t) => t.id !== trip.id));
    if (p?.ok) discount = p.discount;
  }
  const decision = discount ? finalizeFare(rule, trip.est.fare, { ...actual, discount }, s.fareTolerancePct) : noDiscount;
  const fare = decision.fare;
  const cmRule = resolveCommissionRule(read('commissionRules').map((r) => ({ ...r, percent: r.percent ?? undefined, fixed: r.fixed ?? undefined })), {
    cityId: trip.cityId, zoneId: zonesAt([trip.pickup.lat, trip.pickup.lng], trip.cityId)[0]?.id ?? null, vehicleTypeId: trip.vehicleTypeId, driverId: driver.id, at: new Date(),
  });
  const isCash = trip.paymentMethod === 'CASH';
  const st = settleTrip(fare.gross, fare.discount, isCash, cmRule);
  trip.final = { ...actual, fare, keptEstimate: decision.keptEstimate, commission: st.commission, driverEarning: st.driverEarning, commissionRuleId: cmRule?.id ?? null };

  // Money movements
  const dKey = `d:${driver.id}`;
  const cKey = `c:${customer.id}`;
  if (isCash) {
    postTx(S, dKey, 'COMMISSION', -st.commission, { tripId: trip.id });
    postTx(S, dKey, 'PROMO_REIMBURSEMENT', fare.discount, { tripId: trip.id });
  } else {
    if (trip.paymentMethod === 'WALLET') postTx(S, cKey, 'TRIP_PAYMENT', -fare.total, { tripId: trip.id });
    else S.payments.push({ id: uid('pay'), tripId: trip.id, userKey: cKey, method: trip.paymentMethod, amount: fare.total, status: 'CAPTURED', gatewayRef: `DEMO-${trip.code}`, ts: now() });
    postTx(S, dKey, 'TRIP_EARNING', st.driverEarning, { tripId: trip.id });
  }
  postTx(S, 'platform', 'COMMISSION', st.commission - fare.discount, { tripId: trip.id });
  if (trip.promoId) {
    const p = S.promotions.find((x) => x.id === trip.promoId);
    if (p && fare.discount) p.usedCount++;
  }

  // Stats
  driver.trips++;
  driver.availability = 'ONLINE';
  driver.idleSince = now();
  customer.trips++;

  // Referral: both sides get a bonus when the new rider completes the first trip
  if (customer.trips === 1 && customer.referredBy) {
    const ref = S.customers.find((c) => c.id === customer.referredBy);
    if (ref) {
      postTx(S, cKey, 'REFERRAL_BONUS', s.refereeBonus, { note: ref.referralCode });
      postTx(S, `c:${ref.id}`, 'REFERRAL_BONUS', s.referrerBonus, { note: customer.referralCode });
      notify(S, `c:${ref.id}`, 'notify.referral_bonus', { amount: s.referrerBonus });
    }
  }
  // Driver incentive: N trips in one local day
  const today = localParts().date;
  const todayCount = S.trips.filter((t) => t.driverId === driver.id && t.status === 'COMPLETED' && localParts(t.ts.completed).date === today).length;
  for (const p of S.promotions.filter((x) => x.type === 'DRIVER_INCENTIVE' && x.isActive && x.startsAt <= today && x.endsAt >= today)) {
    if (todayCount === p.tripsPerDay) {
      postTx(S, dKey, 'DRIVER_BONUS', p.bonus, { note: p.id });
      notify(S, dKey, 'notify.bonus', { amount: p.bonus });
    }
  }
  notify(S, cKey, 'notify.trip_completed', { amount: fare.total, code: trip.code });
  notify(S, dKey, 'notify.trip_completed_driver', { amount: st.driverEarning, code: trip.code });
  if (driver.bot) rate(S, trip, 'DRIVER', 5, [], '');
}

export function cancelTrip(tripId, actor, actorId, reasonIdx, note = '') {
  return tx((S) => {
    const trip = S.trips.find((t) => t.id === tripId);
    if (!trip || isTerminal(trip.status)) throw new AppError('err.not_found');
    const s = read('cancellation').policy;
    const driver = trip.driverId ? S.drivers.find((d) => d.id === trip.driverId) : null;
    let fee = 0;
    if (actor === 'CUSTOMER') {
      if (trip.customerId !== actorId) throw new AppError('err.not_found');
      if (trip.status === 'IN_PROGRESS') throw new AppError('err.cannot_cancel_started');
      // the demo runs on a simulated clock, so policy windows are compared in simulated seconds
      const sinceAccepted = trip.ts.accepted ? ((now() - trip.ts.accepted) / 1000) * settings().simSpeed : 0;
      const promisedEta = trip.offers.find((o) => o.status === 'ACCEPTED')?.etaS ?? 0;
      const driverLate = trip.status === 'DRIVER_ARRIVING' && sinceAccepted > promisedEta * 1.5 + 180;
      fee = customerCancellationFee(
        { freeWindowS: s.freeWindowS, fee: s.fee, feeAfterArrived: s.feeAfterArrived, noShowAfterS: s.noShowAfterS },
        { status: trip.status, secondsSinceAccepted: sinceAccepted, secondsSinceArrived: trip.waitingS, driverLate },
      );
      setStatus(trip, 'CANCELLED_BY_CUSTOMER', 'CUSTOMER', { reasonIdx, note });
      S.customers.find((c) => c.id === actorId).cancelled++;
    } else if (actor === 'DRIVER') {
      if (trip.driverId !== actorId) throw new AppError('err.not_found');
      if (trip.status === 'IN_PROGRESS') throw new AppError('err.cannot_cancel_started');
      driver.cancelled++;
      driver.availability = 'ONLINE';
      driver.idleSince = now();
      if (trip.status === 'DRIVER_ARRIVED') {
        // No-show: customer pays only if the driver waited long enough
        if (trip.waitingS >= s.noShowAfterS) fee = s.feeAfterArrived;
        setStatus(trip, 'CANCELLED_BY_DRIVER', 'DRIVER', { reasonIdx, note });
      } else {
        // Re-dispatch automatically; the customer does not need to request again
        trip.events.push({ from: trip.status, to: 'CANCELLED_BY_DRIVER', by: 'DRIVER', ts: now(), reasonIdx, driverId: actorId, redispatch: true });
        setStatus(trip, 'SEARCHING', 'SYSTEM');
        trip.excluded.push(actorId);
        trip.driverId = null;
        trip.vehicle = null;
        trip.round = 0;
        trip.ts.searchStarted = now();
        trip.ts.accepted = null;
        trip.approach = null;
        notify(S, `c:${trip.customerId}`, 'notify.driver_cancelled_redispatch', {});
        return trip;
      }
    } else {
      setStatus(trip, 'CANCELLED_BY_ADMIN', 'ADMIN', { note });
      audit(S, actorId, 'trip.cancel', 'trip', trip.id, null, { note });
    }
    trip.ts.cancelled = now();
    trip.cancel = { by: actor, reasonIdx, note, fee };
    for (const o of trip.offers) if (o.status === 'SENT') o.status = 'CANCELLED';
    if (driver && actor !== 'DRIVER') { driver.availability = 'ONLINE'; driver.idleSince = now(); }
    if (fee) {
      postTx(S, `c:${trip.customerId}`, 'CANCELLATION_FEE', -fee, { tripId: trip.id });
      if (driver) postTx(S, `d:${driver.id}`, 'CANCELLATION_FEE', fee, { tripId: trip.id });
    }
    notify(S, `c:${trip.customerId}`, 'notify.trip_cancelled', { code: trip.code, fee });
    if (driver && !driver.bot) notify(S, `d:${driver.id}`, 'notify.trip_cancelled', { code: trip.code, fee: 0 });
    return trip;
  });
}

function rate(S, trip, raterType, stars, tags, comment) {
  if (trip.ratings[raterType === 'CUSTOMER' ? 'byCustomer' : 'byDriver']) return;
  const r = { stars, tags, comment, ts: now() };
  if (raterType === 'CUSTOMER') {
    trip.ratings.byCustomer = r;
    const d = S.drivers.find((x) => x.id === trip.driverId);
    d.rating = Number(((d.rating * d.ratingCount + stars) / (d.ratingCount + 1)).toFixed(2));
    d.ratingCount++;
    if (stars === 1) {
      const c = S.customers.find((x) => x.id === trip.customerId);
      if (!c.blockedDrivers.includes(d.id)) c.blockedDrivers.push(d.id);
    }
  } else {
    trip.ratings.byDriver = r;
    const c = S.customers.find((x) => x.id === trip.customerId);
    c.rating = Number(((c.rating * c.ratingCount + stars) / (c.ratingCount + 1)).toFixed(2));
    c.ratingCount++;
  }
}

export function rateTrip(tripId, raterType, stars, tags = [], comment = '') {
  tx((S) => {
    const trip = S.trips.find((t) => t.id === tripId);
    if (!trip || trip.status !== 'COMPLETED') throw new AppError('err.not_found');
    rate(S, trip, raterType, Math.min(5, Math.max(1, Math.round(stars))), tags, comment.slice(0, 500));
  });
}

const BOT_REPLIES = ['chat.bot_ok', 'chat.bot_coming', 'chat.bot_traffic'];
export function sendChat(tripId, from, text) {
  const clean = text.trim().slice(0, 300);
  if (!clean) return;
  const trip = tx((S) => {
    const t = S.trips.find((x) => x.id === tripId);
    if (!t) throw new AppError('err.not_found');
    t.chat.push({ from, text: clean, ts: now() });
    const to = from === 'CUSTOMER' ? `d:${t.driverId}` : `c:${t.customerId}`;
    notify(S, to, 'notify.chat', { text: clean.slice(0, 60) });
    return t;
  });
  const driver = read('drivers').find((d) => d.id === trip.driverId);
  if (from === 'CUSTOMER' && driver?.bot) {
    setTimeout(() => tx((S) => {
      const t = S.trips.find((x) => x.id === tripId);
      if (t && !isTerminal(t.status)) t.chat.push({ from: 'DRIVER', key: BOT_REPLIES[Math.floor(Math.random() * BOT_REPLIES.length)], ts: now() });
    }), 2500);
  }
}

export function triggerSos(userKey, actor, tripId, loc) {
  tx((S) => {
    S.sos.push({ id: uid('sos'), userKey, actor, tripId, lat: loc?.[0] ?? null, lng: loc?.[1] ?? null, status: 'OPEN', createdAt: now(), notes: '' });
  });
}

/** Build a shareable trip summary text. */
export function shareText(trip, driver) {
  return `${trip.code} – ${driver?.name ?? ''} – ${driver?.vehicle.make ?? ''} ${driver?.vehicle.model ?? ''} ${driver?.vehicle.plate ?? ''}\n`
    + `https://www.openstreetmap.org/?mlat=${driver?.loc[0] ?? trip.pickup.lat}&mlon=${driver?.loc[1] ?? trip.pickup.lng}#map=16/${driver?.loc[0] ?? trip.pickup.lat}/${driver?.loc[1] ?? trip.pickup.lng}`;
}

// ───────────────────────────── accounts ─────────────────────────────

export function normalizePhone(input) {
  let d = String(input).replace(/[^\d+]/g, '').replace(/^00/, '+');
  if (d.startsWith('+964')) d = d.slice(4);
  else if (d.startsWith('964')) d = d.slice(3);
  d = d.replace(/^0/, '');
  if (!/^7[3-9]\d{8}$/.test(d)) throw new AppError('err.bad_phone');
  return `+964${d}`;
}

// Demo OTP: the code is shown on screen instead of being sent by SMS.
const otps = new Map();
export function sendOtp(phone) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  otps.set(phone, { code, exp: now() + 5 * 60_000, tries: 0 });
  return code;
}
export function verifyOtp(phone, code) {
  const o = otps.get(phone);
  if (!o || now() > o.exp) throw new AppError('err.otp_expired');
  if (++o.tries > 5) throw new AppError('err.otp_tries');
  if (o.code !== String(code).trim()) throw new AppError('err.otp_wrong');
  otps.delete(phone);
}

export function registerCustomer({ phone, name, email, birthDate, gender, address, referralCode }) {
  return tx((S) => {
    if (S.customers.some((c) => c.phone === phone)) throw new AppError('err.exists');
    let referredBy = null;
    if (referralCode) {
      const ref = S.customers.find((c) => c.referralCode === referralCode.trim().toUpperCase());
      if (!ref) throw new AppError('err.bad_referral');
      referredBy = ref.id;
    }
    const c = {
      id: uid('c'), phone, name: name.trim().slice(0, 80), email: email?.trim() || null, birthDate: birthDate || null, gender: gender || 'UNSPECIFIED',
      address: address?.trim() || '', photo: null, emergency: [], saved: {}, referralCode: `R${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      referredBy, rating: 5, ratingCount: 0, trips: 0, cancelled: 0, status: 'ACTIVE', cityId: 'erbil', createdAt: now(), blockedDrivers: [],
    };
    S.customers.push(c);
    S.wallets[`c:${c.id}`] = { balance: 0 };
    return c;
  });
}

export function updateCustomer(id, fn) {
  tx((S) => { const c = S.customers.find((x) => x.id === id); if (c) fn(c); });
}

export function topUp(customerId, amount, method) {
  const a = Math.round(Number(amount));
  if (!(a >= 1000 && a <= 1_000_000)) throw new AppError('err.bad_amount');
  tx((S) => {
    S.payments.push({ id: uid('pay'), tripId: null, userKey: `c:${customerId}`, method, amount: a, status: 'CAPTURED', gatewayRef: `DEMO-${Date.now()}`, ts: now(), kind: 'TOP_UP' });
    postTx(S, `c:${customerId}`, 'TOP_UP', a, { note: method });
    notify(S, `c:${customerId}`, 'notify.topup', { amount: a });
  });
}

export function registerDriver(data) {
  return tx((S) => {
    if (S.drivers.some((d) => d.phone === data.phone)) throw new AppError('err.exists');
    const city = read('cities').find((c) => c.id === data.cityId);
    const serves = { TAXI: ['TAXI', 'ECONOMY'], ECONOMY: ['ECONOMY'], COMFORT: ['COMFORT', 'ECONOMY'], PREMIUM: ['PREMIUM', 'COMFORT'], SUV: ['SUV'], XL: ['XL', 'ECONOMY'] };
    const d = {
      id: uid('d'), bot: false, phone: data.phone, name: data.name.trim().slice(0, 80), nameEn: data.name, email: data.email || null, photo: data.photo || null,
      cityId: data.cityId, status: 'PENDING', availability: 'OFFLINE',
      vehicle: { cls: data.cls, serves: serves[data.cls] ?? [data.cls], make: data.make, model: data.model, year: Number(data.year), color: { ar: data.color, en: data.color, ckb: data.color }, plate: data.plate, plateRegion: data.cityId },
      documents: data.documents, loc: city.center, rating: 5, ratingCount: 0, trips: 0, offersReceived: 0, offersAccepted: 0, cancelled: 0,
      idleSince: now(), autoDrive: true, createdAt: now(), history: [{ to: 'PENDING', by: 'driver', ts: now() }],
    };
    S.drivers.push(d);
    S.wallets[`d:${d.id}`] = { balance: 0 };
    return d;
  });
}

export function resubmitDocument(driverId, type, file, fileName, expiresAt) {
  tx((S) => {
    const d = S.drivers.find((x) => x.id === driverId);
    const doc = d.documents.find((x) => x.type === type);
    Object.assign(doc, { file, fileName, expiresAt: expiresAt || doc.expiresAt, status: 'PENDING', reason: null });
    if (['CHANGES_REQUESTED', 'DOCUMENTS_EXPIRED', 'REJECTED'].includes(d.status)) {
      d.history.push({ from: d.status, to: 'UNDER_REVIEW', by: 'driver', ts: now() });
      d.status = 'UNDER_REVIEW';
    }
  });
}

export function setAvailability(driverId, online) {
  tx((S) => {
    const d = S.drivers.find((x) => x.id === driverId);
    if (!online) {
      if (S.trips.some((t) => t.driverId === driverId && WITH_DRIVER.includes(t.status))) throw new AppError('err.on_trip');
      d.availability = 'OFFLINE';
      return;
    }
    if (d.status !== 'APPROVED') throw new AppError('err.not_approved');
    if (!documentsValid(d)) throw new AppError('err.documents_invalid');
    if (cashDebt(d.id, S) > settings().cashDebtLimit * 2) throw new AppError('err.debt_block', { amount: cashDebt(d.id, S) });
    d.availability = 'ONLINE';
    d.idleSince = now();
  });
}

export function updateDriver(id, fn) {
  tx((S) => { const d = S.drivers.find((x) => x.id === id); if (d) fn(d); });
}

/** Real GPS update from the driver's phone (when simulated driving is off). */
export function driverGps(driverId, pos) {
  tx((S) => {
    const d = S.drivers.find((x) => x.id === driverId);
    if (!d) return;
    const prev = d.loc;
    d.loc = pos;
    const trip = S.trips.find((t) => t.driverId === driverId && t.status === 'IN_PROGRESS');
    if (trip && !d.autoDrive) {
      const step = dist(prev, pos);
      if (step < 500) { // drop GPS jumps
        trip.traveledM += step;
        if ((trip.path ??= []).length < 300) trip.path.push(pos);
      }
    }
  });
}

export function payDebt(driverId, amount, method) {
  const a = Math.round(Number(amount));
  if (!(a > 0)) throw new AppError('err.bad_amount');
  tx((S) => {
    postTx(S, `d:${driverId}`, 'DEBT_SETTLEMENT', a, { note: method });
    S.payments.push({ id: uid('pay'), tripId: null, userKey: `d:${driverId}`, method, amount: a, status: 'CAPTURED', gatewayRef: `DEMO-${Date.now()}`, ts: now(), kind: 'DEBT' });
  });
}

export function requestPayout(driverId, amount, method, destination) {
  const a = Math.round(Number(amount));
  tx((S) => {
    if (!(a >= 5000) || a > balance(`d:${driverId}`, S)) throw new AppError('err.bad_amount');
    if (S.payouts.some((p) => p.driverId === driverId && p.status === 'REQUESTED')) throw new AppError('err.payout_pending');
    S.payouts.push({ id: uid('po'), driverId, amount: a, method, destination: destination.slice(0, 60), status: 'REQUESTED', createdAt: now() });
  });
}

export function openTicket(userKey, openerType, { category, subject, text, tripId }) {
  return tx((S) => {
    const seq = nextSeq(S, 'ticketSeq');
    const tk = {
      id: uid('tk'), code: `T-${seq}`, userKey, openerType, tripId: tripId || null, category, priority: category === 'SAFETY_ISSUE' ? 'URGENT' : 'NORMAL',
      status: 'OPEN', subject: subject.slice(0, 120), assignee: null, createdAt: now(), messages: [{ from: openerType, text: text.slice(0, 2000), ts: now() }],
    };
    S.tickets.push(tk);
    return tk;
  });
}

export function replyTicket(ticketId, from, text, internal = false, admin = null) {
  tx((S) => {
    const tk = S.tickets.find((x) => x.id === ticketId);
    tk.messages.push({ from, text: text.slice(0, 2000), ts: now(), internal });
    if (from === 'ADMIN' && !internal) {
      if (tk.status === 'OPEN' || tk.status === 'ASSIGNED') tk.status = 'WAITING_USER';
      notify(S, tk.userKey, 'notify.ticket_reply', { code: tk.code });
    } else if (from !== 'ADMIN') tk.status = 'IN_PROGRESS';
    if (admin) audit(S, admin, 'ticket.reply', 'ticket', tk.id);
  });
}

export function markNotificationsRead(userKey) {
  tx((S) => { for (const n of S.notifications) if (n.to === userKey) n.read = true; });
}

// ───────────────────────────── admin ─────────────────────────────

export function can(admin, perm) {
  return !!admin && (read('roles')[admin.role]?.perms ?? []).includes(perm);
}

function requirePerm(admin, perm) {
  if (!can(admin, perm)) throw new AppError('err.forbidden');
}

const DRIVER_STATUS_NOTIFY = {
  APPROVED: 'notify.driver_approved', REJECTED: 'notify.driver_rejected', SUSPENDED: 'notify.driver_suspended',
  BLOCKED: 'notify.driver_blocked', CHANGES_REQUESTED: 'notify.driver_changes', UNDER_REVIEW: 'notify.driver_review',
};

export function setDriverStatus(admin, driverId, to, reason = '') {
  requirePerm(admin, ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'UNDER_REVIEW'].includes(to) ? 'drivers.approve' : 'drivers.suspend');
  tx((S) => {
    const d = S.drivers.find((x) => x.id === driverId);
    if (to === 'APPROVED' && !documentsValid(d)) throw new AppError('err.docs_not_approved');
    if (['SUSPENDED', 'BLOCKED'].includes(to) && S.trips.some((t) => t.driverId === driverId && WITH_DRIVER.includes(t.status))) throw new AppError('err.on_trip');
    const before = d.status;
    d.history.push({ from: before, to, by: admin.role, reason, ts: now() });
    d.status = to;
    if (to !== 'APPROVED') d.availability = 'OFFLINE';
    if (to === 'APPROVED' && !d.approvedAt) d.approvedAt = now();
    if (DRIVER_STATUS_NOTIFY[to]) notify(S, `d:${d.id}`, DRIVER_STATUS_NOTIFY[to], { reason });
    audit(S, admin, `driver.${to.toLowerCase()}`, 'driver', d.id, { status: before }, { status: to, reason });
  });
}

export function reviewDocument(admin, driverId, type, status, reason = '') {
  requirePerm(admin, 'drivers.approve');
  tx((S) => {
    const d = S.drivers.find((x) => x.id === driverId);
    const doc = d.documents.find((x) => x.type === type);
    const before = doc.status;
    doc.status = status;
    doc.reason = status === 'REJECTED' ? reason : null;
    if (d.status === 'PENDING') { d.history.push({ from: 'PENDING', to: 'UNDER_REVIEW', by: admin.role, ts: now() }); d.status = 'UNDER_REVIEW'; }
    audit(S, admin, 'document.review', 'driver', d.id, { type, status: before }, { type, status, reason });
  });
}

export function setCustomerStatus(admin, customerId, status) {
  requirePerm(admin, 'customers.suspend');
  tx((S) => {
    const c = S.customers.find((x) => x.id === customerId);
    const before = c.status;
    c.status = status;
    notify(S, `c:${c.id}`, 'notify.account_status', { status });
    audit(S, admin, 'customer.status', 'customer', c.id, { status: before }, { status });
  });
}

export function adjustWallet(admin, key, amount, note) {
  requirePerm(admin, 'wallets.adjust');
  const a = Math.round(Number(amount));
  if (!a) throw new AppError('err.bad_amount');
  tx((S) => {
    postTx(S, key, 'ADJUSTMENT', a, { note: note.slice(0, 200), by: admin.role });
    audit(S, admin, 'wallet.adjust', 'wallet', key, null, { amount: a, note });
  });
}

export function processPayout(admin, payoutId, approve) {
  requirePerm(admin, 'payouts.approve');
  tx((S) => {
    const p = S.payouts.find((x) => x.id === payoutId);
    if (p.status !== 'REQUESTED') return;
    if (approve) {
      if (balance(`d:${p.driverId}`, S) < p.amount) throw new AppError('err.bad_amount');
      postTx(S, `d:${p.driverId}`, 'WITHDRAWAL', -p.amount, { note: `${p.method} ${p.destination}` });
    }
    p.status = approve ? 'PAID' : 'REJECTED';
    p.processedAt = now();
    p.processedBy = admin.role;
    notify(S, `d:${p.driverId}`, approve ? 'notify.payout_paid' : 'notify.payout_rejected', { amount: p.amount });
    audit(S, admin, approve ? 'payout.approve' : 'payout.reject', 'payout', p.id, null, { amount: p.amount });
  });
}

/** Save a config table with permission check and an audit row (before/after). */
export function adminSave(admin, perm, table, action, mutate) {
  requirePerm(admin, perm);
  tx((S) => {
    const before = structuredClone(S[table]);
    const result = mutate(S[table], S);
    if (result !== undefined) S[table] = result;
    audit(S, admin, action, table, null, summarize(before), summarize(S[table]));
  });
}

function summarize(v) {
  const s = JSON.stringify(v);
  return s.length > 1500 ? `${s.slice(0, 1500)}…` : v;
}

export function broadcast(admin, audience, title, body) {
  requirePerm(admin, 'notifications.broadcast');
  tx((S) => {
    const keys = [
      ...(audience !== 'drivers' ? S.customers.filter((c) => c.status === 'ACTIVE').map((c) => `c:${c.id}`) : []),
      ...(audience !== 'customers' ? S.drivers.filter((d) => d.status === 'APPROVED').map((d) => `d:${d.id}`) : []),
    ];
    for (const k of keys) notify(S, k, 'notify.broadcast', { title: title.slice(0, 80), body: body.slice(0, 300) });
    audit(S, admin, 'notification.broadcast', 'notification', null, null, { audience, title, count: keys.length });
  });
}

export function adminAudit(admin, action, entity, entityId, after) {
  tx((S) => audit(S, admin, action, entity, entityId, null, after));
}

// ───────────────────────────── simulation loop (runs in the leader tab) ─────────────────────────────

const SPEED_MPS = 9; // simulated driving speed ≈ 32 km/h
let lastTick = 0;
let lastSurge = 0;
let lastDocs = 0;

export function tick() {
  const t = now();
  // throttled tabs tick less often; catch up on up to 10 s so trips keep moving
  const dt = lastTick ? Math.min(10, (t - lastTick) / 1000) : 1;
  lastTick = t;
  const s = settings();
  const simDt = dt * s.simSpeed;
  const toComplete = [];
  tx((S) => {
    // 1) dispatch
    for (const trip of S.trips) {
      if (trip.status !== 'SEARCHING') continue;
      if (t - trip.ts.searchStarted > s.maxSearchS * 1000) { noDriver(S, trip); continue; }
      let accepted = false;
      for (const o of trip.offers.filter((x) => x.status === 'SENT')) {
        const driver = S.drivers.find((d) => d.id === o.driverId);
        if (t > o.expiresAt) { o.status = 'EXPIRED'; trip.excluded.push(o.driverId); continue; }
        if (driver.bot && t >= o.decideAt && !accepted) {
          if (Math.random() < s.botAcceptRate && driver.availability === 'ONLINE') { o.respondedAt = t; assignDriver(S, trip, driver); accepted = true; toComplete.push(['refine', trip.id]); }
          else { o.status = 'REJECTED'; o.respondedAt = t; trip.excluded.push(o.driverId); }
        }
      }
      if (trip.status === 'SEARCHING' && !trip.offers.some((o) => o.status === 'SENT')) sendOffers(S, trip);
    }

    // 2) movement and timers for active trips
    for (const trip of S.trips) {
      if (!WITH_DRIVER.includes(trip.status)) continue;
      const driver = S.drivers.find((d) => d.id === trip.driverId);
      if (!driver) continue;
      const auto = driver.bot || driver.autoDrive;
      if (trip.status === 'DRIVER_ARRIVING' && auto && trip.approach) {
        const r = advance(trip.approach, trip.progress, SPEED_MPS * simDt);
        driver.loc = r.pos; driver.heading = r.heading; trip.progress = r.progress;
        if (r.done && driver.bot) { setStatus(trip, 'DRIVER_ARRIVED', 'DRIVER'); trip.ts.arrived = t; notify(S, `c:${trip.customerId}`, 'notify.driver_arrived', { name: driver.name }); }
      } else if (trip.status === 'DRIVER_ARRIVED') {
        trip.waitingS += simDt;
        if (driver.bot && trip.waitingS >= 75) beginRide(S, trip);
      } else if (trip.status === 'IN_PROGRESS') {
        trip.rideS += simDt;
        if (auto) {
          const r = advance(trip.route, trip.progress, SPEED_MPS * simDt);
          driver.loc = r.pos; driver.heading = r.heading; trip.progress = r.progress; trip.traveledM += r.moved;
          if ((trip.path ??= []).length < 300 && (trip.rideS | 0) % 5 === 0) trip.path.push(r.pos);
          if (r.done && driver.bot) toComplete.push(['complete', trip.id, driver.id]);
        }
      }
    }

    // 3) idle bots drift around their city so the map looks alive
    const cities = read('cities');
    for (const d of S.drivers) {
      if (!d.bot || d.status !== 'APPROVED') continue;
      if (d.availability === 'ONLINE') {
        const c = cities.find((x) => x.id === d.cityId).center;
        const pull = dist(d.loc, c) > 5000 ? 0.0006 : 0;
        d.loc = [d.loc[0] + (Math.random() - 0.5) * 0.0004 * dt + (c[0] - d.loc[0]) * pull, d.loc[1] + (Math.random() - 0.5) * 0.0005 * dt + (c[1] - d.loc[1]) * pull];
        if (Math.random() < 0.0015 * dt) d.availability = 'OFFLINE';
      } else if (d.availability === 'OFFLINE' && Math.random() < 0.006 * dt) {
        d.availability = 'ONLINE';
        d.idleSince = t;
      }
    }
  });

  for (const job of toComplete) {
    try {
      if (job[0] === 'refine') refineApproach(job[1]);
      else completeTrip(job[1], job[2]);
    } catch (e) { console.warn(e); }
  }

  if (t - lastSurge > 20_000) { lastSurge = t; surgeTick(); }
  if (t - lastDocs > 60_000) { lastDocs = t; documentsTick(); }
}

function surgeTick() {
  const lp = localParts();
  tx((S) => {
    for (const rule of read('surgeRules')) {
      const { demand, supply } = demandSupply(rule, S.trips, S.drivers);
      const prev = S.surgeState[rule.id];
      const multiplier = calculateSurge(rule, { demand, supply, localDay: lp.day, localMinutes: lp.minutes, previous: prev?.multiplier, maxChangePerTick: 0.3 });
      S.surgeState[rule.id] = { multiplier, demand, supply, ts: now() };
      if (!rule.zoneId) {
        const hist = (S.meta.supplyByHour ??= {});
        const row = (hist[rule.cityId] ??= Array(24).fill(null));
        row[lp.hour] = row[lp.hour] == null ? supply : Math.round(row[lp.hour] * 0.8 + supply * 0.2);
      }
    }
  });
}

function documentsTick() {
  const today = localParts().date;
  const soon = localParts(now() + 7 * 86_400_000).date;
  tx((S) => {
    for (const d of S.drivers) {
      for (const doc of d.documents) {
        if (doc.expiresAt && doc.expiresAt < today && doc.status === 'APPROVED') doc.status = 'EXPIRED';
        if (doc.expiresAt && doc.expiresAt <= soon && doc.expiresAt >= today && !doc.warned && !d.bot) {
          doc.warned = true;
          notify(S, `d:${d.id}`, 'notify.doc_expiring', { date: doc.expiresAt });
        }
      }
      if (d.status === 'APPROVED' && d.documents.some((x) => x.status === 'EXPIRED')) {
        d.history.push({ from: 'APPROVED', to: 'DOCUMENTS_EXPIRED', by: 'system', ts: now() });
        d.status = 'DOCUMENTS_EXPIRED';
        if (!S.trips.some((t) => t.driverId === d.id && WITH_DRIVER.includes(t.status))) d.availability = 'OFFLINE';
        notify(S, `d:${d.id}`, 'notify.doc_expired', {});
      }
    }
  });
}

/** Start the shared loop. Every page calls this; only the leader tab does the work. */
export function startLoop(isLeaderFn) {
  setInterval(() => {
    if (isLeaderFn()) {
      try { tick(); } catch (e) { console.error(e); }
    } else lastTick = 0;
  }, 1000);
}

export { pathLength };
