/* Electricity Finland · UI mockups kit.
   Sample data (made up but realistic), the price maths of web/costs.js, SVG charts for every view of the app,
   and the shared panels (Explore, Usage, Alerts, Settings, sheets). Each concept page styles them through
   the tokens in kit.css and adds its own home screen and navigation. No libraries. */
(() => {
'use strict';
const EF = window.EF = {};
const Q = 9e5, H = 36e5, DAY = 864e5;
// Times are Finnish local time stored as "naive" UTC milliseconds, so the mockup reads the same in every time zone.
const B = Date.UTC(2025, 9, 16), NOW = Date.UTC(2026, 9, 15, 15, 10);
const PUB_END = Date.UTC(2026, 9, 17), EST_END = Date.UTC(2026, 9, 23);
const NS = (EST_END - B) / Q, NH = NS / 4, ND = NH / 24;
const TODAY = Date.UTC(2026, 9, 15);
Object.assign(EF, { Q, H, DAY, B, NOW, PUB_END, EST_END, TODAY });

// ------------------------------------------------------------------ sample data
let seed = 20261015;
const rnd = () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, f) => a + (b - a) * f;
const bump = (x, c, w) => Math.exp(-((x - c) ** 2) / (2 * w * w));
const season = t => Math.cos(2 * Math.PI * ((t - Date.UTC(2026, 0, 15)) / DAY) / 365.25); // 1 mid-January, −1 mid-July

const dW = [], dL = [], dT = [], dC = [];
{ let w = .5, ta = 0, c = .6;
  for (let d = 0; d <= ND; d++) {
    w = clamp(.7 * w + .3 * rnd() + .12 * gauss(), .03, .97); ta = .8 * ta + 1.5 * gauss(); c = clamp(.55 * c + .45 * rnd() + .1 * gauss(), 0, 1);
    const s = season(B + d * DAY); let L = (4.4 + 3.4 * s) * Math.exp(.28 * gauss()); if (s > .3 && rnd() < .05) L *= 2.3;
    dW.push(w); dL.push(L); dT.push(ta); dC.push(c);
  }
  // keep the days around "today" readable: a windy calm night, a normal today, a pricier tomorrow
  const di = (TODAY - B) / DAY; dW[di - 1] = .35; dW[di] = .52; dW[di + 1] = .3; dW[di + 2] = .22; dL[di] = 5.2; dL[di + 1] = 6.4; dL[di + 2] = 7.1; dT[di] = .5;
}
const wind = new Float32Array(NH), temp = new Float32Array(NH), ms = new Float32Array(NH), cloud = new Float32Array(NH), wet = new Uint8Array(NH), dark = new Uint8Array(NH);
{ let wn = 0;
  for (let h = 0; h < NH; h++) {
    const d = Math.floor(h / 24), f = (h % 24) / 24, t = B + h * H, s = season(t), hr = h % 24;
    wn = .88 * wn + .05 * gauss();
    const wv = clamp(lerp(dW[d], dW[d + 1] ?? dW[d], f) + wn, .01, 1);
    wind[h] = Math.round(450 + wv * 7600); ms[h] = Math.max(.3, 1.6 + wv * 8 + .6 * gauss());
    temp[h] = 5.8 - 10.8 * s + lerp(dT[d], dT[d + 1] ?? dT[d], f) + (2 + .8 * (1 - s)) * Math.cos(2 * Math.PI * (hr - 15) / 24) + .3 * gauss();
    const cl = clamp(lerp(dC[d], dC[d + 1] ?? dC[d], f) + .1 * gauss(), 0, 1); cloud[h] = cl;
    const len = 12.4 - 6.4 * s, rise = 13.2 - len / 2, set = 13.2 + len / 2; dark[h] = hr + .5 < rise || hr + .5 > set ? 1 : 0;
    if (cl > .8 && rnd() < .4) wet[h] = temp[h] > 1.5 ? (s < -.6 && rnd() < .12 ? 4 : 1) : temp[h] < -.5 ? 3 : 2;
    else if (cl > .5 && ms[h] < 2.2 && rnd() < .15) wet[h] = 5;
  }
}
const spot = new Float32Array(NS), isEst = new Uint8Array(NS), estPast = new Float32Array(NS).fill(NaN);
for (let i = 0; i < NS; i++) {
  const t = B + i * Q, h = i >> 2, d = Math.floor(i / 96), hr = (i % 96) / 4, s = season(t);
  const shape = .56 + .52 * bump(hr, 8.2, 1.7) + .66 * bump(hr, 18.6, 2.3) + .2 * (hr >= 6 && hr < 22) - .32 * Math.max(0, -s) * bump(hr, 13.5, 2.6);
  const wf = 1.6 - 1.3 * (wind[h] - 450) / 7600;
  let p = dL[d] * shape * wf * (1 + .065 * gauss()) + ((i % 4) - 1.5) * .05 * dL[d] * (bump(hr, 8, 2) + bump(hr, 18, 2));
  if (p < .6 && s < 0 && wind[h] > 5600 && rnd() < .5) p = -.05 - .7 * rnd();
  spot[i] = Math.round(p * 1000) / 1000; isEst[i] = t >= PUB_END ? 1 : 0;
}
{ const start = (TODAY - 90 * DAY - B) / Q, end = (PUB_END - B) / Q; let bias = 0;
  for (let i = start; i < end; i++) {
    if (i % 96 === 0) bias = .14 * gauss();
    const h0 = i - (i % 4), hav = (spot[h0] + spot[h0 + 1] + spot[h0 + 2] + spot[h0 + 3]) / 4;
    estPast[i] = hav * (1 + bias) + .35 * gauss() * (i % 4 === 0 ? 1 : 0) + (estPast[i - 1] - hav * (1 + bias) || 0) * .6;
  }
}
// sample household consumption, hourly kWh, 1 Aug – 14 Oct
const cons = new Float32Array(NH).fill(NaN), CONS_FROM = Date.UTC(2026, 7, 1), CONS_TO = TODAY;
for (let t = CONS_FROM; t < CONS_TO; t += H) {
  const h = (t - B) / H, hr = h % 24, dow = (Math.floor(t / DAY) + 4) % 7;
  let k = .3 + .45 * Math.max(0, (11 - temp[h]) / 20) + .35 * bump(hr, 7.5, 1) + .75 * bump(hr, 19.5, 2);
  if (dow === 6 && (hr === 18 || hr === 19)) k += 3;
  if ((dow === 1 || dow === 3 || dow === 5) && hr >= 1 && hr <= 3) k += 2.4;
  cons[h] = Math.max(.08, k * (1 + .15 * gauss()));
}

// ------------------------------------------------------------------ settings, price maths (as web/costs.js)
const S = EF.S = { vat: 25.5, margin: .49, other: 0, transfer_day: 4.28, transfer_night: 2.65, night_start: 22, night_end: 7, tax: 2.827,
  monthly_provider: 3.95, monthly_transfer: 9.9, monthly_kwh: 650, spread: false,
  high_on: true, high: 18, low_on: true, low: 9, alarm_basis: 'total', alarm_vat: true, wa_on: true, email_on: true,
  extra_times: ['07:30', '', ''], place: 'Helsinki', price_color: '' };
const st = EF.state = { mode: 'total', vat: true, preset: '3d', from: TODAY - 3 * DAY, to: TODAY + 3 * DAY, lens: 'bars', yz: 1, avg: false,
  layers: { wind: true, temp: false, wx: true, readout: true }, sel: null };
const hourOf = t => new Date(t).getUTCHours();
function parts(t, sp) {
  const k = 1 + S.vat / 100, h = hourOf(t), ns = S.night_start, ne = S.night_end;
  const night = ns > ne ? (h >= ns || h < ne) : (ns <= h && h < ne);
  const per = S.spread && S.monthly_kwh > 0 ? 100 / S.monthly_kwh : 0, spotIn = sp > 0 ? sp * k : sp;
  const p = { spotEx: sp, vatOnSpot: spotIn - sp, margin: S.margin, other: S.other, night, transferFee: night ? S.transfer_night : S.transfer_day,
    tax: S.tax, monthly: (S.monthly_provider + S.monthly_transfer) * per, k };
  p.total = spotIn + p.margin + p.other + p.transferFee + p.tax + p.monthly;
  return p;
}
function value(t, sp, mode, vat) {
  const p = parts(t, sp);
  if (mode === 'spot') return vat ? p.spotEx + p.vatOnSpot : p.spotEx;
  if (mode === 'transfer') return (p.transferFee + p.tax) * (vat ? 1 : 1 / p.k);
  return vat ? p.total : p.spotEx + (p.total - p.spotEx - p.vatOnSpot) / p.k;
}
const val = i => value(B + i * Q, spot[i], st.mode, st.vat);
const aval = i => value(B + i * Q, spot[i], S.alarm_basis, S.alarm_vat);
const limitState = a => { a = +a.toFixed(2); return S.high_on && a >= S.high ? 'hi' : S.low_on && a <= S.low ? 'lo' : ''; };
const slotAt = t => Math.floor((t - B) / Q);
Object.assign(EF, { parts, value, val, aval, limitState, slotAt, spot, isEst, wind, temp, ms, cons, clamp, CONS_FROM, CONS_TO });

// ------------------------------------------------------------------ formatting
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], WDL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const neg = s => s.replace('-', '−');
const f2 = v => v == null || isNaN(v) ? '–' : neg(v.toFixed(2));
const f1 = v => v == null || isNaN(v) ? '–' : neg(Math.abs(v) >= 10 ? Math.round(v).toString() : v.toFixed(1));
const int = v => Math.round(v).toLocaleString('en-US');
const eur = v => (v < 0 ? '−' : '') + '€' + Math.abs(v).toFixed(2);
const p2 = n => String(n).padStart(2, '0');
const hm = t => { const d = new Date(t); return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; };
const wd = t => WD[new Date(t).getUTCDay()];
const dmy = t => { const d = new Date(t); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
const dayLabel = t => `${wd(t)} ${dmy(t)}`;
const dayStart = t => Math.floor(t / DAY) * DAY;
const rel = t => { const d = (dayStart(t) - TODAY) / DAY; return d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d === -1 ? 'Yesterday' : dayLabel(t); };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
Object.assign(EF, { f2, f1, int, eur, hm, wd, dmy, dayLabel, dayStart, rel, WD, WDL, MON, MONL, esc });
EF.basisLabel = (m = st.mode, v = st.vat) => `${m === 'spot' ? 'Spot' : 'Total cost'} · ${v ? 'incl.' : 'excl.'} VAT`;
EF.alarmBasisLabel = () => `${S.alarm_basis === 'spot' ? 'spot' : 'total cost'} ${S.alarm_vat ? 'incl.' : 'excl.'} VAT`;

// ------------------------------------------------------------------ events
const subs = {};
EF.on = (ev, fn) => (subs[ev] ||= []).push(fn);
EF.emit = (ev, x) => (subs[ev] || []).forEach(fn => fn(x));
EF.set = patch => { Object.assign(st, patch); EF.emit('change', patch); };

// ------------------------------------------------------------------ aggregation
function bstart(t, step) {
  if (step === 'month') { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); }
  if (step === 'year') return Date.UTC(new Date(t).getUTCFullYear(), 0, 1);
  if (step === 7 * DAY) { const d = dayStart(t); return d - ((Math.floor(d / DAY) + 3) % 7) * DAY; }
  return Math.floor(t / step) * step;
}
function bend(t, step) {
  if (step === 'month') { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); }
  if (step === 'year') return Date.UTC(new Date(t).getUTCFullYear() + 1, 0, 1);
  return t + step;
}
const CUR = slotAt(NOW) * Q + B;
function agg(from, to, step, fn = val) {
  from = Math.max(from, B); to = Math.min(to, EST_END);
  const out = []; let cur = null;
  for (let i = Math.ceil((from - B) / Q), e = Math.ceil((to - B) / Q); i < e; i++) {
    const t = B + i * Q, bs = bstart(t, step);
    if (!cur || cur.t !== bs) { cur = { t: bs, end: bend(bs, step), sum: 0, asum: 0, ssum: 0, n: 0, lo: Infinity, hi: -Infinity, est: 0, i0: i }; out.push(cur); }
    const v = fn(i), a = aval(i); cur.sum += v; cur.asum += a; cur.ssum += spot[i]; cur.n++; cur.est += isEst[i];
    if (v < cur.lo) cur.lo = v; if (v > cur.hi) cur.hi = v;
  }
  for (const b of out) {
    b.avg = b.sum / b.n; b.a = b.asum / b.n; b.spot = b.ssum / b.n;
    b.kind = b.est > b.n / 2 ? 'est' : b.t > CUR ? 'fix' : 'past';
    b.now = b.t <= NOW && NOW < b.end; b.passed = b.end <= NOW; b.state = limitState(b.a);
  }
  return out;
}
EF.agg = agg; EF.bstart = bstart;
EF.nowBucket = () => agg(CUR, CUR + Q, Q)[0];
const hourly = (arr, t0, t1) => { let s = 0, n = 0; for (let h = Math.max(0, Math.floor((t0 - B) / H)), e = Math.min(NH, Math.ceil((t1 - B) / H)); h < e; h++) if (!isNaN(arr[h])) { s += arr[h]; n++; } return n ? s / n : NaN; };
const hourlySum = (arr, t0, t1) => { let s = 0, n = 0; for (let h = Math.max(0, Math.floor((t0 - B) / H)), e = Math.min(NH, Math.ceil((t1 - B) / H)); h < e; h++) if (!isNaN(arr[h])) { s += arr[h]; n++; } return n ? s : NaN; };
EF.hourly = hourly;
const WX_LABEL = { sun: 'Clear', moon: 'Clear', partly: 'Partly cloudy', mooncloud: 'Partly cloudy', cloud: 'Cloudy', rain: 'Rain', sleet: 'Sleet', snow: 'Snow', fog: 'Fog', thunder: 'Thunder' };
function wx(t0, t1) {
  const h0 = Math.max(0, Math.floor((t0 - B) / H)), h1 = Math.min(NH, Math.ceil((t1 - B) / H)); if (h1 <= h0) return null;
  let n = 0, cl = 0, dk = 0, wetN = 0, fog = 0; const c = [0, 0, 0, 0, 0, 0];
  for (let h = h0; h < h1; h++) { n++; cl += cloud[h]; dk += dark[h]; if (wet[h] === 5) fog++; else if (wet[h]) { wetN++; c[wet[h]]++; } }
  cl /= n; const night = dk > n / 2; let icon;
  if (wetN >= Math.max(1, n / 5)) icon = c[4] ? 'thunder' : (c[1] && c[3]) || c[2] ? 'sleet' : c[3] ? 'snow' : 'rain';
  else if (fog >= n / 3) icon = 'fog';
  else icon = cl < .32 ? (night ? 'moon' : 'sun') : cl < .7 ? (night ? 'mooncloud' : 'partly') : 'cloud';
  return { icon, label: WX_LABEL[icon], temp: hourly(temp, t0, t1), ms: hourly(ms, t0, t1), wind: hourly(wind, t0, t1) };
}
EF.wx = wx;

// ------------------------------------------------------------------ derived numbers
EF.current = () => { const i = slotAt(NOW); return { t: B + i * Q, end: B + (i + 1) * Q, v: val(i), a: aval(i), state: limitState(aval(i)), spot: spot[i], i }; };
EF.dayStats = d => { const b = agg(d, d + DAY, DAY)[0]; return b && b.est < b.n / 2 ? b : b ? { ...b, estimate: true } : null; };
EF.cheapest = (hours = 3, from = CUR, to = PUB_END) => {
  const n = hours * 4, i0 = slotAt(from), i1 = slotAt(to); let best = null, s = 0;
  for (let i = i0; i < i1; i++) { s += val(i); if (i - i0 >= n) s -= val(i - n); if (i - i0 >= n - 1) { const a = s / n; if (!best || a < best.avg) best = { t: B + (i - n + 1) * Q, end: B + (i + 1) * Q, avg: a }; } }
  return best;
};
EF.plan = (kwh, hours) => {
  const n = Math.round(hours * 4), i0 = slotAt(NOW), i1 = slotAt(PUB_END); if (i1 - i0 < n || !(kwh > 0)) return null;
  const per = kwh / n / 100, costs = [];
  let s = 0; for (let i = i0; i < i1; i++) { s += val(i); if (i - i0 >= n) s -= val(i - n); if (i - i0 >= n - 1) costs.push({ t: B + (i - n + 1) * Q, cost: s * per }); }
  const now = costs[0], best = costs.reduce((a, b) => b.cost < a.cost ? b : a), worst = costs.reduce((a, b) => b.cost > a.cost ? b : a);
  return { now, best, worst, save: now.cost - best.cost, pct: now.cost > 0 ? (now.cost - best.cost) / now.cost : 0, hours, kwh };
};
EF.series = (from, to, step) => agg(from, to, step).map(b => b.avg);
// one plain sentence about the price right now, for the home screens
EF.insight = () => {
  const c = EF.current(), td = agg(TODAY, TODAY + DAY, DAY)[0], tm = agg(TODAY + DAY, TODAY + 2 * DAY, DAY)[0], ch = EF.cheapest(3), d = c.v - td.avg;
  const hr = hourOf(ch.t), when = dayStart(ch.t) === TODAY ? (hr >= 18 ? 'tonight' : 'later today') : dayStart(ch.t) === TODAY + DAY && hr < 6 ? 'tonight' : 'tomorrow';
  const state = c.state === 'hi' ? 'High price' : c.state === 'lo' ? 'Low price' : Math.abs(d) < .4 ? 'Average' : d < 0 ? 'Below average' : 'Above average';
  const sentence = `${Math.abs(d) < .4 ? 'About' : d < 0 ? `${f2(-d)} below` : `${f2(d)} above`} today's average of ${f2(td.avg)}. The cheapest three hours start ${when} at ${hm(ch.t)}, averaging ${f2(ch.avg)}.`;
  return { c, td, tm, ch, state, sentence, tone: c.state || (d < 0 ? 'good' : 'warn') };
};
EF.windNow = () => wind[Math.floor((NOW - B) / H)];

// ------------------------------------------------------------------ svg helpers
const ticks = (lo, hi, n = 5) => {
  const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || raw;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6)); return { out, step };
};
const KIND_LABEL = { past: 'Published price', fix: 'Fixed future price', est: 'Estimate, not fixed yet' };
EF.KIND_LABEL = KIND_LABEL;
const barClass = b => b.state ? 'b-' + b.state : 'b-' + b.kind;
const ICONS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></symbol>
<symbol id="i-moon" viewBox="0 0 24 24"><path d="M19.5 14.6A8 8 0 1 1 9.4 4.5a6.4 6.4 0 0 0 10.1 10.1z"/></symbol>
<symbol id="i-cloud" viewBox="0 0 24 24"><path d="M7.5 19h9a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 6.6 10.1 4.5 4.5 0 0 0 7.5 19z"/></symbol>
<symbol id="i-partly" viewBox="0 0 24 24"><path d="M8 3v1.5M3 8h1.5M4.5 4.5l1 1M11.5 4.5l-1 1"/><path d="M5.6 10.4A3.2 3.2 0 1 1 11 7.2"/><path d="M9.5 20h7.5a3.5 3.5 0 0 0 .5-6.96A4.8 4.8 0 0 0 8.7 12.2 3.9 3.9 0 0 0 9.5 20z"/></symbol>
<symbol id="i-mooncloud" viewBox="0 0 24 24"><path d="M12 6.6A4.4 4.4 0 1 1 6.4 2.8a3.5 3.5 0 0 0 5.6 3.8z"/><path d="M9.5 20h7.5a3.5 3.5 0 0 0 .5-6.96A4.8 4.8 0 0 0 8.7 12.2 3.9 3.9 0 0 0 9.5 20z"/></symbol>
<symbol id="i-rain" viewBox="0 0 24 24"><path d="M7.5 15h9a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 6.6 6.1 4.5 4.5 0 0 0 7.5 15z"/><path d="M9 17.5l-1 3M13 17.5l-1 3M17 17.5l-1 3"/></symbol>
<symbol id="i-snow" viewBox="0 0 24 24"><path d="M7.5 15h9a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 6.6 6.1 4.5 4.5 0 0 0 7.5 15z"/><circle cx="8.5" cy="19" r=".9"/><circle cx="12.5" cy="20.5" r=".9"/><circle cx="16.5" cy="19" r=".9"/></symbol>
<symbol id="i-sleet" viewBox="0 0 24 24"><path d="M7.5 15h9a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 6.6 6.1 4.5 4.5 0 0 0 7.5 15z"/><path d="M9.5 17.5l-1 3M15.5 17.5l-1 3"/><circle cx="12.3" cy="20" r=".9"/></symbol>
<symbol id="i-fog" viewBox="0 0 24 24"><path d="M4 9h16M6 13h12M4 17h16"/></symbol>
<symbol id="i-thunder" viewBox="0 0 24 24"><path d="M7.5 15h1.3M15.2 15h1.3a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 6.6 6.1 4.5 4.5 0 0 0 7.5 15"/><path d="M13 12l-2.5 4h3l-2.5 4.5"/></symbol>
</defs></svg>`;
EF.icon = (name, cls = 'wxi') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${name}"/></svg>`;

// pointer + keyboard on a chart: hover reads out, click/Enter picks, drag pans, ctrl+wheel / pinch zooms
function interact(svgEl, items, xOf, o) {
  const hov = svgEl.querySelector('.hov'); let idx = -1, drag = null;
  const show = i => {
    idx = clamp(i, 0, items.length - 1); const it = items[idx], [x0, x1] = xOf(it);
    if (hov) { hov.setAttribute('x', x0); hov.setAttribute('width', Math.max(1, x1 - x0)); hov.style.opacity = 1; }
    o.onHover && o.onHover(it);
  };
  const find = ev => { const r = svgEl.getBoundingClientRect(), x = (ev.clientX - r.left) * (svgEl.viewBox.baseVal.width / r.width);
    let lo = 0, hi = items.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (xOf(items[m])[1] < x) lo = m + 1; else hi = m; } return lo; };
  svgEl.addEventListener('pointermove', ev => {
    if (drag && o.onPan) { const dx = ev.clientX - drag.x; if (Math.abs(dx) > 6) drag.moved = true; if (drag.moved) { o.onPan(-dx / svgEl.getBoundingClientRect().width, drag); return; } }
    show(find(ev));
  });
  svgEl.addEventListener('pointerdown', ev => { drag = { x: ev.clientX, moved: false, from: st.from, to: st.to }; });
  svgEl.addEventListener('pointerup', ev => { if (drag && !drag.moved) { show(find(ev)); o.onPick && o.onPick(items[idx]); } drag = null; });
  svgEl.addEventListener('pointerleave', () => { drag = null; if (hov) hov.style.opacity = 0; o.onLeave && o.onLeave(); });
  svgEl.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') { show((idx < 0 ? items.findIndex(b => b.now) : idx) + (ev.key === 'ArrowRight' ? 1 : -1)); ev.preventDefault(); }
    if (ev.key === 'Enter' && idx >= 0) o.onPick && o.onPick(items[idx]);
  });
  if (o.onZoom) svgEl.addEventListener('wheel', ev => { if (!ev.ctrlKey) return; ev.preventDefault(); o.onZoom(ev.deltaY > 0 ? 1.25 : .8); }, { passive: false });
  return { show };
}

// ------------------------------------------------------------------ A / B · bars (15-min or hourly + range)
EF.bars = function (el, o = {}) {
  const from = o.from ?? st.from, to = o.to ?? st.to, span = to - from, W = Math.max(280, Math.round(el.clientWidth));
  const lay = { ...st.layers, ...(o.layers || {}) }, compact = !!o.compact, showTemp = lay.temp && !compact;
  const L = compact ? 30 : 38, R = showTemp ? 38 : 10, pw = W - L - R;
  const steps = o.hourly ? [H, 2 * H, 3 * H, 6 * H, 12 * H, DAY, 7 * DAY] : [Q, 2 * Q, H, 2 * H, 3 * H, 6 * H, 12 * H, DAY, 7 * DAY];
  const step = steps.find(s => span / s * (o.hourly ? 6 : 3) <= pw) || 7 * DAY;
  const bk = agg(from, to, step); if (!bk.length) { el.innerHTML = '<p class="empty">No prices in this period.</p>'; return; }
  const days = span / DAY, showDays = !compact && o.days !== false && days <= 14.01 && pw / days >= 70;
  const topH = showDays ? 28 : 8, ph = o.height || Math.round(clamp(W * .36, 190, 340)), wxH = lay.wx && !compact ? (pw / (span / H) * 3 >= 22 || true ? 42 : 0) : 0;
  const axH = compact ? 22 : 36, windH = lay.wind && !compact ? 66 : 0, y0 = topH, y1 = topH + ph, Ht = y1 + axH + wxH + windH + 4;
  const vals = bk.map(b => o.hourly ? b.hi : b.avg), lows = bk.map(b => o.hourly ? b.lo : b.avg);
  let lo = Math.min(0, ...lows), hi = Math.max(...vals, .5);
  const showLim = !compact && st.mode === S.alarm_basis && st.vat === S.alarm_vat;
  if (showLim) { if (S.high_on && S.high < hi * 1.7) hi = Math.max(hi, S.high); if (S.low_on && S.low < lo) lo = S.low; }
  hi = lo + (hi - lo) * 1.08 / (st.yz || 1);
  const sx = t => L + (t - from) / span * pw, sy = v => y1 - (clamp(v, lo, hi) - lo) / (hi - lo) * (ph - 4);
  const g = [];
  const tk = ticks(lo, hi, compact ? 3 : 5);
  g.push(`<defs><clipPath id="cp-${el.id}"><rect x="${L}" y="${y0}" width="${pw}" height="${ph}"/></clipPath></defs>`);
  for (const v of tk.out) g.push(`<line class="gl${v === 0 ? ' z' : ''}" x1="${L}" x2="${L + pw}" y1="${sy(v)}" y2="${sy(v)}"/><text class="ax" x="${L - 6}" y="${sy(v) + 3.5}" text-anchor="end">${neg(String(v))}</text>`);
  // night transfer shading
  if (!compact && S.transfer_day !== S.transfer_night && step <= H && lay.night !== false)
    for (let d = dayStart(from) - DAY; d < to; d += DAY) { const a = Math.max(from, d + S.night_start * H), b = Math.min(to, d + DAY + S.night_end * H); if (b > a) g.push(`<rect class="night" x="${sx(a)}" y="${y0}" width="${sx(b) - sx(a)}" height="${ph}"/>`); }
  // day separators
  for (let d = dayStart(from) + DAY; d < to; d += DAY) if (step < DAY && span <= 21 * DAY) g.push(`<line class="dl" x1="${sx(d)}" x2="${sx(d)}" y1="${y0 - (showDays ? 24 : 0)}" y2="${y1}"/>`);
  // cheapest 3 h band
  const ch = EF.cheapest(3);
  if (!compact && ch && ch.end > from && ch.t < to && step <= H) { const a = sx(Math.max(ch.t, from)), b = sx(Math.min(ch.end, to)); g.push(`<rect class="band" x="${a}" y="${y0}" width="${b - a}" height="${ph}" rx="3"/>${b - a > 54 ? `<text class="band-t" x="${(a + b) / 2}" y="${y0 + 12}" text-anchor="middle">Cheapest 3 h</text>` : ''}`); }
  // bars
  const gap = w => w > 8 ? 1.5 : w > 4 ? 1 : w > 2.2 ? .5 : 0;
  g.push(`<g clip-path="url(#cp-${el.id})">`);
  for (const b of bk) {
    const x0 = sx(b.t), x1 = sx(b.end), w = x1 - x0, gp = gap(w);
    if (o.hourly) g.push(`<rect class="rng ${barClass(b)}" x="${x0 + gp / 2}" width="${Math.max(.5, w - gp)}" y="${sy(b.hi)}" height="${Math.max(1, sy(b.lo) - sy(b.hi))}" rx="${w > 8 ? 2 : 0}"/>`);
    const bw = o.hourly ? Math.max(.5, w * .56) : Math.max(.5, w - gp), bx = o.hourly ? x0 + (w - bw) / 2 : x0 + gp / 2;
    const top = sy(Math.max(b.avg, 0)), bot = sy(Math.min(b.avg, 0));
    g.push(`<rect class="bar ${barClass(b)}${b.passed ? ' passed' : ''}${b.now ? ' now' : ''}" x="${bx}" y="${top}" width="${bw}" height="${Math.max(1, bot - top)}" rx="${bw > 6 ? 2 : 0}"/>`);
    if (!compact && b.state && w >= 9) g.push(`<text class="mk mk-${b.state}" x="${x0 + w / 2}" y="${top - 4}" text-anchor="middle">${b.state === 'hi' ? '▲' : '▼'}</text>`);
    else if (!compact && w >= 28) g.push(`<text class="bv" x="${x0 + w / 2}" y="${top - 5}" text-anchor="middle">${f1(b.avg)}</text>`);
  }
  g.push('</g>');
  // limit lines
  if (showLim) {
    if (S.high_on && S.high <= hi) g.push(`<line class="lim hi" x1="${L}" x2="${L + pw}" y1="${sy(S.high)}" y2="${sy(S.high)}"/><text class="lim-t hi" x="${L + 4}" y="${sy(S.high) - 4}">Alert above ${S.high}</text>`);
    if (S.low_on && S.low >= lo) g.push(`<line class="lim lo" x1="${L}" x2="${L + pw}" y1="${sy(S.low)}" y2="${sy(S.low)}"/><text class="lim-t lo" x="${L + 4}" y="${sy(S.low) + 12}">Alert below ${S.low}</text>`);
  }
  // averages per kind (past, fixed, estimate)
  if (o.avg ?? st.avg) for (const k of ['past', 'fix', 'est']) {
    const ks = bk.filter(b => b.kind === k); if (!ks.length) continue;
    const a = ks.reduce((s, b) => s + b.sum, 0) / ks.reduce((s, b) => s + b.n, 0), xa = sx(ks[0].t), xb = sx(ks.at(-1).end), yv = sy(a);
    g.push(`<line class="avgl avg-${k}" x1="${xa}" x2="${xb}" y1="${yv}" y2="${yv}"/><g class="avgp avg-${k}"><rect x="${xb - 52}" y="${yv - 18}" width="50" height="15" rx="7.5"/><text x="${xb - 27}" y="${yv - 7}" text-anchor="middle">⌀ ${f2(a)}</text></g>`);
  }
  // temperature (dotted, warm above 0 °C, cold below)
  if (showTemp) {
    const ts = step < H ? H : step, pts = []; for (let t = bstart(from, ts); t < to; t += ts) { const v = hourly(temp, t, t + ts); if (!isNaN(v)) pts.push([t + ts / 2, v]); }
    if (pts.length > 1) {
      const tv = pts.map(p => p[1]); let tlo = Math.min(...tv, 0) - 1, thi = Math.max(...tv, 0) + 1; const ty = v => y1 - (v - tlo) / (thi - tlo) * (ph - 4), z = ty(0);
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${ty(p[1]).toFixed(1)}`).join('');
      g.push(`<clipPath id="tw-${el.id}"><rect x="${L}" y="${y0}" width="${pw}" height="${z - y0}"/></clipPath><clipPath id="tc-${el.id}"><rect x="${L}" y="${z}" width="${pw}" height="${y1 - z}"/></clipPath>`);
      g.push(`<line class="zero" x1="${L}" x2="${L + pw}" y1="${z}" y2="${z}"/><path class="temp warm" d="${d}" clip-path="url(#tw-${el.id})"/><path class="temp cold" d="${d}" clip-path="url(#tc-${el.id})"/>`);
      for (const v of ticks(tlo, thi, 4).out) g.push(`<text class="ax tax" x="${L + pw + 6}" y="${ty(v) + 3.5}">${neg(String(v))}°</text>`);
    }
  }
  // now line
  if (NOW > from && NOW < to) g.push(`<line class="nowl" x1="${sx(NOW)}" x2="${sx(NOW)}" y1="${y0 - 4}" y2="${y1}"/>`);
  // day summaries
  if (showDays) for (const d of agg(from, to, DAY)) {
    const a = Math.max(sx(d.t), L), b = Math.min(sx(d.end), L + pw); if (b - a < 60) continue;
    g.push(`<text class="dsum${d.kind === 'est' ? ' est' : ''}" x="${(a + b) / 2}" y="${y0 - 10}" text-anchor="middle">${b - a >= 128 ? `⌀ ${f2(d.avg)} · max ${f2(d.hi)}` : `⌀ ${f1(d.avg)}`}</text>`);
  }
  // x axis
  const xs = [H, 2 * H, 3 * H, 6 * H, 12 * H, DAY, 2 * DAY, 7 * DAY, 14 * DAY, 'month'].find(s => s === 'month' || span / s * 54 <= pw);
  const ay = y1 + 15;
  if (xs === 'month') { for (let t = bstart(from, 'month'); t < to; t = bend(t, 'month')) if (t >= from) g.push(`<text class="ax" x="${sx(t)}" y="${ay}" text-anchor="middle">${MON[new Date(t).getUTCMonth()]}</text>`); }
  else for (let t = Math.ceil(from / xs) * xs; t < to; t += xs) {
    if (xs === 7 * DAY || xs === 14 * DAY) { /* align to Mondays */ }
    const mid = t % DAY === 0;
    if (xs < DAY) {
      g.push(`<text class="ax" x="${sx(t)}" y="${ay}" text-anchor="middle">${hm(t)}</text>`);
      if (mid && !compact) g.push(`<text class="ax day" x="${sx(t)}" y="${ay + 14}" text-anchor="middle">${wd(t)} ${dmy(t)}</text>`);
    } else g.push(`<text class="ax" x="${sx(t)}" y="${ay}" text-anchor="middle">${xs >= 7 * DAY ? dmy(t) : `${compact ? '' : wd(t) + ' '}${new Date(t).getUTCDate()}`}</text>`);
  }
  // weather row
  if (wxH) {
    const ws = [H, 2 * H, 3 * H, 6 * H, 12 * H, DAY, 7 * DAY].find(s => s >= Math.min(step, DAY) && span / s * 26 <= pw) || 7 * DAY, yy = y1 + axH;
    for (let t = bstart(from, ws); t < to; t += ws) {
      const w = wx(Math.max(t, from), Math.min(t + ws, to)); if (!w) continue; const cx = sx(Math.max(t, from)) + (sx(Math.min(t + ws, to)) - sx(Math.max(t, from))) / 2;
      if (cx < L + 6 || cx > L + pw - 6) continue;
      g.push(`<use class="wxu" href="#i-${w.icon}" x="${cx - 9}" y="${yy}" width="18" height="18"><title>${w.label} · ${f1(w.temp)} °C · ${f1(w.ms)} m/s</title></use>`);
      if (span / ws * 30 <= pw) g.push(`<text class="ax ms" x="${cx}" y="${yy + 32}" text-anchor="middle">${f1(w.ms)}</text>`);
    }
  }
  // wind panel
  if (windH) {
    const ws = step < H ? H : step, pts = []; for (let t = bstart(from, ws); t < to; t += ws) { const v = hourly(wind, t, t + ws); if (!isNaN(v)) pts.push([t + ws / 2, v]); }
    const wy0 = y1 + axH + wxH + 6, wy1 = wy0 + windH - 10, wmax = Math.max(2000, ...pts.map(p => p[1])) * 1.1, wy = v => wy1 - v / wmax * (wy1 - wy0);
    if (pts.length > 1) {
      const line = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${wy(p[1]).toFixed(1)}`).join('');
      g.push(`<line class="gl" x1="${L}" x2="${L + pw}" y1="${wy1}" y2="${wy1}"/><path class="wind-a" d="${line}L${sx(pts.at(-1)[0])},${wy1}L${sx(pts[0][0])},${wy1}Z"/><path class="wind-l" d="${line}"/>`);
      g.push(`<text class="ax" x="${L - 6}" y="${wy0 + 8}" text-anchor="end">${int(Math.round(wmax / 1000) * 1000 / 1000)}k</text><text class="ax wl" x="${L + 4}" y="${wy0 + 8}">Wind power, MW</text>`);
      if (NOW > from && NOW < to) g.push(`<line class="nowl thin" x1="${sx(NOW)}" x2="${sx(NOW)}" y1="${wy0}" y2="${wy1}"/>`);
    }
  }
  g.push(`<rect class="hov" x="0" y="${y0}" width="0" height="${ph}" rx="3"/><rect class="hit" x="${L}" y="0" width="${pw}" height="${Ht}"/>`);
  el.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${W} ${Ht}" width="100%" height="${Ht}" tabindex="0" role="img" aria-label="Price chart, ${dayLabel(from)} to ${dayLabel(to - 1)}">${g.join('')}</svg>`;
  const svg = el.firstChild;
  const api = interact(svg, bk, b => [sx(b.t), sx(b.end)], o);
  return { buckets: bk, step, ...api };
};

// ------------------------------------------------------------------ C · heatmap (one row per day, one cell per hour)
EF.heat = function (el, o = {}) {
  const d0 = dayStart(o.from ?? st.from), d1 = Math.min(dayStart((o.to ?? st.to) - 1) + DAY, EST_END), maxRows = o.maxRows || 62;
  const first = Math.max(d0, d1 - maxRows * DAY), bk = agg(first, d1, H), by = new Map(bk.map(b => [b.t, b]));
  const mids = bk.filter(b => !b.state).map(b => b.avg), mn = Math.min(...mids), mx = Math.max(...mids);
  const cell = b => {
    if (!b) return '<i class="hc none"></i>';
    let bg; const a = b.a;
    if (b.state === 'hi') bg = `color-mix(in oklab, var(--hi) ${Math.round(45 + 45 * clamp((a - S.high) / (S.high * .4), 0, 1))}%, var(--surface))`;
    else if (b.state === 'lo') bg = `color-mix(in oklab, var(--lo) ${Math.round(40 + 45 * clamp((S.low - a) / (S.low * .5), 0, 1))}%, var(--surface))`;
    else bg = `color-mix(in oklab, var(--heat) ${Math.round(6 + 52 * clamp((b.avg - mn) / ((mx - mn) || 1), 0, 1))}%, var(--surface))`;
    return `<button class="hc ${b.kind}${b.now ? ' now' : ''}${b.state ? ' ' + b.state : ''}" style="background:${bg}" data-t="${b.t}" title="${dayLabel(b.t)} ${hm(b.t)}–${hm(b.end)} · ${f2(b.avg)} c/kWh · ${KIND_LABEL[b.kind]}"><span>${f1(b.avg)}</span></button>`;
  };
  let rows = '<div class="hr hh"><span></span>' + Array.from({ length: 24 }, (_, h) => `<span>${h % 3 ? '' : p2(h)}</span>`).join('') + '</div>';
  for (let d = first; d < d1; d += DAY) rows += `<div class="hr${d === TODAY ? ' today' : ''}"><span class="hd">${wd(d)} <b>${new Date(d).getUTCDate()}</b></span>${Array.from({ length: 24 }, (_, h) => cell(by.get(d + h * H))).join('')}</div>`;
  el.innerHTML = `<div class="heat${el.clientWidth < 620 ? ' small' : ''}">${rows}</div>`;
  el.onclick = e => { const c = e.target.closest('[data-t]'); if (c && o.onPick) o.onPick(by.get(+c.dataset.t)); };
};

// ------------------------------------------------------------------ D · cheapest hours from now on
EF.ladder = function (el, o = {}) {
  const pts = agg(bstart(NOW, H), PUB_END, H), sorted = [...pts].sort((a, b) => a.avg - b.avg), mx = Math.max(...pts.map(p => p.avg)), mn = Math.min(0, ...pts.map(p => p.avg));
  el.innerHTML = `<ol class="ladder">${sorted.map((p, i) => `<li class="${p.state}${p.now ? ' now' : ''}" data-t="${p.t}"><span class="rk">${i + 1}</span><span class="tm">${rel(p.t)} ${hm(p.t)}${p.now ? ' <em>now</em>' : ''}</span><span class="br"><i class="${barClass(p)}" style="width:${(Math.max(.02, (p.avg - mn) / (mx - mn)) * 100).toFixed(1)}%"></i></span><b>${f2(p.avg)}</b></li>`).join('')}</ol>`;
  el.onclick = e => { const r = e.target.closest('[data-t]'); if (r && o.onPick) o.onPick(pts.find(p => p.t === +r.dataset.t)); };
};

// ------------------------------------------------------------------ E · typical day
EF.typical = function (el, o = {}) {
  const from = o.from ?? st.from, to = Math.min(o.to ?? st.to, PUB_END), W = Math.max(280, el.clientWidth), Ht = o.height || Math.round(clamp(W * .34, 200, 300));
  const by = Array.from({ length: 24 }, () => []); for (const b of agg(from, to, H)) by[hourOf(b.t)].push(b.avg);
  const hs = by.map((v, h) => v.length ? { h, avg: v.reduce((a, b) => a + b) / v.length, lo: Math.min(...v), hi: Math.max(...v), n: v.length } : { h, n: 0 });
  const lo = Math.min(0, ...hs.filter(x => x.n).map(x => x.lo)), hi = Math.max(...hs.filter(x => x.n).map(x => x.hi)) * 1.08, L = 38, pw = W - L - 8, y1 = Ht - 26, sy = v => y1 - (v - lo) / (hi - lo) * (y1 - 10);
  const best = hs.filter(x => x.n).reduce((a, b) => b.avg < a.avg ? b : a), cw = pw / 24, g = [];
  for (const v of ticks(lo, hi, 4).out) g.push(`<line class="gl" x1="${L}" x2="${L + pw}" y1="${sy(v)}" y2="${sy(v)}"/><text class="ax" x="${L - 6}" y="${sy(v) + 3.5}" text-anchor="end">${v}</text>`);
  for (const x of hs) { if (!x.n) continue; const X = L + x.h * cw;
    g.push(`<rect class="rng b-past" x="${X + 2}" width="${cw - 4}" y="${sy(x.hi)}" height="${sy(x.lo) - sy(x.hi)}" rx="3"/><rect class="bar ${x === best ? 'b-lo' : 'b-past'}" x="${X + cw * .25}" width="${cw * .5}" y="${sy(x.avg)}" height="${sy(lo < 0 ? 0 : lo) - sy(x.avg)}" rx="2"><title>${p2(x.h)}:00 · avg ${f2(x.avg)} · ${f2(x.lo)} – ${f2(x.hi)}</title></rect>`);
    if (x.h % (cw < 22 ? 3 : 1) === 0) g.push(`<text class="ax" x="${X + cw / 2}" y="${y1 + 16}" text-anchor="middle">${p2(x.h)}</text>`); }
  el.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${W} ${Ht}" width="100%" height="${Ht}">${g.join('')}</svg><p class="cap">Average of each hour over the published prices of the period. Cheapest on average: <b>${p2(best.h)}:00–${p2(best.h + 1)}:00</b> at ${f2(best.avg)} c/kWh.</p>`;
};

// ------------------------------------------------------------------ F · calendar of daily averages
EF.calendar = function (el, o = {}) {
  const from = o.from ?? st.from, to = o.to ?? st.to, days = new Map(agg(dayStart(from), Math.min(to, EST_END), DAY).map(d => [d.t, d]));
  const all = [...days.values()].filter(d => !d.state).map(d => d.avg), mn = Math.min(...all), mx = Math.max(...all), out = [];
  for (let m = bstart(from, 'month'); m < to && out.length < 14; m = bend(m, 'month')) {
    const md = new Date(m); let cells = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(x => `<span class="cw">${x}</span>`).join('') + '<span></span>'.repeat((md.getUTCDay() + 6) % 7);
    for (let d = m; d < bend(m, 'month'); d += DAY) { const p = days.get(d);
      if (!p) { cells += `<span class="cd none">${new Date(d).getUTCDate()}</span>`; continue; }
      const bg = p.state === 'hi' ? 'color-mix(in oklab, var(--hi) 70%, var(--surface))' : p.state === 'lo' ? 'color-mix(in oklab, var(--lo) 62%, var(--surface))' : `color-mix(in oklab, var(--heat) ${Math.round(6 + 52 * clamp((p.avg - mn) / ((mx - mn) || 1), 0, 1))}%, var(--surface))`;
      cells += `<button class="cd ${p.kind}${d === TODAY ? ' now' : ''}${p.state ? ' ' + p.state : ''}" style="background:${bg}" data-t="${d}" title="${dayLabel(d)} · avg ${f2(p.avg)} (${f2(p.lo)} – ${f2(p.hi)})"><small>${new Date(d).getUTCDate()}</small>${f1(p.avg)}</button>`; }
    out.push(`<div class="month"><h4>${MONL[md.getUTCMonth()]} ${md.getUTCFullYear()}</h4><div class="calg">${cells}</div></div>`);
  }
  el.innerHTML = `<div class="months">${out.join('')}</div>`;
  el.onclick = e => { const c = e.target.closest('[data-t]'); if (c && o.onPick) o.onPick(days.get(+c.dataset.t)); };
};

// ------------------------------------------------------------------ G · price vs wind
EF.scatter = function (el, o = {}) {
  const from = o.from ?? st.from, to = Math.min(o.to ?? st.to, PUB_END), W = Math.max(280, el.clientWidth), Ht = o.height || Math.round(clamp(W * .45, 220, 360));
  let pts = agg(from, to, H).map(b => [hourly(wind, b.t, b.end), b.avg, b]); const stride = Math.ceil(pts.length / 2200); pts = pts.filter((_, i) => i % stride === 0);
  const n = pts.length, mxw = Math.max(...pts.map(p => p[0])) * 1.05, ys = pts.map(p => p[1]), lo = Math.min(0, ...ys), hi = Math.max(...ys) * 1.06;
  const mX = pts.reduce((s, p) => s + p[0], 0) / n, mY = ys.reduce((s, v) => s + v, 0) / n; let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pts) { sxy += (x - mX) * (y - mY); sxx += (x - mX) ** 2; syy += (y - mY) ** 2; }
  const k = sxy / sxx, c0 = mY - k * mX, r = sxy / Math.sqrt(sxx * syy), L = 40, pw = W - L - 10, y1 = Ht - 30, X = v => L + v / mxw * pw, Y = v => y1 - (v - lo) / (hi - lo) * (y1 - 8), g = [];
  for (const v of ticks(lo, hi, 4).out) g.push(`<line class="gl" x1="${L}" x2="${L + pw}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 6}" y="${Y(v) + 3.5}" text-anchor="end">${v}</text>`);
  for (const v of ticks(0, mxw, 4).out) g.push(`<text class="ax" x="${X(v)}" y="${y1 + 16}" text-anchor="middle">${int(v)}</text>`);
  g.push(`<text class="ax" x="${L + pw}" y="${y1 + 28}" text-anchor="end">Wind power, MW</text>`);
  for (const [x, y, b] of pts) g.push(`<circle class="dot ${barClass(b)}" cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="${n > 900 ? 1.8 : 2.6}"/>`);
  g.push(`<line class="trend" x1="${X(0)}" y1="${Y(c0)}" x2="${X(mxw)}" y2="${Y(c0 + k * mxw)}"/>`);
  el.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${W} ${Ht}" width="100%" height="${Ht}">${g.join('')}</svg><p class="cap">${n} hours. Correlation r = <b>${neg(r.toFixed(2))}</b>: ${Math.abs(r) > .5 ? 'strong' : Math.abs(r) > .3 ? 'moderate' : 'weak'} link, ${r < 0 ? 'more wind, lower price' : 'no clear wind effect'}. Each 1,000 MW changes the price by about ${f2(k * 1000)} c/kWh.</p>`;
};

// ------------------------------------------------------------------ Estimate vs actual
EF.compare = function (el, o = {}) {
  const from = Math.max(o.from ?? st.from, TODAY - 90 * DAY), to = Math.min(o.to ?? st.to, PUB_END), W = Math.max(280, el.clientWidth), Ht = o.height || Math.round(clamp(W * .36, 200, 320));
  const step = (to - from) / H * 3 > W ? ((to - from) / DAY * 5 > W ? DAY : 6 * H) : H;
  const act = agg(from, to, step), est = agg(from, to, step, i => isNaN(estPast[i]) ? NaN : value(B + i * Q, estPast[i], st.mode, st.vat));
  const pairs = act.map((b, i) => [b.t + (b.end - b.t) / 2, b.avg, est[i]?.avg]).filter(p => !isNaN(p[2]));
  if (!pairs.length) { el.innerHTML = '<p class="empty">No estimates stored for this period (kept 90 days).</p>'; return; }
  const all = pairs.flatMap(p => [p[1], p[2]]), lo = Math.min(0, ...all), hi = Math.max(...all) * 1.08, L = 38, pw = W - L - 10, y1 = Ht - 26;
  const X = t => L + (t - from) / (to - from) * pw, Y = v => y1 - (v - lo) / (hi - lo) * (y1 - 8), g = [];
  for (const v of ticks(lo, hi, 4).out) g.push(`<line class="gl" x1="${L}" x2="${L + pw}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 6}" y="${Y(v) + 3.5}" text-anchor="end">${v}</text>`);
  const xs = [6 * H, 12 * H, DAY, 2 * DAY, 7 * DAY, 14 * DAY].find(s => (to - from) / s * 60 <= pw) || 30 * DAY;
  for (let t = Math.ceil(from / xs) * xs; t < to; t += xs) g.push(`<text class="ax" x="${X(t)}" y="${y1 + 16}" text-anchor="middle">${xs < DAY ? hm(t) : dmy(t)}</text>`);
  const path = k => pairs.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[k]).toFixed(1)}`).join('');
  g.push(`<path class="cmp-est" d="${path(2)}"/><path class="cmp-act" d="${path(1)}"/>`);
  const mae = pairs.reduce((s, p) => s + Math.abs(p[2] - p[1]), 0) / pairs.length, bias = pairs.reduce((s, p) => s + p[2] - p[1], 0) / pairs.length;
  el.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${W} ${Ht}" width="100%" height="${Ht}">${g.join('')}</svg><p class="cap"><span class="key"><i class="k-past"></i>Actual price</span> <span class="key"><i class="k-est dash"></i>Estimate made before publication</span> · Average error <b>${f2(mae)} c/kWh</b>, the estimate was ${bias > 0 ? 'high' : 'low'} by ${f2(Math.abs(bias))} on average.</p>`;
};

// ------------------------------------------------------------------ Table (Grid View)
const RES = [['15 min', Q], ['30 min', 2 * Q], ['1 h', H], ['2 h', 2 * H], ['3 h', 3 * H], ['6 h', 6 * H], ['12 h', 12 * H], ['1 day', DAY], ['1 week', 7 * DAY], ['1 month', 'month'], ['1 year', 'year']];
EF.RES = RES;
EF.table = function (el, o = {}) {
  const res = o.res ?? H, from = o.from ?? st.from, to = o.to ?? st.to;
  const rows = agg(from, to, res), max = 400, show = rows.slice(0, max);
  const spotV = b => value(b.t, b.spot, 'spot', st.vat), totV = b => b.avg + (st.mode === 'spot' ? value(b.t, b.spot, 'total', st.vat) - value(b.t, b.spot, 'spot', st.vat) : 0);
  const when = b => res === 'year' ? new Date(b.t).getUTCFullYear() : res === 'month' ? `${MONL[new Date(b.t).getUTCMonth()]} ${new Date(b.t).getUTCFullYear()}` : res >= DAY ? dayLabel(b.t) : `${dayLabel(b.t)} <span class="t">${hm(b.t)}</span>`;
  const cellP = (v, b, on) => `<td class="num${on && b.state ? ' st-' + b.state : ''}${on ? ' basis' : ''}">${on && b.state ? (b.state === 'hi' ? '▲ ' : '▼ ') : ''}${f2(v)}</td>`;
  const body = show.map((b, i) => { const w = wx(b.t, b.end);
    return `<tr class="k-${b.kind}${b.now ? ' now' : ''}" data-t="${b.t}"><td class="rn">${i + 1}</td><td>${when(b)}</td>${cellP(spotV(b), b, st.mode === 'spot')}${cellP(totV(b), b, st.mode === 'total')}<td class="num w">${int(hourly(wind, b.t, b.end))}</td><td class="num ${w && w.temp < 0 ? 'cold' : 'warm'}">${w ? f1(w.temp) : '–'}</td><td class="num">${w ? f1(w.ms) : '–'}</td><td class="wxc">${w ? EF.icon(w.icon) + ' ' + w.label : ''}</td><td class="stc">${b.kind === 'past' ? 'Published' : b.kind === 'fix' ? 'Fixed' : 'Estimate'}</td></tr>`; }).join('');
  el.innerHTML = `<div class="tblwrap" tabindex="0"><table class="tbl"><thead><tr><th class="rn">#</th><th>Time</th><th class="num">Spot</th><th class="num">Total</th><th class="num">Wind MW</th><th class="num">°C</th><th class="num">m/s</th><th>Weather</th><th>Status</th></tr></thead><tbody>${body}</tbody></table></div>` +
    `<p class="cap">${rows.length} rows of ${RES.find(r => r[1] === res)[0]} · c/kWh ${st.vat ? 'incl.' : 'excl.'} VAT${rows.length > max ? ` · showing the first ${max}, export for all` : ''}. Drag to select cells, then copy or export.</p>`;
};

// ------------------------------------------------------------------ Usage (consumption) chart
EF.usage = function (el, o = {}) {
  const from = Math.max(o.from ?? CONS_FROM, CONS_FROM), to = Math.min(o.to ?? CONS_TO, CONS_TO), W = Math.max(280, el.clientWidth), Ht = o.height || Math.round(clamp(W * .34, 200, 320));
  const step = (to - from) / H * 4 <= W - 60 ? H : DAY, bk = agg(from, to, step);
  const rows = bk.map(b => ({ b, kwh: hourlySum(cons, b.t, b.end) })).filter(r => !isNaN(r.kwh));
  const L = 38, R = 40, pw = W - L - R, y1 = Ht - 26, mk = Math.max(...rows.map(r => r.kwh)) * 1.1, mp = Math.max(...rows.map(r => r.b.avg)) * 1.1;
  const X = t => L + (t - from) / (to - from) * pw, Y = v => y1 - v / mk * (y1 - 8), YP = v => y1 - Math.max(0, v) / mp * (y1 - 8), g = [];
  for (const v of ticks(0, mk, 4).out) g.push(`<line class="gl" x1="${L}" x2="${L + pw}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 6}" y="${Y(v) + 3.5}" text-anchor="end">${v}</text>`);
  for (const v of ticks(0, mp, 4).out) g.push(`<text class="ax tax" x="${L + pw + 6}" y="${YP(v) + 3.5}">${v}</text>`);
  for (const r of rows) { const x0 = X(r.b.t), w = X(r.b.end) - x0; g.push(`<rect class="ubar" x="${x0 + (w > 4 ? .75 : 0)}" width="${Math.max(.5, w - (w > 4 ? 1.5 : 0))}" y="${Y(r.kwh)}" height="${y1 - Y(r.kwh)}" rx="${w > 6 ? 2 : 0}"><title>${dayLabel(r.b.t)}${step < DAY ? ' ' + hm(r.b.t) : ''} · ${r.kwh.toFixed(2)} kWh · ${f2(r.b.avg)} c/kWh · ${eur(r.kwh * r.b.avg / 100)}</title></rect>`); }
  g.push(`<path class="uprice" d="${rows.map((r, i) => `${i ? 'L' : 'M'}${(X(r.b.t) + (X(r.b.end) - X(r.b.t)) / 2).toFixed(1)},${YP(r.b.avg).toFixed(1)}`).join('')}"/>`);
  const xs = [DAY, 2 * DAY, 7 * DAY, 14 * DAY].find(s => (to - from) / s * 56 <= pw) || 28 * DAY;
  for (let t = Math.ceil(from / xs) * xs; t < to; t += xs) g.push(`<text class="ax" x="${X(t)}" y="${y1 + 16}" text-anchor="middle">${dmy(t)}</text>`);
  el.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${W} ${Ht}" width="100%" height="${Ht}">${g.join('')}</svg>`;
  const kwh = rows.reduce((s, r) => s + r.kwh, 0), cost = rows.reduce((s, r) => s + r.kwh * r.b.avg, 0) / 100, plain = rows.reduce((s, r) => s + r.b.avg, 0) / rows.length, paid = cost * 100 / kwh;
  return { kwh, cost, plain, paid, timing: cost - kwh * plain / 100 };
};

// ------------------------------------------------------------------ 24 h price dial (concept C)
EF.dial = function (el, o = {}) {
  const day = o.day ?? TODAY, S0 = Math.min(el.clientWidth, o.max || 420), R = S0 / 2, cx = R, cy = R, r0 = R * .5, r1 = R * .94;
  const bk = agg(day, day + DAY, Q), vs = bk.map(b => b.avg), lo = Math.min(0, ...vs), hi = Math.max(...vs), g = [];
  g.push(`<circle class="dial-bg" cx="${cx}" cy="${cy}" r="${(r0 + r1) / 2}" stroke-width="${r1 - r0}"/>`);
  bk.forEach((b, k) => {
    const a0 = (k / 96) * 2 * Math.PI - Math.PI / 2 + .008, a1 = ((k + 1) / 96) * 2 * Math.PI - Math.PI / 2 - .008, len = r0 + 4 + (r1 - r0 - 4) * clamp((b.avg - lo) / (hi - lo), .04, 1);
    const P = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
    g.push(`<path class="wedge ${barClass(b)}${b.passed ? ' passed' : ''}" data-k="${k}" d="M${P(r0, a0)}L${P(len, a0)}A${len},${len} 0 0 1 ${P(len, a1)}L${P(r0, a1)}A${r0},${r0} 0 0 0 ${P(r0, a0)}Z"/>`);
  });
  for (let h = 0; h < 24; h += 3) { const a = h / 24 * 2 * Math.PI - Math.PI / 2; g.push(`<text class="ax dial-h" x="${cx + (r0 - 13) * Math.cos(a)}" y="${cy + (r0 - 13) * Math.sin(a) + 3.5}" text-anchor="middle">${p2(h)}</text>`); }
  if (NOW >= day && NOW < day + DAY) { const a = (NOW - day) / DAY * 2 * Math.PI - Math.PI / 2; g.push(`<line class="hand" x1="${cx + (r0 - 2) * Math.cos(a)}" y1="${cy + (r0 - 2) * Math.sin(a)}" x2="${cx + (R - 1) * Math.cos(a)}" y2="${cy + (R - 1) * Math.sin(a)}"/><circle class="hand-dot" cx="${cx + (R - 3) * Math.cos(a)}" cy="${cy + (R - 3) * Math.sin(a)}" r="3.5"/>`); }
  el.innerHTML = `<svg class="dial" viewBox="0 0 ${S0} ${S0}" width="${S0}" height="${S0}" role="img" aria-label="Prices of ${dayLabel(day)} around the clock">${g.join('')}</svg>`;
  const svg = el.firstChild;
  const pick = ev => { const r = svg.getBoundingClientRect(), x = ev.clientX - r.left - r.width / 2, y = ev.clientY - r.top - r.height / 2, d = Math.hypot(x, y) / (r.width / 2);
    if (d < .45 || d > 1.02) return null; let a = Math.atan2(y, x) + Math.PI / 2; if (a < 0) a += 2 * Math.PI; return bk[Math.floor(a / (2 * Math.PI) * 96)]; };
  svg.addEventListener('pointermove', ev => { const b = pick(ev); svg.querySelectorAll('.wedge.on').forEach(w => w.classList.remove('on')); if (b) { svg.querySelector(`[data-k="${bk.indexOf(b)}"]`).classList.add('on'); o.onHover && o.onHover(b); } });
  svg.addEventListener('pointerleave', () => { svg.querySelectorAll('.wedge.on').forEach(w => w.classList.remove('on')); o.onLeave && o.onLeave(); });
  svg.addEventListener('click', ev => { const b = pick(ev); if (b && o.onPick) o.onPick(b); });
  return { buckets: bk };
};

// ------------------------------------------------------------------ sparkline
EF.spark = (vals, w = 96, h = 28, cls = 'spark') => {
  const lo = Math.min(...vals), hi = Math.max(...vals), X = i => i / (vals.length - 1) * (w - 4) + 2, Y = v => h - 3 - (v - lo) / ((hi - lo) || 1) * (h - 6);
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path class="sp-a" d="${d}L${X(vals.length - 1)},${h}L${X(0)},${h}Z"/><path class="sp-l" d="${d}"/><circle class="sp-e" cx="${X(vals.length - 1)}" cy="${Y(vals.at(-1))}" r="2.2"/></svg>`;
};

// ================================================================== shared UI
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
EF.$ = $; EF.$$ = $$;

EF.toast = msg => { let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2600); };

// sheet: bottom sheet on a phone, a centred panel (or a side panel) on wider screens
EF.sheet = (title, html, opt = {}) => {
  EF.closeSheet();
  const w = document.createElement('div'); w.className = 'sheet-wrap' + (opt.side ? ' side' : '');
  w.innerHTML = `<div class="scrim" data-close></div><section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header class="sheet-h"><span class="grab"></span><h2>${title}</h2><button class="icon-btn" data-close aria-label="Close">${X_ICON}</button></header><div class="sheet-b">${html}</div></section>`;
  document.body.append(w); requestAnimationFrame(() => w.classList.add('on'));
  w.addEventListener('click', e => { if (e.target.closest('[data-close]')) EF.closeSheet(); });
  $('.sheet .icon-btn', w).focus();
  return $('.sheet-b', w);
};
EF.closeSheet = () => $$('.sheet-wrap').forEach(w => { w.classList.remove('on'); setTimeout(() => w.remove(), 220); });
addEventListener('keydown', e => { if (e.key === 'Escape') EF.closeSheet(); });
const X_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
EF.X_ICON = X_ICON;

// line icons for navigation and buttons
const ic = d => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
EF.ICON = {
  now: ic('<path d="M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z"/>'),
  explore: ic('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  usage: ic('<path d="M12 3v3M5.6 5.6l2 2M3 12h3M18 12h3M16.4 7.6l2-2"/><path d="M12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12z"/><path d="M12 15l2.5-2.5"/>'),
  alerts: ic('<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16z"/><path d="M10 21h4"/>'),
  settings: ic('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'),
  layers: ic('<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>'),
  download: ic('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  upload: ic('<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>'),
  refresh: ic('<path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4"/>'),
  plus: ic('<path d="M12 5v14M5 12h14"/>'),
  minus: ic('<path d="M5 12h14"/>'),
  reset: ic('<path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4"/>'),
  user: ic('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  chev: ic('<path d="M9 6l6 6-6 6"/>'),
  copy: ic('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  info: ic('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
  send: ic('<path d="M21 3L10 14M21 3l-7 18-4-7-7-4 18-7z"/>'),
  menu: ic('<path d="M4 7h16M4 12h16M4 17h16"/>'),
};
EF.NAV = [['now', 'Now'], ['explore', 'Explore'], ['usage', 'Usage'], ['alerts', 'Alerts'], ['settings', 'Settings']];

// price basis: one control for the whole app (Spot / Total cost, incl. VAT)
EF.basisControl = () => `<div class="basis"><div class="seg" role="group" aria-label="Price shown"><button type="button" data-mode="spot" aria-pressed="${st.mode === 'spot'}">Spot</button><button type="button" data-mode="total" aria-pressed="${st.mode === 'total'}">Total cost</button></div><label class="switch"><input type="checkbox" data-vat ${st.vat ? 'checked' : ''}><span class="tr"></span>Incl. VAT</label></div>`;
document.addEventListener('click', e => { const b = e.target.closest('.basis [data-mode]'); if (b) { EF.set({ mode: b.dataset.mode }); $$('.basis [data-mode]').forEach(x => x.setAttribute('aria-pressed', x.dataset.mode === st.mode)); } });
document.addEventListener('change', e => { if (e.target.matches('.basis [data-vat]')) { EF.set({ vat: e.target.checked }); $$('.basis [data-vat]').forEach(x => x.checked = st.vat); } });
EF.basisPill = () => `<button type="button" class="basis-pill" data-act="basis" aria-label="Price shown: ${EF.basisLabel()}. Change">${EF.basisLabel()}</button>`;
document.addEventListener('click', e => { if (e.target.closest('[data-act="basis"]')) EF.sheet('Price shown', `${EF.basisControl()}<p class="note">Applies to every number and chart. Alerts keep their own basis (${EF.alarmBasisLabel()}), so the red and green colours do not change with this choice.</p>`); });
EF.on('change', p => { if ('mode' in p || 'vat' in p) $$('.basis-pill').forEach(b => b.textContent = EF.basisLabel()); });

// price breakdown of a picked slot or bucket
EF.breakdown = b => {
  const p = parts(b.t, b.spot), exT = p.spotEx + (p.total - p.spotEx - p.vatOnSpot) / p.k;
  const segs = [['Spot', p.spotEx, 'c1'], ['VAT on spot', p.vatOnSpot, 'c2'], ['Margin', p.margin + p.other, 'c3'], [`Transfer · ${p.night ? 'night' : 'day'}`, p.transferFee, 'c4'], ['Electricity tax', p.tax, 'c5'], ['Monthly fees per kWh', p.monthly, 'c6']].filter(s => Math.abs(s[1]) > 1e-6);
  const pos = segs.reduce((s, x) => s + Math.max(0, x[1]), 0);
  return `<div class="bd"><p class="bd-when">${dayLabel(b.t)} · ${hm(b.t)}–${hm(b.end)} <span class="tag k-${b.kind}">${KIND_LABEL[b.kind]}</span></p>
    <p class="bd-total"><span class="num">${f2(p.total)}</span> <small>c/kWh incl. VAT</small></p>
    <div class="stack" aria-hidden="true">${segs.filter(s => s[1] > 0).map(s => `<i class="${s[2]}" style="flex:${(s[1] / pos).toFixed(4)}"></i>`).join('')}</div>
    <dl class="kv">${segs.map(s => `<div><dt><i class="dotk ${s[2]}"></i>${s[0]}</dt><dd class="num">${f2(s[1])}</dd></div>`).join('')}<div class="sum"><dt>Total incl. VAT</dt><dd class="num">${f2(p.total)}</dd></div><div class="muted"><dt>Total excl. VAT</dt><dd class="num">${f2(exT)}</dd></div></dl></div>`;
};
EF.showBreakdown = b => EF.sheet('Price breakdown', EF.breakdown(b));

// readout text for a hovered bucket
EF.readout = b => { if (!b) return ''; const w = wx(b.t, b.end);
  return `<span class="ro-t">${rel(b.t)} ${hm(b.t)}–${hm(b.end)}</span><span class="ro-p num">${f2(b.avg)} <small>c/kWh</small></span><span class="ro-k tag k-${b.kind}">${KIND_LABEL[b.kind]}</span>${w ? `<span class="ro-w">${EF.icon(w.icon)} ${f1(w.temp)} °C · ${f1(w.ms)} m/s · ${int(w.wind)} MW</span>` : ''}`; };

// what would it cost?
const PRESETS = [['Sauna', 6, 1], ['Dishwasher', 1.2, 2], ['Washing machine', 1, 2], ['Car charging', 20, 4]];
EF.planner = (el, opt = {}) => {
  const id = el.id || (el.id = 'pl' + Math.random().toString(36).slice(2, 7));
  el.innerHTML = `<div class="planner"><div class="chips pl-pre" role="group" aria-label="Device">${PRESETS.map(([n, k, h], i) => `<button type="button" class="chip" data-k="${k}" data-h="${h}" aria-pressed="${i === (opt.preset ?? 1)}">${n}</button>`).join('')}</div>
    <div class="pl-in"><label class="field">Energy<span class="in"><input type="number" id="${id}-k" step="0.1" min="0" inputmode="decimal" value="${PRESETS[opt.preset ?? 1][1]}"><em>kWh</em></span></label>
    <label class="field">Run time<select id="${id}-h">${[[.25, '15 min'], [.5, '30 min'], [1, '1 h'], [1.5, '1.5 h'], [2, '2 h'], [3, '3 h'], [4, '4 h'], [6, '6 h'], [8, '8 h']].map(([v, l]) => `<option value="${v}"${v === PRESETS[opt.preset ?? 1][2] ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <div class="pl-out" aria-live="polite"></div></div>`;
  const out = $('.pl-out', el), K = $(`#${id}-k`), Hs = $(`#${id}-h`);
  const draw = () => { const r = EF.plan(+K.value, +Hs.value);
    out.innerHTML = !r ? `<p class="note">Not enough published prices from now on for this run time. Tomorrow's prices come around 14:00.</p>` :
      `<div class="pl-best"><span class="lbl">Best start</span><b class="num">${rel(r.best.t)} ${hm(r.best.t)}</b><span class="num">${eur(r.best.cost)}</span></div>
       <div class="pl-cmp"><div><span class="lbl">Start now</span><b class="num">${eur(r.now.cost)}</b></div><div><span class="lbl">Worst start · ${hm(r.worst.t)}</span><b class="num">${eur(r.worst.cost)}</b></div><div><span class="lbl">Waiting saves</span><b class="num save">${eur(r.save)}</b></div></div>`; };
  el.addEventListener('click', e => { const b = e.target.closest('.pl-pre .chip'); if (!b) return; $$('.pl-pre .chip', el).forEach(c => c.setAttribute('aria-pressed', c === b)); K.value = b.dataset.k; Hs.value = b.dataset.h; draw(); });
  K.oninput = Hs.onchange = () => { $$('.pl-pre .chip', el).forEach(c => c.setAttribute('aria-pressed', 'false')); draw(); };
  EF.on('change', p => ('mode' in p || 'vat' in p) && draw());
  draw();
};

// export sheet (the ⬇ Export dialog)
EF.exportSheet = () => {
  const b = EF.sheet('Export prices', `<div class="seg wide" role="group" aria-label="Period" id="exK">${['Year', 'Month', 'Week', 'Day', 'Custom'].map((x, i) => `<button type="button" aria-pressed="${i === 1}">${x}</button>`).join('')}</div>
    <div class="form2"><label class="field">Year<select><option>2026</option><option>2025</option></select></label><label class="field">Month<select>${MONL.map((m, i) => `<option${i === 9 ? ' selected' : ''}>${m}</option>`).join('')}</select></label>
    <label class="field">Rows<select><option>15 min</option><option selected>1 h</option><option>1 day</option></select></label><label class="switch"><input type="checkbox" checked><span class="tr"></span>Prices incl. VAT</label></div>
    <p class="note">October 2026 · 744 rows · spot, total cost, wind, temperature, wind m/s, weather and status on every row.</p>
    <div class="actions"><button class="btn" data-dl>${EF.ICON.download}CSV</button><button class="btn primary" data-dl>${EF.ICON.download}Excel</button></div>`);
  b.addEventListener('click', e => { const k = e.target.closest('#exK button'); if (k) $$('#exK button', b).forEach(x => x.setAttribute('aria-pressed', x === k)); if (e.target.closest('[data-dl]')) { EF.closeSheet(); EF.toast('Mockup: the file would download now'); } });
};

// ------------------------------------------------------------------ Explore: every view of the prices
const LENSES = [
  ['bars', 'Bars', '15-minute prices, coloured by your limits'], ['hourly', 'Hourly range', 'Hourly average with the low–high range'],
  ['heat', 'Heatmap', 'One row per day, one cell per hour'], ['ladder', 'Cheapest hours', 'Published hours from now, cheapest first'],
  ['typical', 'Typical day', 'Average price of each hour of the day'], ['calendar', 'Calendar', 'Daily averages by week'],
  ['scatter', 'Price vs wind', 'How wind power moves the price'], ['compare', 'Estimate vs actual', 'How good the forecast was'],
  ['table', 'Table', 'Every value, to copy or export']];
EF.LENSES = LENSES;
const PRESET = [['3d', '−3 … +2 d', 3], ['7', 'Week', 7], ['30', 'Month', 30], ['91', '3 months', 91], ['365', 'Year', 365]];
const rangeOf = k => { const p = PRESET.find(x => x[0] === k); return p ? { from: TODAY - p[2] * DAY, to: TODAY + 3 * DAY } : null; };
EF.explore = (el, opt = {}) => {
  el.innerHTML = `<div class="explore ${opt.layout || 'rail'}">
    <nav class="lenses" aria-label="Views">${LENSES.map(([k, n, d]) => `<button type="button" data-lens="${k}" aria-pressed="${st.lens === k}"><span class="ln">${n}</span><span class="ld">${d}</span></button>`).join('')}</nav>
    <section class="ex-main">
      <div class="ex-tb">
        <div class="seg" role="group" aria-label="Period" id="exP">${PRESET.map(([k, n]) => `<button type="button" data-p="${k}" aria-pressed="${st.preset === k}">${n}</button>`).join('')}<button type="button" data-p="custom" aria-pressed="${st.preset === 'custom'}">Custom</button></div>
        <div class="ex-dates" ${st.preset === 'custom' ? '' : 'hidden'}><label class="field inline">From<input type="date" id="exFrom" value="2026-10-01"></label><label class="field inline">To<input type="date" id="exTo" value="2026-10-17"></label></div>
        <span class="sp"></span>
        <div class="zoom" role="group" aria-label="Zoom"><button class="icon-btn" data-z="out" aria-label="Zoom out">${EF.ICON.minus}</button><button class="icon-btn" data-z="in" aria-label="Zoom in">${EF.ICON.plus}</button><button class="icon-btn" data-z="reset" aria-label="Reset view">${EF.ICON.reset}</button></div>
        <button type="button" class="btn ghost" data-act="layers">${EF.ICON.layers}<span>Layers</span></button>
        <button type="button" class="btn ghost" data-act="export">${EF.ICON.download}<span>Export</span></button>
      </div>
      <div class="ex-head"><div><h2 id="exTitle"></h2><p class="ex-sub" id="exSub"></p></div><label class="switch"><input type="checkbox" id="exAvg" ${st.avg ? 'checked' : ''}><span class="tr"></span>Average</label></div>
      <div class="readout" id="exRo" aria-live="polite"></div>
      <div class="ex-chart" id="exChart"></div>
      <div class="ex-foot" id="exFoot"></div>
    </section></div>`;
  let res = H, hover = null;
  const draw = () => {
    const [k, n] = LENSES.find(l => l[0] === st.lens);
    $('#exTitle', el).textContent = n;
    $$('[data-lens]', el).forEach(x => x.setAttribute('aria-pressed', x.dataset.lens === k));
    $('#exSub', el).textContent = st.lens === 'ladder' ? 'From now until the end of the published prices · does not depend on the period' :
      `${dayLabel(st.from)} – ${dayLabel(st.to - 1)} · ${EF.basisLabel()}`;
    const c = $('#exChart', el), pick = b => b && EF.showBreakdown(b), ro = $('#exRo', el);
    ro.hidden = !(['bars', 'hourly'].includes(k) && st.layers.readout);
    $('.zoom', el).hidden = !['bars', 'hourly', 'heat', 'table'].includes(k);
    const roNow = () => { ro.innerHTML = EF.readout(agg(CUR, CUR + Q, Q)[0]); };
    if (k === 'bars' || k === 'hourly') { roNow(); EF.bars(c, { hourly: k === 'hourly', onHover: b => ro.innerHTML = EF.readout(b), onLeave: roNow, onPick: pick,
      onPan: (f, d) => { const sp = d.to - d.from, sh = Math.round(f * sp / Q) * Q; EF.set({ from: d.from + sh, to: d.to + sh, preset: 'custom-pan' }); },
      onZoom: z => zoom(z) }); }
    else if (k === 'heat') EF.heat(c, { onPick: pick });
    else if (k === 'ladder') EF.ladder(c, { onPick: pick });
    else if (k === 'typical') EF.typical(c);
    else if (k === 'calendar') EF.calendar(c, { onPick: d => { EF.set({ lens: 'bars', from: d.t, to: d.t + DAY, preset: 'custom' }); } });
    else if (k === 'scatter') EF.scatter(c);
    else if (k === 'compare') EF.compare(c);
    else if (k === 'table') { c.innerHTML = `<div class="tbl-tb"><label class="field inline">Rows<select id="exRes">${RES.map(([l, v]) => `<option value="${v}"${v === res ? ' selected' : ''}>${l}</option>`).join('')}</select></label><span class="sp"></span><button class="btn ghost" data-tb="copy">${EF.ICON.copy}<span>Copy</span></button><button class="btn ghost" data-tb="csv">${EF.ICON.download}<span>CSV</span></button><button class="btn ghost" data-tb="xlsx">${EF.ICON.download}<span>Excel</span></button></div><div id="exTbl"></div>`;
      EF.table($('#exTbl', c), { res }); $('#exRes', c).onchange = e => { res = isNaN(+e.target.value) ? e.target.value : +e.target.value; draw(); }; }
    $('#exFoot', el).innerHTML = ['bars', 'hourly', 'heat', 'calendar', 'ladder'].includes(k) ? EF.legend() : '';
  };
  const zoom = z => { const c = (st.from + st.to) / 2, sp = clamp((st.to - st.from) * z, 6 * H, 400 * DAY); EF.set({ from: Math.round((c - sp / 2) / Q) * Q, to: Math.round((c + sp / 2) / Q) * Q, preset: 'custom-zoom' }); };
  el.addEventListener('click', e => {
    const l = e.target.closest('[data-lens]'); if (l) { EF.set({ lens: l.dataset.lens }); $$('[data-lens]', el).forEach(x => x.setAttribute('aria-pressed', x === l)); }
    const p = e.target.closest('#exP [data-p]'); if (p) { $$('#exP [data-p]', el).forEach(x => x.setAttribute('aria-pressed', x === p)); $('.ex-dates', el).hidden = p.dataset.p !== 'custom';
      EF.set(p.dataset.p === 'custom' ? { preset: 'custom', from: Date.UTC(2026, 9, 1), to: Date.UTC(2026, 9, 18) } : { preset: p.dataset.p, ...rangeOf(p.dataset.p) }); }
    const z = e.target.closest('[data-z]'); if (z) { if (z.dataset.z === 'reset') { EF.set({ preset: '3d', yz: 1, ...rangeOf('3d') }); $$('#exP [data-p]', el).forEach(x => x.setAttribute('aria-pressed', x.dataset.p === '3d')); } else if (st.lens === 'table') { const i = RES.findIndex(r => r[1] === res); res = RES[clamp(i + (z.dataset.z === 'in' ? -1 : 1), 0, RES.length - 1)][1]; draw(); } else zoom(z.dataset.z === 'in' ? .6 : 1.6); }
    if (e.target.closest('[data-act="layers"]')) EF.layersSheet();
    if (e.target.closest('[data-act="export"]')) EF.exportSheet();
    const tb = e.target.closest('[data-tb]'); if (tb) EF.toast(tb.dataset.tb === 'copy' ? 'Mockup: the selected cells would be copied' : 'Mockup: the file would download now');
  });
  $('#exAvg', el).onchange = e => EF.set({ avg: e.target.checked });
  EF.on('change', () => draw());
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(draw, 150); });
  draw();
  return { draw };
};
EF.legend = () => `<div class="legend"><span class="key"><i class="k-past"></i>Published</span><span class="key"><i class="k-fix"></i>Fixed, still to come</span><span class="key"><i class="k-est"></i>Estimate</span><span class="key"><i class="k-hi"></i>At or above ${S.high} ▲</span><span class="key"><i class="k-lo"></i>At or below ${S.low} ▼</span><span class="key"><i class="k-band"></i>Cheapest 3 h</span></div>`;
EF.layersSheet = () => {
  const L = st.layers, row = (k, n, d) => `<label class="row"><span><b>${n}</b><small>${d}</small></span><span class="switch"><input type="checkbox" data-l="${k}" ${L[k] ? 'checked' : ''}><span class="tr"></span></span></label>`;
  const b = EF.sheet('Layers', `<div class="list">${row('wind', 'Wind power', 'Its own panel under the prices, MW')}${row('temp', 'Temperature', 'Dotted curve, warm above 0 °C and cold below')}${row('wx', 'Weather', 'Icons and wind m/s under the time axis, for ' + S.place)}${row('readout', 'Readout line', 'Time, price and weather of the point under your finger')}</div>
    <div class="row"><span><b>Price scale</b><small>Zoom the price axis</small></span><span class="zoom"><button class="icon-btn" data-yz="-" aria-label="Zoom price out">${EF.ICON.minus}</button><button class="icon-btn" data-yz="+" aria-label="Zoom price in">${EF.ICON.plus}</button></span></div>`);
  b.addEventListener('change', e => { const k = e.target.dataset.l; if (k) EF.set({ layers: { ...st.layers, [k]: e.target.checked } }); });
  b.addEventListener('click', e => { const z = e.target.closest('[data-yz]'); if (z) EF.set({ yz: clamp(st.yz * (z.dataset.yz === '+' ? 1.5 : 1 / 1.5), 1, 8) }); });
};

// ------------------------------------------------------------------ Usage page
EF.usagePage = el => {
  el.innerHTML = `<div class="usage">
    <div class="u-tb"><div class="seg" role="group" aria-label="Period" id="uP"><button type="button" data-d="7" aria-pressed="false">Week</button><button type="button" data-d="30" aria-pressed="true">Month</button><button type="button" data-d="75" aria-pressed="false">All</button></div><span class="sp"></span>
      <label class="btn">${EF.ICON.upload}<span>Import file</span><input type="file" class="vh" accept=".xlsx,.xls,.csv,.txt"></label><button type="button" class="btn ghost danger" data-act="udel">Delete imported</button></div>
    <div class="u-kpis" id="uK"></div>
    <div class="u-chart" id="uC"></div>
    <div class="legend"><span class="key"><i class="k-use"></i>Your use, kWh</span><span class="key"><i class="k-line"></i>Price, c/kWh (right axis)</span></div>
    <details class="help"><summary>Where do I get the file?</summary><p><b>Oomi:</b> OmaOomi → Kulutus → pick the address and the period → <b>Lataa (.xls)</b>, and import that file as it is. <b>Any company:</b> download hourly or 15-minute consumption as CSV from Fingrid's <a href="https://oma.datahub.fi" target="_blank" rel="noopener">Oma Datahub</a> (bank ID). Other Excel or CSV exports work too. Importing the same period again replaces it.</p></details>
    <p class="note">Sample data: 1 Aug – 14 Oct 2026, a household with a sauna on Saturdays and night-time car charging.</p></div>`;
  let days = 30;
  const draw = () => { const r = EF.usage($('#uC', el), { from: CONS_TO - days * DAY, to: CONS_TO });
    $('#uK', el).innerHTML = `<div><span class="lbl">Used</span><b class="num">${int(r.kwh)} <small>kWh</small></b></div><div><span class="lbl">Cost</span><b class="num">${eur(r.cost)}</b></div><div><span class="lbl">You paid on average</span><b class="num">${f2(r.paid)} <small>c/kWh</small></b><span class="sub">plain average ${f2(r.plain)}</span></div><div><span class="lbl">Timing</span><b class="num ${r.timing < 0 ? 'good' : 'bad'}">${r.timing < 0 ? 'saved ' : 'cost '}${eur(Math.abs(r.timing))}</b><span class="sub">against using evenly</span></div>`; };
  el.addEventListener('click', e => { const p = e.target.closest('#uP [data-d]'); if (p) { $$('#uP [data-d]', el).forEach(x => x.setAttribute('aria-pressed', x === p)); days = +p.dataset.d; draw(); } if (e.target.closest('[data-act="udel"]')) EF.toast('Mockup: asks to confirm, then deletes the imported readings'); });
  EF.on('change', p => ('mode' in p || 'vat' in p) && draw());
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(draw, 150); });
  draw();
};

// ------------------------------------------------------------------ Alerts page
const RECIPS = [{ name: 'Sami', phone: '+358 40 123 4567', key: '••••19', email: 'sami@example.fi', test: true }, { name: 'Laura', phone: '+358 50 765 4321', key: '••••52', email: '', test: false }];
EF.messagePreview = () => {
  const bk = agg(TODAY + 14 * H, TODAY + 38 * H, H), vs = bk.map(b => b.a), mn = Math.min(...vs), mx = Math.max(...vs), av = vs.reduce((a, b) => a + b) / vs.length;
  const hiB = bk.filter(b => b.state === 'hi'), loB = bk.filter(b => b.state === 'lo');
  const run = arr => { if (!arr.length) return null; let e = arr[0]; for (const b of arr.slice(1)) { if (b.t !== e.end) break; e = b; } return { s: arr[0], e }; };
  const lh = run(hiB), ll = run(loB), lines = [];
  lines.push(`<b>Electricity prices Thu 15.10. 14:00 – Fri 16.10. 14:00</b>`, `Average ${f2(av)} · lowest ${f2(mn)} (${hm(bk[vs.indexOf(mn)].t)}) · highest ${f2(mx)} (${hm(bk[vs.indexOf(mx)].t)}) c/kWh, ${EF.alarmBasisLabel()}`);
  if (lh) lines.push(`⬆️ Above ${S.high} c/kWh: ${wd(lh.s.t)} ${hm(lh.s.t)}–${hm(lh.e.end)}, highest ${f2(Math.max(...hiB.map(b => b.a)))}`);
  if (ll) lines.push(`⬇️ Below ${S.low} c/kWh: ${wd(ll.s.t)} ${hm(ll.s.t)}–${hm(ll.e.end)}, lowest ${f2(Math.min(...loB.map(b => b.a)))}`);
  lines.push('', bk.slice(0, 8).map(b => `${b.state ? (b.state === 'hi' ? '▲ ' : '▼ ') : ''}${hm(b.t)} ${b.state ? '<b>' + f2(b.a) + '</b>' : f2(b.a)}`).join('<br>') + '<br>…');
  return lines.join('<br>');
};
EF.alertsPage = el => {
  const r = RECIPS;
  el.innerHTML = `<div class="alerts">
    <div class="status ok"><span class="dot"></span><div><b>Today's 14:00 message was delivered</b><small>14:02 · 2 recipients · WhatsApp and email · next: tomorrow 07:30</small></div></div>
    <section class="group"><h3>Price limits</h3>
      <div class="row lim"><span class="switch"><input type="checkbox" checked aria-label="High price alert on"><span class="tr"></span></span><span class="grow"><b>High price</b><small>Bars turn red and ▲ marks the hours at or above</small></span><span class="in"><input type="number" value="${S.high}" step="0.1" inputmode="decimal" aria-label="High limit"><em>c/kWh</em></span></div>
      <div class="row lim"><span class="switch"><input type="checkbox" checked aria-label="Low price alert on"><span class="tr"></span></span><span class="grow"><b>Low price</b><small>Bars turn green and ▼ marks the hours at or below</small></span><span class="in"><input type="number" value="${S.low}" step="0.1" inputmode="decimal" aria-label="Low limit"><em>c/kWh</em></span></div>
      <div class="row"><span class="grow"><b>Compare on</b><small>Kept separate from the price shown, so the colours stay put</small></span><div class="seg"><button type="button" aria-pressed="true">Total cost</button><button type="button" aria-pressed="false">Spot</button></div><label class="switch"><input type="checkbox" checked><span class="tr"></span>VAT</label></div>
    </section>
    <section class="group"><h3>Schedule</h3>
      <div class="row"><span class="grow"><b>Daily at 14:00</b><small>Fixed prices from 14:00 to 14:00 tomorrow, sent as soon as Nord Pool publishes them</small></span><span class="pill">Always on</span></div>
      <div class="row"><span class="grow"><b>Extra times</b><small>Up to 3. Before 14:00 the hours after midnight are estimates, marked ~</small></span><div class="chips">${S.extra_times.filter(Boolean).map(t => `<span class="chip on">${t}<button type="button" aria-label="Remove ${t}">${X_ICON}</button></span>`).join('')}<button type="button" class="chip add">${EF.ICON.plus}Add time</button></div></div>
    </section>
    <section class="group"><h3>Channels</h3>
      <label class="row"><span class="grow"><b>WhatsApp</b><small>To every recipient with a phone and CallMeBot key · ${r.filter(x => x.phone).length} now</small></span><span class="switch"><input type="checkbox" checked><span class="tr"></span></span></label>
      <label class="row"><span class="grow"><b>Email</b><small>To every recipient with an address · ${r.filter(x => x.email).length} now · through your email server</small></span><span class="switch"><input type="checkbox" checked><span class="tr"></span></span></label>
    </section>
    <section class="group"><h3>Recipients <small>everyone gets every scheduled message</small></h3>
      ${r.map(x => `<button type="button" class="row person" data-act="recip"><span class="av">${x.name[0]}</span><span class="grow"><b>${x.name}</b><small>${[x.phone && 'WhatsApp ' + x.phone, x.email && x.email].filter(Boolean).join(' · ')}</small></span><span class="chev">${EF.ICON.chev}</span></button>`).join('')}
      <button type="button" class="row add" data-act="recip">${EF.ICON.plus}<span>Add recipient</span></button>
    </section>
    <section class="group"><h3>Message</h3>
      <div class="bubble">${EF.messagePreview()}</div>
      <div class="actions"><button type="button" class="btn" data-act="msg">Customize text</button><span class="sp"></span><button type="button" class="btn ghost" data-act="test">${EF.ICON.send}<span>Send test</span></button></div>
    </section></div>`;
  el.addEventListener('click', e => {
    if (e.target.closest('[data-act="recip"]')) EF.sheet('Recipient', `<div class="form1"><label class="field">Name<input value="Sami"></label><label class="field">WhatsApp number<input value="+358 40 123 4567" inputmode="tel"></label><label class="field">CallMeBot key<input value="1234519"></label><label class="field">Email<input value="sami@example.fi" inputmode="email"></label><label class="switch"><input type="checkbox" checked><span class="tr"></span>Include in tests</label></div><p class="note">To get a key, send “I allow callmebot to send me messages” to +34 644 51 95 23 on WhatsApp.</p><div class="actions"><button class="btn ghost danger">Remove</button><span class="sp"></span><button class="btn primary" data-close>Done</button></div>`);
    if (e.target.closest('[data-act="msg"]')) EF.sheet('Message text', `<div class="form1"><label class="field">Summary (first line is bold)<textarea rows="3">Electricity prices {from} – {to}\nAverage {avg} · lowest {min} ({min_time}) · highest {max} ({max_time}) c/kWh, {basis}</textarea></label><label class="field">Line for a high period<textarea rows="2">⬆️ Above {limit} c/kWh: {weekday} {date} {time}–{end} ({duration}), highest {price}</textarea></label><label class="field">Line for a low period<textarea rows="2">⬇️ Below {limit} c/kWh: {weekday} {date} {time}–{end} ({duration}), lowest {price}</textarea></label></div><p class="note">Placeholders: {price} {avg} {weekday} {date} {time} {end} {duration} {limit} {basis} · summary also {from} {to} {min} {min_time} {max} {max_time}</p><div class="bubble">${EF.messagePreview()}</div><div class="actions"><button class="btn ghost">Restore defaults</button><span class="sp"></span><button class="btn primary" data-close>Save</button></div>`);
    if (e.target.closest('[data-act="test"]')) EF.sheet('Send a test', `<div class="list">${r.map(x => `<label class="row"><span class="grow"><b>${x.name}</b><small>${[x.phone, x.email].filter(Boolean).join(' · ')}</small></span><span class="switch"><input type="checkbox" ${x.test ? 'checked' : ''}><span class="tr"></span></span></label>`).join('')}</div><div class="actions"><button class="btn" data-close data-sent>WhatsApp</button><button class="btn primary" data-close data-sent>Email</button></div>`).addEventListener('click', ev => ev.target.closest('[data-sent]') && EF.toast('Mockup: test sent to 1 recipient'));
  });
};

// ------------------------------------------------------------------ Settings page
const SWATCH = [['', 'Auto'], ['#000000', 'Black'], ['#1f2937', 'Charcoal'], ['#64748b', 'Slate'], ['#1e3a8a', 'Navy'], ['#2563eb', 'Blue'], ['#0284c7', 'Sky'], ['#92400e', 'Brown'], ['#ca8a04', 'Gold']];
const PLACES = ['Helsinki', 'Espoo', 'Tampere', 'Vantaa', 'Oulu', 'Turku', 'Jyväskylä', 'Kuopio', 'Lahti', 'Pori', 'Rovaniemi', 'Vaasa', 'Joensuu', 'Inari'];
EF.SETTINGS_SECTIONS = [['costs', 'Costs'], ['monthly', 'Monthly fees'], ['weather', 'Weather place'], ['look', 'Appearance'], ['email', 'Email server'], ['users', 'Users'], ['account', 'Account']];
EF.settingsPage = el => {
  const num = (l, v, u, id) => `<label class="field">${l}<span class="in"><input type="number" id="${id}" value="${v}" step="0.01" inputmode="decimal"><em>${u}</em></span></label>`;
  el.innerHTML = `<div class="settings">
    <section class="group" id="set-costs"><h3>Costs <small>c/kWh incl. VAT · saved as you type</small></h3><div class="form3">
      ${num('Provider margin', S.margin, 'c', 'sMargin')}${num('Transfer, day', S.transfer_day, 'c', 'sTd')}${num('Transfer, night', S.transfer_night, 'c', 'sTn')}
      <label class="field">Night hours<span class="in two"><input type="number" value="${S.night_start}" aria-label="Night starts">–<input type="number" value="${S.night_end}" aria-label="Night ends"></span></label>
      ${num('Electricity tax + supply fee', S.tax, 'c', 'sTax')}${num('Other per kWh', S.other, 'c', 'sOther')}${num('VAT', S.vat, '%', 'sVat')}</div></section>
    <section class="group" id="set-monthly"><h3>Monthly fees <small>€ per month</small></h3><div class="form3">${num('Provider', S.monthly_provider, '€', 'sMp')}${num('Transfer', S.monthly_transfer, '€', 'sMt')}${num('Monthly use', S.monthly_kwh, 'kWh', 'sMk')}</div>
      <label class="row"><span class="grow"><b>Spread into the price per kWh</b><small>Adds ${f2((S.monthly_provider + S.monthly_transfer) * 100 / S.monthly_kwh)} c/kWh to the total cost · fixed €${(S.monthly_provider + S.monthly_transfer).toFixed(2)} a month</small></span><span class="switch"><input type="checkbox"><span class="tr"></span></span></label></section>
    <section class="group" id="set-weather"><h3>Weather place <small>for the icons, temperature and wind m/s</small></h3><label class="field">Town or village in Finland<input type="search" id="sPlace" placeholder="e.g. Tampere" autocomplete="off" value=""></label><div class="chips places" id="sPlaces">${PLACES.slice(0, 6).map(p => `<button type="button" class="chip" aria-pressed="${p === S.place}">${p}</button>`).join('')}</div><p class="note">Data: <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a>. A year of weather is loaded for the new place.</p></section>
    <section class="group" id="set-look"><h3>Appearance</h3><div class="row"><span class="grow"><b>Theme</b></span><div class="seg" id="sTheme"><button type="button" data-th="" aria-pressed="true">System</button><button type="button" data-th="light" aria-pressed="false">Light</button><button type="button" data-th="dark" aria-pressed="false">Dark</button></div></div>
      <div class="row col"><span class="grow"><b>Published price colour</b><small>Red and green stay reserved for your limits</small></span><div class="swatches">${SWATCH.map(([c, n]) => `<button type="button" class="sw-b" data-c="${c}" aria-pressed="${c === S.price_color}" title="${n}"><i style="${c ? 'background:' + c : ''}"></i><span>${n}</span></button>`).join('')}<label class="sw-b custom"><input type="color" value="#1f2937" aria-label="Custom colour"><span>Custom</span></label></div></div></section>
    <section class="group" id="set-email"><h3>Email server <small>SMTP relay</small></h3><div class="form3"><label class="field">Server<input value="smtp.example.fi"></label><label class="field">Port<input type="number" value="587"></label><label class="field">Security<select><option>STARTTLS</option><option>SSL</option></select></label><label class="field">Username<input value="alerts@example.fi"></label><label class="field">Password<input type="password" placeholder="Saved · leave empty to keep"></label><label class="field">From<input value="Electricity Finland"></label></div><div class="actions"><button type="button" class="btn ghost" data-act="smtptest">${EF.ICON.send}<span>Send a test email</span></button></div></section>
    <section class="group" id="set-users"><h3>Users <small>admin only</small></h3>
      ${['sami · admin', 'laura', 'mökki'].map(u => `<div class="row person"><span class="av">${u[0].toUpperCase()}</span><span class="grow"><b>${u.split(' · ')[0]}</b><small>${u.includes('admin') ? 'Admin · you' : 'Own recipients, alerts and costs'}</small></span>${u.includes('admin') ? '' : '<button type="button" class="btn ghost sm">Reset password</button><button type="button" class="btn ghost sm danger">Remove</button>'}</div>`).join('')}
      <div class="adduser"><input placeholder="New username" aria-label="New username" autocapitalize="none"><input placeholder="Temporary password" aria-label="Temporary password"><button type="button" class="btn">Add user</button></div></section>
    <section class="group" id="set-account"><h3>Account</h3><button type="button" class="row" data-act="pw"><span class="grow"><b>Username and password</b><small>Signed in as sami</small></span><span class="chev">${EF.ICON.chev}</span></button><div class="row"><span class="grow"><b>Data</b><small>Published prices until Fri 16 Oct 23:45 · Fingrid on · updated 15:02</small></span><button type="button" class="btn ghost sm" data-act="refresh">${EF.ICON.refresh}<span>Refresh</span></button></div><button type="button" class="row danger" data-act="logout"><span class="grow"><b>Log out</b></span></button></section></div>`;
  el.addEventListener('click', e => {
    const th = e.target.closest('#sTheme [data-th]'); if (th) { $$('#sTheme [data-th]', el).forEach(x => x.setAttribute('aria-pressed', x === th)); th.dataset.th ? document.documentElement.setAttribute('data-theme', th.dataset.th) : document.documentElement.removeAttribute('data-theme'); EF.emit('change', { theme: 1 }); }
    const sw = e.target.closest('.sw-b[data-c]'); if (sw) { $$('.sw-b', el).forEach(x => x.setAttribute('aria-pressed', x === sw)); document.documentElement.style.setProperty('--past-user', sw.dataset.c || ''); sw.dataset.c ? document.documentElement.style.setProperty('--past', sw.dataset.c) : document.documentElement.style.removeProperty('--past'); EF.toast('Saved'); }
    const pl = e.target.closest('#sPlaces .chip'); if (pl) { $$('#sPlaces .chip', el).forEach(x => x.setAttribute('aria-pressed', x === pl)); S.place = pl.textContent; EF.toast(`Weather place: ${S.place}`); }
    if (e.target.closest('[data-act="smtptest"]')) EF.toast('Mockup: test email sent to the selected recipients');
    if (e.target.closest('[data-act="refresh"]')) EF.toast('Prices refreshed · published until Fri 23:45');
    if (e.target.closest('[data-act="logout"]')) EF.toast('Mockup: would log out');
    if (e.target.closest('[data-act="pw"]')) EF.sheet('Username and password', `<div class="form1"><label class="field">Current password<input type="password"></label><label class="field">Username<input value="sami" autocapitalize="none"></label><label class="field">New password<input type="password" placeholder="At least 8 characters"></label><label class="field">Repeat new password<input type="password"></label></div><div class="actions"><span class="sp"></span><button class="btn primary" data-close>Save</button></div>`);
  });
  $('#sPlace', el).oninput = e => { const q = e.target.value.toLowerCase(); $('#sPlaces', el).innerHTML = PLACES.filter(p => p.toLowerCase().startsWith(q)).slice(0, 6).map(p => `<button type="button" class="chip" aria-pressed="${p === S.place}">${p}</button>`).join('') || '<span class="note">No place in Finland with that name.</span>'; };
  el.addEventListener('input', e => { if (e.target.id === 'sTd') { S.transfer_day = +e.target.value; EF.emit('change', { costs: 1 }); } if (e.target.id === 'sMargin') { S.margin = +e.target.value; EF.emit('change', { costs: 1 }); } });
};

// ------------------------------------------------------------------ simple router used by every concept: #now, #explore …
EF.router = (render, initial = 'now') => {
  const go = () => { const v = (location.hash || '#' + initial).slice(1).split('/')[0]; const valid = EF.NAV.some(n => n[0] === v) ? v : initial;
    $$('[data-nav]').forEach(a => a.setAttribute('aria-current', a.dataset.nav === valid ? 'page' : 'false')); render(valid); };
  addEventListener('hashchange', go); go();
};

// ------------------------------------------------------------------ review bar (only for the mockups)
EF.review = cur => {
  const b = document.createElement('div'); b.className = 'review';
  b.innerHTML = `<a href="index.html" class="rv-home">UI mockups</a><nav>${[['a-calm.html', 'A · Calm'], ['b-studio.html', 'B · Studio'], ['c-signal.html', 'C · Signal']].map(([h, n]) => `<a href="${h}"${h.startsWith(cur) ? ' aria-current="page"' : ''}>${n}</a>`).join('')}</nav><span class="rv-note">Example data · now is Thu 15 Oct 15:10</span>`;
  document.body.prepend(b);
  document.body.insertAdjacentHTML('beforeend', ICONS);
};
})();
