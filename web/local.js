// Standalone mode: when index.html is opened by double-click (file://), this replaces the
// Python backend (app/main.py) in the browser: fetching, cost calc, alarms, notifications.
// Alarms only run while the page is open.
(() => {
  if (location.protocol !== 'file:') return;
  const NPF = 'https://raw.githubusercontent.com/vividfog/nordpool-predict-fi/main/deploy/';
  const DEFAULTS = {
    vat: 25.5, margin: 0, transfer_day: 0, transfer_night: 0, night_start: 22, night_end: 7, tax: 2.827, other: 0,
    monthly_provider: 0, monthly_transfer: 0, monthly_kwh: 0, spread_monthly: false,
    alarm_basis: 'total', high_on: false, high: 20, low_on: false, low: 2, hysteresis: 0.5, summary_on: true,
    quiet_start: -1, quiet_end: -1, wa_on: false, wa_phone: '', wa_apikey: '', email_on: false, email_to: '',
    ejs_service: '', ejs_template: '', ejs_key: '', fingrid_key: '',
  };
  const get = (k, d) => { try { return JSON.parse(localStorage.getItem('elfi_' + k)) ?? d; } catch { return d; } };
  const put = (k, v) => { try { localStorage.setItem('elfi_' + k, JSON.stringify(v)); } catch { } };
  const TABLES = ['prices', 'forecast', 'wind_npf', 'wind_fg', 'wind_actual'];
  const db = Object.fromEntries(TABLES.map(t => [t, get(t, {})]));  // { ts: value }
  const errors = {};
  const settings = () => ({ ...DEFAULTS, ...get('settings', {}) });
  const now = () => Date.now() / 1000;
  const tsOf = iso => Math.floor(Date.parse(iso) / 1000);
  const exVat = v => v > 0 ? v / 1.255 : v;  // public feeds include VAT 25.5 %
  const rows = (t, from = 0) => Object.entries(db[t]).map(([k, v]) => [+k, v]).filter(r => r[0] >= from).sort((a, b) => a[0] - b[0]);
  const hour = ts => new Date(ts * 1000).getHours();
  const hm = ts => new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const midnight = days => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days); return d; };

  function costs(s, ts, spot) {
    const sv = spot > 0 ? spot * (1 + s.vat / 100) : spot, h = hour(ts), ns = s.night_start, ne = s.night_end;
    const night = ns > ne ? (h >= ns || h < ne) : (ns <= h && h < ne);
    let total = sv + s.margin + s.tax + s.other + (night ? s.transfer_night : s.transfer_day);
    if (s.spread_monthly && s.monthly_kwh > 0) total += (s.monthly_provider + s.monthly_transfer) * 100 / s.monthly_kwh;
    return [+sv.toFixed(3), +total.toFixed(3)];
  }
  const priceOf = (s, ts, spot) => costs(s, ts, spot)[s.alarm_basis === 'total' ? 1 : 0];

  async function json(url, opts) {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
    return r.json();
  }
  async function track(name, fn) {
    try { await fn(); delete errors[name]; } catch (e) { errors[name] = `${name}: ${e.message}`; console.warn(name, e); }
  }

  async function fetchPrices() {
    let list;
    try {
      list = (await json('https://api.spot-hinta.fi/TodayAndDayForward?priceResolution=15')).map(x => [tsOf(x.DateTime), x.PriceNoTax * 100]);
    } catch {
      list = (await json('https://api.porssisahko.net/v2/latest-prices.json')).prices.map(x => [tsOf(x.startDate), exVat(x.price)]);
    }
    list.forEach(([t, v]) => db.prices[t] = v);
  }
  async function fetchForecasts() {
    (await json(NPF + 'prediction.json')).forEach(([t, v]) => db.forecast[Math.floor(t / 1000)] = exVat(v));
    (await json(NPF + 'windpower.json')).forEach(([t, v]) => db.wind_npf[Math.floor(t / 1000)] = v);
  }
  async function fetchFingrid() {
    const key = settings().fingrid_key;
    if (!key) return;
    const n = Date.now(), iso = ms => new Date(ms).toISOString();
    for (const [ds, t, a, b] of [[245, 'wind_fg', n - 2 * 3600e3, n + 3 * 86400e3], [75, 'wind_actual', n - 7 * 86400e3, n]]) {
      const r = await json(`https://data.fingrid.fi/api/datasets/${ds}/data?startTime=${iso(a)}&endTime=${iso(b)}&pageSize=20000&sortOrder=asc`,
        { headers: { 'x-api-key': key } });
      r.data.forEach(x => db[t][tsOf(x.startTime)] = x.value);
    }
  }
  function persist() {
    const cutoff = now() - 60 * 86400;
    TABLES.forEach(t => { for (const k in db[t]) if (+k < cutoff) delete db[t][k]; put(t, db[t]); });
  }

  async function notify(s, text, force = false) {
    const out = {};
    if (s.wa_on || force) {
      if (s.wa_phone && s.wa_apikey) {
        // CallMeBot sends no CORS headers: fire-and-forget, the response cannot be read
        await fetch(`https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(s.wa_phone)}&apikey=${encodeURIComponent(s.wa_apikey)}&text=${encodeURIComponent(text)}`, { mode: 'no-cors' })
          .then(() => out.whatsapp = 'sent (check your phone)', e => out.whatsapp = 'failed: ' + e.message);
      } else out.whatsapp = 'missing phone or API key';
    }
    if (s.email_on || force) {
      if (s.email_to && s.ejs_service && s.ejs_template && s.ejs_key) {
        await fetch('https://api.emailjs.com/api/v1.0/email/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ service_id: s.ejs_service, template_id: s.ejs_template, user_id: s.ejs_key,
            template_params: { to_email: s.email_to, subject: 'Electricity price alert', message: text } }),
        }).then(async r => out.email = r.ok ? 'sent' : 'failed: ' + await r.text(), e => out.email = 'failed: ' + e.message);
      } else out.email = 'missing recipient or EmailJS settings';
    }
    console.info('notify', text, out);
    return out;
  }

  function inQuiet(s) {
    const a = s.quiet_start, b = s.quiet_end, h = new Date().getHours();
    if (a < 0 || b < 0 || a === b) return false;
    return a > b ? (h >= a || h < b) : (a <= h && h < b);
  }
  function checkAlarms(s) {
    const row = rows('prices').filter(r => r[0] <= now()).at(-1);
    if (!row || now() - row[0] > 3600) return [];
    const p = priceOf(s, ...row), st = get('alarm_state', {}), msgs = [], hy = s.hysteresis;
    for (const [kind, on, trig, clear, word] of [
      ['high', s.high_on, p >= s.high, p < s.high - hy, 'ABOVE'],
      ['low', s.low_on, p <= s.low, p > s.low + hy, 'BELOW']]) {
      if (on && trig && !st[kind]) {
        st[kind] = true;
        msgs.push(`⚡ Price ${word} ${s[kind]} c/kWh: now ${p.toFixed(2)} c/kWh (${hm(row[0])}, ${s.alarm_basis})`);
      } else if (st[kind] && (clear || !on)) st[kind] = false;
    }
    put('alarm_state', st);
    return inQuiet(s) ? [] : msgs;
  }
  function windows(list, test) {
    const out = []; let start = null;
    list.forEach(([ts, p]) => {
      if (test(p) && start === null) start = ts;
      if (!test(p) && start !== null) { out.push(`${hm(start)}–${hm(ts)}`); start = null; }
    });
    if (start !== null) out.push(`${hm(start)}–${hm(list.at(-1)[0] + 900)}`);
    return out.join(', ');
  }
  function dailySummary(s) {
    const d0 = midnight(1), a = d0 / 1000, b = midnight(2) / 1000, key = d0.toDateString();
    if (!s.summary_on || get('summary_date') === key) return [];
    const list = rows('prices', a).filter(r => r[0] < b).map(([t, v]) => [t, priceOf(s, t, v)]);
    if (!list.length || list.at(-1)[0] < b - 3600) return [];
    put('summary_date', key);
    const ps = list.map(r => r[1]), lo = list.reduce((x, y) => y[1] < x[1] ? y : x), hi = list.reduce((x, y) => y[1] > x[1] ? y : x);
    let msg = `📅 Tomorrow ${d0.getDate()}.${d0.getMonth() + 1}. (${s.alarm_basis}): avg ${(ps.reduce((x, y) => x + y) / ps.length).toFixed(2)}, ` +
      `min ${lo[1].toFixed(2)} @${hm(lo[0])}, max ${hi[1].toFixed(2)} @${hm(hi[0])} c/kWh`;
    let w;
    if (s.high_on && (w = windows(list, p => p >= s.high))) msg += `\n🔴 ≥${s.high}: ${w}`;
    if (s.low_on && (w = windows(list, p => p <= s.low))) msg += `\n🟢 ≤${s.low}: ${w}`;
    return [msg];
  }
  const hasTomorrow = () => { const m = Math.max(0, ...Object.keys(db.prices).map(Number)); return m >= midnight(2) / 1000 - 3600; };

  const last = { p: 0, f: 0 };
  async function tick() {
    const t = now(), waiting = !hasTomorrow() && new Date().getHours() >= 13;
    let changed = false;
    if (t - last.p > (waiting ? 600 : 3600)) { last.p = t; await track('prices', fetchPrices); changed = true; }
    if (t - last.f > 3600) { last.f = t; await track('forecast', fetchForecasts); await track('fingrid', fetchFingrid); changed = true; }
    if (changed) { persist(); window.load?.(); }
    const s = settings();
    for (const m of [...checkAlarms(s), ...dailySummary(s)]) await notify(s, m);
  }

  function data(daysBack) {
    const s = settings(), start = now() - Math.max(1, Math.min(daysBack, 60)) * 86400;
    const actual = rows('prices', start).map(([t, v]) => [t, ...costs(s, t, v)]);
    const lastTs = actual.length ? actual.at(-1)[0] : 0;
    const forecast = rows('forecast', Math.max(lastTs + 1, start)).map(([t, v]) => [t, ...costs(s, t, v)]);
    const fg = rows('wind_fg', start), fgEnd = fg.length ? fg.at(-1)[0] : 0;
    const wind = [...rows('wind_npf', start).filter(r => !fg.length || r[0] > fgEnd), ...fg].sort((a, b) => a[0] - b[0]);
    return { actual, forecast, wind, wind_actual: rows('wind_actual', start), settings: s,
      smtp: !!(s.ejs_service && s.ejs_template && s.ejs_key), fingrid: !!s.fingrid_key, errors: Object.values(errors) };
  }

  window.LOCAL = {
    fields: [['ejs_service', 'EmailJS service ID', 'text'], ['ejs_template', 'EmailJS template ID', 'text'],
      ['ejs_key', 'EmailJS public key', 'text'], ['fingrid_key', 'Fingrid API key (optional)', 'text']],
    emailHint: 'Email uses a free <a href="https://www.emailjs.com" target="_blank" rel="noopener">EmailJS</a> account; in the template use {{to_email}} as recipient and {{message}} as body. Alarms run only while this page is open.',
    async api(path, opts = {}) {
      const [p, q] = path.split('?');
      if (p === 'data') return data(+new URLSearchParams(q).get('days_back') || 1);
      if (p === 'settings' && opts.method === 'PUT') {
        const s = settings(), body = JSON.parse(opts.body);
        for (const [k, v] of Object.entries(body)) {
          if (!(k in DEFAULTS)) continue;
          const d = DEFAULTS[k];
          s[k] = typeof d === 'boolean' ? !!v : typeof d === 'number' ? +v : String(v);
          if (Number.isNaN(s[k])) throw new Error('invalid value for ' + k);
        }
        put('settings', s); put('alarm_state', {});
        if (body.fingrid_key) last.f = 0;  // fetch with the new key on the next tick
        return s;
      }
      if (p === 'test-notify') return notify(settings(), '✅ Test message from Electricity Finland', true);
      return { ok: true };
    },
  };
  tick();
  setInterval(tick, 60 * 1000);
})();
