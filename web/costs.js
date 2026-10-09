// Price calculation shared by app.js and local.js. Mirrors value() in app/main.py.
// spot: c/kWh excl. VAT. Fee settings are c/kWh incl. VAT, monthly fees in EUR.
// kind: 'spot' | 'transfer' (transfer fee + electricity tax) | 'total'.
function priceValue(s, ts, spot, kind, vat) {
  const k = 1 + s.vat / 100, h = new Date(ts * 1000).getHours(), ns = s.night_start, ne = s.night_end;
  const night = ns > ne ? (h >= ns || h < ne) : (ns <= h && h < ne);
  const per = s.spread_monthly && s.monthly_kwh > 0 ? 100 / s.monthly_kwh : 0;
  const transfer = (night ? s.transfer_night : s.transfer_day) + s.tax + s.monthly_transfer * per;
  const energy = s.margin + s.other + s.monthly_provider * per;
  const sp = vat ? (spot > 0 ? spot * k : spot) : spot, f = vat ? 1 : 1 / k;
  return kind === 'spot' ? sp : kind === 'transfer' ? transfer * f : sp + (transfer + energy) * f;
}
