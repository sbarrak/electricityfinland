// Standalone mode: when index.html is opened by double-click (file://), this replaces the
// Python backend (app/main.py) in the browser: fetching, alarms, notifications. Prices use
// priceValue() from costs.js. Alarms only run while the page is open.
(() => {
  if (location.protocol !== 'file:') return;
  const NPF = 'https://raw.githubusercontent.com/vividfog/nordpool-predict-fi/main/deploy/';
  const HISTORY_DAYS = 366;  // forecasts and wind are kept this long
  const MAX_HISTORY_DAYS = 2200;  // published prices are kept and can be loaded this far back on demand
  const DEFAULTS = {
    vat: 25.5, margin: 0, transfer_day: 0, transfer_night: 0, night_start: 22, night_end: 7, tax: 2.827, other: 0,
    monthly_provider: 0, monthly_transfer: 0, monthly_kwh: 0, spread_monthly: false,
    alarm_basis: 'total', alarm_vat: true, high_on: true, high: 20, low_on: true, low: 2, summary_on: true, extra_time_1: '', extra_time_2: '', extra_time_3: '', ...MSG_DEFAULTS,
    wa_on: true, email_on: true, recipients: [], alerts_v2: false,
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
    const saved = get('settings', {});
    for (const [k, olds] of Object.entries(OLD_MSGS)) if (olds.includes(saved[k])) delete saved[k];  // an earlier default text: use the new default
    const s = { ...DEFAULTS, ...saved };
    if (!s.alerts_v2) {  // one time: the limits are checked, and WhatsApp + Email are on when both were off (nothing would be sent)
      Object.assign(s, { high_on: true, low_on: true, alerts_v2: true });
      if (!s.wa_on && !s.email_on) s.wa_on = s.email_on = true;
    }
    if (!s.recipients.length && (s.wa_phone || s.email_to))  // migrate single-recipient settings
      s.recipients = [clean({ name: 'Me', phone: s.wa_phone, apikey: s.wa_apikey, email: s.email_to, wa: true, mail: true })];
    return s;
  }
  const now = () => Date.now() / 1000;
  let backfilledFrom = now();  // oldest start already requested from sahkotin.fi
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
  async function backfill(days = HISTORY_DAYS) {  // hourly history back `days` days, without overwriting 15-min data
    const first = Math.min(now(), keyRange('prices')[0]), start = now() - Math.min(days, MAX_HISTORY_DAYS) * 86400;
    if (first - start < 2 * 86400 || start >= backfilledFrom) return -1;  // covered, or already asked for
    const iso = t => new Date(t * 1000).toISOString();
    let total = 0;
    for (let end = first; end - start > 3600; end -= HISTORY_DAYS * 86400) {  // one request per year of data
      const a = Math.max(start, end - HISTORY_DAYS * 86400);
      const r = await json(`https://sahkotin.fi/prices?start=${iso(a)}&end=${iso(end)}`);
      r.prices.forEach(x => { const t = tsOf(x.date); if (!(t in db.prices)) { db.prices[t] = x.value / 10; total++; } });
    }
    if (total) backfilledFrom = start;  // nothing at all is suspicious (source down?): ask again next time
    return total;
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
    const cutoff = now() - (HISTORY_DAYS + 5) * 86400;  // published prices are kept
    TABLES.forEach(t => { if (t !== 'prices') for (const k in db[t]) if (+k < cutoff) delete db[t][k]; put(t, db[t]); });
  }

  const WA_CHUNK = 1500;  // CallMeBot takes the text in the URL: longer messages are sent as several parts
  const waParts = text => {
    const parts = []; let cur = '';
    for (const line of text.split('\n')) { if (cur && cur.length + line.length + 1 > WA_CHUNK) { parts.push(cur.trimEnd()); cur = ''; } cur += line + '\n'; }
    return [...parts, cur.trimEnd()];
  };
  const sentOk = v => String(v).startsWith('sent');
  async function notify(s, m, force = null) {  // m: {subject, wa, text}. force: null = scheduled message, 'all' | 'whatsapp' | 'email' = test
    const out = {}, wa = ['all', 'whatsapp'].includes(force) || (!force && s.wa_on), em = ['all', 'email'].includes(force) || (!force && s.email_on);
    for (const r of s.recipients) {
      const who = r.name || r.phone || r.email;
      if (wa && r.phone) {
        if (!r.apikey) out[who + ' WhatsApp'] = 'missing CallMeBot API key';
        else {  // CallMeBot sends no CORS headers: fire-and-forget, the response cannot be read
          try {
            for (const [i, part] of waParts(m.wa).entries()) {
              if (i) await new Promise(res => setTimeout(res, 3000));
              await fetch(`https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(r.phone)}&apikey=${encodeURIComponent(r.apikey)}&text=${encodeURIComponent(part)}`, { mode: 'no-cors' });
            }
            out[who + ' WhatsApp'] = 'sent (check the phone)';
          } catch (e) { out[who + ' WhatsApp'] = 'failed: ' + e.message; }
        }
      }
      if (em && r.email) {
        if (!(s.ejs_service && s.ejs_template && s.ejs_key)) out[who + ' email'] = 'EmailJS not configured';
        else await fetch('https://api.emailjs.com/api/v1.0/email/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ service_id: s.ejs_service, template_id: s.ejs_template, user_id: s.ejs_key,
            template_params: { to_email: r.email, subject: m.subject, message: m.text } }),
        }).then(async res => out[who + ' email'] = res.ok ? 'sent' : 'failed: ' + await res.text(), e => out[who + ' email'] = 'failed: ' + e.message);
      }
    }
    if (!Object.keys(out).length) out.info = !force && !(wa || em) ? 'the WhatsApp alerts and Email alerts switches are both off'
      : { whatsapp: 'the selected recipients have no WhatsApp number', email: 'the selected recipients have no email address' }[force] || 'no recipient with a WhatsApp number or email address';
    console.info('notify', m.subject, out);
    return out;
  }

  // ---- when messages are sent. Mirrors due_messages() in app/main.py: the daily 14:00 message plus up to 3 extra times, each with
  // the prices from that time to the same time tomorrow (before 14:00 tomorrow is not fixed yet: until midnight).
  const SEND_HOUR = 14, DAILY_GRACE = 10 * 3600, EXTRA_GRACE = 3 * 3600, PARTIAL_AFTER = 90 * 60, RETRY_AFTER = 300, MAX_TRIES = 4;
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function scheduleTimes(s) {
    const out = [['daily', '14:00']], seen = new Set(['14:00']);
    ['extra_time_1', 'extra_time_2', 'extra_time_3'].forEach((k, i) => {
      const t = String(s[k] || '').trim();
      if (TIME_RE.test(t) && !seen.has(t)) { seen.add(t); out.push(['extra:' + i, t]); }
    });
    return out;
  }
  function dueMessages(s) {
    const n = new Date(), out = [];
    for (const [slot, t] of scheduleTimes(s)) for (const back of [0, 1]) {  // yesterday too: the grace period may reach past midnight
      const start = new Date(n.getFullYear(), n.getMonth(), n.getDate() - back, +t.slice(0, 2), +t.slice(3)), late = (n - start) / 1000;
      const key = slot === 'daily' ? isoDay(start) : `${isoDay(start)} ${t}`;
      const legacy = slot === 'daily' ? get('daily_sent') === start.toDateString() : get('sent_extra_time_' + (+slot.slice(6) + 1)) === `${start.toDateString()} ${t}`;  // sent by the previous version
      if (late < 0 || late >= (slot === 'daily' ? DAILY_GRACE : EXTRA_GRACE) || get('sent_' + slot) === key || legacy) continue;
      const tr = get('tries_' + slot, {});
      if (tr.key === key && (tr.n >= MAX_TRIES || now() - tr.at < RETRY_AFTER)) continue;
      const a = start / 1000, y = start.getFullYear(), mo = start.getMonth(), d = start.getDate();
      let b = (start.getHours() >= SEND_HOUR ? new Date(y, mo, d + 1, start.getHours(), start.getMinutes()) : new Date(y, mo, d + 1)) / 1000, note = '';
      const list = rows('prices', a - 3600);
      if (!list.length || list.at(-1)[0] < b - 3600) {  // the end of the period is not published yet: wait for it
        if (late < PARTIAL_AFTER || !list.length || list.at(-1)[0] < a) continue;
        b = list.at(-1)[0] + 900; note = `Prices after ${daystamp(b)} are not published yet.`;
      }
      const msg = composeMessage(s, list, a, b, { note });
      if (msg) out.push({ slot, key, time: t, msg });
    }
    return out;
  }
  function recordSend(due, out) {  // delivered to someone = done; only failures = try again later; nobody to send to = tried again until the grace period ends
    const ok = Object.values(out).some(sentOk), bad = Object.entries(out).filter(([k, v]) => k !== 'info' && !sentOk(v));
    if (ok) put('sent_' + due.slot, due.key);
    else if (bad.length) { const tr = get('tries_' + due.slot, {}); put('tries_' + due.slot, { key: due.key, at: now(), n: (tr.key === due.key ? tr.n : 0) + 1 }); console.warn('message not delivered, will try again', bad); }
    if (ok || bad.length) put('last_send', { at: Math.floor(now()), time: due.time, ok: ok && !bad.length, results: out });
  }
  const scheduleInfo = s => ({ times: scheduleTimes(s).map(x => x[1]), last: get('last_send', null),
    wa: s.recipients.filter(r => r.phone && r.apikey).length, email: s.ejs_service && s.ejs_template && s.ejs_key ? s.recipients.filter(r => r.email).length : 0 });

  const last = { p: 0, f: 0, h: 0 };
  let sending = false;
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
    if (t - last.h > 86400) { last.h = t; await track('history', () => backfill()); changed = true; }
    if (changed) { persist(); if (!document.querySelector('#main.hidden')) window.load?.(); }
    if (sending) return;  // a slow send must not be started a second time by the next tick
    sending = true;
    try {
      const s = settings();
      for (const due of dueMessages(s)) recordSend(due, await notify(s, due.msg));
    } finally { sending = false; }
  }

  function data(daysBack) {
    const s = settings(), start = now() - Math.max(1, Math.min(daysBack, MAX_HISTORY_DAYS)) * 86400;
    const fg = rows('wind_fg', start), fgEnd = fg.length ? fg.at(-1)[0] : 0;
    const wind = [...rows('wind_npf', start).filter(r => !fg.length || r[0] > fgEnd), ...fg].sort((a, b) => a[0] - b[0]);
    return { actual: rows('prices', start), forecast: rows('forecast', start), wind, wind_actual: rows('wind_actual', start),
      settings: s, schedule: scheduleInfo(s), fingrid: !!s.fingrid_key, errors: Object.values(errors) };
  }

  window.LOCAL = {
    fields: [['ejs_service', 'EmailJS service ID', 'text'], ['ejs_template', 'EmailJS template ID', 'text'],
      ['ejs_key', 'EmailJS public key', 'text'], ['fingrid_key', 'Fingrid API key (optional)', 'text']],
    emailHint: 'A page opened from disk cannot use an SMTP server, so email goes through a free <a href="https://www.emailjs.com" target="_blank" rel="noopener">EmailJS</a> account: in the template use {{to_email}} as recipient and {{message}} as body. Alarms run only while this page is open.',
    async api(path, opts = {}) {
      const [p, q] = path.split('?'), body = opts.body ? JSON.parse(opts.body) : {};
      if (p === 'me') return { username: 'local', must_change: false };
      if (p === 'data') return data(+new URLSearchParams(q).get('days_back') || 60);
      if (p === 'history') { const rows = await backfill(+body.days || 0); persist(); return { rows: rows }; }
      if (p === 'refresh') return body.auto && now() - last.p < 120 ? { prices: 'up to date' } : refresh(false);
      if (p === 'settings' && opts.method === 'PUT') {
        const s = settings();
        for (const [k, v] of Object.entries(body)) {
          if (!(k in DEFAULTS)) continue;
          const d = DEFAULTS[k];
          if (/^extra_time_/.test(k) && v && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new Error('invalid value for ' + k);
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
        const text = 'TEST MESSAGE\nNo published prices yet.';
        return notify(s, composeMessage(s, rows('prices', a - 3600), a, a + 86400, { test: true }) || { subject: '[TEST] Electricity prices', wa: text, text }, body.channel || 'all');
      }
      return { ok: true };
    },
  };
  tick();
  setInterval(tick, 60 * 1000);
})();
