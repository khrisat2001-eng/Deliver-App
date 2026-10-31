// End-to-end test of the static site in a real browser (Playwright + Chromium).
//
//   npm i -D playwright && npx playwright install chromium   (once)
//   node tests/e2e.mjs
//
// Opens the passenger, driver and admin apps as tabs of one browser profile (they share localStorage),
// runs a full trip with a human driver, a trip with a simulated driver, visits every admin page,
// approves a driver, checks role restrictions and all three languages. Fails on any page error.
// External hosts (map tiles, OSRM, Nominatim, fonts) are blocked on purpose to exercise the offline fallbacks.
// Env: CHROMIUM_PATH (optional browser binary), OUT (screenshot folder, default tests/screenshots).
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = process.env.OUT ?? join(ROOT, 'tests/screenshots');
await mkdir(OUT, { recursive: true });

let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  // fall back to a globally installed playwright
  const { execSync } = await import('node:child_process');
  const require = createRequire(`${execSync('npm root -g').toString().trim()}/`);
  ({ chromium } = require('playwright'));
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(ROOT, path.endsWith('/') ? `${path}index.html` : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const BASE = `http://localhost:${server.address().port}/`;
const errors = [];
const log = (...a) => console.log('•', ...a);

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, locale: 'ar' });
// external hosts are blocked in this sandbox: fail them fast so the app's fallbacks are exercised
await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
const watch = (page, name) => {
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message} @ ${(e.stack || "").split("\n").slice(1, 4).join(" | ")}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) errors.push(`[${name}] console: ${m.text()}`); });
};
const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png` });
const codeFrom = async (page) => (await page.locator('.notice').first().innerText()).match(/\d{6}/)[0];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pages = [];
const onFail = async (e) => {
  console.log('FAILED:', e.message.split('\n')[0], (e.stack || '').split('\n').find((l) => /\.mjs:\d+/.test(l))?.trim() ?? '');
  for (const [n, p] of pages) {
    try {
      const d = await p.evaluate(async () => {
        const snap = () => { const tr = JSON.parse(localStorage.getItem('ride.v1.trips')).filter((t) => !t.historical).at(-1); return { leader: localStorage.getItem('ride.leader'), now: Date.now(), hidden: document.hidden, vis: document.visibilityState, status: tr?.status, progress: tr?.progress, rideS: tr?.rideS }; };
        const a = snap(); await new Promise((r) => setTimeout(r, 4000)); return [a, snap()];
      });
      console.log(`diag ${n}:`, JSON.stringify(d));
    } catch (err) { console.log('diag fail', n, err.message); }
  }
  for (const [n, p] of pages) { try { await p.screenshot({ path: `${OUT}/fail-${n}.png` }); console.log(`--- ${n} text:\n`, (await p.innerText('body')).slice(0, 600)); } catch {} }
  console.log(errors.join('\n'));
  process.exit(2);
};
process.on('unhandledRejection', onFail);
process.on('uncaughtException', onFail);

// Landing
const landing = await ctx.newPage(); watch(landing, 'landing'); pages.push(['landing', landing]);
await landing.goto(BASE);
await landing.waitForFunction(() => document.querySelector('[data-i18n="landing.title"]').textContent.includes('منصة'));
await shot(landing, '01-landing');
log('landing ok');

// Driver logs in and goes online
const drv = await ctx.newPage(); watch(drv, 'driver'); pages.push(['driver', drv]);
await drv.goto(BASE + 'driver.html');
await drv.getByRole('button', { name: 'الدخول بحساب السائق التجريبي' }).click();
await drv.locator('input.otp').fill(await codeFrom(drv));
await drv.getByRole('button', { name: 'تحقق' }).click();
await drv.getByRole('button', { name: 'اتصال', exact: true }).click();
await drv.waitForSelector('text=بانتظار طلبات الرحلات');
await shot(drv, '02-driver-online');
log('driver online');

// Make the human driver the only candidate in Erbil for the first trip
await drv.evaluate(() => {
  const k = 'ride.v1.drivers';
  const ds = JSON.parse(localStorage.getItem(k));
  for (const d of ds) if (d.bot && d.cityId === 'erbil') d.availability = 'OFFLINE';
  localStorage.setItem(k, JSON.stringify(ds));
  const s = JSON.parse(localStorage.getItem('ride.v1.settings')); s.botAcceptRate = 0; localStorage.setItem('ride.v1.settings', JSON.stringify(s));
});

// Passenger logs in and books
const pas = await ctx.newPage(); watch(pas, 'passenger'); pages.push(['passenger', pas]);
await pas.goto(BASE + 'passenger.html');
await pas.getByRole('button', { name: 'الدخول بحساب الراكب التجريبي' }).click();
await pas.locator('input.otp').fill(await codeFrom(pas));
await pas.getByRole('button', { name: 'تحقق' }).click();
await pas.waitForSelector('text=إلى أين؟');
await wait(1500);
await shot(pas, '03-passenger-home');
await pas.getByRole('button', { name: /إلى أين/ }).click();
await pas.getByRole('button', { name: /منتزه سامي عبد الرحمن/ }).click();
await pas.waitForSelector('.vt');
await pas.locator('input[placeholder="WELCOME"]').fill('WELCOME');
await pas.getByRole('button', { name: 'تطبيق' }).click();
await pas.waitForSelector('text=تم تطبيق الكود WELCOME');
await shot(pas, '04-passenger-options');
const price = await pas.locator('.vt.on .price').innerText();
log('quote', price);
await pas.getByRole('button', { name: /^اطلب/ }).click();
await pas.waitForSelector('text=نبحث لك عن سائق');
log('trip requested');

// Driver receives the offer and accepts
await drv.bringToFront();
await drv.waitForSelector('text=طلب رحلة جديد', { timeout: 20000 });
await shot(drv, '05-driver-offer');
await drv.getByRole('button', { name: 'قبول' }).click();
await drv.waitForSelector('text=اذهب إلى نقطة الانطلاق');
log('accepted');
await pas.waitForSelector('text=يصل خلال', { timeout: 10000 });
await shot(pas, '06-passenger-arriving');

// Simulated driving to pickup, then "arrived"
await drv.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'وصلت'); return b && !b.disabled; }, null, { timeout: 60000 });
await drv.getByRole('button', { name: 'وصلت', exact: true }).click();
await pas.waitForSelector('.pin-code', { timeout: 10000 });
const pin = (await pas.locator('.pin-code').innerText()).trim();
await shot(pas, '07-passenger-pin');
await drv.locator('input.otp').fill('0000');
await drv.getByRole('button', { name: 'بدء الرحلة' }).click();
await drv.waitForSelector('text=الرمز غير صحيح');
await drv.locator('input.otp').fill(pin);
await drv.getByRole('button', { name: 'بدء الرحلة' }).click();
await drv.waitForSelector('text=في الرحلة');
log('started with PIN', pin);
await pas.waitForSelector('text=في الطريق');
await shot(pas, '08-passenger-in-progress');

// Wait for the car to reach the destination, then complete
await drv.waitForFunction(() => /متبقٍ 0[.,٫]0|متبقٍ ٠[.,٫]٠/.test(document.body.innerText), null, { timeout: 120000 });
await drv.getByRole('button', { name: 'إنهاء الرحلة' }).click();
await drv.waitForSelector('text=اكتملت الرحلة');
await shot(drv, '09-driver-done');
await drv.getByRole('button', { name: 'إرسال التقييم' }).click();
log('completed');
await pas.waitForSelector('text=وصلت إلى وجهتك');
await shot(pas, '10-passenger-rating');
await pas.getByRole('button', { name: 'إرسال التقييم' }).click();
await pas.waitForSelector('text=إلى أين؟');

const state = await pas.evaluate(() => {
  const trips = JSON.parse(localStorage.getItem('ride.v1.trips')).filter((t) => !t.historical);
  const w = JSON.parse(localStorage.getItem('ride.v1.wallets'));
  return { trip: trips.at(-1), wDriver: w['d:d-demo'], wPlatform: w.platform };
});
const t = state.trip;
log('final', t.status, 'est', t.est.fare.total, 'final', t.final.fare.total, 'gross', t.final.fare.gross, 'discount', t.final.fare.discount, 'commission', t.final.commission, 'earning', t.final.driverEarning, 'kept', t.final.keptEstimate, 'driverWallet', state.wDriver.balance, 'rating', t.ratings.byCustomer?.stars);
if (t.status !== 'COMPLETED') errors.push('trip not completed');
// cash trip: driver holds total; wallet = discount − commission; net = earning
if (t.final.fare.total + state.wDriver.balance !== t.final.driverEarning) errors.push(`settlement mismatch: ${t.final.fare.total} + ${state.wDriver.balance} != ${t.final.driverEarning}`);

// Second trip handled entirely by simulated drivers, paid by wallet
await drv.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('ride.v1.settings')); s.botAcceptRate = 1; localStorage.setItem('ride.v1.settings', JSON.stringify(s));
  const ds = JSON.parse(localStorage.getItem('ride.v1.drivers'));
  for (const d of ds) if (d.bot && d.cityId === 'erbil' && d.status === 'APPROVED') d.availability = 'ONLINE';
  for (const d of ds) if (d.id === 'd-demo') d.availability = 'OFFLINE';
  localStorage.setItem('ride.v1.drivers', JSON.stringify(ds));
});
await pas.bringToFront();
await pas.getByRole('button', { name: /إلى أين/ }).click();
await pas.getByRole('button', { name: /عنكاوا/ }).first().click();
await pas.waitForSelector('.vt');
await pas.locator('select').filter({ hasText: 'نقدًا' }).selectOption('WALLET');
await pas.getByRole('button', { name: /^اطلب/ }).click();
await pas.waitForSelector('text=وصلت إلى وجهتك', { timeout: 300000 });
const t2 = await pas.evaluate(() => JSON.parse(localStorage.getItem('ride.v1.trips')).filter((t) => !t.historical).at(-1));
log('bot trip', t2.status, t2.paymentMethod, 'final', t2.final.fare.total, 'driver', t2.driverId);
await shot(pas, '11-passenger-bot-trip-done');
await pas.getByRole('button', { name: 'تخطي' }).click();

// Email + password sign-in, and forgot password
await pas.getByRole('button', { name: /الحساب/ }).click();
await pas.waitForSelector('text=تثبيت التطبيق');
await pas.getByRole('button', { name: /تعيين كلمة مرور/ }).click();
await pas.locator('dialog input[type=password]').fill('demo1234');
await pas.locator('dialog button', { hasText: 'حفظ' }).click();
await pas.getByRole('button', { name: /تغيير كلمة المرور/ }).waitFor();
await pas.getByRole('button', { name: 'تسجيل الخروج' }).click();
await pas.getByRole('button', { name: /الدخول بالبريد الإلكتروني/ }).click();
await pas.locator('input[type=email]').fill('rider@demo.iq');
await pas.locator('input[type=password]').fill('wrong-pass');
await pas.getByRole('button', { name: 'دخول', exact: true }).click();
await pas.waitForSelector('text=البريد أو كلمة المرور غير صحيحة');
await pas.locator('input[type=password]').fill('demo1234');
await pas.getByRole('button', { name: 'دخول', exact: true }).click();
await pas.waitForSelector('text=إلى أين؟');
log('email login ok');
await pas.getByRole('button', { name: /الحساب/ }).click();
await pas.getByRole('button', { name: 'تسجيل الخروج' }).click();
await pas.getByRole('button', { name: /الدخول بالبريد الإلكتروني/ }).click();
await pas.locator('input[type=email]').fill('RIDER@demo.iq');
await pas.getByRole('button', { name: 'نسيت كلمة المرور؟' }).click();
await pas.getByRole('button', { name: 'إرسال الرمز' }).click();
const reset = (await pas.locator('.notice').first().innerText()).match(/\d{6}/)[0];
await pas.locator('input.otp').fill(reset);
await pas.locator('input[type=password]').fill('newpass99');
await pas.getByRole('button', { name: 'حفظ' }).click();
await pas.waitForSelector('text=إلى أين؟');
const pwdOk = await pas.evaluate(() => { const c = JSON.parse(localStorage.getItem('ride.v1.customers')).find((x) => x.id === 'c-demo'); return !!c.pwd?.hash && !JSON.stringify(c).includes('newpass99'); });
if (!pwdOk) errors.push('password not stored as a hash');
log('forgot-password flow ok');

// Installable app: manifest + service worker
const pwa = await pas.evaluate(async () => {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 5000))]);
  const href = document.querySelector('link[rel=manifest]')?.href;
  const manifest = href ? await (await fetch(href)).json() : null;
  return { sw: !!reg?.active, scope: reg?.scope, manifest: manifest?.start_url, icons: manifest?.icons?.length };
});
log('pwa', JSON.stringify(pwa));
if (!pwa.sw || !pwa.manifest || pwa.icons < 2) errors.push(`PWA not ready: ${JSON.stringify(pwa)}`);

// Admin: visit every page as Super Admin
const adm = await ctx.newPage(); watch(adm, 'admin'); pages.push(['admin', adm]);
await adm.setViewportSize({ width: 1360, height: 900 });
await adm.goto(BASE + 'admin.html');
await adm.getByRole('button', { name: 'دخول' }).click();
await adm.waitForSelector('text=اليوم');
await wait(1200);
await shot(adm, '20-admin-dashboard');
const navCount = (await adm.locator('.side button:not(.btn)').count());
const navButtons = [];
for (let i = 0; i < navCount; i++) {
  const btn = adm.locator('.side button:not(.btn)').nth(i);
  const name = (await btn.innerText()).replace(/\s+/g, ' ').trim();
  navButtons.push(name);
  await btn.click();
  await wait(600);
  await shot(adm, `21-admin-${String(i).padStart(2, '0')}`);
}
log('admin pages visited:', navButtons.length);

// Approve a pending driver end-to-end: approve docs then account
await adm.locator('.side button', { hasText: 'الموافقة على السائقين' }).click();
await adm.locator('tbody tr.click').first().click();
for (let i = 0; i < 10; i++) {
  const pending = adm.locator('dialog .list-item').filter({ hasNotText: 'مقبول' }).filter({ has: adm.locator('.btn.good') });
  if (!(await pending.count())) break;
  await pending.first().locator('.btn.good').click();
  await wait(300);
}
await adm.locator('dialog button', { hasText: 'موافقة' }).click();
await adm.waitForSelector('dialog >> text=مُوافق عليه');
await shot(adm, '22-admin-driver-approved');
await adm.locator('dialog button', { hasText: 'إغلاق' }).last().click();
log('applicant approved');

// Role-based access: Customer Support should not see pricing
await adm.locator('.side button', { hasText: 'تسجيل الخروج' }).click();
await adm.locator('select').first().selectOption('CUSTOMER_SUPPORT');
await adm.getByRole('button', { name: 'دخول' }).click();
await wait(500);
const supportNav = await adm.locator('.side button').allInnerTexts();
if (supportNav.some((x) => x.includes('الأسعار'))) errors.push('RBAC: support can see pricing');
log('support nav:', supportNav.length, 'items');

// English + Kurdish render
for (const [loc, needle, dir] of [['en', 'Where to?', 'ltr'], ['ckb', 'بۆ کوێ؟', 'rtl']]) {
  await pas.evaluate((l) => localStorage.setItem('ride.locale', l), loc);
  await pas.reload();
  await pas.waitForSelector(`text=${needle}`);
  const d = await pas.evaluate(() => document.documentElement.dir);
  if (d !== dir) errors.push(`${loc}: dir ${d}`);
  await shot(pas, `30-passenger-${loc}`);
}
log('locales ok');

await browser.close();
server.close();
console.log(errors.length ? `\nERRORS (${errors.length}):\n${[...new Set(errors)].join('\n')}` : '\nNO ERRORS');
process.exit(errors.length ? 1 : 0);
