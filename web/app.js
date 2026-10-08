const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const store = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v); } catch { return null; } };
let filled = false, mode = store('mode') || 'total', range = +(store('range') || 1), S = {}, D = null, chart;

const FIELDS = {
  costs: [['margin', 'Provider margin'], ['transfer_day', 'Transfer (day)'], ['transfer_night', 'Transfer (night)'],
    ['night_start', 'Night starts (hour)', 1], ['night_end', 'Night ends (hour)', 1],
    ['tax', 'Electricity tax + supply fee'], ['other', 'Other per kWh'], ['vat', 'VAT %']],
  monthly: [['monthly_provider', 'Provider monthly fee €'], ['monthly_transfer', 'Transfer monthly fee €'],
    ['monthly_kwh', 'Monthly consumption kWh'], ['spread_monthly', 'Spread monthly fees into total c/kWh', 'cb']],
  notif: [['wa_phone', 'WhatsApp phone (+358…)', 'text'], ['wa_apikey', 'CallMeBot API key', 'text'],
    ['email_to', 'Email to', 'email'], ['hysteresis', 'Re-arm margin c/kWh'],
    ['quiet_start', 'Quiet from hour (-1 off)', 1], ['quiet_end', 'Quiet until hour', 1],
    ['summary_on', "Daily summary when tomorrow's prices publish", 'cb']],
};
const LOCAL = window.LOCAL;  // set by local.js when opened as a file
if (LOCAL) { FIELDS.notif.push(...LOCAL.fields); $('#emailHint').innerHTML = LOCAL.emailHint; $('#logout').classList.add('hidden'); }
for (const [id, list] of Object.entries(FIELDS))
  $('#' + id).innerHTML = list.map(([k, label, t]) => t === 'cb'
    ? `<label class="sw full"><input type="checkbox" data-k="${k}"><span>${label}</span></label>`
    : `<label>${label}<input data-k="${k}" type="${t === 'text' || t === 'email' ? t : 'number'}" step="${t === 1 ? 1 : 'any'}" ${t ? '' : 'inputmode="decimal"'}></label>`).join('');

async function api(path, opts = {}) {
  if (LOCAL) return LOCAL.api(path, opts);
  const r = await fetch('/api/' + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (r.status === 401 && path !== 'login') { show(false); throw new Error('login'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || r.statusText);
  return j;
}
const show = ok => { $('#login').classList.toggle('hidden', ok); $('#main').classList.toggle('hidden', !ok); };

$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  try { await api('login', { method: 'POST', body: JSON.stringify({ password: $('#pw').value }) }); $('#pw').value = ''; load(); }
  catch (err) { $('#loginErr').textContent = err.message; }
};
$('#logout').onclick = () => api('logout', { method: 'POST' }).then(() => show(false));

function seg(id, cur, fn) {
  const el = $('#' + id);
  const mark = v => $$('button', el).forEach(b => b.classList.toggle('on', b.dataset.v == v));
  mark(cur);
  el.onclick = e => { const v = e.target.dataset.v; if (v) { mark(v); fn(v); } };
}
seg('mode', mode, v => { store('mode', mode = v); render(); });
seg('range', range, v => { store('range', range = +v); load(); });

function fillSettings() {
  $$('[data-k]').forEach(el => { const v = S[el.dataset.k]; el.type === 'checkbox' ? el.checked = !!v : el.value = v ?? ''; });
  const fixed = S.monthly_provider + S.monthly_transfer;
  $('#monthlyInfo').textContent = `Fixed ${fixed.toFixed(2)} €/month` +
    (S.monthly_kwh > 0 ? ` ≈ ${(fixed * 100 / S.monthly_kwh).toFixed(2)} c/kWh at ${S.monthly_kwh} kWh` : '');
}
function readSettings() {
  const o = {};
  $$('[data-k]').forEach(el => {
    const k = el.dataset.k;
    o[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value.trim();
  });
  return o;
}
$$('.save').forEach(b => b.onclick = async () => {
  try { S = await api('settings', { method: 'PUT', body: JSON.stringify(readSettings()) }); fillSettings(); flash('Saved ✓'); load(); }
  catch (e) { flash('Error: ' + e.message); }
});
$('#test').onclick = async () => {
  $('#testOut').textContent = 'Sending…';
  try {
    await api('settings', { method: 'PUT', body: JSON.stringify(readSettings()) });
    const r = await api('test-notify', { method: 'POST' });
    $('#testOut').textContent = Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(' · ');
  } catch (e) { $('#testOut').textContent = e.message; }
};
const flash = t => { $('#status').textContent = t; setTimeout(() => status(), 3000); };

async function load() {
  try { D = await api('data?days_back=' + range); } catch { return; }
  show(true); S = D.settings; if (!filled) { fillSettings(); filled = true; } render();
}

const col = i => mode === 'total' ? i + 1 : i;  // rows: [ts, spot+VAT, total]
const css = v => getComputedStyle(document.body).getPropertyValue(v).trim();
const hm = ts => new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const fmt = v => v == null ? '–' : v.toFixed(2);

function stats(rows) {
  if (!rows.length) return null;
  const v = rows.map(r => r[col(1)]);
  return { avg: v.reduce((a, b) => a + b, 0) / v.length, min: Math.min(...v), max: Math.max(...v) };
}

function renderCards() {
  const now = Date.now() / 1000, a = D.actual, day = new Date(); day.setHours(0, 0, 0, 0);
  const t0 = day / 1000, t1 = t0 + 86400, t2 = t1 + 86400;
  const cur = [...a].reverse().find(r => r[0] <= now);
  const today = stats(a.filter(r => r[0] >= t0 && r[0] < t1)), tom = stats(a.filter(r => r[0] >= t1 && r[0] < t2));
  // cheapest upcoming 3h window in published prices
  const fut = a.filter(r => r[0] >= now - 900), step = fut.length > 1 ? fut[1][0] - fut[0][0] : 3600, n = Math.round(10800 / step);
  let best = null;
  for (let i = 0; i + n <= fut.length; i++) {
    const avg = fut.slice(i, i + n).reduce((s, r) => s + r[col(1)], 0) / n;
    if (!best || avg < best.avg) best = { avg, ts: fut[i][0] };
  }
  const w = [...D.wind_actual].reverse().find(r => r[0] <= now) || D.wind.find(r => r[0] >= now - 3600);
  const p = cur && cur[col(1)], cls = p == null ? '' : S.high_on && p >= S.high ? 'hi' : S.low_on && p <= S.low ? 'lo' : '';
  const card = (t, v, sub, c = '') => `<div class="card stat ${c}"><small>${t}</small><b>${v}</b><span>${sub}</span></div>`;
  $('#cards').innerHTML =
    card('Now', fmt(p), 'c/kWh' + (cur ? ' · ' + hm(cur[0]) : ''), cls) +
    card('Today avg', today ? fmt(today.avg) : '–', today ? `${fmt(today.min)} – ${fmt(today.max)}` : '') +
    card('Tomorrow avg', tom ? fmt(tom.avg) : '–', tom ? `${fmt(tom.min)} – ${fmt(tom.max)}` : 'published ~14:00') +
    card('Cheapest 3h', best ? hm(best.ts) : '–', best ? `avg ${fmt(best.avg)} c/kWh` : '') +
    card('Wind', w ? Math.round(w[1]) : '–', 'MW' + (w ? ' · ' + hm(w[0]) : ''));
}

const nowLine = {
  id: 'now', afterDatasetsDraw(c) {
    const x = c.scales.x.getPixelForValue(Date.now()), { top, bottom } = c.chartArea, g = c.ctx;
    const line = (y, color) => { g.strokeStyle = color; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(c.chartArea.left, y); g.lineTo(c.chartArea.right, y); g.stroke(); };
    g.save(); g.lineWidth = 1;
    if (S.alarm_basis === mode) {
      if (S.high_on) line(c.scales.y.getPixelForValue(S.high), css('--hi'));
      if (S.low_on) line(c.scales.y.getPixelForValue(S.low), css('--lo'));
    }
    g.setLineDash([]); g.strokeStyle = css('--fg'); g.beginPath(); g.moveTo(x, top); g.lineTo(x, bottom); g.stroke();
    g.restore();
  }
};

function render() {
  if (!D) return;
  renderCards();
  const pts = rows => rows.map(r => ({ x: r[0] * 1000, y: r[col(1)] }));
  const segColor = ctx => {
    const y = ctx.p0.parsed.y, on = S.alarm_basis === mode;
    return on && S.high_on && y >= S.high ? css('--hi') : on && S.low_on && y <= S.low ? css('--lo') : css('--accent');
  };
  const wind = r => r.map(([t, v]) => ({ x: t * 1000, y: v }));
  const datasets = [
    { label: 'Price c/kWh', data: pts(D.actual), stepped: 'after', borderWidth: 2, pointRadius: 0, yAxisID: 'y',
      segment: { borderColor: segColor }, borderColor: css('--accent'), fill: 'origin', backgroundColor: css('--accent-bg') },
    { label: 'Estimate c/kWh', data: pts(D.forecast), stepped: 'after', borderDash: [6, 4], borderWidth: 2, pointRadius: 0,
      yAxisID: 'y', borderColor: css('--est') },
    { label: 'Wind forecast MW', data: wind(D.wind), borderWidth: 1.5, pointRadius: 0, tension: .3, yAxisID: 'y1',
      borderColor: css('--wind'), backgroundColor: css('--wind-bg'), fill: 'origin' },
    { label: 'Wind actual MW', data: wind(D.wind_actual), borderWidth: 1.5, pointRadius: 0, yAxisID: 'y1', borderColor: css('--wind-act') },
  ].filter(d => d.data.length);
  const grid = { color: css('--grid') }, ticks = { color: css('--muted') };
  const small = innerWidth < 600;
  const cfg = {
    type: 'line', data: { datasets }, plugins: [nowLine],
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
      interaction: { mode: 'x', intersect: false }, elements: { point: { hitRadius: 4 } },
      scales: {
        x: { type: 'time', time: { tooltipFormat: 'EEE d.M. HH:mm', displayFormats: { hour: 'HH:mm', day: 'EEE d.M.' } }, grid, ticks: { ...ticks, maxRotation: 0 } },
        y: { suggestedMin: S.alarm_basis === mode && S.low_on ? S.low - 1 : undefined, suggestedMax: S.alarm_basis === mode && S.high_on ? S.high + 1 : undefined, title: { display: !small, text: 'c/kWh', color: ticks.color }, grid, ticks },
        y1: { position: 'right', min: 0, title: { display: !small, text: 'MW', color: ticks.color }, grid: { display: false }, ticks },
      },
      plugins: {
        legend: { labels: { color: css('--fg'), boxWidth: 12, font: { size: small ? 10 : 12 } } },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y.toFixed(c.dataset.yAxisID === 'y' ? 2 : 0)}` } },
      },
    },
  };
  chart?.destroy();
  chart = new Chart($('#chart'), cfg);
  const last = D.actual.at(-1);
  $('#status').textContent = `Published prices until ${last ? new Date(last[0] * 1000).toLocaleString('fi-FI') : '–'}` +
    ` · email ${D.smtp ? 'configured' : 'not configured'} · Fingrid ${D.fingrid ? 'on' : 'off'}` +
    (D.errors?.length ? ' · ⚠ ' + D.errors.join(' · ') : '');
}
const status = () => D && render();

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(render, 250); });
document.addEventListener('visibilitychange', () => !document.hidden && load());
setInterval(load, 5 * 60 * 1000);
load();
