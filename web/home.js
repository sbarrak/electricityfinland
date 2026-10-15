// The sections of the page (Now, Explore, Usage, Alerts, Settings), their navigation, the user's layout
// (Signal, Studio or Calm; saved with their settings as ui_layout) and the Now page drawn in that layout.
// Loaded before app.js: everything here that touches the data runs later and uses the helpers of app.js
// (D, S, val, alarmVal, agg, windows, priceParts, priceValue, breakdownHtml, onTab, build, ...).
const Home = (() => {
  const LAYOUTS = ['signal', 'studio', 'calm'];
  const PAGES = [['now', 'Now'], ['explore', 'Explore'], ['usage', 'Usage'], ['alerts', 'Alerts'], ['settings', 'Settings']];
  const ICONS = {
    now: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z"/>',
    explore: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    usage: '<path d="M12 3v3M5.6 5.6l2 2M3 12h3M18 12h3M16.4 7.6l2-2"/><path d="M12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12z"/><path d="M12 15l2.5-2.5"/>',
    alerts: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16z"/><path d="M10 21h4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  };
  const WX_ICONS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
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
  const KIND = { past: 'published', fix: 'fixed, still to come', est: 'estimate' };
  const q = (s, el = document) => el.querySelector(s), qa = (s, el = document) => [...el.querySelectorAll(s)];
  const ls = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v); } catch { return null; } };
  const svgIcon = (d, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const wxUse = (name, cls = 'wxi') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const H = 36e5;

  let layout = LAYOUTS.includes(ls('layout')) ? ls('layout') : 'signal';  // the last layout on this device, until the settings arrive
  let built = null, page = 'now', prevTab = 'prices';
  let dday = 0, studioRange = ls('hStudio') || '3d', calmRange = ls('hCalm') || '0', pickT = null;
  document.body.dataset.layout = layout;

  // ---------------------------------------------------------------- data helpers
  const nextDay = ms => { const d = new Date(ms); d.setDate(d.getDate() + 1); return +d; };
  const rel = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); const n = Math.round((+d - midnight()) / DAY);
    return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : `${WD[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`; };
  const stateOf = a => { const v = +a.toFixed(2); return S.high_on && v >= S.high ? 'hi' : S.low_on && v <= S.low ? 'lo' : ''; };
  const limitsShown = () => mode === S.alarm_basis && vat === S.alarm_vat;
  const current = () => D.actual.filter(r => r[0] <= Date.now() / 1000).at(-1);
  function dayStats(d0) {  // published prices of the local day starting at d0 (ms)
    const a = d0 / 1000, b = nextDay(d0) / 1000, v = D.actual.filter(r => r[0] >= a && r[0] < b).map(val);
    return v.length ? { avg: v.reduce((x, y) => x + y) / v.length, min: Math.min(...v), max: Math.max(...v), n: v.length } : null;
  }
  const best = h => windows(h * 3600).reduce((x, y) => !x || y.avg < x.avg ? y : x, null);
  const windNow = () => { const t = Date.now() / 1000; return D.wind_actual.filter(r => r[0] <= t).at(-1) || D.wind.find(r => r[0] >= t - 3600); };
  // the bars between a and b (ms): published prices, then the estimate after the last published one
  function points(a, b, sec) {
    const la = lastActual(), slot = Math.floor(Date.now() / 9e5) * 9e5, now = Date.now(), cap = Math.max(sec * 1000, H) * 1.1, out = [];
    const sets = [[D.actual.filter(r => r[0] * 1000 >= a && r[0] * 1000 < b), false], [D.forecast.filter(r => r[0] > la && r[0] * 1000 >= a && r[0] * 1000 < b), true]];
    for (const [rows, est] of sets) {
      const pts = agg(rows, sec, val, false, alarmVal);
      pts.forEach((p, k) => {
        const n = pts[k + 1], w = n && n.x - p.x <= cap ? n.x - p.x : Math.min(k ? p.x - pts[k - 1].x : sec * 1000, cap);
        out.push({ ...p, w, kind: est ? 'est' : p.x > slot ? 'fix' : 'past', state: stateOf(p.a), passed: p.x + w <= now, now: p.x <= now && now < p.x + w });
      });
    }
    return out.sort((x, y) => x.x - y.x);
  }
  function insight() {
    const cur = current(), td = dayStats(midnight()), tm = dayStats(midnight(1)), ch = best(3);
    if (!cur) return { cur, td, tm, ch, state: 'No price', tone: '', sentence: 'There is no published price for this moment yet.' };
    const v = val(cur), st = stateOf(alarmVal(cur)), d = td ? v - td.avg : 0;
    const state = st === 'hi' ? 'High price' : st === 'lo' ? 'Low price' : Math.abs(d) < .4 ? 'Average' : d < 0 ? 'Below average' : 'Above average';
    let sentence = td ? `${Math.abs(d) < .4 ? 'About' : `${fmt(Math.abs(d))} ${d < 0 ? 'below' : 'above'}`} today's average of ${fmt(td.avg)}.` : '';
    if (ch) { const h = new Date(ch.ts * 1000).getHours(), today = rel(ch.ts * 1000) === 'Today';
      const when = ch.ts * 1000 - Date.now() < 9e5 ? 'now' : today ? (h >= 18 ? 'tonight at ' : 'later today at ') + hm(ch.ts * 1000) : (h < 6 ? 'tonight at ' : 'tomorrow at ') + hm(ch.ts * 1000);
      sentence += ` The cheapest three hours start ${when}, averaging ${fmt(ch.avg)}.`; }
    else sentence += " Tomorrow's prices are published around 14:00.";
    return { cur, v, td, tm, ch, state, tone: st || (d < 0 ? 'good' : 'warn'), sentence };
  }
  const wxIcon = s => !s ? null : s.thunder ? 'thunder' : s.kind === 'snow' ? 'snow' : s.kind === 'sleet' ? 'sleet' : s.kind ? 'rain' : s.fog ? 'fog'
    : s.sky === 0 ? (s.night ? 'moon' : 'sun') : s.sky <= 2 ? (s.night ? 'mooncloud' : 'partly') : 'cloud';
  const wxOf = (a, b) => D.wx?.length ? WX.summarize(WX.between(D.wx, a / 1000, b / 1000), b - a >= 23 * H) : null;
  function windMap(a, b, sec) {  // MW per bucket: the forecast, replaced by the measured wind where there is one
    const m = new Map(), part = rows => rows.filter(r => r[0] * 1000 >= a - H && r[0] * 1000 < b + H);
    agg(part(D.wind), sec, r => r[1]).forEach(p => m.set(p.x, p.y));
    agg(part(D.wind_actual), sec, r => r[1]).forEach(p => m.set(p.x, p.y));
    return m;
  }
  const nice = (lo, hi, n = 5) => { const raw = (hi - lo) / n || 1, mag = 10 ** Math.floor(Math.log10(raw)), st = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
    const out = []; for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) out.push(+v.toFixed(6)); return out; };
  const num = v => String(v).replace('-', '−');
  const barCls = p => 'b-' + (p.state || p.kind);

  // ---------------------------------------------------------------- the bars of the Now page (SVG, so they are light and sharp at every size)
  function bars(el, o) {
    const W = Math.round(el.clientWidth); if (W < 50) return;
    const a = o.a, b = o.b, span = b - a, L = 34, R = o.temp ? 34 : 6, pw = W - L - R;
    const sec = [900, 3600, 10800, 21600, 86400].find(s => span / (s * 1000) * 3 <= pw) || 86400;
    const pts = points(a, b, sec);
    if (!pts.length) { el.innerHTML = '<p class="hint empty">No prices for this period yet.</p>'; return; }
    const days = span / DAY, showDays = o.days !== false && days > 1.01 && days <= 14.01 && pw / days >= 70;
    const top = showDays ? 26 : 10, ph = o.height, axH = 34, wxH = o.wx && D.wx?.length ? 40 : 0, windH = o.wind ? 60 : 0;
    const y0 = top, y1 = top + ph, Ht = y1 + axH + wxH + windH + 4;
    let lo = Math.min(0, ...pts.map(p => p.y)), hi = Math.max(.5, ...pts.map(p => p.y));
    const lim = limitsShown();
    if (lim) { if (S.high_on && S.high < hi * 1.7) hi = Math.max(hi, S.high); if (S.low_on && S.low < lo) lo = S.low; }
    hi += (hi - lo) * .1;
    const sx = t => L + (t - a) / span * pw, sy = v => y1 - (clamp(v, lo, hi) - lo) / (hi - lo) * (ph - 4), g = [];
    for (const v of nice(lo, hi, o.height < 200 ? 3 : 5)) g.push(`<line class="gl${v === 0 ? ' z' : ''}" x1="${L}" x2="${L + pw}" y1="${sy(v)}" y2="${sy(v)}"/><text class="ax" x="${L - 6}" y="${sy(v) + 3.5}" text-anchor="end">${num(v)}</text>`);
    if (days <= 21) for (let d = nextDay(new Date(a).setHours(0, 0, 0, 0)); d < b; d = nextDay(d)) g.push(`<line class="dl" x1="${sx(d)}" x2="${sx(d)}" y1="${y0 - (showDays ? 22 : 0)}" y2="${y1}"/>`);
    const ch = best(3);
    if (ch && sec <= 3600 && ch.end * 1000 > a && ch.ts * 1000 < b) { const x0 = sx(Math.max(ch.ts * 1000, a)), x1 = sx(Math.min(ch.end * 1000, b));
      g.push(`<rect class="band" x="${x0}" y="${y0}" width="${x1 - x0}" height="${ph}" rx="3"/>${x1 - x0 > 56 ? `<text class="band-t" x="${(x0 + x1) / 2}" y="${y0 + 12}" text-anchor="middle">Cheapest 3 h</text>` : ''}`); }
    g.push(`<clipPath id="cp-${el.id}"><rect x="${L}" y="${y0 - 2}" width="${pw}" height="${ph + 2}"/></clipPath><g clip-path="url(#cp-${el.id})">`);
    for (const p of pts) {
      const x0 = sx(p.x), w = sx(p.x + p.w) - x0, gap = w > 8 ? 1.5 : w > 4 ? 1 : w > 2.2 ? .5 : 0, bw = Math.max(.6, w - gap), t = sy(Math.max(p.y, 0)), bt = sy(Math.min(p.y, 0));
      g.push(`<rect class="bar ${barCls(p)}${p.passed ? ' passed' : ''}" x="${x0 + gap / 2}" y="${t}" width="${bw}" height="${Math.max(1, bt - t)}" rx="${bw > 6 ? 2 : 0}"/>`);
      if (p.state && w >= 9) g.push(`<text class="mk mk-${p.state}" x="${x0 + w / 2}" y="${t - 4}" text-anchor="middle">${p.state === 'hi' ? '▲' : '▼'}</text>`);
      else if (w >= 28) g.push(`<text class="bv" x="${x0 + w / 2}" y="${t - 5}" text-anchor="middle">${Math.abs(p.y) < 10 ? p.y.toFixed(1) : Math.round(p.y)}</text>`);
    }
    g.push('</g>');
    if (lim) {
      if (S.high_on && S.high <= hi) g.push(`<line class="lim hi" x1="${L}" x2="${L + pw}" y1="${sy(S.high)}" y2="${sy(S.high)}"/><text class="lim-t hi" x="${L + 4}" y="${sy(S.high) - 4}">Alert above ${S.high}</text>`);
      if (S.low_on && S.low >= lo) g.push(`<line class="lim lo" x1="${L}" x2="${L + pw}" y1="${sy(S.low)}" y2="${sy(S.low)}"/><text class="lim-t lo" x="${L + 4}" y="${sy(S.low) + 12}">Alert below ${S.low}</text>`);
    }
    if (o.temp && D.wx?.length) {  // dotted temperature, warm above 0 °C and cold below
      const tp = D.wx.filter(w => w.t * 1000 >= a && w.t * 1000 < b).map(w => [w.t * 1000 + H / 2, w.temp]);
      if (tp.length > 1) {
        const tv = tp.map(p => p[1]), tlo = Math.min(...tv, 0) - 1, thi = Math.max(...tv, 0) + 1, ty = v => y1 - (v - tlo) / (thi - tlo) * (ph - 4), z = ty(0);
        const d = tp.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${ty(p[1]).toFixed(1)}`).join('');
        g.push(`<clipPath id="tw-${el.id}"><rect x="${L}" y="${y0}" width="${pw}" height="${Math.max(0, z - y0)}"/></clipPath><clipPath id="tc-${el.id}"><rect x="${L}" y="${z}" width="${pw}" height="${Math.max(0, y1 - z)}"/></clipPath>`);
        g.push(`<path class="temp warm" d="${d}" clip-path="url(#tw-${el.id})"/><path class="temp cold" d="${d}" clip-path="url(#tc-${el.id})"/>`);
        for (const v of nice(tlo, thi, 3)) g.push(`<text class="ax tax" x="${L + pw + 5}" y="${ty(v) + 3.5}">${num(v)}°</text>`);
      }
    }
    const now = Date.now();
    if (now > a && now < b) g.push(`<line class="nowl" x1="${sx(now)}" x2="${sx(now)}" y1="${y0 - 4}" y2="${y1}"/>`);
    if (showDays) for (let d = new Date(a).setHours(0, 0, 0, 0); d < b; d = nextDay(d)) {
      const x0 = Math.max(sx(d), L), x1 = Math.min(sx(nextDay(d)), L + pw), dp = pts.filter(p => p.x >= d && p.x < nextDay(d)); if (x1 - x0 < 60 || !dp.length) continue;
      const avg = dp.reduce((s, p) => s + p.y * p.w, 0) / dp.reduce((s, p) => s + p.w, 0), max = Math.max(...dp.map(p => p.y)), est = dp.every(p => p.kind === 'est');
      g.push(`<text class="dsum${est ? ' est' : ''}" x="${(x0 + x1) / 2}" y="${y0 - 9}" text-anchor="middle">${x1 - x0 >= 130 ? `${est ? 'est. ' : ''}⌀ ${fmt(avg)} · max ${fmt(max)}` : `⌀ ${avg.toFixed(1)}`}</text>`);
    }
    const xs = [1, 2, 3, 6, 12, 24, 48, 168].find(h => span / (h * H) * 54 <= pw) || 336, ay = y1 + 14;
    for (let d = new Date(a); +d < b;) {
      if (xs < 24) { d.setMinutes(0, 0, 0); d.setHours(Math.ceil(d.getHours() / xs) * xs); } else { d.setHours(0, 0, 0, 0); if (+d < a) d.setDate(d.getDate() + 1); }
      if (+d >= b) break;
      const t = +d, x = sx(t);
      if (xs < 24) { g.push(`<text class="ax" x="${x}" y="${ay}" text-anchor="middle">${hm(t)}</text>`); if (d.getHours() === 0) g.push(`<text class="ax day" x="${x}" y="${ay + 14}" text-anchor="middle">${WD[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.</text>`); }
      else g.push(`<text class="ax" x="${x}" y="${ay}" text-anchor="middle">${WD[d.getDay()]} ${d.getDate()}.</text>`);
      if (xs < 24) d.setTime(t + xs * H); else d.setDate(d.getDate() + xs / 24);
    }
    if (wxH) {  // a weather icon (and wind m/s) per step that leaves room for it
      const ws = [1, 2, 3, 6, 12, 24].find(h => h * 3600 >= sec && span / (h * H) * 26 <= pw) || 24, yy = y1 + axH;
      for (let d = new Date(a); +d < b;) {
        if (ws < 24) { d.setMinutes(0, 0, 0); d.setHours(Math.floor(d.getHours() / ws) * ws); } else d.setHours(0, 0, 0, 0);
        const t0 = Math.max(+d, a), t1 = Math.min(ws < 24 ? +d + ws * H : nextDay(+d), b), s = wxOf(t0, t1), cx = (sx(t0) + sx(t1)) / 2;
        if (s && cx > L + 6 && cx < L + pw - 6 && sx(t1) - sx(t0) >= 18) {
          g.push(`<use class="wxu" href="#i-${wxIcon(s)}" x="${cx - 9}" y="${yy}" width="18" height="18"><title>${WX.describe(s)} · ${s.temp.toFixed(1)} °C · ${Math.round(s.ms)} m/s</title></use>`);
          if (sx(t1) - sx(t0) >= 24) g.push(`<text class="ax ms" x="${cx}" y="${yy + 32}" text-anchor="middle">${Math.round(s.ms)}</text>`);
        }
        if (ws < 24) d.setTime(+d + ws * H); else d.setDate(d.getDate() + 1);
      }
    }
    if (windH) {
      const ws = Math.max(sec, 3600), m = windMap(a, b, ws), wp = [...m].filter(([t]) => t >= a - ws * 1000 && t < b).sort((x, y) => x[0] - y[0]);
      const wy0 = y1 + axH + wxH + 6, wy1 = wy0 + windH - 10, wmax = Math.max(2000, ...wp.map(p => p[1])) * 1.1, wy = v => wy1 - v / wmax * (wy1 - wy0);
      if (wp.length > 1) {
        const line = wp.map(([t, v], i) => `${i ? 'L' : 'M'}${sx(clamp(t + ws * 500, a, b)).toFixed(1)},${wy(v).toFixed(1)}`).join('');
        g.push(`<line class="gl" x1="${L}" x2="${L + pw}" y1="${wy1}" y2="${wy1}"/><path class="wind-a" d="${line}L${sx(clamp(wp.at(-1)[0] + ws * 500, a, b))},${wy1}L${sx(clamp(wp[0][0] + ws * 500, a, b))},${wy1}Z"/><path class="wind-l" d="${line}"/>`);
        g.push(`<text class="ax" x="${L - 6}" y="${wy0 + 8}" text-anchor="end">${Math.round(wmax / 1000)}k</text><text class="ax wl" x="${L + 4}" y="${wy0 - 1}">wind power, MW</text>`);
        if (now > a && now < b) g.push(`<line class="nowl thin" x1="${sx(now)}" x2="${sx(now)}" y1="${wy0}" y2="${wy1}"/>`);
      }
    }
    g.push(`<rect class="hov" x="0" y="${y0}" width="0" height="${ph}" rx="3"/><rect class="hit" x="${L}" y="0" width="${pw}" height="${Ht}"/>`);
    el.innerHTML = `<svg class="hchart" viewBox="0 0 ${W} ${Ht}" width="100%" height="${Ht}" tabindex="0" role="img" aria-label="Prices ${dayFmt(a)} – ${dayFmt(b - 1)}. Use the arrow keys to read the prices.">${g.join('')}</svg>`;
    interact(el.firstChild, pts, p => [sx(p.x), sx(p.x + p.w)], o);
  }
  function interact(svg, pts, xOf, o) {  // hover or drag a finger to read, tap or Enter to pick, arrow keys step through
    const hov = q('.hov', svg); let idx = -1;
    const show = i => { idx = clamp(i, 0, pts.length - 1); const [x0, x1] = xOf(pts[idx]); hov.setAttribute('x', x0); hov.setAttribute('width', Math.max(1, x1 - x0)); hov.style.opacity = 1; o.onHover?.(pts[idx]); };
    const find = e => { const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) * svg.viewBox.baseVal.width / r.width;
      let l = 0, h = pts.length - 1; while (l < h) { const m = (l + h) >> 1; if (xOf(pts[m])[1] < x) l = m + 1; else h = m; } return l; };
    svg.addEventListener('pointermove', e => show(find(e)));
    svg.addEventListener('pointerleave', () => { hov.style.opacity = 0; o.onHover?.(null); });
    svg.addEventListener('click', e => { show(find(e)); o.onPick?.(pts[idx]); });
    svg.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); show((idx < 0 ? pts.findIndex(p => p.now) : idx) + (e.key === 'ArrowRight' ? 1 : -1)); }
      else if (e.key === 'Enter' && idx >= 0) o.onPick?.(pts[idx]);
    });
  }
  // the day around the clock: one wedge per 15 minutes (Signal)
  function dial(el, d0, o) {
    const S0 = Math.min(el.clientWidth || 300, 460); if (S0 < 50) return;
    const R = S0 / 2, r0 = R * .5, r1 = R * .94, pts = points(d0, nextDay(d0), 900), g = [];
    if (!pts.length) { el.innerHTML = ''; return; }
    const vs = pts.map(p => p.y), lo = Math.min(0, ...vs), hi = Math.max(...vs, .5), len = nextDay(d0) - d0;
    const P = (r, ang) => `${(R + r * Math.cos(ang)).toFixed(2)},${(R + r * Math.sin(ang)).toFixed(2)}`, ang = t => (t - d0) / len * 2 * Math.PI - Math.PI / 2;
    g.push(`<circle class="dial-bg" cx="${R}" cy="${R}" r="${(r0 + r1) / 2}" stroke-width="${r1 - r0}"/>`);
    pts.forEach((p, k) => {
      const a0 = ang(p.x) + .008, a1 = ang(p.x + p.w) - .008, rr = r0 + 4 + (r1 - r0 - 4) * clamp((p.y - lo) / (hi - lo), .04, 1);
      g.push(`<path class="wedge ${barCls(p)}${p.passed ? ' passed' : ''}" data-k="${k}" d="M${P(r0, a0)}L${P(rr, a0)}A${rr},${rr} 0 0 1 ${P(rr, a1)}L${P(r0, a1)}A${r0},${r0} 0 0 0 ${P(r0, a0)}Z"/>`);
    });
    for (let h = 0; h < 24; h += 3) { const t = new Date(d0).setHours(h), aa = ang(t); g.push(`<text class="ax dial-h" x="${R + (r0 - 13) * Math.cos(aa)}" y="${R + (r0 - 13) * Math.sin(aa) + 3.5}" text-anchor="middle">${String(h).padStart(2, '0')}</text>`); }
    const now = Date.now();
    if (now >= d0 && now < d0 + len) { const aa = ang(now); g.push(`<line class="hand" x1="${R + (r0 - 2) * Math.cos(aa)}" y1="${R + (r0 - 2) * Math.sin(aa)}" x2="${R + (R - 1) * Math.cos(aa)}" y2="${R + (R - 1) * Math.sin(aa)}"/><circle class="hand-dot" cx="${R + (R - 3) * Math.cos(aa)}" cy="${R + (R - 3) * Math.sin(aa)}" r="3.5"/>`); }
    el.innerHTML = `<svg class="dial" viewBox="0 0 ${S0} ${S0}" role="img" aria-label="Prices of ${dayFmt(d0)} around the clock">${g.join('')}</svg>`;
    const svg = el.firstChild, at = e => { const r = svg.getBoundingClientRect(), x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2, dd = Math.hypot(x, y) / (r.width / 2);
      if (dd < .45 || dd > 1.02) return -1; let aa = Math.atan2(y, x) + Math.PI / 2; if (aa < 0) aa += 2 * Math.PI; const t = d0 + aa / (2 * Math.PI) * len; return pts.findIndex(p => p.x <= t && t < p.x + p.w); };
    const mark = k => { qa('.wedge.on', svg).forEach(w => w.classList.remove('on')); if (k >= 0) q(`[data-k="${k}"]`, svg).classList.add('on'); };
    svg.addEventListener('pointermove', e => { const k = at(e); mark(k); o.onHover?.(k >= 0 ? pts[k] : null); });
    svg.addEventListener('pointerleave', () => { mark(-1); o.onHover?.(null); });
    svg.addEventListener('click', e => { const k = at(e); if (k >= 0) o.onPick?.(pts[k]); });
  }
  const spark = (vals, w = 110, h = 26) => {
    vals = vals.filter(v => v != null && isFinite(v)); if (vals.length < 2) return '';
    const lo = Math.min(...vals), hi = Math.max(...vals), X = i => i / (vals.length - 1) * (w - 4) + 2, Y = v => h - 3 - (v - lo) / ((hi - lo) || 1) * (h - 6);
    const d = vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path class="sp-a" d="${d}L${X(vals.length - 1)},${h}L${X(0)},${h}Z"/><path class="sp-l" d="${d}"/><circle class="sp-e" cx="${X(vals.length - 1)}" cy="${Y(vals.at(-1))}" r="2.2"/></svg>`;
  };
  const hourSeries = (a, b) => agg(D.actual.filter(r => r[0] * 1000 >= a && r[0] * 1000 < b), 3600, val).map(p => p.y);
  const windSeries = () => { const b = Date.now(), a = b - 2 * DAY; return [...windMap(a, b, 10800)].filter(([t]) => t >= a && t < b).sort((x, y) => x[0] - y[0]).map(p => p[1]); };

  // ---------------------------------------------------------------- shared pieces
  function readoutHtml(p) {
    if (!p) { const c = current(); if (!c) return '<span class="hint">Move over the bars, or drag a finger along them, to read a price.</span>';
      p = points(c[0] * 1000, c[0] * 1000 + 9e5, 900)[0]; if (!p) return ''; }
    const end = p.x + p.w, w = wxOf(p.x, end), wm = windMap(p.x, end, Math.max(3600, p.w / 1000)), wv = [...wm].find(([t]) => t <= p.x && p.x < t + Math.max(H, p.w))?.[1];
    return `<b>${p.now ? 'Now · ' : ''}${rel(p.x)} ${hm(p.x)}–${hm(end)}</b><span class="rp ${p.state}">${p.state === 'hi' ? '▲ ' : p.state === 'lo' ? '▼ ' : ''}${fmt(p.y)} c/kWh</span>` +
      `<span class="tag k-${p.kind}">${KIND[p.kind]}</span>${w ? `<span>${wxUse(wxIcon(w))} ${w.temp.toFixed(1)} °C · ${Math.round(w.ms)} m/s</span>` : ''}${wv != null ? `<span>wind ${Math.round(wv).toLocaleString('en-GB')} MW</span>` : ''}`;
  }
  const keys = () => '<span><i class="k-past"></i>Published</span><span><i class="k-fix"></i>Fixed, still to come</span><span><i class="k-est"></i>Estimate</span>' +
    `<span><i class="k-hi"></i>▲ at or above ${S.high_on ? S.high : '–'}</span><span><i class="k-lo"></i>▼ at or below ${S.low_on ? S.low : '–'}</span><span><i class="k-band"></i>Cheapest 3 h</span>`;
  function ladder(n = 6) {  // the published hours from now on, cheapest first
    const h0 = new Date(); h0.setMinutes(0, 0, 0);
    const pts = agg(D.actual.filter(r => r[0] * 1000 >= +h0), 3600, val, false, alarmVal);
    if (!pts.length) return '<li class="hint">No published prices from now on. Tomorrow\'s prices are published around 14:00.</li>';
    const mx = Math.max(...pts.map(p => p.y)), mn = Math.min(0, ...pts.map(p => p.y));
    return [...pts].sort((x, y) => x.y - y.y).slice(0, n).map((p, i) => `<li class="${stateOf(p.a)}" data-t="${p.x}"><span class="rk">${i + 1}</span><span class="tm">${rel(p.x)} ${hm(p.x)}${p.x === +h0 ? ' <em>now</em>' : ''}</span>` +
      `<span class="br"><i style="width:${(Math.max(.03, (p.y - mn) / ((mx - mn) || 1)) * 100).toFixed(1)}%"></i></span><b>${fmt(p.y)}</b></li>`).join('');
  }
  function pick(ms) {  // a bar, wedge or row: its price breakdown (and the same point in the Explore chart)
    sel = ms / 1000; renderBreakdown();
    if (layout === 'studio') { pickT = ms; inspector(); if (innerWidth >= 1100) return; }
    sheet('Price breakdown', breakdownHtml(ms / 1000, false));
  }
  function sheet(title, html) {
    const d = q('#sheet'); q('#sheetTitle').textContent = title; q('#sheetBody').innerHTML = html;
    if (!d.open) d.showModal();
  }
  const until = ts => { const m = Math.round((ts * 1000 - Date.now()) / 6e4); return m <= 0 ? 'now' : `in ${Math.floor(m / 60)} h ${m % 60} min`; };
  const big = v => { const [i, d] = fmt(v).split('.'); return `${num(i)}<span class="dec">.${d ?? ''}</span>`; };
  const basisText = () => `${mode === 'spot' ? 'Spot' : 'Total cost'} · ${vat ? 'incl.' : 'excl.'} VAT`;

  // ---------------------------------------------------------------- the three Now pages
  const SKELETON = {
    signal: `<div class="sg-hero">
        <div class="sg-dialcol"><div class="sg-dial"><div id="hDial"></div><div class="sg-center" id="hCenter"></div></div>
          <div class="seg" id="hDay" role="group" aria-label="Day"><button type="button" data-v="0">Today</button><button type="button" data-v="1">Tomorrow</button></div></div>
        <div class="sg-side"><h2 id="hHead"></h2><p class="lede" id="hLede"></p><div class="sg-wins" id="hWins"></div><div class="sg-mini" id="hMini"></div></div>
      </div>
      <div class="card hcard"><div class="hd"><h3>Next 48 hours</h3><span class="sp"></span><a href="#explore" class="more">Explore →</a></div>
        <div class="readout" id="hRo" aria-live="polite"></div><div id="hChart" class="hchartwrap"></div><p class="keys">${'<!--keys-->'}</p></div>
      <div class="cols2"><div class="slot-helper"></div><div class="card"><h3>Cheapest hours ahead</h3><ol class="hladder" id="hLadder"></ol></div></div>`,
    studio: `<div class="st-kpis" id="hKpis"></div>
      <div class="st-ov">
        <div class="card hcard"><div class="hd"><h3>Prices</h3><span class="sub" id="hSub"></span><span class="sp"></span>
          <div class="seg" id="hRange" role="group" aria-label="Period"><button type="button" data-v="1">Today</button><button type="button" data-v="3d">−3 … +2 d</button><button type="button" data-v="7">7 days ahead</button></div></div>
          <div class="readout" id="hRo" aria-live="polite"></div><div id="hChart" class="hchartwrap"></div><p class="keys"><!--keys--></p></div>
        <aside class="st-insp">
          <div class="card"><div class="hd"><h3>Price breakdown</h3><span class="sp"></span><button type="button" class="linkbtn" id="hNowBtn" hidden>Back to now</button></div><div id="hBd" class="bd"></div></div>
          <div class="slot-helper"></div>
          <div class="card"><div class="hd"><h3>Cheapest hours ahead</h3><span class="sp"></span><a class="more" href="#explore" data-style="ladder">All</a></div><ol class="hladder" id="hLadder"></ol></div>
        </aside>
      </div>`,
    calm: `<div class="cm-hero"><p class="cm-eye" id="hEye"></p><p class="cm-big" id="hBig"></p><div class="cm-state" id="hState"></div></div>
      <div class="card hcard"><div class="hd"><div class="seg" id="hRange" role="group" aria-label="Period"><button type="button" data-v="0">Today</button><button type="button" data-v="1">Tomorrow</button><button type="button" data-v="w">Next 7 days</button></div>
        <span class="sp"></span><a href="#explore" class="more">Explore all views →</a></div>
        <div class="readout" id="hRo" aria-live="polite"></div><div id="hChart" class="hchartwrap"></div><p class="keys"><!--keys--></p></div>
      <div class="cm-facts" id="hFacts"></div>
      <div class="cols2"><div class="slot-helper"></div><div class="card"><h3>Cheapest hours ahead</h3><ol class="hladder" id="hLadder"></ol></div></div>`,
  };
  const chartOpts = o => ({ ...o, onHover: p => q('#hRo').innerHTML = readoutHtml(p), onPick: p => pick(p.x) });
  function signal() {
    const ins = insight(), d0 = midnight(dday);
    qa('#hDay button').forEach(b => b.classList.toggle('on', +b.dataset.v === dday));
    const center = () => q('#hCenter').innerHTML = dday === 0
      ? (ins.cur ? `<span class="lbl">Now · ${hm(ins.cur[0] * 1000)}</span><span class="p">${fmt(ins.v)}</span><span class="u">c/kWh</span><span class="st ${ins.tone}">${ins.state}</span>` : '<span class="u">No price yet</span>')
      : ins.tm ? `<span class="lbl">Tomorrow avg</span><span class="p">${fmt(ins.tm.avg)}</span><span class="u">c/kWh</span><span class="st">${fmt(ins.tm.min)} – ${fmt(ins.tm.max)}</span>`
      : '<span class="lbl">Tomorrow</span><span class="u">Estimate · prices<br>come around 14:00</span>';
    dial(q('#hDial'), d0, { onHover: p => p ? q('#hCenter').innerHTML = `<span class="lbl">${hm(p.x)}–${hm(p.x + p.w)}</span><span class="p">${fmt(p.y)}</span><span class="u">c/kWh</span><span class="st ${p.state}">${KIND[p.kind]}</span>` : center(), onPick: p => pick(p.x) });
    center();
    const ch = ins.ch, late = ch && ch.ts * 1000 - Date.now() > 3 * H;
    q('#hHead').textContent = ins.cur && stateOf(alarmVal(ins.cur)) === 'hi' ? 'Expensive right now. Wait if you can.'
      : !ch ? 'Prices for tomorrow come around 14:00.' : !late ? 'A cheap stretch is coming up soon.' : `Cheapest from ${hm(ch.ts * 1000)} ${rel(ch.ts * 1000) === 'Today' ? 'tonight' : 'tomorrow'}.`;
    q('#hLede').textContent = ins.sentence;
    q('#hWins').innerHTML = [1, 3, 6].map(h => { const w = best(h); return w ? `<button type="button" class="win" data-t="${w.ts * 1000}"><span class="lbl">Cheapest ${h} h</span><b>${hm(w.ts * 1000)}–${hm(w.end * 1000)}</b><span class="sub">${rel(w.ts * 1000)} · avg ${fmt(w.avg)}</span><span class="in">${until(w.ts)}</span></button>` : ''; }).join('');
    const c = ins.cur, tr = c && priceValue(S, c[0], c[1], 'transfer', vat), wn = windNow();
    q('#hMini').innerHTML = `<div><span class="lbl">Today avg</span><b>${ins.td ? fmt(ins.td.avg) : '–'}</b><span>${ins.td ? `${fmt(ins.td.min)} – ${fmt(ins.td.max)}` : ''}</span></div>` +
      `<div><span class="lbl">Tomorrow avg</span><b>${ins.tm ? fmt(ins.tm.avg) : '–'}</b><span>${ins.tm ? `${fmt(ins.tm.min)} – ${fmt(ins.tm.max)}` : 'published ~14:00'}</span></div>` +
      `<div><span class="lbl">Transfer now</span><b>${c ? fmt(tr) : '–'}</b><span>${c ? (priceParts(S, c[0], c[1]).night ? 'night' : 'day') + ' rate + tax' : ''}</span></div>` +
      `<div><span class="lbl">Wind</span><b>${wn ? Math.round(wn[1]).toLocaleString('en-GB') + ' MW' : '–'}</b>${spark(windSeries(), 96, 22)}</div>`;
    const h0 = new Date(); h0.setMinutes(0, 0, 0);
    q('#hRo').innerHTML = readoutHtml(null);
    bars(q('#hChart'), chartOpts({ a: +h0 - 6 * H, b: +h0 + 42 * H, height: innerWidth < 760 ? 190 : 230, wind: windOn, wx: wxOn, temp: tempOn }));
  }
  function inspector() {
    const t = pickT ?? Date.now();
    q('#hBd').innerHTML = breakdownHtml(t / 1000, pickT == null);
    q('#hNowBtn').hidden = pickT == null;
  }
  function studio() {
    const ins = insight(), c = ins.cur, tr = c && priceValue(S, c[0], c[1], 'transfer', vat), wn = windNow(), ch = ins.ch;
    q('#hKpis').innerHTML = `<div class="kpi now"><span class="lbl">Now${c ? ' · ' + hm(c[0] * 1000) + '–' + hm(c[0] * 1000 + 9e5) : ''}</span><span class="v">${c ? fmt(ins.v) : '–'}<small>c/kWh</small></span><span><span class="badge ${ins.tone}">${ins.state}</span></span></div>` +
      `<div class="kpi"><span class="lbl">Today avg</span><span class="v">${ins.td ? fmt(ins.td.avg) : '–'}</span><span class="s">${ins.td ? `${fmt(ins.td.min)} – ${fmt(ins.td.max)}` : ''}</span>${spark(hourSeries(midnight(), midnight(1)))}</div>` +
      `<div class="kpi"><span class="lbl">Tomorrow avg</span><span class="v">${ins.tm ? fmt(ins.tm.avg) : '–'}</span><span class="s">${ins.tm ? `${fmt(ins.tm.min)} – ${fmt(ins.tm.max)}` : 'published ~14:00'}</span>${ins.tm ? spark(hourSeries(midnight(1), midnight(2))) : ''}</div>` +
      `<div class="kpi"><span class="lbl">Cheapest 3 h</span><span class="v">${ch ? hm(ch.ts * 1000) : '–'}<small>${ch ? rel(ch.ts * 1000) : ''}</small></span><span class="s">${ch ? `avg ${fmt(ch.avg)}` : ''}${c ? ` · transfer now ${fmt(tr)}` : ''}</span></div>` +
      `<div class="kpi wind"><span class="lbl">Wind power</span><span class="v">${wn ? Math.round(wn[1]).toLocaleString('en-GB') : '–'}<small>MW</small></span>${spark(windSeries())}</div>`;
    qa('#hRange button').forEach(b => b.classList.toggle('on', b.dataset.v === studioRange));
    const r = studioRange === '1' ? [midnight(), midnight(1)] : studioRange === '7' ? [midnight(), midnight(7)] : [midnight(-3), midnight(3)];
    q('#hSub').textContent = `${dayFmt(r[0])} – ${dayFmt(r[1] - 1)}`;
    q('#hRo').innerHTML = readoutHtml(null);
    bars(q('#hChart'), chartOpts({ a: r[0], b: r[1], height: innerWidth < 760 ? 210 : 290, wind: windOn, wx: wxOn, temp: tempOn }));
    inspector();
  }
  function calm() {
    const ins = insight(), c = ins.cur, w = wxOf(Date.now() - H, Date.now() + H);
    q('#hEye').innerHTML = `<span>Now${c ? ` · ${hm(c[0] * 1000)}–${hm(c[0] * 1000 + 9e5)}` : ''}</span>${w ? `<span>${wxUse(wxIcon(w))} ${w.temp.toFixed(0)}° ${esc(S.wx_place)}</span>` : ''}<span>${basisText()}</span>`;
    q('#hBig').innerHTML = c ? `${big(ins.v)}<span class="u">c/kWh</span>` : '–';
    q('#hState').innerHTML = `<span class="chip-s ${ins.tone}">${ins.state}</span><p>${ins.sentence}</p>`;
    qa('#hRange button').forEach(b => b.classList.toggle('on', b.dataset.v === calmRange));
    const r = calmRange === 'w' ? [midnight(), midnight(7)] : [midnight(+calmRange), midnight(+calmRange + 1)];
    q('#hRo').innerHTML = readoutHtml(null);
    bars(q('#hChart'), chartOpts({ a: r[0], b: r[1], height: innerWidth < 760 ? 200 : 260, wind: false, wx: wxOn, temp: false, days: calmRange === 'w' }));
    const ch = ins.ch, tr = c && priceValue(S, c[0], c[1], 'transfer', vat), wn = windNow();
    const fact = (id, lbl, v, sub) => `<button type="button" class="fact" data-info="${id}"><span class="lbl">${lbl}</span><b>${v}</b><span class="sub">${sub}</span><i class="ii" aria-hidden="true">i</i></button>`;
    q('#hFacts').innerHTML = fact('today', 'Today', ins.td ? fmt(ins.td.avg) : '–', ins.td ? `${fmt(ins.td.min)} – ${fmt(ins.td.max)}` : '') +
      fact('tomorrow', 'Tomorrow', ins.tm ? fmt(ins.tm.avg) : '–', ins.tm ? `${fmt(ins.tm.min)} – ${fmt(ins.tm.max)}` : 'published ~14:00') +
      fact('cheap', 'Cheapest 3 h', ch ? hm(ch.ts * 1000) : '–', ch ? `${rel(ch.ts * 1000)} · avg ${fmt(ch.avg)}` : '') +
      fact('transfer', 'Transfer now', c ? fmt(tr) : '–', c ? (priceParts(S, c[0], c[1]).night ? 'Night' : 'Day') + ' rate + tax' : '') +
      fact('wind', 'Wind power', wn ? Math.round(wn[1]).toLocaleString('en-GB') + ' <small>MW</small>' : '–', spark(windSeries(), 110, 24));
  }
  const RENDER = { signal, studio, calm };

  function render() {
    if (!D) return;
    q('#basisBtn').textContent = basisText();
    document.body.style.setProperty('--user-price', S.price_color || '');
    if (page !== 'now') return;
    const home = q('#home');
    if (built !== layout) {  // a new layout: its own page structure; the cost helper moves into it
      q('#parking').append(q('#helper'));
      home.innerHTML = SKELETON[layout];
      built = layout;
      q('.slot-helper', home).append(q('#helper'));
    }
    qa('.keys', home).forEach(k => k.innerHTML = keys());
    RENDER[layout]();
    q('#hLadder').innerHTML = ladder(layout === 'studio' ? 5 : 6);
  }

  // ---------------------------------------------------------------- sections and navigation
  function route() {
    const v = (location.hash.slice(1) || 'now').split('/')[0], want = PAGES.some(p => p[0] === v) ? v : 'now';
    page = want;
    qa('.page').forEach(p => p.hidden = p.dataset.page !== want);
    qa('[data-nav]').forEach(a => a.setAttribute('aria-current', a.dataset.nav === want ? 'page' : 'false'));
    q('#ptitle').textContent = PAGES.find(p => p[0] === want)[1];
    q('#basis').classList.remove('open'); q('#basisBtn').setAttribute('aria-expanded', 'false');
    const card = q('.chartcard');
    if (want === 'usage' || want === 'explore') {  // one chart card: Explore shows the prices, Usage its Consumption tab
      q(want === 'usage' ? '#usageSlot' : '#exploreSlot').append(card);
      if (D) {
        if (want === 'usage' && tab !== 'consumption') { prevTab = tab; onTab('consumption'); }
        else if (want === 'explore' && tab === 'consumption') onTab(prevTab === 'consumption' ? 'prices' : prevTab);
        else build();
      }
    }
    if (want === 'now') render();
    scrollTo(0, 0);
  }
  function layoutTo(v) {  // the user's layout from their settings (or just picked)
    v = LAYOUTS.includes(v) ? v : 'signal';
    qa('input[name="ui_layout"]').forEach(r => r.checked = r.value === v);
    if (v === layout && document.body.dataset.layout === v) return;
    layout = v; ls('layout', v); document.body.dataset.layout = v; pickT = null;
  }
  function init() {
    document.body.insertAdjacentHTML('beforeend', WX_ICONS);
    qa('[data-navlist]').forEach(n => n.innerHTML = PAGES.map(([k, l]) => `<a href="#${k}" data-nav="${k}" title="${l}">${svgIcon(ICONS[k])}<span>${l}</span></a>`).join(''));
    addEventListener('hashchange', route);
    q('#basisBtn').onclick = e => { const o = q('#basis').classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', o); };
    document.addEventListener('click', e => { if (!e.target.closest('#basis, #basisBtn')) { q('#basis').classList.remove('open'); q('#basisBtn').setAttribute('aria-expanded', 'false'); } });
    q('#sheet').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });  // a tap outside closes it
    q('#home').addEventListener('click', e => {
      const t = e.target;
      const day = t.closest('#hDay [data-v]'); if (day) { dday = +day.dataset.v; signal(); return; }
      const rg = t.closest('#hRange [data-v]');
      if (rg) { if (layout === 'studio') ls('hStudio', studioRange = rg.dataset.v); else ls('hCalm', calmRange = rg.dataset.v); RENDER[layout](); return; }
      const win = t.closest('.win[data-t]'), li = t.closest('#hLadder [data-t]'); if (win || li) { pick(+(win || li).dataset.t); return; }
      const f = t.closest('.fact[data-info]'); if (f) { sheet(q('.lbl', f).textContent, `<p>${INFO[f.dataset.info]}</p>`); return; }
      if (t.closest('#hNowBtn')) { pickT = null; inspector(); return; }
      const st = t.closest('[data-style]'); if (st) setStyle(st.dataset.style);
    });
    q('#layoutCard').addEventListener('change', async e => {
      if (e.target.name !== 'ui_layout') return;
      const v = e.target.value, old = layout;
      layoutTo(v); build();  // show it at once (the chart colours come from the layout); then save it for this user
      try { await putSettings({ ui_layout: v }); flash('Layout saved ✓'); }
      catch (err) { layoutTo(old); build(); flash('Layout not saved: ' + err.message); }
    });
    let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => page === 'now' && D && RENDER[built]?.(), 200); });
    layoutTo(layout);
    route();
  }
  return { init, render, layout: layoutTo };
})();
