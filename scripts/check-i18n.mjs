// Verifies the localization files:
//  1. ar / en / ckb have exactly the same keys and the same {placeholders}
//  2. every key referenced in assets/js exists (literal t('…') calls, AppError/notify keys, and dynamic families)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const LOCALES = ['en', 'ar', 'ckb'];
const dict = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(readFileSync(join(root, 'assets/locales', `${l}.json`), 'utf8'))]));
const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const errors = [];

for (const l of LOCALES) {
  for (const k of Object.keys(dict.en)) {
    if (!(k in dict[l])) errors.push(`${l}: missing ${k}`);
    else if (vars(dict[l][k]) !== vars(dict.en[k])) errors.push(`${l}: placeholder mismatch in ${k}`);
  }
  for (const k of Object.keys(dict[l])) if (!(k in dict.en)) errors.push(`${l}: unknown key ${k}`);
}

const files = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (e.name !== 'core') walk(join(dir, e.name)); } else if (e.name.endsWith('.js')) files.push(join(dir, e.name));
  }
};
walk(join(root, 'assets/js'));
const used = new Set();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*['`]([a-zA-Z_]+\.[a-zA-Z0-9_.]+)['`]/g)) used.add(m[1]);
  for (const m of src.matchAll(/['`]((?:err|notify|chat|pay)\.[a-zA-Z_]+)['`]/g)) used.add(m[1]);
}
const html = readFileSync(join(root, 'index.html'), 'utf8');
for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) used.add(m[1]);

// keys built at runtime as `${family}.${value}`
const FAMILIES = {
  actor: ['CUSTOMER', 'DRIVER', 'ADMIN', 'SYSTEM'],
  availability: ['ONLINE', 'OFFLINE', 'BUSY', 'ON_TRIP'],
  status: ['REQUESTED', 'SEARCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_ADMIN', 'NO_DRIVER_FOUND'],
  driverStatus: ['PENDING', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED', 'BLOCKED', 'DOCUMENTS_EXPIRED'],
  driverStatusText: ['PENDING', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED', 'BLOCKED', 'DOCUMENTS_EXPIRED'],
  docStatus: ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'],
  customerStatus: ['ACTIVE', 'SUSPENDED', 'BLOCKED', 'DELETED'],
  pay: ['CASH', 'WALLET', 'ZAINCASH', 'FIB', 'FASTPAY', 'CARD', 'CASH_OFFICE', 'BANK', 'paid_cash', 'paid_online', 'card_note', 'wallet_note'],
  tx: ['TOP_UP', 'TRIP_PAYMENT', 'TRIP_EARNING', 'COMMISSION', 'CASH_COMMISSION_DEBT', 'DEBT_SETTLEMENT', 'REFUND', 'PROMO_CREDIT', 'PROMO_REIMBURSEMENT', 'REFERRAL_BONUS', 'DRIVER_BONUS', 'WITHDRAWAL', 'CANCELLATION_FEE', 'ADJUSTMENT'],
  ticket: ['DRIVER_COMPLAINT', 'CUSTOMER_COMPLAINT', 'PAYMENT_ISSUE', 'LOST_ITEM', 'TRIP_ISSUE', 'TECHNICAL_ISSUE', 'SAFETY_ISSUE'],
  ticketStatus: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_USER', 'RESOLVED', 'CLOSED'],
  priority: ['LOW', 'NORMAL', 'HIGH', 'URGENT'],
  payoutStatus: ['REQUESTED', 'APPROVED', 'PAID', 'REJECTED'],
  sosStatus: ['OPEN', 'ACKNOWLEDGED', 'ESCALATED', 'RESOLVED'],
  offer: ['SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  promo: ['not_found', 'inactive', 'expired', 'limit_reached', 'user_limit_reached', 'city_not_eligible', 'vehicle_not_eligible', 'below_min_fare', 'not_first_trip'],
  promoType: ['PERCENTAGE', 'FIXED', 'FIRST_TRIP', 'DRIVER_INCENTIVE'],
  commissionType: ['PERCENTAGE', 'FIXED', 'PERCENTAGE_PLUS_FIXED'],
  zoneKind: ['standard', 'downtown', 'airport'],
  price: ['baseFare', 'perKm', 'perMinute', 'minimumFare', 'bookingFee', 'freeWaitingMinutes', 'waitingPerMinute', 'airportFee', 'specialFee', 'roundingStep'],
  cancel: ['freeWindowS', 'fee', 'feeAfterArrived', 'noShowAfterS', 'driverWarnRatePct'],
  demand: ['very_high', 'high', 'normal', 'low'],
  day: ['0', '1', '2', '3', '4', '5', '6'],
  gender: ['UNSPECIFIED', 'MALE', 'FEMALE'],
  home: ['home', 'work'],
  rating: ['tag_clean', 'tag_polite', 'tag_safe', 'tag_route', 'tag_music'],
  permGroup: ['dashboard', 'drivers', 'customers', 'trips', 'geo', 'pricing', 'finance', 'promotions', 'support', 'notifications', 'reports', 'admin'],
  adminNav: ['overview', 'operations', 'pricingGroup', 'financeGroup', 'analytics', 'system', 'dashboard', 'livemap', 'approvals', 'drivers', 'customers', 'trips', 'sos', 'tickets', 'geo', 'vehicles', 'pricing', 'surge', 'commission', 'cancellation', 'promotions', 'finance', 'payouts', 'reports', 'broadcast', 'roles', 'audit', 'settings'],
  driver: ['step1', 'step2', 'step3'],
};
for (const [fam, values] of Object.entries(FAMILIES)) for (const v of values) used.add(`${fam}.${v}`);
for (const k of used) if (!(k in dict.en)) errors.push(`missing key used in code: ${k}`);

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`i18n OK: ${LOCALES.join(', ')} × ${Object.keys(dict.en).length} keys, ${used.size} referenced`);
