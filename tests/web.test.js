// Frontend tests: node --test tests   (Node 18+, no packages)
const test = require('node:test'), assert = require('node:assert'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const web = f => fs.readFileSync(path.join(__dirname, '..', 'web', f), 'utf8');
const ctx = vm.createContext({ Intl, Math, Date, Number, String, Map, Object, Array, Set });
vm.runInContext(web('costs.js') + '\n;this.priceParts = priceParts; this.priceValue = priceValue; this.finHour = finHour;', ctx);
const { priceParts, priceValue, finHour } = ctx;
const S = { vat: 25.5, margin: 0.6, other: 0, transfer_day: 3, transfer_night: 1, tax: 0, night_start: 22, night_end: 7,
  monthly_provider: 0, monthly_transfer: 0, monthly_kwh: 0, spread_monthly: false };
const at = (iso) => Date.parse(iso) / 1000;
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.006, `${a} != ${b}`);

test('total = spot + VAT + margin + transfer + tax (screenshot case, 2.75)', () => {
  const t = at('2026-11-10T05:15:00+02:00'), p = priceParts(S, t, 0.92);
  near(p.total, 2.75); near(p.vatOnSpot, 0.23); near(p.transferFee, 1.0);
  near(priceValue(S, t, 0.92, 'total', true), 2.75); near(priceValue(S, t, 0.92, 'total', false), 2.19);
});

test('transmission cost = transfer fee + electricity tax', () => {
  const p = priceParts({ ...S, tax: 2.827 }, at('2026-11-10T12:00:00+02:00'), 1);
  near(p.transmission, 3 + 2.827);
});

test('day / night rate uses Finnish time whatever the browser time zone is', () => {
  assert.strictEqual(finHour(at('2026-11-10T23:30:00+02:00')), 23);
  assert.strictEqual(finHour(at('2026-07-10T00:10:00+03:00')), 0);  // summer time
  assert.strictEqual(priceParts(S, at('2026-11-10T23:30:00+02:00'), 1).night, true);
  assert.strictEqual(priceParts(S, at('2026-11-10T12:00:00+02:00'), 1).night, false);
});

test('a missing or non-finite time does not throw (page error "The provided value is non-finite")', () => {
  for (const t of [NaN, undefined, Infinity, null]) assert.doesNotThrow(() => priceParts(S, t, 1));
  assert.ok(Number.isNaN(finHour(NaN)));
});

test('the same number comes out in every process time zone', () => {
  const { execFileSync } = require('node:child_process');
  const code = `const vm=require('vm'),fs=require('fs');const c=vm.createContext({Intl,Math,Date,Number,String,Map,Object,Array,Set});` +
    `vm.runInContext(fs.readFileSync(${JSON.stringify(path.join(__dirname, '..', 'web', 'costs.js'))},'utf8')+';this.f=finHour',c);console.log(c.f(${at('2026-11-10T23:30:00+02:00')}))`;
  for (const tz of ['Europe/Helsinki', 'America/New_York', 'Asia/Tokyo']) assert.strictEqual(execFileSync('node', ['-e', code], { env: { ...process.env, TZ: tz } }).toString().trim(), '23');
});

test('price breakdown lists the transmission cost', () => assert.match(web('app.js'), /Transmission cost \(transfer \+ tax\)/));

test('default period is -1 day … +2 days', () => {
  assert.match(web('app.js'), /defaultView = \(\) => \(\{ min: midnight\(-1\), max: midnight\(3\) \}\)/);
  assert.match(web('index.html'), /−1 day … \+2 days/); assert.doesNotMatch(web('index.html'), /−3 days/);
  assert.doesNotMatch(web('home.js'), /midnight\(-3\)/);
});

test('readout boxes are two fixed lines', () => {
  assert.match(web('style.css'), /\.readout\{display:block;height:4\.6em;overflow:hidden/);
  assert.match(web('style.css'), /\.readout>div\{[^}]*flex-wrap:nowrap[^}]*height:1\.6em/);
  const home = web('home.js'), app = web('app.js');
  assert.match(home.slice(home.indexOf('function readoutHtml')), /<\/div><div>.*<\/div>`;/s);
  assert.match(app, /<\/div><div>`;/);
});

test('temperature labels and zero line stay inside the price panel', () => {
  const app = web('app.js');
  assert.match(app, /v < tempLo - 1e-9 \? ''/); assert.match(app, /py < y\.bottom\) \{ g\.setLineDash\(\[2, 4\]\); g\.strokeStyle = TEMP\.cold/);
});

test('chart canvas is freed before a new chart is made', () => assert.match(web('app.js'), /Chart\.getChart\(\$\('#chart'\)\)\?\.destroy\(\)/));

test('an empty fee box is not saved as 0', () => assert.match(web('app.js'), /el\.type === 'number' && el\.value\.trim\(\) === ''\) return/));

test('browser-only mode sends nothing without WhatsApp / email set up', () => {
  const l = web('local.js');
  assert.match(l, /if \(canSend\(s\)\) for \(const due of dueMessages\(s\)\)/); assert.match(l, /skipped: no CallMeBot API key/);
});

test('temperature gradient never gets a NaN colour stop (Safari: "The provided value is non-finite")', () => {
  const app = web('app.js');
  assert.match(app, /f = Number\.isFinite\(f\) \? Math\.max\(0, Math\.min\(1, f\)\) : 1/);
  // run tempColor with a scale that has no range yet
  const stops = [], ctx2 = vm.createContext({ Math, Number, TEMP: { warm: 'r', cold: 'b' } });
  const fn = app.slice(app.indexOf('function tempColor'), app.indexOf('const WX_STEPS'));
  vm.runInContext(fn + ';this.tempColor = tempColor', ctx2);
  const chart = { chartArea: { top: 10, bottom: 100 }, scales: { y2: { getPixelForValue: () => NaN } },
    ctx: { createLinearGradient: () => ({ addColorStop: (o) => { if (!Number.isFinite(o)) throw new TypeError('The provided value is non-finite'); stops.push(o); } }) } };
  assert.doesNotThrow(() => ctx2.tempColor({ chart }));
});

test('changed page files have a new cache-busting version', () => {
  const h = web('index.html');
  assert.match(h, /costs\.js\?v=14/); assert.match(h, /app\.js\?v=29/); assert.match(h, /home\.js\?v=2/); assert.match(h, /style\.css\?v=20/);
});
