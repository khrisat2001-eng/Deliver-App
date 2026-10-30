// Demo data for Iraq / Kurdistan. Coordinates of landmarks are approximate.
import { calculateFare, calculateCommission } from '../core/index.js';

const N = (ar, en, ckb) => ({ ar, en, ckb: ckb ?? ar });

export const PERMISSIONS = {
  dashboard: ['dashboard.view', 'livemap.view'],
  drivers: ['drivers.view', 'drivers.view_pii', 'drivers.approve', 'drivers.suspend', 'drivers.edit'],
  customers: ['customers.view', 'customers.edit', 'customers.suspend'],
  trips: ['trips.view', 'trips.cancel'],
  geo: ['cities.manage', 'zones.manage', 'vehicle_types.manage'],
  pricing: ['pricing.update', 'surge.update', 'surge.override', 'cancellation_policy.update'],
  finance: ['payments.view', 'wallets.adjust', 'payouts.approve', 'commission.update'],
  promotions: ['promotions.manage'],
  support: ['tickets.view', 'tickets.reply', 'sos.handle'],
  notifications: ['notifications.broadcast'],
  reports: ['reports.operations', 'reports.finance'],
  admin: ['roles.manage', 'audit.view', 'settings.manage'],
};
const ALL = Object.values(PERMISSIONS).flat();

const ROLES = {
  SUPER_ADMIN: { name: N('المدير العام', 'Super Admin', 'بەڕێوەبەری گشتی'), perms: ALL },
  OPERATIONS_MANAGER: {
    name: N('مدير العمليات', 'Operations Manager', 'بەڕێوەبەری کارپێکردن'),
    perms: ['dashboard.view', 'livemap.view', 'drivers.view', 'drivers.view_pii', 'drivers.suspend', 'customers.view', 'customers.edit',
      'customers.suspend', 'trips.view', 'trips.cancel', 'cities.manage', 'zones.manage', 'vehicle_types.manage', 'surge.override',
      'promotions.manage', 'tickets.view', 'tickets.reply', 'sos.handle', 'notifications.broadcast', 'reports.operations'],
  },
  DRIVER_MANAGER: {
    name: N('مدير السائقين', 'Driver Manager', 'بەڕێوەبەری شۆفێران'),
    perms: ['dashboard.view', 'livemap.view', 'drivers.view', 'drivers.view_pii', 'drivers.approve', 'drivers.suspend', 'drivers.edit',
      'trips.view', 'tickets.view', 'tickets.reply', 'reports.operations'],
  },
  FINANCE_MANAGER: {
    name: N('المدير المالي', 'Finance Manager', 'بەڕێوەبەری دارایی'),
    perms: ['dashboard.view', 'livemap.view', 'drivers.view', 'customers.view', 'trips.view', 'pricing.update', 'surge.update',
      'cancellation_policy.update', 'payments.view', 'wallets.adjust', 'payouts.approve', 'commission.update', 'promotions.manage',
      'tickets.view', 'tickets.reply', 'reports.operations', 'reports.finance'],
  },
  CUSTOMER_SUPPORT: {
    name: N('خدمة العملاء', 'Customer Support', 'خزمەتگوزاری کڕیاران'),
    perms: ['dashboard.view', 'livemap.view', 'drivers.view', 'customers.view', 'trips.view', 'tickets.view', 'tickets.reply', 'sos.handle'],
  },
};

const CITIES = [
  { id: 'erbil', name: N('أربيل', 'Erbil', 'هەولێر'), center: [36.1911, 44.0092], plate: N('أربيل', 'Erbil', 'هەولێر') },
  { id: 'sulaymaniyah', name: N('السليمانية', 'Sulaymaniyah', 'سلێمانی'), center: [35.5613, 45.4374], plate: N('السليمانية', 'Sulaymaniyah', 'سلێمانی') },
  { id: 'duhok', name: N('دهوك', 'Duhok', 'دهۆک'), center: [36.8669, 42.9503], plate: N('دهوك', 'Duhok', 'دهۆک') },
  { id: 'baghdad', name: N('بغداد', 'Baghdad', 'بەغدا'), center: [33.3152, 44.3661], plate: N('بغداد', 'Baghdad', 'بەغدا') },
  { id: 'basra', name: N('البصرة', 'Basra', 'بەسرە'), center: [30.5085, 47.7804], plate: N('البصرة', 'Basra', 'بەسرە') },
].map((c) => ({ ...c, countryId: 'IQ', active: true, emergency: { police: '104', ambulance: '122', fire: '115' } }));

const ZONES = [
  { id: 'z-ebl-airport', cityId: 'erbil', kind: 'airport', name: N('مطار أربيل الدولي', 'Erbil International Airport', 'فڕۆکەخانەی نێودەوڵەتی هەولێر'), center: [36.2376, 43.9632], radiusM: 2200 },
  { id: 'z-ebl-center', cityId: 'erbil', kind: 'downtown', name: N('مركز أربيل (القلعة)', 'Erbil Downtown (Citadel)', 'ناوەندی هەولێر (قەڵا)'), center: [36.1911, 44.0092], radiusM: 1500 },
  { id: 'z-ebl-ankawa', cityId: 'erbil', kind: 'standard', name: N('عنكاوا', 'Ankawa', 'عەنکاوە'), center: [36.2333, 43.9958], radiusM: 1800 },
  { id: 'z-sul-airport', cityId: 'sulaymaniyah', kind: 'airport', name: N('مطار السليمانية الدولي', 'Sulaymaniyah International Airport', 'فڕۆکەخانەی نێودەوڵەتی سلێمانی'), center: [35.5617, 45.3167], radiusM: 2000 },
  { id: 'z-bgw-airport', cityId: 'baghdad', kind: 'airport', name: N('مطار بغداد الدولي', 'Baghdad International Airport', 'فڕۆکەخانەی نێودەوڵەتی بەغدا'), center: [33.2625, 44.2346], radiusM: 3000 },
  { id: 'z-bgw-center', cityId: 'baghdad', kind: 'downtown', name: N('ساحة التحرير', 'Tahrir Square', 'گۆڕەپانی تەحریر'), center: [33.3328, 44.4206], radiusM: 1500 },
  { id: 'z-bsr-airport', cityId: 'basra', kind: 'airport', name: N('مطار البصرة الدولي', 'Basra International Airport', 'فڕۆکەخانەی نێودەوڵەتی بەسرە'), center: [30.5491, 47.6621], radiusM: 2500 },
].map((z) => ({ ...z, active: true, specialFee: z.kind === 'downtown' ? 500 : 0 }));

export const POIS = [
  ['erbil', N('قلعة أربيل', 'Erbil Citadel', 'قەڵای هەولێر'), 36.1912, 44.0091],
  ['erbil', N('مطار أربيل الدولي', 'Erbil International Airport', 'فڕۆکەخانەی هەولێر'), 36.2376, 43.9632],
  ['erbil', N('منتزه سامي عبد الرحمن', 'Sami Abdulrahman Park', 'پارکی سامی عەبدولڕەحمان'), 36.2003, 43.9907],
  ['erbil', N('عنكاوا', 'Ankawa', 'عەنکاوە'), 36.2333, 43.9958],
  ['sulaymaniyah', N('مركز السليمانية', 'Sulaymaniyah Center', 'ناوەندی سلێمانی'), 35.5613, 45.4374],
  ['sulaymaniyah', N('مطار السليمانية الدولي', 'Sulaymaniyah Airport', 'فڕۆکەخانەی سلێمانی'), 35.5617, 45.3167],
  ['duhok', N('مركز دهوك', 'Duhok Center', 'ناوەندی دهۆک'), 36.8669, 42.9503],
  ['baghdad', N('ساحة التحرير', 'Tahrir Square', 'گۆڕەپانی تەحریر'), 33.3328, 44.4206],
  ['baghdad', N('مطار بغداد الدولي', 'Baghdad International Airport', 'فڕۆکەخانەی بەغدا'), 33.2625, 44.2346],
  ['baghdad', N('متنزه الزوراء', 'Al-Zawraa Park', 'پارکی زەوراء'), 33.3120, 44.3760],
  ['baghdad', N('الكاظمية', 'Kadhimiya', 'کازمیە'), 33.3800, 44.3383],
  ['basra', N('مركز البصرة', 'Basra Center', 'ناوەندی بەسرە'), 30.5085, 47.7804],
  ['basra', N('مطار البصرة الدولي', 'Basra International Airport', 'فڕۆکەخانەی بەسرە'), 30.5491, 47.6621],
].map(([cityId, name, lat, lng]) => ({ cityId, name, lat, lng }));

const VEHICLE_TYPES = [
  { id: 'TAXI', icon: '🚕', seats: 4, factor: 0.9, name: N('تاكسي', 'Taxi', 'تەکسی'), desc: N('تاكسي مرخّص بلوحة أجرة', 'Licensed taxi', 'تەکسی مۆڵەتدار') },
  { id: 'ECONOMY', icon: '🚗', seats: 4, factor: 1, name: N('اقتصادي', 'Economy', 'ئابووری'), desc: N('رحلات يومية بسعر مناسب', 'Affordable everyday rides', 'گەشتی ڕۆژانە بە نرخی گونجاو') },
  { id: 'COMFORT', icon: '🚙', seats: 4, factor: 1.3, name: N('مريح', 'Comfort', 'ئاسوودە'), desc: N('سيارات أحدث مع تكييف', 'Newer cars with A/C', 'ئۆتۆمبێلی نوێتر بە فێنککەرەوە') },
  { id: 'PREMIUM', icon: '🚘', seats: 4, factor: 1.9, name: N('فاخر', 'Premium', 'نایاب'), desc: N('سيارات فاخرة وسائقون بتقييم عالٍ', 'Luxury cars, top-rated drivers', 'ئۆتۆمبێلی نایاب') },
  { id: 'SUV', icon: '🚐', seats: 6, factor: 1.7, name: N('دفع رباعي', 'SUV', 'جیپ'), desc: N('سيارات كبيرة ومرتفعة', 'Large, high cars', 'ئۆتۆمبێلی گەورە') },
  { id: 'XL', icon: '🚌', seats: 7, factor: 1.6, name: N('عائلي XL', 'XL', 'خێزانی XL'), desc: N('حتى 7 ركاب', 'Up to 7 passengers', 'تا ٧ سەرنشین') },
].map((v, i) => ({ ...v, active: true, sortOrder: i, serviceType: 'RIDE' }));

const CITY_PRICE = { erbil: 1, sulaymaniyah: 0.95, duhok: 0.9, baghdad: 1.05, basra: 0.95 };

function pricingRules() {
  const rules = [];
  for (const c of CITIES) {
    for (const v of VEHICLE_TYPES) {
      const f = CITY_PRICE[c.id] * v.factor;
      const r250 = (x) => Math.max(0, Math.round(x / 50) * 50);
      rules.push({
        id: `pr-${c.id}-${v.id}`, cityId: c.id, zoneId: null, vehicleTypeId: v.id, active: true,
        baseFare: r250(1500 * f), perKm: r250(500 * f), perMinute: r250(100 * f), minimumFare: r250(3000 * f),
        bookingFee: 250, freeWaitingMinutes: 3, waitingPerMinute: r250(150 * f), airportFee: 5000, specialFee: 0, roundingStep: 250,
      });
    }
  }
  return rules;
}

const SURGE_DEFAULT = {
  isEnabled: true, minMultiplier: 1, maxMultiplier: 2, ratioThreshold: 1.2, sensitivity: 0.5, stepSize: 0.1, manualMultiplier: null,
  schedule: [
    { days: [0, 1, 2, 3, 4], from: '07:00', to: '09:00', multiplier: 1.2 },
    { days: [0, 1, 2, 3, 4], from: '17:00', to: '20:00', multiplier: 1.3 },
  ],
};

const FIRST = ['أحمد', 'كاروان', 'دلشاد', 'هاوري', 'علي', 'مصطفى', 'زانا', 'شيرزاد', 'عمر', 'حسين', 'ريباز', 'شفان', 'بختيار', 'حيدر', 'عباس', 'سامان', 'آراس', 'هيوا', 'يوسف', 'كمال', 'سرور', 'نوزاد', 'محمد', 'جاسم', 'سلام', 'رزگار', 'آزاد', 'فرهاد', 'كريم', 'ئاكو'];
const LAST = ['عبدالله', 'حسن', 'محمود', 'رشيد', 'صالح', 'كريم', 'جمال', 'سعيد', 'إبراهيم', 'عثمان', 'قادر', 'مجيد'];
const FIRST_EN = ['Ahmed', 'Karwan', 'Dilshad', 'Hawre', 'Ali', 'Mustafa', 'Zana', 'Sherzad', 'Omar', 'Hussein', 'Rebaz', 'Shvan', 'Bakhtiyar', 'Haidar', 'Abbas', 'Saman', 'Aras', 'Hiwa', 'Yousif', 'Kamal', 'Srwa', 'Nawzad', 'Mohammed', 'Jasim', 'Salam', 'Rizgar', 'Azad', 'Farhad', 'Karim', 'Ako'];
const CARS = {
  TAXI: [['Hyundai', 'Elantra'], ['Kia', 'Cerato'], ['Toyota', 'Corolla']],
  ECONOMY: [['Toyota', 'Corolla'], ['Hyundai', 'Elantra'], ['Kia', 'Rio'], ['Chevrolet', 'Cruze']],
  COMFORT: [['Toyota', 'Camry'], ['Hyundai', 'Sonata'], ['Kia', 'K5']],
  PREMIUM: [['Mercedes-Benz', 'E-Class'], ['Lexus', 'ES'], ['Genesis', 'G80']],
  SUV: [['Toyota', 'Land Cruiser'], ['Chevrolet', 'Tahoe'], ['GMC', 'Yukon']],
  XL: [['Kia', 'Carnival'], ['Toyota', 'Hiace'], ['Hyundai', 'Staria']],
};
const COLORS = [N('أبيض', 'White', 'سپی'), N('فضي', 'Silver', 'زیوی'), N('أسود', 'Black', 'ڕەش'), N('رمادي', 'Grey', 'خۆڵەمێشی'), N('أصفر', 'Yellow', 'زەرد')];
// which ride types a car class can serve
const SERVES = { TAXI: ['TAXI', 'ECONOMY'], ECONOMY: ['ECONOMY'], COMFORT: ['COMFORT', 'ECONOMY'], PREMIUM: ['PREMIUM', 'COMFORT'], SUV: ['SUV'], XL: ['XL', 'ECONOMY'] };

export const DOC_TYPES = [
  { id: 'NATIONAL_ID', name: N('البطاقة الوطنية الموحدة', 'National ID card', 'کارتی نیشتمانی'), expiry: true },
  { id: 'DRIVING_LICENSE', name: N('إجازة السوق', 'Driving licence', 'مۆڵەتی شۆفێری'), expiry: true },
  { id: 'VEHICLE_REGISTRATION', name: N('سنوية السيارة', 'Vehicle registration', 'تۆماری ئۆتۆمبێل'), expiry: true },
  { id: 'INSURANCE', name: N('التأمين', 'Insurance', 'بیمە'), expiry: true },
  { id: 'VEHICLE_PHOTO', name: N('صور السيارة', 'Vehicle photos', 'وێنەی ئۆتۆمبێل'), expiry: false },
];

// deterministic pseudo-random so every fresh seed looks the same
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const DAY = 86_400_000;
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

function makeDocs(now, status, rand, expiringSoon = false) {
  return DOC_TYPES.map((d) => ({
    type: d.id, file: null, fileName: `${d.id.toLowerCase()}.jpg`, status,
    expiresAt: d.expiry ? isoDate(now + (expiringSoon && d.id === 'INSURANCE' ? 12 : 200 + Math.floor(rand() * 600)) * DAY) : null,
    reason: null,
  }));
}

export function buildSeed() {
  const now = Date.now();
  const rand = rng(42);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const jitter = ([lat, lng], km) => [lat + (rand() - 0.5) * (km / 111) * 2, lng + (rand() - 0.5) * (km / 92) * 2];

  const drivers = [];
  const wallets = { platform: { balance: 0 } };
  const counts = { erbil: 12, sulaymaniyah: 6, duhok: 5, baghdad: 10, basra: 6 };
  const typesCycle = ['ECONOMY', 'TAXI', 'COMFORT', 'ECONOMY', 'SUV', 'PREMIUM', 'XL', 'ECONOMY', 'COMFORT', 'TAXI'];
  let n = 0;
  for (const c of CITIES) {
    for (let i = 0; i < counts[c.id]; i++, n++) {
      const cls = typesCycle[i % typesCycle.length];
      const [make, model] = pick(CARS[cls]);
      const id = `d-${c.id}-${i + 1}`;
      drivers.push({
        id, bot: true, phone: `+96475${String(10000000 + n * 7919).slice(0, 8)}`,
        name: `${FIRST[n % FIRST.length]} ${LAST[n % LAST.length]}`, nameEn: `${FIRST_EN[n % FIRST_EN.length]}`,
        email: null, photo: null, cityId: c.id, status: 'APPROVED', availability: rand() < 0.85 ? 'ONLINE' : 'OFFLINE',
        vehicle: { cls, serves: SERVES[cls], make, model, year: 2014 + Math.floor(rand() * 10), color: cls === 'TAXI' ? COLORS[4] : pick(COLORS.slice(0, 4)), plate: `${10000 + Math.floor(rand() * 89999)}`, plateRegion: c.id },
        documents: makeDocs(now, 'APPROVED', rand, i === 3 && c.id === 'erbil'),
        loc: jitter(c.center, 3.5), rating: Number((4.3 + rand() * 0.7).toFixed(2)), ratingCount: 20 + Math.floor(rand() * 300),
        trips: 0, offersReceived: 40, offersAccepted: 30 + Math.floor(rand() * 10), cancelled: Math.floor(rand() * 3),
        idleSince: now - Math.floor(rand() * 1800_000), autoDrive: true, createdAt: now - (60 + Math.floor(rand() * 300)) * DAY,
        history: [{ to: 'APPROVED', by: 'Driver Manager', ts: now - 50 * DAY }],
      });
      wallets[`d:${id}`] = { balance: 0 };
    }
  }
  // One driver over the cash-debt limit, to show the restriction
  wallets['d:d-erbil-5'] = { balance: -62000 };

  // Applicants waiting for review
  const applicants = [
    ['PENDING', 'erbil', 'نوزاد كاكه', 'COMFORT'],
    ['UNDER_REVIEW', 'erbil', 'هيمن رسول', 'ECONOMY'],
    ['PENDING', 'baghdad', 'مرتضى كاظم', 'TAXI'],
    ['CHANGES_REQUESTED', 'sulaymaniyah', 'دانا عمر', 'SUV'],
  ];
  applicants.forEach(([status, cityId, name, cls], i) => {
    const [make, model] = pick(CARS[cls]);
    const id = `d-app-${i + 1}`;
    const docs = makeDocs(now, 'PENDING', rand);
    if (status === 'CHANGES_REQUESTED') { docs[1].status = 'REJECTED'; docs[1].reason = 'الصورة غير واضحة'; }
    drivers.push({
      id, bot: true, phone: `+96477${String(20000000 + i * 1311).slice(0, 8)}`, name, nameEn: name, email: null, photo: null, cityId, status,
      availability: 'OFFLINE', vehicle: { cls, serves: SERVES[cls], make, model, year: 2018, color: COLORS[0], plate: `${30000 + i * 17}`, plateRegion: cityId },
      documents: docs, loc: CITIES.find((c) => c.id === cityId).center, rating: 5, ratingCount: 0, trips: 0, offersReceived: 0,
      offersAccepted: 0, cancelled: 0, idleSince: now, autoDrive: true, createdAt: now - (i + 1) * DAY, history: [{ to: 'PENDING', by: 'system', ts: now - (i + 1) * DAY }],
    });
    wallets[`d:${id}`] = { balance: 0 };
  });

  // Demo human driver (not a bot)
  drivers.push({
    id: 'd-demo', bot: false, phone: '+9647501111111', name: 'سائق تجريبي', nameEn: 'Demo Driver', email: 'driver@demo.iq', photo: null,
    cityId: 'erbil', status: 'APPROVED', availability: 'OFFLINE',
    vehicle: { cls: 'ECONOMY', serves: SERVES.ECONOMY, make: 'Toyota', model: 'Corolla', year: 2020, color: COLORS[0], plate: '24680', plateRegion: 'erbil' },
    documents: makeDocs(now, 'APPROVED', rand), loc: [36.1950, 44.0050], rating: 4.9, ratingCount: 12, trips: 0, offersReceived: 10,
    offersAccepted: 9, cancelled: 0, idleSince: now, autoDrive: true, createdAt: now - 20 * DAY, history: [{ to: 'APPROVED', by: 'Driver Manager', ts: now - 19 * DAY }],
  });
  wallets['d:d-demo'] = { balance: 0 };

  const customers = [];
  for (let i = 0; i < 40; i++) {
    const id = `c-${i + 1}`;
    customers.push({
      id, phone: `+96478${String(30000000 + i * 4111).slice(0, 8)}`, name: `${FIRST[(i * 7) % FIRST.length]} ${LAST[(i * 5) % LAST.length]}`,
      email: null, birthDate: null, gender: 'UNSPECIFIED', address: '', photo: null, emergency: [], saved: {}, referralCode: `R${(1000 + i * 37).toString(36).toUpperCase()}`,
      referredBy: null, rating: Number((4.4 + rand() * 0.6).toFixed(2)), ratingCount: 3 + Math.floor(rand() * 40), trips: 0, cancelled: 0,
      status: 'ACTIVE', cityId: CITIES[i % CITIES.length].id, createdAt: now - Math.floor(rand() * 60) * DAY - Math.floor(rand() * DAY), blockedDrivers: [],
    });
    wallets[`c:${id}`] = { balance: Math.floor(rand() * 4) * 5000 };
  }
  customers.push({
    id: 'c-demo', phone: '+9647500000000', name: 'عميل تجريبي', email: 'rider@demo.iq', birthDate: null, gender: 'UNSPECIFIED', address: 'أربيل',
    photo: null, emergency: [{ name: 'أخي', phone: '+9647509999999' }], saved: {}, referralCode: 'DEMO2026', referredBy: null, rating: 4.8, ratingCount: 9, trips: 0,
    cancelled: 0, status: 'ACTIVE', cityId: 'erbil', createdAt: now - 30 * DAY, blockedDrivers: [],
  });
  wallets['c:c-demo'] = { balance: 25000 };

  const rules = pricingRules();
  const commissionRules = [
    { id: 'cm-global', type: 'PERCENTAGE', percent: 20, fixed: null, cityId: null, zoneId: null, vehicleTypeId: null, driverId: null, isActive: true },
    { id: 'cm-premium', type: 'PERCENTAGE', percent: 25, fixed: null, cityId: null, zoneId: null, vehicleTypeId: 'PREMIUM', driverId: null, isActive: true },
    { id: 'cm-taxi', type: 'PERCENTAGE', percent: 15, fixed: null, cityId: null, zoneId: null, vehicleTypeId: 'TAXI', driverId: null, isActive: true },
  ];

  // 30 days of history for reports
  const trips = [];
  const hourWeight = [1, 0.5, 0.3, 0.2, 0.2, 0.4, 1, 3, 3.5, 2, 1.6, 1.8, 2.4, 2.6, 2.2, 1.8, 2, 3, 3.6, 3.4, 3, 2.4, 2, 1.4];
  const totalW = hourWeight.reduce((a, b) => a + b, 0);
  const pickHour = () => { let r = rand() * totalW; for (let h = 0; h < 24; h++) { r -= hourWeight[h]; if (r <= 0) return h; } return 23; };
  const cityW = { erbil: 0.32, sulaymaniyah: 0.16, duhok: 0.1, baghdad: 0.28, basra: 0.14 };
  const pickCity = () => { let r = rand(); for (const [k, w] of Object.entries(cityW)) { r -= w; if (r <= 0) return k; } return 'erbil'; };
  let seq = 1000;
  for (let d = 29; d >= 0; d--) {
    const dayStart = new Date(now - d * DAY); dayStart.setUTCHours(-3, 0, 0, 0); // local midnight (UTC+3)
    const perDay = 18 + Math.floor(rand() * 10) + (dayStart.getUTCDay() === 4 ? 8 : 0);
    for (let k = 0; k < perDay; k++) {
      const cityId = pickCity();
      const city = CITIES.find((c) => c.id === cityId);
      const hour = pickHour();
      const ts = dayStart.getTime() + hour * 3600_000 + Math.floor(rand() * 3600_000);
      if (ts > now - 3600_000) continue;
      const cityDrivers = drivers.filter((x) => x.cityId === cityId && x.status === 'APPROVED' && x.bot);
      const driver = pick(cityDrivers);
      const vt = pick(driver.vehicle.serves);
      // demo accounts start with a clean history
      const customer = pick(customers.filter((c) => c.cityId === cityId && c.id !== 'c-demo'));
      const p = jitter(city.center, 4); const q = jitter(city.center, 6);
      const distanceM = 1500 + Math.floor(rand() * 13000);
      const durationS = Math.round(distanceM / (5 + rand() * 4));
      const peak = (hour >= 7 && hour < 9) || (hour >= 17 && hour < 20);
      const surge = peak && rand() < 0.5 ? 1.2 + Math.floor(rand() * 4) / 10 : 1;
      const rule = rules.find((r) => r.cityId === cityId && r.vehicleTypeId === vt);
      const fare = calculateFare(rule, { distanceM, durationS, surgeMultiplier: surge, waitingS: rand() < 0.3 ? 240 : 0 });
      const r = rand();
      const status = r < 0.86 ? 'COMPLETED' : r < 0.93 ? 'CANCELLED_BY_CUSTOMER' : r < 0.97 ? 'CANCELLED_BY_DRIVER' : 'NO_DRIVER_FOUND';
      const cm = commissionRules.find((c) => c.vehicleTypeId === vt) ?? commissionRules[0];
      const { commission, driverEarning } = calculateCommission(fare.gross, cm);
      const completed = status === 'COMPLETED';
      const pay = rand() < 0.78 ? 'CASH' : pick(['WALLET', 'ZAINCASH', 'FIB', 'FASTPAY']);
      const waitS = 120 + Math.floor(rand() * 420);
      trips.push({
        id: `t-h${seq}`, code: `R${seq++}`, historical: true, customerId: customer.id, driverId: status === 'NO_DRIVER_FOUND' ? null : driver.id,
        cityId, vehicleTypeId: vt, status, paymentMethod: pay, surge,
        pickup: { lat: p[0], lng: p[1], address: '' }, dropoff: { lat: q[0], lng: q[1], address: '' },
        est: { distanceM, durationS, fare }, final: completed ? { distanceM, durationS, fare, commission, driverEarning, waitingS: 0 } : null,
        ts: { requested: ts, accepted: status === 'NO_DRIVER_FOUND' ? null : ts + waitS * 300, completed: completed ? ts + waitS * 1000 + durationS * 1000 : null, cancelled: completed ? null : ts + 200_000 },
        pickupWaitS: waitS,
        ratings: completed && rand() < 0.8 ? { byCustomer: { stars: rand() < 0.85 ? 5 : rand() < 0.6 ? 4 : 3 } } : {},
      });
      if (completed) { driver.trips++; customer.trips++; }
      else if (status === 'CANCELLED_BY_CUSTOMER') customer.cancelled++;
      else if (status === 'CANCELLED_BY_DRIVER') driver.cancelled++;
    }
  }

  const tickets = [
    {
      id: 'tk-1', code: 'T-1001', userKey: 'c:c-3', openerType: 'CUSTOMER', tripId: trips[5]?.id ?? null, category: 'LOST_ITEM', priority: 'NORMAL',
      status: 'OPEN', subject: 'نسيت هاتفي في السيارة', assignee: null, createdAt: now - 3 * 3600_000,
      messages: [{ from: 'CUSTOMER', text: 'نسيت هاتفي في المقعد الخلفي، أرجو التواصل مع السائق', ts: now - 3 * 3600_000 }],
    },
    {
      id: 'tk-2', code: 'T-1002', userKey: 'd:d-erbil-2', openerType: 'DRIVER', tripId: null, category: 'PAYMENT_ISSUE', priority: 'HIGH',
      status: 'ASSIGNED', subject: 'لم يظهر تسديد العمولة عبر ZainCash', assignee: 'FINANCE_MANAGER', createdAt: now - 26 * 3600_000,
      messages: [{ from: 'DRIVER', text: 'سددت 20,000 دينار أمس ولم يتغير الرصيد', ts: now - 26 * 3600_000 }],
    },
  ];

  return {
    meta: { seededAt: now, version: 1, tripSeq: seq, ticketSeq: 1003 },
    settings: {
      offerTimeoutS: 15, radiiM: [2000, 4000, 7000], batchSize: 1, maxPickupEtaS: 900, maxSearchS: 120, cashDebtLimit: 50000,
      fallbackSpeedMps: 6, fareTolerancePct: 15, quoteValidityS: 300, simSpeed: 8, arriveRadiusM: 150, referrerBonus: 3000, refereeBonus: 3000,
      useOsrm: true, useNominatim: true, botAcceptRate: 0.85,
      weights: { eta: 0.6, rating: 0.15, acceptance: 0.15, idle: 0.1 },
    },
    cities: CITIES,
    zones: ZONES,
    vehicleTypes: VEHICLE_TYPES,
    pricingRules: rules,
    surgeRules: CITIES.map((c) => ({ id: `sr-${c.id}`, cityId: c.id, zoneId: null, ...structuredClone(SURGE_DEFAULT) })),
    surgeState: {},
    commissionRules,
    cancellation: {
      policy: { freeWindowS: 120, fee: 1000, feeAfterArrived: 2000, noShowAfterS: 300, driverWarnRatePct: 10 },
      reasons: {
        CUSTOMER: [N('السائق بعيد جدًا', 'Driver is too far'), N('غيّرت رأيي', 'Changed my mind'), N('طلبت بالخطأ', 'Requested by mistake'), N('السائق طلب الإلغاء', 'Driver asked me to cancel')],
        DRIVER: [N('العميل لا يرد', 'Rider not answering'), N('الموقع غير صحيح', 'Wrong pickup location'), N('مشكلة في السيارة', 'Vehicle problem'), N('عدد الركاب أكبر من المسموح', 'Too many passengers')],
      },
    },
    promotions: [
      { id: 'pm-welcome', code: 'WELCOME', type: 'FIRST_TRIP', percent: 50, amount: null, maxDiscount: 5000, minFare: null, cityIds: [], vehicleTypeIds: [], startsAt: isoDate(now - 90 * DAY), endsAt: isoDate(now + 365 * DAY), totalLimit: null, perUserLimit: 1, usedCount: 37, isActive: true, title: N('خصم 50% على أول رحلة', '50% off your first trip') },
      { id: 'pm-erbil', code: 'ERBIL20', type: 'PERCENTAGE', percent: 20, amount: null, maxDiscount: 3000, minFare: 4000, cityIds: ['erbil'], vehicleTypeIds: [], startsAt: isoDate(now - 10 * DAY), endsAt: isoDate(now + 60 * DAY), totalLimit: 1000, perUserLimit: 3, usedCount: 112, isActive: true, title: N('20% في أربيل', '20% off in Erbil') },
      { id: 'pm-fixed', code: 'SAVE1000', type: 'FIXED', percent: null, amount: 1000, maxDiscount: null, minFare: 5000, cityIds: [], vehicleTypeIds: [], startsAt: isoDate(now - 5 * DAY), endsAt: isoDate(now + 30 * DAY), totalLimit: 500, perUserLimit: 2, usedCount: 41, isActive: true, title: N('خصم 1000 دينار', '1,000 IQD off') },
      { id: 'pm-incentive', code: null, type: 'DRIVER_INCENTIVE', tripsPerDay: 10, bonus: 15000, cityIds: [], vehicleTypeIds: [], startsAt: isoDate(now - 5 * DAY), endsAt: isoDate(now + 30 * DAY), perUserLimit: 1, usedCount: 0, isActive: true, title: N('أكمل 10 رحلات اليوم واحصل على 15,000', 'Complete 10 trips today, earn 15,000') },
    ],
    customers,
    drivers,
    trips,
    wallets,
    walletTx: [],
    payments: [],
    tickets,
    sos: [],
    notifications: [],
    audit: [],
    payouts: [{ id: 'po-1', driverId: 'd-erbil-1', amount: 75000, method: 'ZAINCASH', destination: '+9647501234567', status: 'REQUESTED', createdAt: now - 5 * 3600_000 }],
    roles: ROLES,
    admins: Object.keys(ROLES).map((r) => ({ id: `a-${r.toLowerCase()}`, role: r, name: ROLES[r].name, cityScope: [] })),
  };
}
