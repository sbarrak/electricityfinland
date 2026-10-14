// Electricity use imported from a file: reading the CSV and pricing each metering interval.
// Works with the CSV from Fingrid's Oma Datahub (oma.datahub.fi, every Finnish provider incl. Oomi) and with most
// spreadsheet exports from a provider's own service: a time column and a kWh column, ; , or tab separated.
const Consumption = (() => {
  const TIME = /alku|start|aika|time|date|päivä|pvm|ajankohta|timestamp|period|jakso/i, END = /loppu|end/i;
  const HOUR = /^(tunti|hour|klo|kellonaika|kello|time|aika)$/i;
  const VALUE = /määrä|quantity|kulutus|consumption|kwh|energia|energy|value|arvo|usage|amount|volume/i;
  const NOT_VALUE = /yksikkö|unit|laatu|quality|tyyppi|type|resoluutio|resolution|tunnus|\bid\b|status|tila|hinta|price|€|eur|snt|cent/i;
  const SERIES = /tuot|product|suunta|direction|flow/i, METER = /mittauspiste|metering|gsrn|käyttöpaikka|point|meter/i;
  const UNIT_COL = /yksikkö|unit/i, USE = /8716867000030|kulutus|consumption|otto|import|use/i;

  function splitLine(line, sep) {  // one CSV line, "quoted" fields may hold the separator
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === sep) { out.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    out.push(cur.trim());
    return out;
  }
  const num = s => {  // "1 234,5" / "1234.5" / "0,123" -> number, anything else -> NaN
    s = String(s ?? '').replace(/[\s ]/g, '');
    if (!/^[-+]?(\d+([.,]\d*)?|[.,]\d+)$/.test(s)) return NaN;
    return +s.replace(',', '.');
  };

  // Finnish wall-clock time -> unix seconds, whatever the time zone of the browser
  const HEL = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Helsinki', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const helOffset = ms => { const p = Object.fromEntries(HEL.formatToParts(ms).map(x => [x.type, x.value]));
    return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(ms / 6e4) * 6e4; };
  function helsinki(y, mo, d, h = 0, mi = 0) {  // in the repeated hour of the autumn DST change: the first one (summer time)
    const wall = Date.UTC(y, mo - 1, d, h, mi), ok = [3, 2].map(o => wall - o * 36e5).filter(t => helOffset(t) === wall - t);
    return (ok.length ? ok[0] : wall - 2 * 36e5) / 1000;
  }

  // a date (and maybe time) as written in the file -> { t: unix s, zoned: had an explicit zone, dateOnly }
  function parseTime(s) {
    s = String(s ?? '').trim().replace(/^klo\s*/i, '');
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2})[:.](\d{2})(?:[:.](\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
    if (m) {
      if (m[7]) return { t: Date.parse(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T${(m[4] || '0').padStart(2, '0')}:${m[5] || '00'}:${m[6] || '00'}${m[7].length === 5 ? m[7].slice(0, 3) + ':' + m[7].slice(3) : m[7]}`) / 1000, zoned: true };
      return { t: helsinki(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0)), dateOnly: m[4] == null };
    }
    m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[\sT,]+(?:klo\s*)?(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?)?$/i);
    if (m) return { t: helsinki(+m[3], +m[2], +m[1], +(m[4] || 0), +(m[5] || 0)), dateOnly: m[4] == null };
    return null;
  }
  const parseHour = s => {  // "13", "13:00", "13-14", "13:00-14:00", "13.00" -> hours (fraction for minutes)
    const m = String(s ?? '').trim().match(/^(\d{1,2})(?:[:.](\d{2}))?/);
    return m && +m[1] < 25 ? +m[1] + (+(m[2] || 0)) / 60 : null;
  };

  // text of a CSV file -> { rows: [[ts, kWh]] (start of each interval, sorted), res: interval in s, notes: [text] }
  function parse(text) {
    const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) throw new Error('the file is empty');
    const sample = lines.slice(0, 20).join('\n');
    const sep = [';', '\t', ','].map(c => [c, sample.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
    const table = lines.map(l => splitLine(l, sep));
    // the header: the first of the first 20 lines with a time-like and a value-like column name
    let hi = table.slice(0, 20).findIndex(r => r.some(c => TIME.test(c) && !/^\d/.test(c)) && r.some(c => VALUE.test(c) && !NOT_VALUE.test(c)));
    let head = hi >= 0 ? table[hi] : null, ti = -1, hr = -1, vi = -1, endOnly = false;
    if (head) {
      const pick = re => head.findIndex(c => re.test(c));
      hr = head.findIndex(c => HOUR.test(c.replace(/\(.*\)/, '').trim()));
      ti = head.findIndex((c, i) => i !== hr && TIME.test(c) && !END.test(c));
      if (ti < 0) { ti = head.findIndex((c, i) => i !== hr && TIME.test(c)); endOnly = ti >= 0; }
      if (ti < 0 && hr >= 0) { ti = hr; hr = -1; }
      const vs = head.map((c, i) => i).filter(i => i !== ti && i !== hr && VALUE.test(head[i]) && !NOT_VALUE.test(head[i]));
      vi = vs.find(i => /kwh|määrä|quantity|kulutus|consumption/i.test(head[i])) ?? vs[0] ?? -1;
      if (hr >= 0 && !table.slice(hi + 1, hi + 6).some(r => parseHour(r[hr]) != null && parseTime(r[ti])?.dateOnly)) hr = -1;  // not a separate hour column
    }
    const body = table.slice(hi + 1);
    if (ti < 0 || vi < 0) {  // no usable header: the first column that reads as a date, the last one that reads as a number
      const r = body.find(x => x.some(c => parseTime(c)));
      if (!r) throw new Error('no dates found: is this a consumption file (CSV with a time and a kWh column)?');
      ti = r.findIndex(c => parseTime(c));
      vi = r.map((c, i) => i).filter(i => i !== ti && isFinite(num(r[i]))).at(-1) ?? -1;
      if (vi < 0) throw new Error('no kWh column found');
      head = null; hr = -1;
    }
    const notes = [], col = re => head ? head.findIndex((c, i) => i !== ti && i !== vi && re.test(c)) : -1;
    // several series (consumption and production) in one file: keep the consumption
    const si = col(SERIES), kinds = si >= 0 ? [...new Set(body.map(r => r[si]).filter(Boolean))] : [];
    const want = kinds.length > 1 ? kinds.find(k => USE.test(k)) ?? kinds[0] : null;
    const nice = k => ({ 8716867000030: 'consumption', 8716867000047: 'production' })[k] || k;  // Datahub product codes
    if (want) notes.push(`the file has ${kinds.length} series (${kinds.map(nice).join(', ')}): imported ${nice(want)}`);
    const ui = col(UNIT_COL), mi = col(METER);
    const scale = u => /^mwh$/i.test(u) ? 1000 : /^wh$/i.test(u) ? 0.001 : 1;
    const headUnit = (head?.[vi].match(/\b(MWh|kWh|Wh)\b/i) || [])[1] || '';
    // a separate hour column numbered 1 … 24 is the hour that ends then
    const hours = hr >= 0 ? body.map(r => parseHour(r[hr])).filter(h => h != null) : [];
    const h0 = hours.length && Math.min(...hours) >= 1 && Math.max(...hours) === 24 ? 1 : 0;
    const read = new Map();  // meter -> [{t, zoned, kwh}] in file order
    let skipped = 0;
    for (const r of body) {
      if (want && r[si] !== want) continue;
      const p = parseTime(r[ti]), v = num(r[vi]);
      if (!p || !isFinite(v)) { skipped++; continue; }
      let t = p.t;
      if (hr >= 0) {
        const h = parseHour(r[hr]);
        if (h == null) { skipped++; continue; }
        t = helsinki(...isoParts(p.t), Math.floor(h - h0), Math.round(h % 1 * 60));
      }
      const meter = mi >= 0 ? r[mi] : '';
      if (!read.has(meter)) read.set(meter, []);
      read.get(meter).push({ t, zoned: p.zoned, kwh: v * scale(ui >= 0 ? r[ui] : headUnit) });
    }
    const per = new Map();  // ts -> kWh, several metering points added up
    for (let list of read.values()) {
      if (list.length > 1 && list[0].t > list.at(-1).t) list = list.reverse();  // newest first in the file
      let last = null, shift = 0;
      for (const x of list) {
        // local times repeat in the night of the autumn DST change: a time that goes back (up to an hour) is the second 03:00
        if (!x.zoned && last != null && x.t + shift <= last && last - (x.t + shift) < 3600) shift += 3600;
        const t = x.t + shift; last = t;
        per.set(t, (per.get(t) || 0) + x.kwh);
      }
    }
    let rows = [...per].sort((a, b) => a[0] - b[0]);
    if (!rows.length) throw new Error('no rows with a time and a kWh value found');
    const meters = read.size;
    if (meters > 1) notes.push(`${meters} metering points added up`);
    const res = resolution(rows);
    if (endOnly) rows = rows.map(([t, v]) => [t - res, v]);  // only an end time: the interval started one step earlier
    if (skipped) notes.push(`${skipped} line${skipped === 1 ? '' : 's'} without a time or a number skipped`);
    if (res > 86400) throw new Error('the file has monthly (or longer) values: download hourly or 15-minute values instead');
    if (res === 86400) notes.push('daily values: their cost uses the average price of each day');
    return { rows, res, notes };
  }
  const isoParts = t => { const p = Object.fromEntries(HEL.formatToParts(t * 1000).map(x => [x.type, x.value])); return [+p.year, +p.month, +p.day]; };

  function resolution(rows) {  // the usual step between rows: 900, 3600 or 86400 s (most common gap)
    const n = new Map();
    for (let i = 1; i < rows.length; i++) { const d = rows[i][0] - rows[i - 1][0]; n.set(d, (n.get(d) || 0) + 1); }
    const d = [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 3600;
    return d <= 900 ? 900 : d <= 3600 ? 3600 : d <= 90000 ? 86400 : d;
  }

  // the price (c/kWh, from value(row) of a price row) of each interval [ts, ts + res): time-weighted over the price rows in it,
  // so 15-min prices are averaged for an hourly reading and an hourly price covers each of its 15-min readings.
  // -> [[ts, kWh, c/kWh | null]] (null when less than half of the interval has a price)
  function priced(cons, prices, res, value) {
    const out = [], P = prices.length;
    let j = 0;
    for (const [t, kwh] of cons) {
      const end = t + res;
      while (j + 1 < P && prices[j + 1][0] <= t) j++;
      let sw = 0, sv = 0;
      for (let k = j; k < P && prices[k][0] < end; k++) {
        const a = prices[k][0], b = Math.min(k + 1 < P ? prices[k + 1][0] : a + 900, a + 3600);
        const w = Math.min(b, end) - Math.max(a, t);
        if (w > 0) { sw += w; sv += value(prices[k]) * w; }
      }
      out.push([t, kwh, sw >= res / 2 ? sv / sw : null]);
    }
    return out;
  }
  return { parse, resolution, priced };
})();
