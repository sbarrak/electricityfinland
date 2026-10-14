// Extra views of the Prices tab (the Chart drop-down) and the "What would it cost?" helper.
// Loaded before app.js: everything here runs later and uses the helpers of app.js (D, S, val, alarmVal, agg, view, ...).
const Views = (() => {
  const H = 36e5;
  const limitOf = a => { const v = +a.toFixed(2); return S.high_on && v >= S.high ? 'hi' : S.low_on && v <= S.low ? 'lo' : 'mid'; };
  const pubRows = () => D.actual, estRows = () => D.forecast.filter(r => r[0] > lastActual());
  const kindOf = (ms, est) => est ? 'est' : ms > Date.now() ? 'fix' : 'pub';
  const KIND = { pub: 'published price', fix: 'published future price (fixed)', est: 'estimate (not fixed)' };
  const short = v => Math.abs(v) < 10 ? v.toFixed(1) : String(Math.round(v));

  // ---------------------------------------------------------------- D cheapest-hours ladder: the coming published hours, cheapest first
  function ladder() {
    const cur = bucketStart(Math.floor(Date.now() / 1000), 3600) * 1000;
    const pts = agg(D.actual.filter(r => r[0] * 1000 >= cur), 3600, val, false, alarmVal);
    if (!pts.length) return '<p class="hint">No published prices from now on. Tomorrow\'s prices are published around 14:00.</p>';
    const ys = pts.map(p => p.y), lo = Math.min(0, ...ys), hi = Math.max(...ys, lo + 0.01);
    const sorted = [...pts].sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = sorted.map((p, i) => {
      const c = limitOf(p.a), w = Math.max(1, (p.y - lo) / (hi - lo) * 100), on = sel != null && sel * 1000 >= p.x && sel * 1000 < p.x + H;
      return `<li class="${c}${p.x === cur ? ' now' : ''}${on ? ' on' : ''}" data-t="${p.x}" title="${dayFmt(p.x)} ${hm(p.x)}–${hm(p.x + H)} · ${KIND[kindOf(p.x + 1)]}` +
        (p.hi > p.lo ? ` · ${fmt(p.lo)} – ${fmt(p.hi)} within the hour` : '') + `">` +
        `<span class="rk">${i + 1}</span><span class="tm">${WD[new Date(p.x).getDay()]} ${hm(p.x)}–${hm(p.x + H)}${p.x === cur ? ' <i>now</i>' : ''}</span>` +
        `<span class="br"><i style="width:${w.toFixed(1)}%"></i></span><b>${fmt(p.y)}</b></li>`;
    });
    return `<p class="hint">${pts.length} published hour${pts.length === 1 ? '' : 's'} from now on, cheapest first (c/kWh, ${NAMES[mode]}, ${vat ? 'incl.' : 'excl.'} VAT). ` +
      `Cheapest ${hm(sorted[0].x)} · ${fmt(sorted[0].y)}, most expensive ${hm(sorted.at(-1).x)} · ${fmt(sorted.at(-1).y)}.</p><ol class="ladder">${rows.join('')}</ol>`;
  }

  // ---------------------------------------------------------------- F calendar: one square per day, coloured by the daily average
  function calendar() {
    const days = new Map(), a = view.min / 1000 - 86400, b = view.max / 1000 + 86400, part = rows => rows.filter(r => r[0] >= a && r[0] < b);
    agg(part(estRows()), 86400, val, false, alarmVal).forEach(p => days.set(p.x, { ...p, est: true }));
    agg(part(pubRows()), 86400, val, false, alarmVal).forEach(p => days.set(p.x, { ...p, est: false }));
    const al = [...days.values()].map(p => +p.a.toFixed(2)), amax = Math.max(...al), amin = Math.min(...al), today = midnight();
    const out = [], m = new Date(view.min); m.setDate(1); m.setHours(0, 0, 0, 0);
    for (let i = 0; +m < view.max && i < 80; i++, m.setMonth(m.getMonth() + 1)) {
      let cells = '<span class="wd">Mo</span><span class="wd">Tu</span><span class="wd">We</span><span class="wd">Th</span><span class="wd">Fr</span><span class="wd">Sa</span><span class="wd">Su</span>';
      cells += '<span></span>'.repeat((m.getDay() + 6) % 7);
      for (const d = new Date(m); d.getMonth() === m.getMonth(); d.setDate(d.getDate() + 1)) {
        const t = +d, p = days.get(t), inView = t + DAY > view.min && t < view.max;
        if (!p || !inView) { cells += `<span class="day none${t === today ? ' now' : ''}">${d.getDate()}</span>`; continue; }
        const c = limitOf(p.a);
        cells += `<span class="day ${c}${p.est ? ' est' : ''}${t === today ? ' now' : ''}" data-t="${t}"${tint(c, +p.a.toFixed(2), amin, amax)}` +
          ` title="${dayFmt(t)} · avg ${fmt(p.y)} c/kWh (${fmt(p.lo)} – ${fmt(p.hi)}) · ${p.est ? 'estimate' : 'published prices'} · tap for its bars">` +
          `<small>${d.getDate()}</small>${short(p.y)}</span>`;
      }
      out.push(`<div class="month"><h4>${m.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h4><div class="cal">${cells}</div></div>`);
    }
    return `<div class="months">${out.join('')}</div>`;
  }

  // ---------------------------------------------------------------- E typical day and G price vs wind (Chart.js, no time axis)
  function typicalData() {
    const by = Array.from({ length: 24 }, () => ({ y: [], a: [] }));
    for (const p of agg(visible(pubRows()), 3600, val, false, alarmVal)) { const h = new Date(p.x).getHours(); by[h].y.push(p.y); by[h].a.push(p.a); }
    const mean = v => v.reduce((s, x) => s + x, 0) / v.length;
    return by.map((h, i) => h.y.length ? { h: i, avg: mean(h.y), a: mean(h.a), lo: Math.min(...h.y), hi: Math.max(...h.y), n: h.y.length } : { h: i, n: 0 });
  }
  function scatterData() {
    const wind = new Map();
    agg(D.wind, 3600, r => r[1]).forEach(p => wind.set(p.x, p.y));
    agg(D.wind_actual, 3600, r => r[1]).forEach(p => wind.set(p.x, p.y));  // the measured wind wins over the forecast
    const pair = (rows, est) => agg(visible(rows), 3600, val, false, alarmVal).filter(p => wind.has(p.x)).map(p => ({ x: wind.get(p.x), y: p.y, a: p.a, t: p.x, est }));
    return { pub: pair(pubRows(), false), est: pair(estRows(), true) };
  }
  function fit(pts) {  // least squares line and correlation of price against wind
    const n = pts.length; if (n < 3) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
    for (const { x, y } of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y; }
    const vx = n * sxx - sx * sx, vy = n * syy - sy * sy; if (!vx) return null;
    const k = (n * sxy - sx * sy) / vx, b = (sy - k * sx) / n;
    return { k, b, r: vy > 0 ? (n * sxy - sx * sy) / Math.sqrt(vx * vy) : 0 };
  }
  const limits = {  // the high / low limit lines (when the chart shows the alarm basis)
    id: 'limits', afterDatasetsDraw(c) {
      if (!showThr()) return;
      const { left, right } = c.chartArea, y = c.scales.y, g = c.ctx;
      g.save(); g.setLineDash([4, 4]); g.lineWidth = 1;
      for (const [on, v, col] of [[S.high_on, S.high, limCol.hi], [S.low_on, S.low, limCol.lo]]) {
        const py = y.getPixelForValue(v);
        if (on && py >= y.top && py <= y.bottom) { g.strokeStyle = col; g.beginPath(); g.moveTo(left, py); g.lineTo(right, py); g.stroke(); }
      }
      g.restore();
    },
  };
  let stat = '';  // the extra text for the info line
  function makeChart(st, canvas) {
    const grid = { color: css('--grid') }, ticks = { color: css('--muted') }, small = innerWidth < 600;
    const base = { responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { labels: { color: css('--fg'), boxWidth: 12, font: { size: small ? 10 : 12 } } } } };
    if (st === 'typical') return new Chart(canvas, {
      type: 'bar', plugins: [limits],
      data: { labels: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')), datasets: [
        { label: 'Lowest – highest', data: [], grouped: false, order: 2, barPercentage: .85, categoryPercentage: .9 },
        { label: 'Average', data: [], grouped: false, order: 1, barPercentage: .5, categoryPercentage: .9 }] },
      options: { ...base, interaction: { mode: 'index', intersect: false },
        scales: { x: { grid, ticks, title: { display: !small, text: 'hour of the day', color: ticks.color } },
          y: { grid, ticks, title: { display: !small, text: 'c/kWh', color: ticks.color } } },
        plugins: { ...base.plugins, tooltip: { filter: it => it.datasetIndex === 1, callbacks: {
          title: it => it.length ? `${it[0].label}:00–${String((+it[0].label + 1) % 24).padStart(2, '0')}:00` : '',
          label: it => { const d = it.chart.$typ[it.dataIndex]; return d.n ? [`Average ${fmt(d.avg)} c/kWh`, `Lowest ${fmt(d.lo)} · highest ${fmt(d.hi)}`, `${d.n} day${d.n === 1 ? '' : 's'}`] : 'no prices'; } } } } },
    });
    return new Chart(canvas, {
      type: 'scatter', plugins: [limits],
      data: { datasets: [
        { label: 'Published price', data: [], pointRadius: 3, pointHoverRadius: 5, order: 2 },
        { label: 'Estimate', data: [], pointRadius: 3, pointStyle: 'circle', backgroundColor: 'transparent', borderColor: css('--est'), order: 3 },
        { label: 'Trend', type: 'line', data: [], borderColor: css('--muted'), borderDash: [6, 4], borderWidth: 2, pointRadius: 0, order: 1 }] },
      options: { ...base, parsing: false,
        scales: { x: { type: 'linear', grid, ticks, title: { display: true, text: 'wind power MW', color: ticks.color } },
          y: { grid, ticks, title: { display: !small, text: 'c/kWh', color: ticks.color } } },
        plugins: { ...base.plugins, tooltip: { filter: it => it.datasetIndex < 2, callbacks: {
          title: it => it.length ? `${dayFmt(it[0].raw.t)} ${hm(it[0].raw.t)}` : '',
          label: it => `${it.raw.est ? 'Estimate' : 'Price'} ${fmt(it.raw.y)} c/kWh · wind ${Math.round(it.raw.x)} MW` } } } },
    });
  }
  function updateChart(st, c) {
    const pick = c => ({ hi: limCol.hi, lo: limCol.lo, mid: priceCol() })[c];
    let lo = Infinity, hi = -Infinity;
    if (st === 'typical') {
      const d = c.$typ = typicalData(), cols = d.map(h => h.n ? pick(limitOf(h.a)) : 'transparent');
      c.data.datasets[0].data = d.map(h => h.n ? [h.lo, h.hi] : null); c.data.datasets[0].backgroundColor = cols.map(x => x === 'transparent' ? x : fade(x, .28));
      c.data.datasets[1].data = d.map(h => h.n ? h.avg : null); c.data.datasets[1].backgroundColor = cols;
      for (const h of d) if (h.n) { lo = Math.min(lo, h.lo); hi = Math.max(hi, h.hi); }
      const n = Math.max(0, ...d.map(h => h.n)), best = d.filter(h => h.n).sort((x, y) => x.avg - y.avg);
      stat = n ? ` · typical day over ${n} day${n === 1 ? '' : 's'}: cheapest hour ${String(best[0].h).padStart(2, '0')}:00 (avg ${fmt(best[0].avg)}), most expensive ${String(best.at(-1).h).padStart(2, '0')}:00 (avg ${fmt(best.at(-1).avg)})` : ' · no published prices in this period';
    } else {
      const { pub, est } = scatterData(), f = fit(pub);
      c.data.datasets[0].data = pub; c.data.datasets[0].backgroundColor = pub.map(p => pick(limitOf(p.a)));
      c.data.datasets[1].data = est;
      const xs = pub.concat(est).map(p => p.x), x0 = Math.min(...xs), x1 = Math.max(...xs);
      c.data.datasets[2].data = f && isFinite(x0) ? [{ x: x0, y: f.k * x0 + f.b }, { x: x1, y: f.k * x1 + f.b }] : [];
      for (const p of pub.concat(est)) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); }
      stat = f ? ` · ${pub.length} hours · correlation r = ${f.r.toFixed(2)} (${Math.abs(f.r) < .2 ? 'little link' : f.r < 0 ? 'more wind, lower price' : 'more wind, higher price'})` +
        ` · trend ${f.k * 1000 >= 0 ? '+' : ''}${fmt(f.k * 1000)} c/kWh per 1000 MW` : ' · not enough hours with both a price and wind power';
    }
    if (showThr()) for (const k of ['high', 'low']) if (S[k + '_on']) { lo = Math.min(lo, S[k]); hi = Math.max(hi, S[k]); }
    if (isFinite(lo)) { const pad = (hi - lo) * .08 || 1; Object.assign(c.options.scales.y, { min: Math.floor(Math.min(0, lo - pad)), max: Math.ceil(hi + pad) }); }
    c.update('none');
  }

  // ---------------------------------------------------------------- the "What would it cost?" helper
  const PRESETS = [['Sauna', 6, 1], ['Dishwasher', 1.2, 2], ['Washing machine', 1, 2], ['Car charging', 20, 4]];
  function helper() {
    const kwh = Math.max(0, +$('#hKwh').value || 0), hrs = +$('#hDur').value, w = windows(hrs * 3600), out = $('#hOut');
    const euro = avg => kwh * avg / 100, eur = v => v.toFixed(2) + ' €', when = ts => `${WD[new Date(ts * 1000).getDay()]} ${hm(ts * 1000)}`;
    if (!kwh) { out.innerHTML = '<p class="hint">Enter the energy the device uses.</p>'; return; }
    if (!w.length) { out.innerHTML = `<p class="hint">Not enough published prices from now on for ${hrs} h. Tomorrow's prices are published around 14:00.</p>`; return; }
    const now = w[0], best = w.reduce((x, y) => y.avg < x.avg ? y : x), worst = w.reduce((x, y) => y.avg > x.avg ? y : x), save = euro(now.avg) - euro(best.avg);
    const tile = (cls, t, ts, avg, sub = '') => `<div class="ht ${cls}"><small>${t}</small><b>${eur(euro(avg))}</b><span>${when(ts)}–${hm((ts + hrs * 3600) * 1000)} · avg ${fmt(avg)} c/kWh${sub}</span></div>`;
    out.innerHTML = tile('', 'Start now', now.ts, now.avg) + tile('lo', 'Cheapest start', best.ts, best.avg) + tile('hi', 'Most expensive start', worst.ts, worst.avg) +
      `<p class="hint">${save > 0.005 ? `Waiting for the cheapest start saves <b>${eur(save)}</b> (${(save / euro(now.avg) * 100).toFixed(0)} %) against starting now.` : 'Now is the cheapest time to start.'}` +
      ` ${kwh} kWh spread evenly over ${hrs} h, with the ${NAMES[mode]} ${vat ? 'incl.' : 'excl.'} VAT chosen above the chart; only published prices are used.</p>`;
  }
  function init() {
    $('#hPresets').innerHTML = PRESETS.map(([n, k, h]) => `<button type="button" class="ghost" data-k="${k}" data-h="${h}">${n} · ${k} kWh · ${h} h</button>`).join('');
    $('#hKwh').value = store('hKwh') || 2; $('#hDur').value = store('hDur') || '1';
    if (!$('#hDur').value) $('#hDur').value = '1';
    const save = () => { store('hKwh', $('#hKwh').value); store('hDur', $('#hDur').value); if (D) helper(); };
    $('#hKwh').oninput = save; $('#hDur').onchange = save;
    $('#hPresets').onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; $('#hKwh').value = b.dataset.k; $('#hDur').value = b.dataset.h; save(); };
    $('#htmlview').onclick = e => {  // a ladder row picks that hour for the breakdown, a calendar day opens its bars
      const el = e.target.closest('[data-t]'); if (!el) return;
      const t = +el.dataset.t;
      if (el.classList.contains('day')) { setStyle('bars'); setView(t, t + DAY); $('#preset').value = 'custom'; return; }
      sel = t / 1000; renderBreakdown();
      $$('#htmlview .on').forEach(c => c.classList.remove('on')); el.classList.add('on');
    };
  }

  const LEGEND = {
    heat: '· one row per day, the hourly average (spot or total cost, with or without VAT, as chosen above) · red = at or above your high alarm limit, green = at or below your low limit (checked on the alarm basis), darker further past the limit' +
      ' · violet underline = published future price (fixed) · italic = estimate (not fixed) · outlined = now · tap a cell for its price breakdown',
    ladder: '· the published hours from now on, sorted from the cheapest; the bar shows the price · red / green = past your high / low alarm limit · tap a row for its price breakdown · the period above does not change this list',
    typical: '· the average price of each hour of the day over the published prices of the period above, with the lowest to highest behind it · pick a longer period (last month, last 3 months) for a steadier pattern · red / green = the average is past your alarm limits',
    calendar: '· one square per day, the daily average (c/kWh) · red / green = past your high / low alarm limit, darker further past it · italic = estimate · outlined = today · tap a day to open its bars',
    scatter: '· one dot per hour of the period above: wind power across, price up · coloured dots = published prices (red / green past your alarm limits), rings = estimates · dashed = trend line',
  };
  return { ladder, calendar, makeChart, updateChart, helper, init, legend: st => LEGEND[st], info: () => stat };
})();
