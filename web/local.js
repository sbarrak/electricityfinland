// Standalone mode: when index.html is opened by double-click (file://), this replaces the
// Python backend (app/main.py) in the browser: fetching, alarms, notifications. Prices use
// priceValue() from costs.js. Alarms only run while the page is open.
(() => {
  if (location.protocol !== 'file:') return;
  const NPF = 'https://raw.githubusercontent.com/vividfog/nordpool-predict-fi/main/deploy/';
  const HISTORY_DAYS = 366;
  const DEFAULTS = {
    vat: 25.5, margin: 0, transfer_day: 0, transfer_night: 0, night_start: 22, night_end: 7, tax: 2.827, other: 0,
    monthly_provider: 0, monthly_transfer: 0, monthly_kwh: 0, spread_monthly: false,
    alarm_basis: 'total', alarm_vat: true, high_on: false, high: 20, low_on: false, low: 2, summary_on: true, ...MSG_DEFAULTS,
    wa_on: false, email_on: false, recipients: [],
    ejs_service: '', ejs_template: '', ejs_key: '', fingrid_key: '',
  };
  const get = (k, d) => { try { return JSON.parse(localStorage.getItem('elfi_' + k)) ?? d; } catch { return d; } };
  const put = (k, v) => { try { localStorage.setItem('elfi_' + k, JSON.stringify(v)); } catch (e) { console.warn('storage', e); } };
  const TABLES = ['prices', 'forecast', 'wind_npf', 'wind_fg', 'wind_actual'];
  const db = Object.fromEntries(TABLES.map(t => [t, get(t, {})]));  // { ts: value }
  const errors = {};
  const clean = r => ({ name: String(r.name || '').slice(0, 60), phone: String(r.phone || '').trim(), apikey: String(r.apikey || '').trim(),
    email: String(r.email || '').trim(), wa: !!r.wa, mail: !!r.mail });
  function settings() {
    const s = { ...DEFAULTS, ...get('settings', {}) };
    if (!s.recipients.length && (s.wa_phone || s.email_to))  // migrate single-recipient settings
      s.recipients = [clean({ name: 'Me', phone: s.wa_phone, apikey: s.wa_apikey, email: s.email_to, wa: true, mail: true })];
    return s;
  }
  const now = () => Date.now() / 1000;
  const tsOf = iso => Math.floor(Date.parse(iso) / 1000);
  const exVat = v => v > 0 ? v / 1.255 : v;  // public feeds include VAT 25.5 %
  const rows = (t, from = 0) => Object.entries(db[t]).map(([k, v]) => [+k, v]).filter(r => r[0] >= from).sort((a, b) => a[0] - b[0]);
  const keyRange = t => { let lo = Infinity, hi = 0; for (const k in db[t]) { lo = Math.min(lo, +k); hi = Math.max(hi, +k); } return [lo, hi]; };
  const lastPrice = () => keyRange('prices')[1];
  const hm = ts => new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const midnight = days => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days); return d; };
  const priceOf = (s, ts, spot) => priceValue(s, ts, spot, s.alarm_basis, s.alarm_vat);

  async function json(url, opts) {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
    return r.json();
  }
  async function track(name, fn) {
    try { await fn(); delete errors[name]; return 'ok'; } catch (e) { errors[name] = `${name}: ${e.message}`; console.warn(name, e); return 'failed: ' + e.message; }
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
  async function backfill() {  // up to a year of hourly history, without overwriting 15-min data
    const first = Math.min(now(), keyRange('prices')[0]), start = now() - HISTORY_DAYS * 86400;
    if (first - start < 2 * 86400) return;
    const iso = t => new Date(t * 1000).toISOString();
    const r = await json(`https://sahkotin.fi/prices?start=${iso(start)}&end=${iso(first)}`);
    r.prices.forEach(x => { const t = tsOf(x.date); if (!(t in db.prices)) db.prices[t] = x.value / 10; });
  }
  async function fetchForecasts() {
    const last = lastPrice();  // keep estimates as they were before the price was published
    (await json(NPF + 'prediction.json')).forEach(([t, v]) => { if (t / 1000 > last) db.forecast[Math.floor(t / 1000)] = exVat(v); });
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
    const cutoff = now() - (HISTORY_DAYS + 5) * 86400;
    TABLES.forEach(t => { for (const k in db[t]) if (+k < cutoff) delete db[t][k]; put(t, db[t]); });
  }

  async function notify(s, text, force = null) {  // force: null = alarm, 'all' | 'whatsapp' | 'email' = test
    const out = {}, wa = ['all', 'whatsapp'].includes(force) || (!force && s.wa_on), em = ['all', 'email'].includes(force) || (!force && s.email_on);
    for (const r of s.recipients) {
      const who = r.name || r.phone || r.email;
      if (wa && r.phone) {
        if (!r.apikey) out[who + ' WhatsApp'] = 'missing CallMeBot API key';
        else  // CallMeBot sends no CORS headers: fire-and-forget, the response cannot be read
          await fetch(`https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(r.phone)}&apikey=${encodeURIComponent(r.apikey)}&text=${encodeURIComponent(text)}`, { mode: 'no-cors' })
            .then(() => out[who + ' WhatsApp'] = 'sent (check the phone)', e => out[who + ' WhatsApp'] = 'failed: ' + e.message);
      }
      if (em && r.email) {
        if (!(s.ejs_service && s.ejs_template && s.ejs_key)) out[who + ' email'] = 'EmailJS not configured';
        else await fetch('https://api.emailjs.com/api/v1.0/email/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ service_id: s.ejs_service, template_id: s.ejs_template, user_id: s.ejs_key,
            template_params: { to_email: r.email, subject: 'Electricity price alert', message: text } }),
        }).then(async res => out[who + ' email'] = res.ok ? 'sent' : 'failed: ' + await res.text(), e => out[who + ' email'] = 'failed: ' + e.message);
      }
    }
    if (!Object.keys(out).length) out.info = 'no recipient has this channel enabled';
    console.info('notify', text, out);
    return out;
  }

  function dailyAlarm(s) {  // once a day from 14:00: the fixed prices from 14:00 today to 14:00 tomorrow
    const d = new Date(); if (d.getHours() < 14) return [];
    d.setHours(14, 0, 0, 0);
    const a = d / 1000, b = a + 86400, key = d.toDateString(), list = rows('prices', a - 3600);
    if (get('daily_sent') === key || !list.length || list.at(-1)[0] < b - 900) return [];
    put('daily_sent', key);
    const msg = dailyMessage(s, list, a, b);
    return msg ? [msg] : [];
  }

  const last = { p: 0, f: 0, h: 0 };
  async function refresh(fingrid = true) {
    const out = { prices: await track('prices', fetchPrices), forecast: await track('forecast', fetchForecasts) };
    if (fingrid) await track('fingrid', fetchFingrid);
    persist();
    return out;
  }
  async function tick() {
    const t = now(), waiting = lastPrice() < midnight(2) / 1000 - 3600 && new Date().getHours() >= 13;
    let changed = false;
    if (t - last.p > (waiting ? 600 : 3600)) { last.p = t; await track('prices', fetchPrices); changed = true; }
    if (t - last.f > 3600) { last.f = t; await track('forecast', fetchForecasts); await track('fingrid', fetchFingrid); changed = true; }
    if (t - last.h > 86400) { last.h = t; await track('history', backfill); changed = true; }
    if (changed) { persist(); if (!document.querySelector('#main.hidden')) window.load?.(); }
    const s = settings();
    for (const m of dailyAlarm(s)) await notify(s, m);
  }

  function data(daysBack) {
    const s = settings(), start = now() - Math.max(1, Math.min(daysBack, HISTORY_DAYS)) * 86400;
    const fg = rows('wind_fg', start), fgEnd = fg.length ? fg.at(-1)[0] : 0;
    const wind = [...rows('wind_npf', start).filter(r => !fg.length || r[0] > fgEnd), ...fg].sort((a, b) => a[0] - b[0]);
    return { actual: rows('prices', start), forecast: rows('forecast', start), wind, wind_actual: rows('wind_actual', start),
      settings: s, fingrid: !!s.fingrid_key, errors: Object.values(errors) };
  }

  window.LOCAL = {
    fields: [['ejs_service', 'EmailJS service ID', 'text'], ['ejs_template', 'EmailJS template ID', 'text'],
      ['ejs_key', 'EmailJS public key', 'text'], ['fingrid_key', 'Fingrid API key (optional)', 'text']],
    emailHint: 'A page opened from disk cannot use an SMTP server, so email goes through a free <a href="https://www.emailjs.com" target="_blank" rel="noopener">EmailJS</a> account: in the template use {{to_email}} as recipient and {{message}} as body. Alarms run only while this page is open.',
    async api(path, opts = {}) {
      const [p, q] = path.split('?'), body = opts.body ? JSON.parse(opts.body) : {};
      if (p === 'me') return { username: 'local', must_change: false };
      if (p === 'data') return data(+new URLSearchParams(q).get('days_back') || 60);
      if (p === 'refresh') return refresh(false);
      if (p === 'settings' && opts.method === 'PUT') {
        const s = settings();
        for (const [k, v] of Object.entries(body)) {
          if (!(k in DEFAULTS)) continue;
          const d = DEFAULTS[k];
          s[k] = Array.isArray(d) ? v.slice(0, 20).map(clean) : typeof d === 'boolean' ? !!v : typeof d === 'number' ? +v : String(v);
          if (Number.isNaN(s[k])) throw new Error('invalid value for ' + k);
        }
        put('settings', Object.fromEntries(Object.entries(s).filter(([k]) => k in DEFAULTS)));
        if (body.fingrid_key) last.f = 0;  // fetch with the new key on the next tick
        return s;
      }
      if (p === 'test-notify') {
        const s = settings(), a = Math.floor(now() / 900) * 900;
        if (Array.isArray(body.only)) {
          s.recipients = s.recipients.filter((r, i) => body.only.includes(i));
          if (!s.recipients.length) throw new Error('select at least one recipient');
        }  // example: daily message for the published prices from now on
        const text = '✅ Test message from Electricity Finland. Example of the daily message:\n' + (dailyMessage(s, rows('prices', a - 3600), a, a + 86400) || '(no published prices yet)');
        return notify(s, text, body.channel || 'all');
      }
      return { ok: true };
    },
  };
  tick();
  setInterval(tick, 60 * 1000);
})();
