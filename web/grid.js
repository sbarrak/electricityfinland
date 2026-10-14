// Grid View tab: the prices of the chosen period as a table, one row per 15 min … 1 year (averages when zoomed out),
// with cell / row / column selection, Copy, and CSV / Excel export (of the selection, or of the whole period).
// Also exports any period (Export button) with exportRange(). Weather columns from weather.js (the place picked under Weather).
// Uses the globals of app.js (D, S, view, mode, vat, avgOn, sel …) when called; loaded before app.js, which calls init().
const GridView = (() => {
  const LEVELS = [[900, '15 min'], [1800, '30 min'], [3600, '1 h'], [7200, '2 h'], [10800, '3 h'], [21600, '6 h'], [43200, '12 h'],
    ['day', '1 day'], ['week', '1 week'], ['month', '1 month'], ['year', '1 year']];
  const NC = 8, OVER = 8, SHOW = 10;  // data columns, rows drawn beyond the visible ones, rows in view
  const STATUS = { published: 'Published', fixed: 'Fixed (future)', estimate: 'Estimate', mixed: 'Partly estimate' };
  const DEC = (1.5).toLocaleString().includes(',') ? ',' : '.', SEP = DEC === ',' ? ';' : ',';  // as the local spreadsheet expects
  let ri = 0, rows = [], parts = [], rh = 32, last = null, keepTop = 0;
  let kind = null, sA = null, sB = null, tapNext = false, ptr = 'mouse', drag = null, raf = 0, pending = null, noteT = 0;
  let wrap, thead, tbody, tfoot, cur = null;  // cur: {r, vat} while exportRange() works on another period
  try { ri = Math.min(LEVELS.length - 1, Math.max(0, +localStorage.getItem('gridRes') || 0)); } catch {}
  const g = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const level = () => cur ? cur.r : LEVELS[ri][0];
  const useVat = () => cur ? cur.vat : vat;

  // ------------------------------------------------------------ rows
  function keyOf(ts, r) {  // start (s) of the row that ts falls in, local time
    if (typeof r === 'number') return r <= 3600 ? Math.floor(ts / r) * r : bucketStart(ts, r);
    const d = new Date(ts * 1000); d.setHours(0, 0, 0, 0);
    if (r === 'week') d.setDate(d.getDate() - (d.getDay() + 6) % 7);  // weeks start on Monday
    else if (r === 'month') d.setDate(1);
    else if (r === 'year') d.setMonth(0, 1);
    return d / 1000;
  }
  function endOf(t, r) {  // end (s) of the row that starts at t
    if (typeof r === 'number') return t + r;
    const d = new Date(t * 1000);
    if (r === 'day') d.setDate(d.getDate() + 1); else if (r === 'week') d.setDate(d.getDate() + 7);
    else if (r === 'month') d.setMonth(d.getMonth() + 1); else d.setFullYear(d.getFullYear() + 1);
    return d / 1000;
  }
  const isoWeek = d => {
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3 - (d.getDay() + 6) % 7), w1 = new Date(t.getFullYear(), 0, 4);
    return 1 + Math.round(((t - w1) / DAY - 3 + (w1.getDay() + 6) % 7) / 7);
  };
  function label(t) {  // shown in the first column
    const r = level(), d = new Date(t * 1000);
    if (r === 'year') return String(d.getFullYear());
    if (r === 'month') return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    if (r === 'week') return `Week ${isoWeek(d)} · ${dayFmt(t * 1000)}`;
    return r === 'day' ? dayFmt(t * 1000) : `${dayFmt(t * 1000)} ${hm(t * 1000)}`;
  }
  function plainTime(t) {  // the first column in a copy or a CSV file
    const r = level(), s = isoDate(t * 1000);
    return r === 'year' ? s.slice(0, 4) : r === 'month' ? s.slice(0, 7) : typeof r === 'number' ? `${s} ${hm(t * 1000)}` : s;
  }
  const head = () => {
    const v = useVat() ? 'incl.' : 'excl.', r = level();
    return [r === 'day' ? 'Date' : r === 'week' ? 'Week' : r === 'month' ? 'Month' : r === 'year' ? 'Year' : 'Date and time',
      `Spot c/kWh ${v} VAT`, `Total cost c/kWh ${v} VAT`, 'Wind MW', 'Temperature °C', 'Wind m/s', 'Weather', 'Status'];
  };
  const before = (list, t) => {  // last [ts, v] at or before t, if less than an hour old
    let lo = 0, hi = list.length - 1, f = null;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m][0] <= t) { f = list[m]; lo = m + 1; } else hi = m - 1; }
    return f && t - f[0] < 3600 ? f : null;
  };

  function compute(a = view.min / 1000, b = view.max / 1000) {  // every row: time-weighted average of the 15-min (or hourly) prices in it
    const r = level(), vat = useVat(), now = Math.floor(Date.now() / 9e5) * 900, la = lastActual();
    const slots = D.actual.concat(D.forecast.filter(x => x[0] > la).map(x => [x[0], x[1], 1]));  // published, then estimates
    const map = new Map(), at = k => { let o = map.get(k); if (!o) map.set(k, o = { t: k, w: 0, sp: 0, to: 0, est: 0, past: 0, wa: [0, 0], wf: [0, 0] }); return o; };
    const sums = { published: [0, 0, 0], fixed: [0, 0, 0], estimate: [0, 0, 0] };  // weight, spot, total
    slots.forEach(([t, v, e], i) => {
      if (t < a || t >= b) return;
      const nx = slots[i + 1]?.[0], pv = slots[i - 1]?.[0], w = Math.min(3600, nx ? nx - t : pv ? t - pv : 900);
      const o = at(keyOf(t, r)), sp = priceValue(S, t, v, 'spot', vat), to = priceValue(S, t, v, 'total', vat);
      o.w += w; o.sp += sp * w; o.to += to * w;
      if (e) o.est += w; else if (t < now) o.past = 1;
      const s = sums[e ? 'estimate' : t < now ? 'published' : 'fixed']; s[0] += w; s[1] += sp * w; s[2] += to * w;
    });
    const wa0 = D.wind_actual[0]?.[0] ?? Infinity, wa1 = D.wind_actual.at(-1)?.[0] ?? -Infinity;  // the forecast only where there is no actual
    for (const [src, list] of [['wa', D.wind_actual], ['wf', D.wind]]) list.forEach(([t, v], i) => {
      if (t < a || t >= b || (src === 'wf' && t >= wa0 && t <= wa1)) return;
      const w = Math.min(3600, (list[i + 1]?.[0] ?? t + 900) - t), o = at(keyOf(t, r));  // weighted by the time each value covers
      o[src][0] += v * w; o[src][1] += w;
    });
    const out = [...map.values()].sort((x, y) => x.t - y.t).map(o => ({ t: o.t, w: o.w,
      spot: o.w ? o.sp / o.w : null, total: o.w ? o.to / o.w : null,
      wind: o.wa[1] + o.wf[1] ? (o.wa[0] + o.wf[0]) / (o.wa[1] + o.wf[1]) : null, wsrc: o.wf[1] ? o.wa[1] ? 'actual + forecast' : 'forecast' : 'actual',
      st: o.est ? (o.est < o.w ? 'mixed' : 'estimate') : o.past ? 'published' : o.w ? 'fixed' : '' }));  // mixed: a long row with published prices and estimates
    for (const o of out) if (o.wind == null) {  // a row shorter than the wind data step (15 min vs hourly forecast): the value of that hour
      const fa = before(D.wind_actual, o.t), f = fa || before(D.wind, o.t);
      if (f) { o.wind = f[1]; o.wsrc = fa ? 'actual' : 'forecast'; }
    }
    for (const o of out) {  // weather of the hours in the row (a row shorter than an hour: that hour), as the chart icons
      const end = endOf(o.t, r), w = WX.summarize(WX.between(D.wx || [], o.t, end), end - o.t >= 82800);
      Object.assign(o, { temp: w ? w.temp : null, ms: w ? w.ms : null, wx: w ? WX.describe(w) : '' });
    }
    const avgOf = (list, k) => { const l = list.filter(o => o[k] != null); return l.length ? l.reduce((n, o) => n + o[k], 0) / l.length : null; };
    parts = Object.entries(sums).filter(([, s]) => s[0]).map(([st, s]) => {
      const sr = out.filter(o => o.st === st);
      return { st, spot: s[1] / s[0], total: s[2] / s[0], wind: avgOf(sr, 'wind'), temp: avgOf(sr, 'temp'), ms: avgOf(sr, 'ms') };
    });
    return out;
  }

  // ------------------------------------------------------------ cells
  const raw = (r, c) => [r.t, r.spot, r.total, r.wind, r.temp, r.ms, r.wx, STATUS[r.st] || ''][c];
  const DECS = [0, 2, 2, 0, 1, 1];
  const limOf = v => v == null ? '' : S.high_on && +v.toFixed(2) >= S.high ? 'hi' : S.low_on && +v.toFixed(2) <= S.low ? 'lo' : '';
  function cls(r, c) {  // colour of a cell: red / green = past a limit (on the Spot or Total column picked above), violet = fixed, slate = estimate
    if (c === 3) return 'wind';
    if (c === 4) return r.temp == null ? '' : r.temp >= 0 ? 'tw' : 'tc';  // red above 0 °C, blue below, as the chart
    if (c === 7) return r.st === 'fixed' ? 'fixed' : r.st === 'estimate' || r.st === 'mixed' ? 'est' : '';
    if (c === 0 || c === 5 || c === 6) return '';
    const v = raw(r, c); if (v == null) return '';
    const lim = (c === 1) === (mode === 'spot') ? limOf(v) : '';
    return r.st === 'estimate' || r.st === 'mixed' ? 'est' + (lim ? ' m' + lim : '') : lim || (r.st === 'fixed' ? 'fixed' : '');
  }
  function text(r, c) {
    if (c === 0) return label(r.t);
    if (c === 7) return STATUS[r.st] || '–';
    if (c === 6) return esc(r.wx) || '–';
    const v = raw(r, c);
    if (v == null) return '–';
    if (c >= 3) return v.toFixed(DECS[c]);
    const k = cls(r, c), m = /hi/.test(k) ? '▲' : /lo/.test(k) ? '▼' : '';
    return fmt(v) + (m ? `<span class="mk">${m}</span>` : '');
  }
  const plain = (r, c) => { const v = raw(r, c); return c === 0 ? plainTime(v) : typeof v === 'number' ? v.toFixed(DECS[c]).replace('.', DEC) : v ?? ''; };

  // ------------------------------------------------------------ selection: adjacent cells, rows (# column) or columns (headers)
  function range() {
    if (!kind || !rows.length) return null;
    let r0 = Math.min(sA.r, sB.r), r1 = Math.max(sA.r, sB.r), c0 = Math.min(sA.c, sB.c), c1 = Math.max(sA.c, sB.c);
    if (kind === 'rows') { c0 = 0; c1 = NC - 1; }
    if (kind === 'cols') { r0 = 0; r1 = rows.length - 1; }
    return { r0, r1, c0, c1 };
  }
  function hitOf(el) {
    const c = +el.dataset.c, r = el.dataset.r == null ? null : +el.dataset.r;
    if (r == null) return c < 0 ? { kind: 'all' } : { kind: 'cols', c };
    return c < 0 ? { kind: 'rows', r } : { kind: 'cells', r, c };
  }
  function start(h) {
    if (!rows.length) return;
    if (h.kind === 'all') { kind = 'rows'; sA = { r: 0, c: 0 }; sB = { r: rows.length - 1, c: NC - 1 }; }
    else { kind = h.kind; sA = { r: h.r ?? 0, c: h.c ?? 0 }; sB = { ...sA }; }
    if (h.r != null) { sel = rows[h.r].t; renderBreakdown(); }  // the price breakdown box follows the picked row
  }
  function extend(h) {  // move the far corner; the kind of selection stays as it began
    if (!kind) return start(h);
    const b = { ...sB };
    if (kind === 'cols') { if (h.c != null && h.c >= 0) b.c = h.c; }
    else if (kind === 'rows') { if (h.r != null) b.r = h.r; }
    else if (h.r != null && h.c != null && h.c >= 0) { b.r = h.r; b.c = h.c; }
    if (b.r === sB.r && b.c === sB.c) return false;
    sB = b; return true;
  }
  const clear = () => { kind = sA = sB = null; tapNext = false; };
  function paint() { renderHead(); renderBody(); bar(); }

  // ------------------------------------------------------------ drawing (only the rows in view are in the page)
  function renderHead() {
    const R = range(), h = head(), lim = mode === 'spot' ? 1 : 2;
    thead.innerHTML = `<tr><th class="rn" data-c="-1" title="Select all">#</th>` + h.map((t, c) =>
      `<th data-c="${c}" class="${c === lim ? 'lim' : ''}${R && c >= R.c0 && c <= R.c1 ? ' on' : ''}" title="${c === lim ? 'The red / green limit colours apply to this column (Spot / Total cost buttons). ' : ''}Click to select the column, drag or Shift+click for adjacent columns">${t}</th>`).join('') + '</tr>';
  }
  function renderBody(top = wrap.scrollTop) {
    const n = rows.length;
    if (!n) { tbody.innerHTML = `<tr class="empty"><td colspan="${NC + 1}">No prices in this period.</td></tr>`; return; }
    const R = range();
    const i0 = clamp(Math.floor(top / rh) - OVER, 0, n), i1 = clamp(Math.ceil((top + wrap.clientHeight) / rh) + OVER, i0, n);
    let h = `<tr class="pad" style="height:${i0 * rh}px"><td colspan="${NC + 1}"></td></tr>`;
    for (let i = i0; i < i1; i++) {
      const r = rows[i], inR = R && i >= R.r0 && i <= R.r1;
      h += `<tr class="st-${r.st === 'mixed' ? 'estimate' : r.st}"><td class="rn${inR ? ' on' : ''}" data-r="${i}" data-c="-1">${i + 1}</td>`;
      for (let c = 0; c < NC; c++) {
        const s = inR && c >= R.c0 && c <= R.c1 ? ' sel' : '';
        h += `<td data-r="${i}" data-c="${c}" class="${cls(r, c)}${s}"${c === 3 && r.wind != null ? ` title="wind ${r.wsrc}"` : ''}>${text(r, c)}</td>`;
      }
      h += '</tr>';
    }
    tbody.innerHTML = h + `<tr class="pad" style="height:${(n - i1) * rh}px"><td colspan="${NC + 1}"></td></tr>`;
  }
  function renderFoot() {  // Average switched on: the averages of the period, like the chart
    const names = { published: 'Avg published', fixed: 'Avg fixed', estimate: 'Avg estimate' }, list = avgOn ? parts : [];
    tfoot.innerHTML = list.map((p, i) => {
      const c = p.st === 'fixed' ? 'fixed' : p.st === 'estimate' ? 'est' : '', b = `style="bottom:${(list.length - 1 - i) * rh}px"`;
      return `<tr><td class="rn" ${b}></td><td ${b} data-f class="${c}">${names[p.st]}</td><td ${b} class="${c}">${fmt(p.spot)}</td>` +
        `<td ${b} class="${c}">${fmt(p.total)}</td><td ${b} class="wind">${p.wind == null ? '–' : Math.round(p.wind)}</td>` +
        `<td ${b} class="${p.temp == null ? '' : p.temp >= 0 ? 'tw' : 'tc'}">${p.temp == null ? '–' : p.temp.toFixed(1)}</td><td ${b}>${p.ms == null ? '–' : p.ms.toFixed(1)}</td><td ${b}></td><td ${b}></td></tr>`;
    }).join('');
  }
  function size() {  // about 10 rows in view, plus the header, the average rows and the scroll bar
    wrap.style.height = thead.offsetHeight + tfoot.offsetHeight + SHOW * rh + (wrap.offsetHeight - wrap.clientHeight) + 'px';
  }
  function measure() {  // the real row height (fonts, zoom): the row positions are computed from it
    const tr = tbody.querySelector('tr:not(.pad):not(.empty)'), h = tr?.getBoundingClientRect().height;
    if (h && Math.abs(h - rh) > 0.2) { rh = h; renderFoot(); size(); renderBody(); }
  }
  function reveal(i) {
    const body = wrap.clientHeight - thead.offsetHeight - tfoot.offsetHeight, y = i * rh;
    if (y < wrap.scrollTop) wrap.scrollTop = y; else if (y + rh > wrap.scrollTop + body) wrap.scrollTop = y + rh - body;
  }
  const rowAt = t => { let lo = 0, hi = rows.length - 1, f = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m].t <= t) { f = m; lo = m + 1; } else hi = m - 1; } return f; };

  function bar() {
    const R = range(), n = R ? (R.r1 - R.r0 + 1) * (R.c1 - R.c0 + 1) : 0;
    g('gCopy').disabled = g('gClear').disabled = !R;
    if (Date.now() < noteT) return;
    g('gnote').textContent = !R ? 'Nothing selected: export uses the whole period. Drag over cells, or click a # / column header (Shift+click for more).'
      : kind === 'cols' ? `${R.c1 - R.c0 + 1} column${R.c1 > R.c0 ? 's' : ''} selected (${R.r1 - R.r0 + 1} rows)`
      : kind === 'rows' ? `${R.r1 - R.r0 + 1} row${R.r1 > R.r0 ? 's' : ''} selected`
      : `${n} cell${n > 1 ? 's' : ''} selected (${R.r1 - R.r0 + 1} × ${R.c1 - R.c0 + 1})`;
  }
  const note = t => { noteT = Date.now() + 2500; g('gnote').textContent = t; setTimeout(bar, 2600); };

  function info() {
    let t = `Resolution ${LEVELS[ri][1]}${ri ? ' (averages of the 15-min prices)' : ''} · ${rows.length} rows`;
    if (avgOn) t += ` · ${parts.map(p => `avg ${p.st} ${fmt(mode === 'spot' ? p.spot : p.total)}`).join(' · ') || 'no prices in view'} c/kWh (${NAMES[mode]}, ${vat ? 'incl.' : 'excl.'} VAT)`;
    g('info').textContent = t;
    g('gres').textContent = LEVELS[ri][1];
  }

  function render() {
    if (!D || !view || !wrap) return;
    const inputs = [D, S, view.min, view.max, ri, vat, D.wx];
    if (!last || inputs.some((x, i) => x !== last[i])) {
      const newRange = !last || last[2] !== view.min || last[3] !== view.max, topT = rows[Math.floor(keepTop / rh)]?.t;
      const sig = rows.length + ':' + rows[0]?.t + ':' + last?.[4];
      rows = compute(); last = inputs;
      if (sig !== rows.length + ':' + rows[0]?.t + ':' + ri) clear();  // other rows: the old selection would point elsewhere
      renderHead(); renderFoot(); size();
      const nowT = Date.now() / 1000;
      if (newRange) keepTop = nowT >= view.min / 1000 && nowT < view.max / 1000 ? Math.max(0, rowAt(nowT) - 2) * rh : 0;  // open at the current time
      else if (topT != null) keepTop = rowAt(topT) * rh;  // other resolution: stay at the same time
    } else { renderHead(); renderFoot(); size(); }
    renderBody(keepTop);  // rows first, so the box is tall enough to scroll there
    wrap.scrollTop = keepTop;  // also after the tab was hidden (a hidden box loses its scroll position)
    keepTop = wrap.scrollTop;
    renderBody(); measure(); bar(); info();
  }
  function zoom(d) {  // − / + next to ⇔: 15 min … 1 year
    const n = d < -50 ? 0 : clamp(ri + d, 0, LEVELS.length - 1);
    if (d < -50) last = null;  // Reset: back to the current time too
    if (n === ri && last) return;
    ri = n; try { localStorage.setItem('gridRes', ri); } catch {}
    render();
  }

  // ------------------------------------------------------------ copy and export
  function matrix() {  // the selection, or the whole period when nothing is selected
    const R = range() || { r0: 0, r1: rows.length - 1, c0: 0, c1: NC - 1 }, cols = [];
    for (let c = R.c0; c <= R.c1; c++) cols.push(c);
    return { cols, list: rows.slice(R.r0, R.r1 + 1) };
  }
  function copyText() {
    const m = matrix(), lines = m.list.map(r => m.cols.map(c => plain(r, c)).join('\t'));
    if (kind === 'cols') lines.unshift(m.cols.map(c => head()[c]).join('\t'));  // whole columns: with their names
    return lines.join('\n');
  }
  function copy() {
    if (!range()) return;
    const t = copyText(), n = t.split('\n').length, done = () => note(`Copied ${n} line${n > 1 ? 's' : ''} ✓ (paste into a spreadsheet)`);
    pending = t;
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    pending = null;
    if (ok) return done();
    navigator.clipboard?.writeText(t).then(done, () => note('The browser blocked copying: click the grid and press Ctrl+C (⌘C on a Mac).'));
  }
  const fileName = ext => `electricity-${isoDate(view.min)}_${isoDate(view.max - 1)}_${LEVELS[ri][1].replace(' ', '')}${range() ? '_selection' : ''}.${ext}`;
  function preview(m) { return { head: m.cols.map(c => head()[c]), rows: m.list.map(r => m.cols.map(c => [plain(r, c), cls(r, c)])) }; }
  function save(name, blob, m) {
    if (window.MOCK_SAVE) return window.MOCK_SAVE(name, blob, preview(m));  // the mock-up cannot download: it shows the file instead
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  function exportCsv(name = fileName('csv')) {
    const m = matrix(), q = s => /["\n\r;,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    const lines = [m.cols.map(c => q(head()[c])), ...m.list.map(r => m.cols.map(c => q(plain(r, c))))].map(l => l.join(SEP));
    save(name, new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' }), m);
  }
  function exportXlsx(name = fileName('xlsx')) {
    const m = matrix(), r = level(), dfmt = r === 'year' ? 167 : r === 'month' ? 166 : typeof r === 'number' ? 164 : 165;
    const body = m.list.map(o => m.cols.map(c => {
      const v = raw(o, c), k = cls(o, c).split(' ')[0];
      if (c === 0) return { n: (v * 1000 - new Date(v * 1000).getTimezoneOffset() * 6e4) / DAY + 25569, f: dfmt, k };  // Excel date, local time
      return typeof v === 'number' ? { n: +v.toFixed(DECS[c]), f: [0, 2, 2, 1, 168, 168][c], k } : { s: v, k };
    }));
    save(name, xlsx(m.cols.map(c => head()[c]), body, m.cols.map(c => [20, 18, 24, 11, 15, 10, 30, 15][c])), m);
  }
  function exportRange(a, b, r, v, type, name) {  // a whole period (s, b excluded) with rows r, prices with VAT v: the number of rows
    const keep = [rows, parts, kind, sA, sB, tapNext];
    cur = { r, vat: v };
    try {
      rows = compute(a, b); kind = sA = sB = null;
      if (rows.length) (type === 'csv' ? exportCsv : exportXlsx)(`${name}.${type}`);
      return rows.length;
    } finally { cur = null; [rows, parts, kind, sA, sB, tapNext] = keep; }
  }

  // ------------------------------------------------------------ init: events
  function init() {
    wrap = g('gridwrap'); thead = $('thead', wrap); tbody = $('tbody', wrap); tfoot = $('tfoot', wrap);
    wrap.addEventListener('scroll', () => { keepTop = wrap.scrollTop; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => renderBody()); }, { passive: true });
    wrap.addEventListener('pointerdown', e => {
      ptr = e.pointerType;
      const el = e.target.closest('[data-c]');
      if (!el || e.button || el.closest('tfoot') || (ptr !== 'mouse' && ptr !== 'pen')) return;  // touch: a tap selects (click below), a drag scrolls
      e.preventDefault(); wrap.focus({ preventScroll: true });
      const h = hitOf(el);
      if (e.shiftKey && kind && h.kind !== 'all') extend(h); else start(h);
      drag = { x: e.clientX, y: e.clientY }; paint(); dragLoop();
    });
    addEventListener('pointermove', e => { if (drag) { drag.x = e.clientX; drag.y = e.clientY; pick(e.clientX, e.clientY); } });
    addEventListener('pointerup', () => { drag = null; });
    wrap.addEventListener('click', e => {  // phone / tablet: tap one cell, then tap another to select everything between them
      const el = e.target.closest('[data-c]');
      if (!el || el.closest('tfoot') || ptr === 'mouse' || ptr === 'pen') return;
      const h = hitOf(el);
      if (tapNext && kind && h.kind === kind) { extend(h); tapNext = false; } else { start(h); tapNext = h.kind !== 'all'; }
      paint();
    });
    wrap.addEventListener('keydown', e => {
      if (e.key === 'Escape') { clear(); return paint(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); start({ kind: 'all' }); return paint(); }
      const mv = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
      if (!mv || !rows.length) return;
      e.preventDefault();
      if (!kind) start({ kind: 'cells', r: rowAt(Date.now() / 1000), c: 1 });
      else {
        const b = { r: clamp(sB.r + mv[0], 0, rows.length - 1), c: clamp(sB.c + mv[1], 0, NC - 1) };
        if (e.shiftKey) sB = b; else start({ kind: 'cells', ...b });
      }
      reveal(sB.r); paint();
    });
    wrap.addEventListener('wheel', e => {  // trackpad pinch / Ctrl + wheel: change the resolution
      if (!e.ctrlKey) return;
      e.preventDefault();
      wheelSum += e.deltaY;
      if (Math.abs(wheelSum) > 60) { zoom(Math.sign(wheelSum)); wheelSum = 0; }
    }, { passive: false });
    document.addEventListener('copy', e => {  // Ctrl+C / ⌘C in the grid, and the Copy button
      const t = pending ?? (range() && wrap.contains(document.activeElement) ? copyText() : null);
      if (t == null) return;
      e.clipboardData.setData('text/plain', t); e.preventDefault();
      if (pending == null) note('Copied ✓');
    });
    g('gCopy').onclick = copy;
    g('gClear').onclick = () => { clear(); paint(); };
    g('gCsv').onclick = () => exportCsv();
    g('gXlsx').onclick = () => exportXlsx();
  }
  let wheelSum = 0;
  function pick(x, y) {
    const el = document.elementFromPoint(x, y)?.closest('#grid [data-c]');
    if (el && !el.closest('tfoot') && extend(hitOf(el))) paint();
  }
  function dragLoop() {  // keep selecting while the pointer is held above or below the rows: scroll that way
    if (!drag) return;
    const b = wrap.getBoundingClientRect(), y0 = b.top + thead.offsetHeight, y1 = b.top + wrap.clientHeight - tfoot.offsetHeight;
    const dy = drag.y < y0 + 6 ? -Math.min(40, (y0 + 6 - drag.y) / 2 + 3) : drag.y > y1 - 6 ? Math.min(40, (drag.y - y1 + 6) / 2 + 3) : 0;
    if (dy && kind !== 'cols') {
      wrap.scrollTop += dy; keepTop = wrap.scrollTop; renderBody();
      pick(clamp(drag.x, b.left + 60, b.left + wrap.clientWidth - 4), clamp(drag.y, y0 + 2, y1 - 2));
    }
    requestAnimationFrame(dragLoop);
  }

  return { init, render, zoom, exportRange, label: () => LEVELS[ri][1] };
})();

// A minimal .xlsx writer (one sheet, inline strings, uncompressed zip): head [text], rows [[{n, f, k} | {s, k}]], widths [chars].
// f: number format (1 = 0, 2 = 0.00, 164… = dates, 168 = 0.0), k: colour class of the grid (hi, lo, fixed, est, wind, tw, tc).
function xlsx(head, rows, widths) {
  const FONTS = ['', '<b/>', '<b/><color rgb="FFB91C1C"/>', '<color rgb="FF6D28D9"/>', '<b/><color rgb="FF15803D"/>', '<i/><color rgb="FF475569"/>',
    '<color rgb="FFA16207"/>', '<color rgb="FFE11D48"/>', '<color rgb="FF0284C7"/>'];
  const FONT_OF = { hdr: 1, hi: 2, fixed: 3, lo: 4, est: 5, wind: 6, tw: 7, tc: 8 };
  const xfs = [[0, 0]], xf = (f, k) => { const p = [f || 0, FONT_OF[k] || 0]; let i = xfs.findIndex(x => x[0] === p[0] && x[1] === p[1]); if (i < 0) i = xfs.push(p) - 1; return i; };
  const x = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const col = i => String.fromCharCode(65 + i);
  const cell = (v, ci, ri) => v.n != null ? `<c r="${col(ci)}${ri}" s="${xf(v.f, v.k)}"><v>${v.n}</v></c>`
    : v.s ? `<c r="${col(ci)}${ri}" s="${xf(0, v.k)}" t="inlineStr"><is><t>${x(v.s)}</t></is></c>` : '';
  const data = [head.map(s => ({ s, k: 'hdr' })), ...rows].map((r, i) => `<row r="${i + 1}">${r.map((v, ci) => cell(v, ci, i + 1)).join('')}</row>`).join('');
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"', R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const sheet = `${XML}<worksheet ${NS}><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${data}</sheetData></worksheet>`;
  const styles = `${XML}<styleSheet ${NS}><numFmts count="5"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/>` +
    `<numFmt numFmtId="166" formatCode="yyyy-mm"/><numFmt numFmtId="167" formatCode="yyyy"/><numFmt numFmtId="168" formatCode="0.0"/></numFmts>` +
    `<fonts count="${FONTS.length}">${FONTS.map(f => `<font>${f}<sz val="11"/><name val="Calibri"/></font>`).join('')}</fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${xfs.length}">${xfs.map(([f, k]) => `<xf numFmtId="${f}" fontId="${k}" fillId="0" borderId="0" xfId="0"${f ? ' applyNumberFormat="1"' : ''}${k ? ' applyFont="1"' : ''}/>`).join('')}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const files = {
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `${XML}<workbook ${NS} xmlns:r="${R}"><sheets><sheet name="Prices" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="${R}/styles" Target="styles.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': sheet,
    'xl/styles.xml': styles,
  };
  return new Blob([zipStore(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
function zipStore(files) {  // {name: text} -> Uint8Array of a zip without compression
  const enc = new TextEncoder(), crcT = zipStore.t ||= Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xEDB88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
  const crc = d => { let c = -1; for (const b of d) c = crcT[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const local = [], central = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const nm = enc.encode(name), d = enc.encode(text), c = crc(d);
    const h = new DataView(new ArrayBuffer(30)), e = new DataView(new ArrayBuffer(46));
    [[0, 0x04034b50, 4], [4, 20, 2], [8, 0, 2], [12, 33, 2], [14, c, 4], [18, d.length, 4], [22, d.length, 4], [26, nm.length, 2]]
      .forEach(([o, v, n]) => n === 4 ? h.setUint32(o, v, true) : h.setUint16(o, v, true));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [14, 33, 2], [16, c, 4], [20, d.length, 4], [24, d.length, 4], [28, nm.length, 2], [42, off, 4]]
      .forEach(([o, v, n]) => n === 4 ? e.setUint32(o, v, true) : e.setUint16(o, v, true));
    local.push(new Uint8Array(h.buffer), nm, d); central.push(new Uint8Array(e.buffer), nm);
    off += 30 + nm.length + d.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0), end = new DataView(new ArrayBuffer(22)), count = Object.keys(files).length;
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, count, true); end.setUint16(10, count, true); end.setUint32(12, size, true); end.setUint32(16, off, true);
  const all = [...local, ...central, new Uint8Array(end.buffer)], out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}
