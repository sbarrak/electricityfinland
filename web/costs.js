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
  msg_summary: '📅 Prices {from} – {to}: avg {avg}, min {min} at {min_time}, max {max} at {max_time} c/kWh ({basis})',
};
const TEMPLATE_FIELDS = {
  alarm: ['price', 'avg', 'weekday', 'date', 'time', 'end', 'duration', 'limit', 'basis'],
  summary: ['from', 'to', 'avg', 'min', 'min_time', 'max', 'max_time', 'basis'],
};
const fillTemplate = (tpl, f) => String(tpl).replace(/\{(\w+)\}/g, (m, k) => k in f ? f[k] : m);
const durationText = sec => { const m = Math.round(sec / 60), h = Math.floor(m / 60), r = m % 60; return h && r ? `${h} h ${r} min` : h ? `${h} h` : `${r} min`; };
const hhmm = ts => new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const alarmBasis = s => `${s.alarm_basis === 'spot' ? 'spot' : 'total cost'} ${s.alarm_vat ? 'incl.' : 'excl.'} VAT`;

function windowFields(s, kind, w) {
  const ps = w.ps.map(x => x[0]), d = new Date(w.start * 1000);
  return { price: (kind === 'high' ? Math.max(...ps) : Math.min(...ps)).toFixed(2),
    avg: (w.ps.reduce((a, [p, n]) => a + p * n, 0) / w.ps.reduce((a, [, n]) => a + n, 0)).toFixed(2),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()], date: `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`,
    time: hhmm(w.start), end: hhmm(w.end), duration: durationText(w.end - w.start), limit: s[kind], basis: alarmBasis(s) };
}
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const daystamp = ts => { const d = new Date(ts * 1000); return `${WEEKDAYS[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}. ${hhmm(ts)}`; };

// Daily message for the fixed prices a..b (seconds): summary line + one line per crossing.
// High: price goes from below the limit to >= limit. Low: from above the limit to <= limit.
// rows: [[ts, spot]] sorted, starting before a. Mirrors daily_message() in app/main.py.
function dailyMessage(s, rows, a, b) {
  const pts = rows.map(([t, v], i) => [t, priceValue(s, t, v, s.alarm_basis, s.alarm_vat), i + 1 < rows.length ? Math.min(3600, rows[i + 1][0] - t) : 900]);
  const hit = { high: p => p >= s.high, low: p => p <= s.low }, lines = [];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][0] < a || pts[i][0] >= b) continue;
    for (const kind of ['high', 'low']) {
      if (!s[kind + '_on'] || !hit[kind](pts[i][1]) || hit[kind](pts[i - 1][1])) continue;
      let j = i; const ps = [];
      while (j < pts.length && hit[kind](pts[j][1])) { ps.push([pts[j][1], pts[j][2]]); j++; }
      const end = j < pts.length ? pts[j][0] : pts.at(-1)[0] + pts.at(-1)[2];
      lines.push([pts[i][0], fillTemplate(s['msg_' + kind], windowFields(s, kind, { start: pts[i][0], end, ps }))]);
    }
  }
  const out = [], day = pts.filter(p => p[0] >= a && p[0] < b);
  if (s.summary_on && day.length) {
    const lo = day.reduce((x, y) => y[1] < x[1] ? y : x), hi = day.reduce((x, y) => y[1] > x[1] ? y : x);
    const avg = day.reduce((t, p) => t + p[1] * p[2], 0) / day.reduce((t, p) => t + p[2], 0), d0 = windowFields(s, 'high', { start: a, end: a, ps: [[0, 1]] });
    out.push(fillTemplate(s.msg_summary, { from: daystamp(a), to: daystamp(b), avg: avg.toFixed(2), min: lo[1].toFixed(2), min_time: daystamp(lo[0]),
      max: hi[1].toFixed(2), max_time: daystamp(hi[0]), basis: alarmBasis(s), weekday: d0.weekday, date: d0.date }));
    if ((s.high_on || s.low_on) && !lines.length) out.push('No crossings of your limits.');
  }
  return [...out, ...lines.sort((x, y) => x[0] - y[0]).map(l => l[1])].join('\n');
}
