const $ = (s, el = document) => el.querySelector(s);
const fatal = msg => { const f = document.getElementById('fatal'); f.textContent = '⚠ ' + msg; f.classList.remove('hidden'); };
addEventListener('error', e => fatal(`${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno}). Try reloading the page.`));
addEventListener('unhandledrejection', e => fatal(String(e.reason?.message || e.reason)));
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const store = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v); } catch { return null; } };
const LOCAL = window.LOCAL;  // set by local.js when opened as a file
const DAY = 864e5, MIN_SPAN = 3 * 36e5, BUCKETS = [900, 3600, 10800, 21600, 86400];
const RES = { 900: '15 min', 3600: '1 h', 10800: '3 h', 21600: '6 h', 86400: '1 day' };
const NAMES = { spot: 'spot', total: 'total cost' };
let D = null, S = {}, chart = null, filled = false, loadedDays = 60, bucket = null, avgVal = null, tickStep = 1;
let mode = store('mode') === 'spot' ? 'spot' : 'total', vat = store('vat') !== '0', cmp = store('cmp') === '1', avgOn = store('avg') === '1';
let tab = 'prices', view = null, yZoom = 1, yPos = 0.5, touched = 0, sel = null;  // sel: chart point picked for the breakdown

// ---------------------------------------------------------------- settings form
const FIELDS = {
  costs: [['margin', 'Provider margin'], ['transfer_day', 'Transfer (day)'], ['transfer_night', 'Transfer (night)'],
    ['night_start', 'Night starts (hour)', 1], ['night_end', 'Night ends (hour)', 1],
    ['tax', 'Electricity tax + supply fee'], ['other', 'Other per kWh'], ['vat', 'VAT %']],
  monthly: [['monthly_provider', 'Provider monthly fee €'], ['monthly_transfer', 'Transfer monthly fee €'],
    ['monthly_kwh', 'Monthly consumption kWh'], ['spread_monthly', 'Spread monthly fees into total c/kWh', 'cb']],
  notif: [['summary_on', 'Start the daily 14:00 message with a price summary (average, min, max)', 'cb']],
  smtp: LOCAL ? LOCAL.fields : [['smtp_host', 'Server', 'text'], ['smtp_port', 'Port', 1], ['smtp_security', 'Security', ['starttls', 'ssl', 'none']],
    ['smtp_user', 'Username', 'text'], ['smtp_pass', 'Password', 'password'], ['smtp_from', 'From address (optional)', 'email'],
    ['smtp_verify', 'Verify server certificate', 'cb']],
};
const esc = v => String(v ?? '').replace(/[&"<>]/g, c => `&#${c.charCodeAt(0)};`);
const field = ([k, label, t]) => t === 'cb' ? `<label class="sw full"><input type="checkbox" data-k="${k}"><span>${label}</span></label>`
  : Array.isArray(t) ? `<label>${label}<select data-k="${k}">${t.map(o => `<option>${o}</option>`).join('')}</select></label>`
  : `<label>${label}<input data-k="${k}" type="${typeof t === 'string' ? t : 'number'}" step="${t === 1 ? 1 : 'any'}" autocomplete="off"></label>`;
for (const [id, list] of Object.entries(FIELDS)) $('#' + id).innerHTML = list.map(field).join('');
if (LOCAL) {
  $('#smtpCard summary').innerHTML = 'Email <small>EmailJS</small>';
  $('#emailHint').innerHTML = LOCAL.emailHint;
  ['#account', '#logout', '#who'].forEach(s => $(s).classList.add('hidden'));
}

const recipRow = (r = { wa: true, mail: true }) => `<div class="recip">
  <input data-r="name" placeholder="Name" value="${esc(r.name)}">
  <input data-r="phone" placeholder="WhatsApp +358…" inputmode="tel" value="${esc(r.phone)}">
  <input data-r="apikey" placeholder="CallMeBot API key" value="${esc(r.apikey)}">
  <input data-r="email" type="email" placeholder="Email" value="${esc(r.email)}">
  <label class="sw"><input type="checkbox" data-r="wa" ${r.wa ? 'checked' : ''}><span>WhatsApp</span></label>
  <label class="sw"><input type="checkbox" data-r="mail" ${r.mail ? 'checked' : ''}><span>Email</span></label>
  <label class="sw test-pick" title="Send test messages to this recipient"><input type="checkbox" data-t><span>Test</span></label>
  <button type="button" class="ghost del" title="Remove">✕</button></div>`;
$('#addRecip').onclick = () => $('#recips').insertAdjacentHTML('beforeend', recipRow());

function fillSettings() {
  $$('[data-k]').forEach(el => { const v = S[el.dataset.k]; el.type === 'checkbox' ? el.checked = !!v : el.value = v ?? ''; });
  const pw = $('[data-k=smtp_pass]');
  if (pw) pw.placeholder = S.smtp_pass_set ? '•••••• (saved)' : '';
  $('#recips').innerHTML = (S.recipients || []).map(recipRow).join('');
  monthlyInfo();
}
function monthlyInfo() {
  const fixed = S.monthly_provider + S.monthly_transfer;
  $('#monthlyInfo').textContent = `Fixed ${fixed.toFixed(2)} €/month` +
    (S.monthly_kwh > 0 ? ` ≈ ${(fixed * 100 / S.monthly_kwh).toFixed(2)} c/kWh at ${S.monthly_kwh} kWh` : '');
}
function readFields(root) {  // the settings inside root (+ recipients when root holds them)
  const o = {};
  $$('[data-k]', root).forEach(el => {
    o[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value.trim();
  });
  if ($('#recips', root)) o.recipients = $$('.recip', root).map(row => Object.fromEntries($$('[data-r]', row).map(el =>
    [el.dataset.r, el.type === 'checkbox' ? el.checked : el.value.trim()])));
  return o;
}
const putSettings = async o => { S = await api('settings', { method: 'PUT', body: JSON.stringify(o) }); };
function refreshValues() { if (!D) return; renderCards(); renderBreakdown(); bucket = null; update(); }

// settings below the chart are saved while typing (no save button)
let saveTimer = null;
const saveNow = async () => {
  clearTimeout(saveTimer); saveTimer = null;
  await putSettings({ ...readFields($('#alarmbar')), ...readFields($('#settings')) });
  monthlyInfo(); refreshValues();
};
const autosave = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow().then(() => flash('Saved ✓'), e => flash('Not saved: ' + e.message)), 400);
};
for (const root of [$('#alarmbar'), $('#settings')]) ['input', 'change'].forEach(ev => root.addEventListener(ev, autosave));
$('#recips').addEventListener('click', e => {  // remove a recipient (a handler must not return false: that would block the tick boxes)
  if (e.target.classList.contains('del')) { e.target.closest('.recip').remove(); autosave(); }
});
$$('.test').forEach(b => b.onclick = async () => {
  const out = t => $$('.testOut').forEach(el => el.textContent = t);
  out('Sending…');
  try {
    await saveNow();
    const only = $$('.recip').map((row, i) => $('[data-t]', row).checked ? i : -1).filter(i => i >= 0);
    if (!only.length) return out('Tick “Test” next to the recipients who should get the test message.');
    const r = await api('test-notify', { method: 'POST', body: JSON.stringify({ channel: b.dataset.ch, only }) });
    out(Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(' · '));
  } catch (e) { out(e.message); }
});

// message templates popup
const dlg = $('#msgDialog');
$('#phAlarm').textContent = TEMPLATE_FIELDS.alarm.map(f => `{${f}}`).join(' ');
$('#phSummary').textContent = TEMPLATE_FIELDS.summary.map(f => `{${f}}`).join(' ');
function sampleFields(k) {
  if (k === 'msg_summary') return { from: 'Fri 10.10. 14:00', to: 'Sat 11.10. 14:00', avg: '8.40', min: '1.20', min_time: 'Sat 11.10. 03:00',
    max: '21.70', max_time: 'Fri 10.10. 18:00', basis: alarmBasis(S), weekday: 'Fri', date: '10.10.' };
  const kind = k === 'msg_high' ? 'high' : 'low', t = Math.floor(Date.now() / 9e5) * 900 + 7200;
  return windowFields(S, kind, { start: t, end: t + 5400, ps: [[kind === 'high' ? S.high + 1.5 : S.low - 0.5, 5400]] });
}
const preview = () => $$('[data-m]', dlg).forEach(t => $(`[data-p=${t.dataset.m}]`, dlg).textContent = 'Example: ' + fillTemplate(t.value, sampleFields(t.dataset.m)));
$$('.openMsg').forEach(b => b.onclick = () => {
  $$('[data-m]', dlg).forEach(t => t.value = S[t.dataset.m] || MSG_DEFAULTS[t.dataset.m]);
  $('#msgErr').textContent = ''; preview(); dlg.showModal();
});
dlg.addEventListener('input', preview);
$('#msgDefaults').onclick = () => { $$('[data-m]', dlg).forEach(t => t.value = MSG_DEFAULTS[t.dataset.m]); preview(); };
$('#msgCancel').onclick = () => dlg.close();
$('#msgForm').onsubmit = async e => {
  e.preventDefault();
  try {
    await putSettings(Object.fromEntries($$('[data-m]', dlg).map(t => [t.dataset.m, t.value.trim() || MSG_DEFAULTS[t.dataset.m]])));
    dlg.close(); flash('Messages saved ✓');
  } catch (err) { $('#msgErr').textContent = err.message; }
};

// ---------------------------------------------------------------- api, login, account
async function api(path, opts = {}) {
  if (LOCAL) return LOCAL.api(path, opts);
  const r = await fetch('/api/' + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== 'login') { screen('login'); throw new Error('login required'); }
  if (r.status === 403) { openChange(true); throw new Error(j.detail); }
  if (!r.ok) throw new Error(j.detail || r.statusText);
  return j;
}
const screen = name => ['loading', 'login', 'change', 'main'].forEach(n => $('#' + n).classList.toggle('hidden', n !== name));
function openChange(forced) {
  $('#changeCancel').classList.toggle('hidden', forced);
  $('#changeHint').classList.toggle('hidden', !forced);
  $('#changeErr').textContent = '';
  $('#changeForm').reset();
  screen('change');
}
async function boot() {
  let me;
  try { me = await api('me'); } catch (e) {
    if (e.message !== 'login required') {  // server not running or not reachable
      screen('login');
      $('#loginErr').textContent = 'Cannot reach the server. Is it running? (' + e.message + ')';
    }
    return;
  }
  if (me.must_change) return openChange(true);
  $('#who').textContent = '👤 ' + me.username;
  if (me.dev) ['#account', '#logout'].forEach(s => $(s).classList.add('hidden'));
  screen('main');
  load();
}
$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  try {
    await api('login', { method: 'POST', body: JSON.stringify({ username: $('#user').value, password: $('#pw').value }) });
    $('#pw').value = ''; $('#loginErr').textContent = ''; boot();
  } catch (err) { $('#loginErr').textContent = err.message; }
};
$('#changeForm').onsubmit = async e => {
  e.preventDefault();
  if ($('#newPw').value !== $('#newPw2').value) return $('#changeErr').textContent = 'New passwords do not match';
  try {
    await api('account', { method: 'POST', body: JSON.stringify({ password: $('#curPw').value, new_username: $('#newUser').value, new_password: $('#newPw').value }) });
    boot();
  } catch (err) { $('#changeErr').textContent = err.message; }
};
$('#changeCancel').onclick = () => screen('main');
$('#account').onclick = () => openChange(false);
$('#logout').onclick = () => api('logout', { method: 'POST' }).then(() => screen('login'));
$('#refresh').onclick = async () => {
  flash('Refreshing…');
  try { const r = await api('refresh', { method: 'POST' }); await load(); flash(Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(' · ')); }
  catch (e) { flash('Refresh: ' + e.message); }
};
const flash = t => { $('#status').textContent = t; clearTimeout(flash.t); flash.t = setTimeout(status, 5000); };

// ---------------------------------------------------------------- toolbar
function seg(id, cur, fn) {
  const el = $('#' + id), mark = v => $$('button', el).forEach(b => b.classList.toggle('on', b.dataset.v === v));
  mark(cur);
  el.onclick = e => { const v = e.target.dataset.v; if (v) { mark(v); fn(v); } };
  return mark;
}
seg('mode', mode, v => { store('mode', mode = v); build(); });
const markTab = seg('tabs', tab, v => { tab = v; build(); });
const check = (id, cur, fn) => { $('#' + id).checked = cur; $('#' + id).onchange = e => fn(e.target.checked); };
check('vat', vat, v => { vat = v; store('vat', v ? '1' : '0'); build(); });
check('avg', avgOn, v => { avgOn = v; store('avg', v ? '1' : '0'); update(); });
check('cmp', cmp, v => { cmp = v; store('cmp', v ? '1' : '0'); showTabs(); });
function showTabs() {
  $('#tabs').classList.toggle('hidden', !cmp);
  if (!cmp && tab === 'compare') { tab = 'prices'; markTab(tab); build(); }
}
showTabs();

const midnight = (days = 0) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days); return +d; };
const defaultView = () => ({ min: midnight(-3), max: midnight(3) });
const isoDate = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
async function showRange(min, max) {
  touched = 0;
  const need = Math.ceil((Date.now() - min) / DAY) + 1;
  if (need > loadedDays) await load(Math.min(366, need));
  setView(min, max);
}
$('#preset').onchange = e => {
  const v = e.target.value;
  if (v === 'default') { const d = defaultView(); showRange(d.min, d.max); }
  else if (v !== 'custom') showRange(midnight(-+v), midnight(2));
};
['from', 'to'].forEach(id => $('#' + id).onchange = () => {
  const a = $('#from').value, b = $('#to').value;
  if (!a || !b) return;
  $('#preset').value = 'custom';
  const min = +new Date(a + 'T00:00'), max = +new Date(b + 'T00:00') + DAY;
  showRange(Math.min(min, max - DAY), Math.max(max, min + DAY));
});
$$('[data-z]').forEach(b => b.onclick = () => {
  const z = b.dataset.z;
  touched = 0;  // stop a still-running smooth scroll from moving the new view
  if (z === 'x+') zoomX(0.5); else if (z === 'x-') zoomX(2);
  else if (z === 'y+') { yZoom = Math.min(20, yZoom * 1.5); update(); }
  else if (z === 'y-') { yZoom = Math.max(1, yZoom / 1.5); if (yZoom < 1.01) yZoom = 1; update(); }
  else { yZoom = 1; yPos = 0.5; $('#preset').value = 'default'; const d = defaultView(); setView(d.min, d.max); }
});

// ---------------------------------------------------------------- data and chart
async function load(days = loadedDays) {
  try { D = await api('data?days_back=' + days); } catch (e) { if (e.message !== 'login required') flash('Cannot load data: ' + e.message); return; }
  loadedDays = Math.max(days, 60); S = D.settings;
  if (!filled) { fillSettings(); filled = true; }
  if (!view) view = defaultView();
  build();
}
const css = v => getComputedStyle(document.body).getPropertyValue(v).trim();
const hm = d => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayFmt = ms => { const d = new Date(ms); return `${WD[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`; };
const fmt = v => v == null || !isFinite(v) ? '–' : v.toFixed(2);
const val = r => priceValue(S, r[0], r[1], mode, vat);
const lastActual = () => D.actual.length ? D.actual.at(-1)[0] : 0;
const showThr = () => mode === S.alarm_basis && vat === S.alarm_vat;
const bucketStart = (ts, b) => { const off = -new Date(ts * 1000).getTimezoneOffset() * 60; return Math.floor((ts + off) / b) * b - off; };

function agg(rows, b, f, tail) {  // [[ts, v]] -> [{x, y}] averaged per bucket of b seconds (local time)
  const out = []; let key = null, sum = 0, n = 0;
  const push = () => n && out.push({ x: key * 1000, y: sum / n });
  for (const r of rows) {
    const k = b === 900 ? r[0] : bucketStart(r[0], b);
    if (k !== key) { push(); key = k; sum = 0; n = 0; }
    sum += f(r); n++;
  }
  push();
  if (tail && out.length) out.push({ x: out.at(-1).x + (out.length > 1 ? out.at(-1).x - out.at(-2).x : b * 1000), y: out.at(-1).y });
  return out;
}

function extent() {
  const dv = defaultView(), la = lastActual(), first = D.actual.length ? D.actual[0][0] * 1000 : dv.min;
  if (tab === 'compare') return { min: Math.min(first, dv.min), max: la ? (la + 900) * 1000 : dv.max };
  const ends = [la && la + 900, D.forecast.at(-1)?.[0] + 3600, D.wind.at(-1)?.[0]].filter(Boolean).map(t => t * 1000);
  return { min: Math.min(first, dv.min), max: Math.max(dv.max, ...ends) };
}
function setView(min, max) {
  if (!D) return;
  const e = extent(), span = Math.min(Math.max(max - min, MIN_SPAN), e.max - e.min);
  min = Math.max(e.min, Math.min(min, e.max - span));
  view = { min, max: min + span };
  update();
}
const zoomTo = (span, c, r) => setView(c - r * span, c - r * span + span);
const zoomX = (f, c = (view.min + view.max) / 2) => zoomTo((view.max - view.min) * f, c, (c - view.min) / (view.max - view.min));

function series() {
  const la = lastActual(), price = (label, rows, color, extra) => ({ label, rows, kind: 'price', borderColor: color, ...extra });
  const slot = Math.floor(Date.now() / 9e5) * 900;  // start of the current 15-min slot
  const list = tab === 'compare' ? [
    price('Actual c/kWh', D.actual, css('--accent')),
    price('Estimate before publish c/kWh', D.forecast.filter(r => r[0] <= la), css('--est'), { borderDash: [6, 4] }),
  ] : [
    price('Price c/kWh', D.actual.filter(r => r[0] <= slot), css('--accent'), { fill: 'origin', backgroundColor: css('--accent-bg') }),
    price('Fixed future price c/kWh', D.actual.filter(r => r[0] >= slot), css('--fixed'), { fill: 'origin', backgroundColor: css('--fixed-bg') }),
    price('Estimate (not fixed) c/kWh', D.forecast.filter(r => r[0] > la), css('--est'), { borderDash: [6, 4] }),
    { label: 'Wind forecast MW', rows: D.wind, kind: 'wind', borderColor: css('--wind'), backgroundColor: css('--wind-bg'), fill: 'origin', tension: .3 },
    { label: 'Wind actual MW', rows: D.wind_actual, kind: 'wind', borderColor: css('--wind-act') },
  ];
  return list.filter(d => d.rows.length);
}

function makeTicks(min, max, width) {
  const H = (max - min) / 36e5, n = Math.max(2, width / 46);
  tickStep = [0.25, 0.5, 1, 2, 3, 6, 12, 24, 48, 168, 720].find(s => H / s <= n) || 720;  // 15 min … daily … monthly
  const d = new Date(min); d.setSeconds(0, 0);
  if (tickStep < 1) d.setMinutes(Math.floor(d.getMinutes() / (tickStep * 60)) * tickStep * 60);
  else {
    d.setMinutes(0);
    if (tickStep === 720) d.setDate(1);
    if (tickStep >= 24) d.setHours(0); else d.setHours(Math.floor(d.getHours() / tickStep) * tickStep);
  }
  const out = [];
  for (let i = 0; +d <= max && i < 400; i++) {
    if (+d >= min) out.push({ value: +d });
    if (tickStep === 720) d.setMonth(d.getMonth() + 1); else if (tickStep >= 24) d.setDate(d.getDate() + tickStep / 24); else d.setMinutes(d.getMinutes() + tickStep * 60);
  }
  return out;
}
function tickLabel(value, i, ticks) {
  const d = new Date(value);
  if (tickStep === 720) return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  const p = i ? new Date(ticks[i - 1].value) : null, day = !p || p.toDateString() !== d.toDateString() ? dayFmt(d) : ' ';
  return tickStep >= 24 ? day : [hm(d), day];  // hours on top, day below
}

const overlay = {
  id: 'overlay', afterDatasetsDraw(c) {
    const { left, right, top, bottom } = c.chartArea, g = c.ctx, x = c.scales.x, y = c.scales.y;
    const hline = (v, color, label) => {
      const py = y.getPixelForValue(v); if (py < top || py > bottom) return;
      g.strokeStyle = g.fillStyle = color; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(left, py); g.lineTo(right, py); g.stroke();
      if (label) {
        g.setLineDash([]); g.font = '600 12px sans-serif';
        const w = g.measureText(label).width + 10;
        g.fillStyle = '#fde047'; g.fillRect(left + 4, py - 18, w, 16);
        g.fillStyle = '#111827'; g.fillText(label, left + 9, py - 6);
      }
    };
    g.save(); g.lineWidth = 1;
    if (view.max - view.min <= 14 * DAY) {  // day separators
      g.strokeStyle = css('--grid-strong');
      for (let d = new Date(view.min); +d <= view.max; d.setDate(d.getDate() + 1)) {
        d.setHours(0, 0, 0, 0); const px = x.getPixelForValue(+d);
        if (px > left && px < right) { g.beginPath(); g.moveTo(px, top); g.lineTo(px, bottom); g.stroke(); }
      }
    }
    if (showThr()) { if (S.high_on) hline(S.high, css('--hi')); if (S.low_on) hline(S.low, css('--lo')); }
    if (avgOn && avgVal != null) hline(avgVal, css('--fg'), `avg ${fmt(avgVal)}`);
    if (sel != null) {
      const sx = x.getPixelForValue(sel * 1000);
      if (sx > left && sx < right) { g.setLineDash([2, 3]); g.strokeStyle = css('--muted'); g.beginPath(); g.moveTo(sx, top); g.lineTo(sx, bottom); g.stroke(); }
    }
    const nx = x.getPixelForValue(Date.now());
    if (nx > left && nx < right) { g.setLineDash([]); g.strokeStyle = css('--fg'); g.beginPath(); g.moveTo(nx, top); g.lineTo(nx, bottom); g.stroke(); }
    g.restore();
  },
};

function build() {
  if (!D) return;
  if (typeof Chart === 'undefined') { renderCards(); status(); return fatal('The chart library could not be loaded. Check the internet connection and reload.'); }
  chart?.destroy();
  renderCards(); renderBreakdown();
  const grid = { color: css('--grid') }, ticks = { color: css('--muted') }, small = innerWidth < 600;
  const datasets = series().map(d => ({ ...d, data: [], pointRadius: 0, borderWidth: d.kind === 'wind' ? 1.5 : 2,
    stepped: d.kind === 'price' ? 'after' : false, yAxisID: d.kind === 'price' ? 'y' : 'y1' }));
  chart = new Chart($('#chart'), {
    type: 'line', data: { datasets }, plugins: [overlay],
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
      interaction: { mode: 'x', intersect: false }, elements: { point: { hitRadius: 4 } },
      onClick: (evt, _, ch) => { sel = ch.scales.x.getValueForPixel(evt.x) / 1000; renderBreakdown(); ch.draw(); },
      scales: {
        x: { type: 'time', grid, afterBuildTicks: sc => { sc.ticks = makeTicks(sc.min, sc.max, sc.width || 600); },
          ticks: { ...ticks, autoSkip: false, maxRotation: 0, callback: tickLabel } },
        y: { grid, ticks: { ...ticks, callback: v => +v.toFixed(1) }, title: { display: !small, text: 'c/kWh', color: ticks.color } },
        y1: { display: tab !== 'compare', position: 'right', min: 0, grid: { display: false }, ticks,
          title: { display: !small, text: 'MW', color: ticks.color } },
      },
      plugins: {
        legend: { labels: { color: css('--fg'), boxWidth: 12, font: { size: small ? 10 : 12 } } },
        tooltip: { filter: (it, i, all) => all.findIndex(o => o.datasetIndex === it.datasetIndex) === i, callbacks: {
          title: it => it.length ? `${dayFmt(it[0].parsed.x)} ${hm(it[0].parsed.x)}` + (bucket > 900 ? `–${hm(it[0].parsed.x + bucket * 1000)}` : '') : '',
          label: c => `${c.dataset.label}: ${c.parsed.y.toFixed(c.dataset.kind === 'price' ? 2 : 0)}` } },
      },
    },
  });
  $('#legend').textContent = tab === 'compare'
    ? '· solid = published day-ahead price · dashed = estimate made before the price was published'
    : '· blue = published price up to now · green = published future price (fixed) · orange dashed = estimate (not fixed) · cyan = wind power MW';
  bucket = null;
  setView(view.min, view.max);
  status();
}

function yRange() {
  let lo = Infinity, hi = -Infinity;
  for (const d of chart.data.datasets) if (d.kind === 'price')
    for (const p of d.data) if (p.x >= view.min - bucket * 1000 && p.x <= view.max) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); }
  if (!isFinite(lo)) return [0, 10];
  if (showThr()) for (const k of ['high', 'low']) if (S[k + '_on']) { lo = Math.min(lo, S[k]); hi = Math.max(hi, S[k]); }
  const pad = (hi - lo) * 0.08 || 1;
  return [Math.min(0, lo - pad), hi + pad];
}
function visible(rows) { const a = view.min / 1000, b = view.max / 1000; return rows.filter(r => r[0] >= a && r[0] < b); }

function update() {
  if (!chart || !view) return;
  const W = chart.chartArea?.width || 600, span = view.max - view.min;
  const b = BUCKETS.find(x => span / 1000 / x <= W / 2) || 86400;
  if (b !== bucket) {
    bucket = b;
    for (const d of chart.data.datasets) d.data = agg(d.rows, b, d.kind === 'price' ? val : r => r[1], d.kind === 'price');
  }
  // time-weighted average of published prices in the visible range
  const vis = visible(D.actual);
  let sw = 0, sv = 0;
  vis.forEach((r, i) => { const w = Math.min(3600, (vis[i + 1]?.[0] ?? r[0] + 900) - r[0]); sw += w; sv += val(r) * w; });
  avgVal = sw ? sv / sw : null;
  Object.assign(chart.options.scales.x, { min: view.min, max: view.max });
  let [lo, hi] = yRange(); lo = Math.floor(lo); hi = Math.ceil(hi);
  const h = (hi - lo) / yZoom, top = hi - yPos * (hi - lo - h);
  Object.assign(chart.options.scales.y, { min: top - h, max: top });
  chart.update('none');
  syncScroll(); info();
  $('#from').value = isoDate(view.min); $('#to').value = isoDate(view.max - 1);
}

function info() {
  let t = `Resolution ${RES[bucket]}`;
  if (avgOn) t += ` · average ${fmt(avgVal)} c/kWh (${NAMES[mode]}, ${vat ? 'incl.' : 'excl.'} VAT)`;
  if (tab === 'compare') {  // hourly comparison of estimate vs actual in view
    const hourly = rows => { const m = new Map(); agg(visible(rows), 3600, val).forEach(p => m.set(p.x, p.y)); return m; };
    const a = hourly(D.actual), f = hourly(D.forecast); let n = 0, err = 0, bias = 0;
    f.forEach((v, x) => { if (a.has(x)) { n++; err += Math.abs(v - a.get(x)); bias += v - a.get(x); } });
    t += n ? ` · estimate error avg ${fmt(err / n)} c/kWh, bias ${bias >= 0 ? '+' : ''}${fmt(bias / n)} (${n} h)` : ' · no estimates recorded for this period yet';
  }
  $('#info').textContent = t;
}

// ---------------------------------------------------------------- scrollbars, pinch, pan
let expectH = -1, expectV = -1, dragging = false;
const userActive = el => dragging || Date.now() - touched < 1000 || el.matches(':hover');
for (const el of [$('#hscroll'), $('#vscroll')]) {
  el.addEventListener('pointerdown', () => dragging = true);
  ['wheel', 'touchmove', 'keydown'].forEach(ev => el.addEventListener(ev, () => touched = Date.now(), { passive: true }));
}
addEventListener('pointerup', () => { if (dragging) touched = Date.now(); dragging = false; });
function syncScroll() {
  const e = extent(), full = e.max - e.min, span = view.max - view.min, h = $('#hscroll'), v = $('#vscroll');
  h.firstElementChild.style.width = Math.max(100, full / span * 100) + '%';
  const maxH = h.scrollWidth - h.clientWidth;
  h.scrollLeft = expectH = Math.round(full > span ? (view.min - e.min) / (full - span) * maxH : 0);
  v.classList.toggle('off', yZoom <= 1);
  v.firstElementChild.style.height = yZoom * 100 + '%';
  v.scrollTop = expectV = Math.round(yPos * (v.scrollHeight - v.clientHeight));
}
$('#hscroll').addEventListener('scroll', ({ target: h }) => {
  if (!userActive(h)) { if (Math.abs(h.scrollLeft - expectH) >= 2) h.scrollLeft = expectH; return; }
  const e = extent(), span = view.max - view.min, maxH = h.scrollWidth - h.clientWidth;
  const min = e.min + (maxH ? h.scrollLeft / maxH : 0) * (e.max - e.min - span);
  setView(min, min + span);
});
$('#vscroll').addEventListener('scroll', ({ target: v }) => {
  if (!userActive(v)) { if (Math.abs(v.scrollTop - expectV) >= 2) v.scrollTop = expectV; return; }
  const maxV = v.scrollHeight - v.clientHeight;
  yPos = maxV ? v.scrollTop / maxV : 0.5;
  update();
});
const cv = $('#chart'), pxToMs = px => px / chart.chartArea.width * (view.max - view.min);
const centerOf = clientX => chart.scales.x.getValueForPixel(clientX - cv.getBoundingClientRect().left);
cv.addEventListener('wheel', e => {  // trackpad pinch arrives as ctrl+wheel (Chrome, Edge, Firefox)
  if (!chart) return;
  if (e.ctrlKey) { e.preventDefault(); zoomX(Math.exp(e.deltaY * 0.01), centerOf(e.clientX)); }
  else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { e.preventDefault(); const d = pxToMs(e.deltaX); setView(view.min + d, view.max + d); }
}, { passive: false });
let g0 = null, t0 = null;  // Safari trackpad pinch uses gesture events
cv.addEventListener('gesturestart', e => {
  e.preventDefault(); if (t0) return;
  const c = centerOf(e.clientX); g0 = { span: view.max - view.min, c, r: (c - view.min) / (view.max - view.min) };
});
cv.addEventListener('gesturechange', e => { e.preventDefault(); if (g0 && !t0) zoomTo(g0.span / e.scale, g0.c, g0.r); });
cv.addEventListener('gestureend', e => { e.preventDefault(); g0 = null; });
const tdist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
cv.addEventListener('touchstart', e => {  // phone/tablet: pinch to zoom, drag sideways to pan
  const t = e.touches, s = view.max - view.min;
  if (t.length === 2) { const c = centerOf((t[0].clientX + t[1].clientX) / 2); t0 = { n: 2, d: tdist(t), s, c, r: (c - view.min) / s }; }
  else if (t.length === 1) t0 = { n: 1, x: t[0].clientX, y: t[0].clientY, min: view.min, s };
}, { passive: true });
cv.addEventListener('touchmove', e => {
  const t = e.touches;
  if (!t0) return;
  if (t.length === 2 && t0.n === 2) { e.preventDefault(); zoomTo(t0.s * t0.d / tdist(t), t0.c, t0.r); }
  else if (t.length === 1 && t0.n === 1) {
    const dx = t[0].clientX - t0.x;
    if (Math.abs(dx) > Math.abs(t[0].clientY - t0.y)) { const m = t0.min - pxToMs(dx); setView(m, m + t0.s); }
  }
}, { passive: false });
cv.addEventListener('touchend', e => { if (!e.touches.length) t0 = null; });

// ---------------------------------------------------------------- cards and status
function renderCards() {
  const now = Date.now() / 1000, a = D.actual, t0 = midnight() / 1000, t1 = t0 + 86400, t2 = t1 + 86400;
  const stats = rows => { if (!rows.length) return null; const v = rows.map(val); return { avg: v.reduce((x, y) => x + y) / v.length, min: Math.min(...v), max: Math.max(...v) }; };
  const cur = a.filter(r => r[0] <= now).at(-1);
  const today = stats(a.filter(r => r[0] >= t0 && r[0] < t1)), tom = stats(a.filter(r => r[0] >= t1 && r[0] < t2));
  const fut = a.filter(r => r[0] >= now - 900), step = fut.length > 1 ? fut[1][0] - fut[0][0] : 3600, n = Math.round(10800 / step);
  let best = null;
  for (let i = 0; i + n <= fut.length; i++) {
    const avg = fut.slice(i, i + n).reduce((s, r) => s + val(r), 0) / n;
    if (!best || avg < best.avg) best = { avg, ts: fut[i][0] };
  }
  const w = D.wind_actual.filter(r => r[0] <= now).at(-1) || D.wind.find(r => r[0] >= now - 3600);
  const p = cur && val(cur), cls = p == null || !showThr() ? '' : S.high_on && p >= S.high ? 'hi' : S.low_on && p <= S.low ? 'lo' : '';
  const tr = cur && priceParts(S, cur[0], cur[1]);
  const card = (id, t, v, sub, c = '') => `<div class="card stat ${c}" data-id="${id}"><button class="info" type="button" aria-label="What does this mean?">i</button>` +
    `<small>${t}</small><b>${v}</b><span>${sub}</span><p class="desc${openInfo.has(id) ? '' : ' hidden'}">${INFO[id]}</p></div>`;
  $('#cards').innerHTML =
    card('now', `Now · ${NAMES[mode]}`, fmt(p), `c/kWh ${vat ? 'incl.' : 'excl.'} VAT` + (cur ? ' · ' + hm(cur[0] * 1000) : ''), cls) +
    card('transfer', 'Transfer now', tr ? fmt(priceValue(S, cur[0], cur[1], 'transfer', vat)) : '–', tr ? `${tr.night ? 'night' : 'day'} rate + tax · ${vat ? 'incl.' : 'excl.'} VAT` : '') +
    card('today', 'Today avg', today ? fmt(today.avg) : '–', today ? `${fmt(today.min)} – ${fmt(today.max)}` : '') +
    card('tomorrow', 'Tomorrow avg', tom ? fmt(tom.avg) : '–', tom ? `${fmt(tom.min)} – ${fmt(tom.max)}` : 'published ~14:00') +
    card('cheap', 'Cheapest 3h', best ? hm(best.ts * 1000) : '–', best ? `avg ${fmt(best.avg)} c/kWh` : '') +
    card('wind', 'Wind', w ? Math.round(w[1]) : '–', 'MW' + (w ? ' · ' + hm(w[0] * 1000) : ''));
}
const INFO = {
  now: 'Price of the current 15-minute slot: the spot price or your total cost (buttons above the chart), with or without VAT (checkbox).',
  transfer: 'Your network transfer fee for this hour (day or night rate) plus electricity tax, from the Costs settings. It does not depend on the market.',
  today: "Average of today's prices. The small numbers are today's lowest and highest price.",
  tomorrow: "Average of tomorrow's prices, lowest and highest. Nord Pool publishes them around 14:00 Finnish time.",
  cheap: 'Start time of the cheapest 3-hour block in the already published prices from now on, and its average price. Good for laundry, dishwasher or car charging.',
  wind: 'Latest wind power production in Finland (or the forecast) in megawatts. More wind usually means cheaper electricity.',
};
const openInfo = new Set();
$('#cards').onclick = e => {
  const c = e.target.closest('.info')?.closest('.stat'); if (!c) return;
  openInfo.has(c.dataset.id) ? openInfo.delete(c.dataset.id) : openInfo.add(c.dataset.id);
  $('.desc', c).classList.toggle('hidden');
};

function renderBreakdown() {  // all cost parts of the picked chart point (default: now)
  if (!D) return;
  const t = sel ?? Date.now() / 1000, la = lastActual();
  let row = t < la + 900 ? D.actual.filter(r => r[0] <= t).at(-1) : null, est = false;
  if (!row) { row = D.forecast.filter(r => r[0] <= t).at(-1); est = true; }
  const box = $('#breakdown');
  if (!row) { box.innerHTML = '<h3>Price breakdown</h3><p class="hint">Click a point in the chart.</p>'; return; }
  const p = priceParts(S, row[0], row[1]), line = (l, v, c = '') => `<tr class="${c}"><td>${l}</td><td>${fmt(v)}</td></tr>`;
  box.innerHTML = `<h3>Price breakdown <small>c/kWh</small></h3>
    <p class="hint">${dayFmt(row[0] * 1000)} ${hm(row[0] * 1000)} · ${est ? 'estimate' : 'published price'}${sel == null ? ' (now)' : ''}. Click a point in the chart to change.</p>
    <table>${line('Spot price excl. VAT', p.spotEx)}${line(`VAT ${S.vat} % on spot`, p.vatOnSpot)}${line('Provider margin', p.margin)}` +
    `${line('Other per kWh', p.other)}${line(`Transfer (${p.night ? 'night' : 'day'})`, p.transferFee)}${line('Electricity tax', p.tax)}` +
    `${p.monthly ? line('Monthly fees per kWh', p.monthly) : ''}${line('Total incl. VAT', p.total, 'sum')}` +
    `${line('Total excl. VAT', p.spotEx + (p.total - p.spotEx - p.vatOnSpot) / p.k, 'muted')}</table>`;
}
function status() {
  if (!D) return;
  const la = lastActual();
  $('#status').textContent = `Published prices until ${la ? new Date(la * 1000).toLocaleString('fi-FI') : '–'}` +
    ` · Fingrid ${D.fingrid ? 'on' : 'off'}` + (D.errors?.length ? ' · ⚠ ' + D.errors.join(' · ') : '');
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', build);
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { bucket = null; update(); }, 250); });
document.addEventListener('visibilitychange', () => !document.hidden && $('#main:not(.hidden)') && load());
setInterval(() => $('#main:not(.hidden)') && load(), 5 * 60 * 1000);
boot();
