// Weather from Open-Meteo (hourly): one hour -> the parts of its icon, several hours -> one combined icon, and drawing
// the icon on a canvas. Used by the chart (app.js), the Grid View (grid.js) and the standalone mode (local.js).
const WX = (() => {
  const SNOW = new Set([71, 73, 75, 77, 85, 86]), FREEZE = new Set([56, 57, 66, 67]), SHOWER = new Set([80, 81, 82, 85, 86]);
  const SKY_OF_CODE = { 0: 0, 1: 20, 2: 50, 3: 100 };

  // a stored row [ts, code, temp, ms, dir, cloud, mm, snow, day] (WMO weather code, °C, m/s, °, %, mm, cm, 0/1) -> one hour
  function hour([t, code, temp, ms, dir, cloud, mm, snow, day]) {
    mm = mm || 0; snow = snow || 0;
    const wet = code >= 51 || mm >= 0.2;  // codes below 51: clear … overcast, fog
    const kind = !wet ? null : FREEZE.has(code) ? 'sleet' : SNOW.has(code) ? 'snow'
      : snow > 0.05 ? (mm - snow * 0.7 > 0.1 ? 'sleet' : 'snow') : 'rain';  // 1 cm of snow ≈ 0.7 mm of water
    cloud = cloud ?? SKY_OF_CODE[code] ?? 90;
    return { t, code, temp, ms: ms ?? 0, dir: dir ?? 0, cloud, mm, kind, day: !!day,
      sun: SHOWER.has(code) || (cloud < 50 && !wet), fog: code === 45 || code === 48, thunder: code >= 95 };
  }
  const parse = rows => (rows || []).map(hour);

  // the hours with a + 1 h > t >= a … b (seconds; a 15-min slot gets the hour it is in); list sorted by t
  function between(list, a, b) {
    let lo = 0, hi = list.length;
    a = Math.floor(a / 3600) * 3600;
    while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].t < a) lo = m + 1; else hi = m; }
    const out = [];
    for (let i = lo; i < list.length && list[i].t < b; i++) out.push(list[i]);
    return out;
  }

  // several hours -> one icon that keeps what happened: cloud cover is averaged; sun seen in some hours and rain in others
  // gives sun, cloud and rain; rain / sleet / snow when at least 1/5 of the hours were wet or it rained 1 mm (2 mm a day
  // over longer steps); snow and rain together give sleet; thunder adds a bolt; the moon when most hours are dark (not for
  // a day or longer). Over more than a day, sun and thunder must be in a part of the hours, so a month is not all of them at once.
  function summarize(list, long = false) {
    const n = list.length;
    if (!n) return null;
    const sum = k => list.reduce((s, w) => s + w[k], 0), share = f => list.filter(f).length / n, wet = list.filter(w => w.kind), mm = sum('mm');
    const some = n > 24 ? 0.15 : 1e-9, rare = n > 24 ? 0.02 : 1e-9;
    const precip = wet.length / n >= 0.2 || mm >= Math.max(1, n / 12);
    let sky = (c => c < 20 ? 0 : c < 50 ? 1 : c < 85 ? 2 : 3)(sum('cloud') / n);
    if (share(w => w.sun) >= some && (sky === 3 || precip)) sky = Math.min(sky, precip ? 1 : 2);
    const count = {}; wet.forEach(w => count[w.kind] = (count[w.kind] || 0) + 1);
    const top = Object.entries(count).sort((x, y) => y[1] - x[1])[0];
    const kind = !precip || !top ? null : top[1] >= 0.8 * wet.length ? top[0] : 'sleet';  // a real mix of rain and snow is sleet
    const per = wet.length ? mm / wet.length : 0;
    const sx = list.reduce((s, w) => s + Math.sin(w.dir * Math.PI / 180), 0), cx = list.reduce((s, w) => s + Math.cos(w.dir * Math.PI / 180), 0);
    return { sky, kind, amount: per < 0.5 ? 1 : per < 2 ? 2 : 3, thunder: share(w => w.thunder) >= rare,
      fog: !precip && share(w => w.fog) > 0.5, night: !long && share(w => !w.day) > 0.5,
      temp: sum('temp') / n, ms: sum('ms') / n, mm, dir: (Math.atan2(sx, cx) * 180 / Math.PI + 360) % 360, hours: n };
  }
  function describe(s) {
    if (!s) return '';
    const what = s.fog ? 'Fog' : ['Clear', 'Partly cloudy', 'Mostly cloudy', 'Cloudy'][s.sky];
    const pr = s.kind ? `${['light', 'moderate', 'heavy'][s.amount - 1]} ${s.kind}` : '';
    return [what, pr, s.thunder ? 'thunder' : ''].filter(Boolean).join(', ');
  }

  // ------------------------------------------------------------ drawing (canvas, so it looks the same everywhere)
  const TOKENS = ['sun', 'moon', 'cloud', 'cloud-dark', 'cloud-edge', 'rain', 'snow', 'bolt', 'fog'];
  const palette = () => { const st = getComputedStyle(document.body); return Object.fromEntries(TOKENS.map(k => [k, st.getPropertyValue('--wx-' + k).trim()])); };
  function cloudPath(g, x, y, r) {  // a cloud whose base centre is x, y
    g.beginPath();
    g.arc(x - r * .55, y - r * .32, r * .32, 0, 7); g.moveTo(x, y);
    g.arc(x - r * .05, y - r * .55, r * .45, 0, 7); g.moveTo(x, y);
    g.arc(x + r * .5, y - r * .35, r * .35, 0, 7);
    g.rect(x - r * .55, y - r * .32, r * 1.05, r * .32);
  }
  function cloud(g, P, x, y, r, dark) {  // the outline is the outer half of a stroke that the fill covers inside
    cloudPath(g, x, y, r); g.lineWidth = Math.max(1, r * .1); g.strokeStyle = P['cloud-edge']; g.stroke();
    cloudPath(g, x, y, r); g.fillStyle = P[dark ? 'cloud-dark' : 'cloud']; g.fill();
  }
  function sun(g, P, x, y, r) {
    g.strokeStyle = g.fillStyle = P.sun; g.lineWidth = Math.max(1, r * .16);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      g.beginPath(); g.moveTo(x + Math.cos(a) * r * .72, y + Math.sin(a) * r * .72); g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); g.stroke();
    }
    g.beginPath(); g.arc(x, y, r * .5, 0, 7); g.fill();
  }
  function moon(g, P, x, y, r) {  // a crescent: a disc minus a shifted disc (drawn apart, then copied, so nothing under it is cut)
    const s = Math.ceil(r * 2.6), c = moon.c ||= document.createElement('canvas');
    c.width = c.height = s * 2; const m = c.getContext('2d'); m.setTransform(2, 0, 0, 2, 0, 0); m.clearRect(0, 0, s, s);
    m.fillStyle = P.moon; m.beginPath(); m.arc(s / 2, s / 2, r * .62, 0, 7); m.fill();
    m.globalCompositeOperation = 'destination-out'; m.beginPath(); m.arc(s / 2 + r * .32, s / 2 - r * .22, r * .52, 0, 7); m.fill();
    m.globalCompositeOperation = 'source-over';
    g.drawImage(c, x - s / 2, y - s / 2, s, s);
  }
  function draw(g, cx, cy, size, s, P) {  // the icon of summarize() in a size × size box centred on cx, cy
    const r = size / 2, wet = !!s.kind || s.thunder, low = wet ? cy + r * .1 : cy + r * .45;  // a cloud sits higher with rain under it
    const orb = (x, y, k) => s.night ? moon(g, P, x, y, r * k) : sun(g, P, x, y, r * k);
    g.save(); g.lineCap = 'round'; g.setLineDash([]);
    if (s.fog) {
      cloud(g, P, cx + r * .05, cy + r * .05, r * 1.05, false);
      g.strokeStyle = P.fog; g.lineWidth = Math.max(1.2, r * .13);
      for (const [dy, w] of [[.32, .8], [.6, .6], [.88, .75]]) { g.beginPath(); g.moveTo(cx - r * w, cy + r * dy); g.lineTo(cx + r * w, cy + r * dy); g.stroke(); }
    } else if (s.sky === 0 && !wet) orb(cx, cy, .9);
    else {
      if (s.sky <= 2) orb(cx - r * .3, cy - r * (wet ? .42 : .25), s.sky === 2 ? .55 : .62);
      if (s.sky === 3) cloud(g, P, cx + r * .32, low - r * .38, r * .7, true);
      cloud(g, P, cx + r * (s.sky <= 1 ? .2 : .05), low, r * (s.sky === 1 ? .95 : 1.1), s.sky === 3 && wet);
    }
    if (s.kind) {  // 2 … 4 drops or flakes for light … heavy; sleet mixes both
      const n = s.amount + 1, y0 = low + r * .18;
      for (let i = 0; i < n; i++) {
        const x = cx - r * .5 + (i + .5) * r * 1.1 / n;
        if (s.kind === 'snow' || (s.kind === 'sleet' && i % 2)) {
          g.strokeStyle = P.snow; g.lineWidth = Math.max(1, r * .1);
          const k = r * .15, yy = y0 + r * .26;
          for (let a = 0; a < 3; a++) { const an = a * Math.PI / 3; g.beginPath(); g.moveTo(x - Math.cos(an) * k, yy - Math.sin(an) * k); g.lineTo(x + Math.cos(an) * k, yy + Math.sin(an) * k); g.stroke(); }
        } else { g.strokeStyle = P.rain; g.lineWidth = Math.max(1.2, r * .13); g.beginPath(); g.moveTo(x + r * .1, y0); g.lineTo(x - r * .06, y0 + r * .42); g.stroke(); }
      }
    }
    if (s.thunder) {
      const x = cx + r * .12, y = low + r * .02;
      g.fillStyle = P.bolt; g.beginPath(); g.moveTo(x, y); g.lineTo(x - r * .3, y + r * .45); g.lineTo(x - r * .05, y + r * .45); g.lineTo(x - r * .2, y + r * .85);
      g.lineTo(x + r * .3, y + r * .28); g.lineTo(x + r * .03, y + r * .28); g.lineTo(x + r * .15, y); g.closePath(); g.fill();
    }
    g.restore();
  }

  // Open-Meteo hourly JSON (timeformat=unixtime) -> stored rows, as wx_rows() in app/main.py (standalone mode)
  const VARS = 'weather_code,temperature_2m,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation,snowfall,is_day';
  function rowsOf(j) {
    const h = j?.hourly || {}, cols = ['time', ...VARS.split(',')].map(k => h[k] || []);
    return cols[0].map((t, i) => cols.map(c => c[i])).filter(r => r[1] != null && r[2] != null).map(r => [r[0], r[1], ...r.slice(2, 8), r[8] ? 1 : 0]);
  }
  return { parse, between, summarize, describe, palette, draw, rowsOf, VARS };
})();
