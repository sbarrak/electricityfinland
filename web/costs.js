// Price calculation and alarm messages shared by app.js and local.js. Mirrors app/main.py.
// spot: c/kWh excl. VAT. Fee settings are c/kWh incl. VAT, monthly fees in EUR.

// All parts of the price of one slot, c/kWh incl. VAT (spotEx excl. VAT).
function priceParts(s, ts, spot) {
  const k = 1 + s.vat / 100, h = new Date(ts * 1000).getHours(), ns = s.night_start, ne = s.night_end;
  const night = ns > ne ? (h >= ns || h < ne) : (ns <= h && h < ne);
  const per = s.spread_monthly && s.monthly_kwh > 0 ? 100 / s.monthly_kwh : 0;
  const spotIn = spot > 0 ? spot * k : spot;
  const p = { spotEx: spot, vatOnSpot: spotIn - spot, margin: s.margin, other: s.other, night,
    transferFee: night ? s.transfer_night : s.transfer_day, tax: s.tax,
    monthly: (s.monthly_provider + s.monthly_transfer) * per, k };
  p.transfer = p.transferFee + p.tax + s.monthly_transfer * per;
  p.total = spotIn + p.margin + p.other + p.transferFee + p.tax + p.monthly;
  return p;
}

// kind: 'spot' | 'transfer' (transfer fee + electricity tax) | 'total'
function priceValue(s, ts, spot, kind, vat) {
  const p = priceParts(s, ts, spot), f = vat ? 1 : 1 / p.k;
  if (kind === 'spot') return vat ? p.spotEx + p.vatOnSpot : p.spotEx;
  if (kind === 'transfer') return p.transfer * f;
  return (vat ? p.spotEx + p.vatOnSpot : p.spotEx) + (p.total - p.spotEx - p.vatOnSpot) * f;
}

// Message templates: {name} placeholders, unknown ones are left as written. Defaults as in app/main.py.
const MSG_DEFAULTS = {
  msg_high: '🔴 High price {price} c/kWh · {weekday} {date} {time}–{end} ({duration}) · limit {limit}',
  msg_low: '🟢 Low price {price} c/kWh · {weekday} {date} {time}–{end} ({duration}) · limit {limit}',
  msg_summary: '📅 Tomorrow {weekday} {date}: avg {avg}, min {min} at {min_time}, max {max} at {max_time} c/kWh ({basis})',
};
const TEMPLATE_FIELDS = {
  alarm: ['price', 'avg', 'weekday', 'date', 'time', 'end', 'duration', 'limit', 'basis'],
  summary: ['weekday', 'date', 'avg', 'min', 'min_time', 'max', 'max_time', 'basis'],
};
const fillTemplate = (tpl, f) => String(tpl).replace(/\{(\w+)\}/g, (m, k) => k in f ? f[k] : m);
const durationText = sec => { const m = Math.round(sec / 60), h = Math.floor(m / 60), r = m % 60; return h && r ? `${h} h ${r} min` : h ? `${h} h` : `${r} min`; };
const hhmm = ts => new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const alarmBasis = s => `${s.alarm_basis === 'spot' ? 'spot' : 'total cost'} ${s.alarm_vat ? 'incl.' : 'excl.'} VAT`;

// Contiguous periods of published prices (not ended yet) above the high / below the low limit.
// rows: [[ts, spot]] sorted by ts.
function priceWindows(s, rows, kind, now = Date.now() / 1000) {
  const out = []; let cur = null;
  rows.forEach(([t, v], i) => {
    const step = i + 1 < rows.length ? Math.min(3600, rows[i + 1][0] - t) : 900;
    const p = priceValue(s, t, v, s.alarm_basis, s.alarm_vat);
    if (t + step <= now || !(kind === 'high' ? p >= s.high : p <= s.low)) { cur = null; return; }
    if (cur && cur.end === t) { cur.end = t + step; cur.ps.push([p, step]); }
    else { cur = { start: t, end: t + step, ps: [[p, step]] }; out.push(cur); }
  });
  return out;
}
function windowFields(s, kind, w) {
  const ps = w.ps.map(x => x[0]), d = new Date(w.start * 1000);
  return { price: (kind === 'high' ? Math.max(...ps) : Math.min(...ps)).toFixed(2),
    avg: (w.ps.reduce((a, [p, n]) => a + p * n, 0) / w.ps.reduce((a, [, n]) => a + n, 0)).toFixed(2),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()], date: `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`,
    time: hhmm(w.start), end: hhmm(w.end), duration: durationText(w.end - w.start), limit: s[kind], basis: alarmBasis(s) };
}
