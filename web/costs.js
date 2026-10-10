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
  msg_high: '▲ Above {limit} c/kWh: {weekday} {date} {time}–{end} ({duration}), highest {price}',
  msg_low: '▼ Below {limit} c/kWh: {weekday} {date} {time}–{end} ({duration}), lowest {price}',
  msg_summary: 'Electricity prices {from} – {to}\nAverage {avg} · lowest {min} ({min_time}) · highest {max} ({max_time}) c/kWh, {basis}',
};
const OLD_MSGS = {  // earlier default texts: a saved copy of one of them is replaced by the new default
  msg_high: ['🔴 High price {price} c/kWh · {weekday} {date} {time}–{end} ({duration}) · limit {limit}'],
  msg_low: ['🟢 Low price {price} c/kWh · {weekday} {date} {time}–{end} ({duration}) · limit {limit}'],
  msg_summary: ['📅 Prices {from} – {to}: avg {avg}, min {min} at {min_time}, max {max} at {max_time} c/kWh ({basis})'],
};
const TEMPLATE_FIELDS = {
  alarm: ['price', 'avg', 'weekday', 'date', 'time', 'end', 'duration', 'limit', 'basis'],
  summary: ['from', 'to', 'avg', 'min', 'min_time', 'max', 'max_time', 'basis', 'weekday', 'date'],
};
const fillTemplate = (tpl, f) => String(tpl).replace(/\{(\w+)\}/g, (m, k) => k in f ? f[k] : m);
const durationText = sec => { const m = Math.round(sec / 60), h = Math.floor(m / 60), r = m % 60; return h && r ? `${h} h ${r} min` : h ? `${h} h` : `${r} min`; };
const hhmm = ts => new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const alarmBasis = s => `${s.alarm_basis === 'spot' ? 'spot' : 'total cost'} ${s.alarm_vat ? 'incl.' : 'excl.'} VAT`;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const p2 = n => String(n).padStart(2, '0');
const dayName = ts => { const d = new Date(ts * 1000); return `${WEEKDAYS[d.getDay()]} ${p2(d.getDate())}.${p2(d.getMonth() + 1)}.`; };
const daystamp = ts => `${dayName(ts)} ${hhmm(ts)}`;

function windowFields(s, kind, w) {
  const ps = w.ps.map(x => x[0]), d = new Date(w.start * 1000);
  return { price: (kind === 'high' ? Math.max(...ps) : Math.min(...ps)).toFixed(2),
    avg: (w.ps.reduce((a, [p, n]) => a + p * n, 0) / w.ps.reduce((a, [, n]) => a + n, 0)).toFixed(2),
    weekday: WEEKDAYS[d.getDay()], date: `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.`,
    time: hhmm(w.start), end: hhmm(w.end), duration: durationText(w.end - w.start), limit: s[kind], basis: alarmBasis(s) };
}

// round half up to d decimals; float noise is cleaned first so the result equals rnd() in app/main.py
const rnd = (x, d) => Math.floor(+x.toFixed(9) * 10 ** d + 0.5) / 10 ** d;

// Hourly prices for a..b (seconds): [{t, end, p}] average per clock hour on the alarm basis, 2 decimals.
// rows: [[ts, spot]] sorted. A part hour at either end of the window stays a part hour. Mirrors hourly() in app/main.py.
function hourlyPrices(s, rows, a, b) {
  const acc = new Map();
  rows.forEach(([t, v], i) => {
    const step = i + 1 < rows.length ? Math.min(3600, rows[i + 1][0] - t) : 900, lo = Math.max(t, a), hi = Math.min(t + step, b);
    if (hi <= lo) return;
    const k = Math.floor(lo / 3600);
    if (!acc.has(k)) acc.set(k, { t: lo, end: hi, sum: 0 });
    const h = acc.get(k);
    h.t = Math.min(h.t, lo); h.end = Math.max(h.end, hi); h.sum += rnd(priceValue(s, t, v, s.alarm_basis, s.alarm_vat), 3) * (hi - lo);
  });
  return [...acc.entries()].sort((x, y) => x[0] - y[0]).map(([, h]) => ({ t: h.t, end: h.end, p: rnd(h.sum / (h.end - h.t), 2) }));
}

// The message for the prices a..b: a summary, one line for every period at or above the high limit / at or below the low
// limit (also one that began before a), and the hourly prices with those hours marked. Returns null without prices.
// Returns {subject, wa (WhatsApp, *bold*), text (plain)}. Mirrors compose() in app/main.py.
function composeMessage(s, rows, a, b, { test = false, note = '' } = {}) {
  const hours = hourlyPrices(s, rows, a, b);
  if (!hours.length) return null;
  const hit = { high: p => p >= s.high, low: p => p <= s.low }, MARK = { high: '▲', low: '▼' };
  hours.forEach(h => h.flag = ['high', 'low'].find(k => s[k + '_on'] && hit[k](h.p)) || null);
  const spans = [];
  hours.forEach((h, i) => {
    if (!h.flag || (i && hours[i - 1].flag === h.flag && hours[i - 1].end === h.t)) return;
    let j = i;
    while (j + 1 < hours.length && hours[j + 1].flag === h.flag && hours[j + 1].t === hours[j].end) j++;
    const ps = hours.slice(i, j + 1).map(x => [x.p, x.end - x.t]);
    spans.push([h.t, h.flag, fillTemplate(s['msg_' + h.flag], windowFields(s, h.flag, { start: h.t, end: hours[j].end, ps }))]);
  });
  const sections = [];
  if (test) sections.push([['title', 'TEST MESSAGE'], ['text', 'Example of the scheduled message, with the prices from now on.']]);
  if (s.summary_on) {
    const tot = hours.reduce((n, h) => n + h.end - h.t, 0), lo = hours.reduce((x, y) => y.p < x.p ? y : x), hi = hours.reduce((x, y) => y.p > x.p ? y : x);
    const d0 = windowFields(s, 'high', { start: a, end: a, ps: [[0, 1]] });
    const text = fillTemplate(s.msg_summary, { from: daystamp(a), to: daystamp(b), avg: (hours.reduce((n, h) => n + h.p * (h.end - h.t), 0) / tot).toFixed(2),
      min: lo.p.toFixed(2), min_time: daystamp(lo.t), max: hi.p.toFixed(2), max_time: daystamp(hi.t), basis: alarmBasis(s), weekday: d0.weekday, date: d0.date });
    sections.push(text.split('\n').map((ln, i) => [i ? 'text' : 'title', ln]));
  }
  if (spans.length) sections.push(spans.sort((x, y) => x[0] - y[0]).map(([, k, ln]) => ['alert_' + k, ln]));
  else if (s.high_on || s.low_on) {
    const lim = [['high', 'above'], ['low', 'below']].filter(([k]) => s[k + '_on']).map(([k, w]) => `${w} ${s[k]}`);
    sections.push([['text', `No prices ${lim.join(' or ')} c/kWh in this period.`]]);
  }
  if (note) sections.push([['text', note]]);
  const list = [['heading', `Hourly prices, c/kWh (${alarmBasis(s)})`]];
  let day = null;
  for (const h of hours) {
    if (dayName(h.t) !== day) { day = dayName(h.t); list.push(['day', day]); }
    list.push([h.flag ? 'row_' + h.flag : 'row', `${h.flag ? MARK[h.flag] + ' ' : ''}${hhmm(h.t)}  ${h.p.toFixed(2)}`]);
  }
  sections.push(list);
  const bold = new Set(['title', 'alert_high', 'alert_low', 'row_high', 'row_low']);
  return { subject: (test ? '[TEST] ' : '') + `Electricity prices ${dayName(a)}` + (spans.length ? ' · price alert' : ''),
    wa: sections.map(sec => sec.map(([k, t]) => bold.has(k) && t ? `*${t}*` : t).join('\n')).join('\n\n'),
    text: sections.map(sec => sec.map(([, t]) => t).join('\n')).join('\n\n'), alert: spans.length > 0 };
}
