"""Electricity Finland: spot price + wind monitor with WhatsApp/email alarms."""
import asyncio, hashlib, hmac, json, logging, os, smtplib, sqlite3, ssl, time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from email.message import EmailMessage
from zoneinfo import ZoneInfo

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, Response

log = logging.getLogger("elfi")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

TZ = ZoneInfo("Europe/Helsinki")
VAT_FEED = 1.255  # VAT included in the public feeds (porssisahko, forecast)
APP_PASSWORD = os.environ["APP_PASSWORD"]
SECRET = (os.getenv("SECRET_KEY") or APP_PASSWORD).encode()
FINGRID_KEY = os.getenv("FINGRID_API_KEY", "")
SMTP = {k: os.getenv("SMTP_" + k.upper(), "") for k in ("host", "port", "security", "verify", "user", "pass", "from")}
NPF = "https://raw.githubusercontent.com/vividfog/nordpool-predict-fi/main/deploy/"

# Fee fields are c/kWh incl. VAT (as on Finnish invoices); monthly fees in EUR.
DEFAULTS = {
    "vat": 25.5, "margin": 0.0, "transfer_day": 0.0, "transfer_night": 0.0,
    "night_start": 22, "night_end": 7, "tax": 2.827, "other": 0.0,
    "monthly_provider": 0.0, "monthly_transfer": 0.0, "monthly_kwh": 0.0, "spread_monthly": False,
    "alarm_basis": "total", "high_on": False, "high": 20.0, "low_on": False, "low": 2.0,
    "hysteresis": 0.5, "summary_on": True, "quiet_start": -1, "quiet_end": -1,
    "wa_on": False, "wa_phone": "", "wa_apikey": "", "email_on": False, "email_to": "",
}

db = sqlite3.connect(os.getenv("DB_PATH", "/data/app.db"), check_same_thread=False)
db.executescript("""
CREATE TABLE IF NOT EXISTS prices(ts INTEGER PRIMARY KEY, spot REAL);
CREATE TABLE IF NOT EXISTS forecast(ts INTEGER PRIMARY KEY, spot REAL);
CREATE TABLE IF NOT EXISTS wind(ts INTEGER, src TEXT, mw REAL, PRIMARY KEY(ts, src));
CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);
""")


def kv_get(k, default=None):
    r = db.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
    return json.loads(r[0]) if r else default


def kv_set(k, v):
    db.execute("REPLACE INTO kv VALUES(?,?)", (k, json.dumps(v)))
    db.commit()


def settings():
    return {**DEFAULTS, **kv_get("settings", {})}


def ts_of(iso):
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())


def ex_vat(v):  # strip feed VAT (VAT is not applied to negative prices)
    return v / VAT_FEED if v > 0 else v


def costs(s, ts, spot):
    """spot c/kWh excl. VAT -> (spot incl. VAT, total incl. all fees)."""
    sv = spot * (1 + s["vat"] / 100) if spot > 0 else spot
    h, ns, ne = datetime.fromtimestamp(ts, TZ).hour, s["night_start"], s["night_end"]
    night = (h >= ns or h < ne) if ns > ne else (ns <= h < ne)
    total = sv + s["margin"] + s["tax"] + s["other"] + (s["transfer_night"] if night else s["transfer_day"])
    if s["spread_monthly"] and s["monthly_kwh"] > 0:
        total += (s["monthly_provider"] + s["monthly_transfer"]) * 100 / s["monthly_kwh"]
    return round(sv, 3), round(total, 3)


def upsert(table, rows, src=None):
    if src:
        db.executemany(f"REPLACE INTO {table} VALUES(?,?,?)", [(t, src, v) for t, v in rows])
    else:
        db.executemany(f"REPLACE INTO {table} VALUES(?,?)", rows)
    db.commit()
    return len(rows)


# ---------------------------------------------------------------- fetchers
async def fetch_prices(c):
    try:
        r = await c.get("https://api.spot-hinta.fi/TodayAndDayForward", params={"priceResolution": 15})
        r.raise_for_status()
        rows = [(ts_of(x["DateTime"]), x["PriceNoTax"] * 100) for x in r.json()]
    except Exception as e:
        log.warning("spot-hinta.fi failed (%s), trying porssisahko.net", e)
        r = await c.get("https://api.porssisahko.net/v2/latest-prices.json")
        r.raise_for_status()
        rows = [(ts_of(x["startDate"]), ex_vat(x["price"])) for x in r.json()["prices"]]
    log.info("prices: %d rows", upsert("prices", rows))


async def fetch_forecasts(c):
    for name, table in (("prediction.json", "forecast"), ("windpower.json", "wind")):
        r = await c.get(NPF + name)
        r.raise_for_status()
        rows = [(int(t / 1000), ex_vat(v) if table == "forecast" else v) for t, v in r.json()]
        upsert(table, rows, None if table == "forecast" else "npf")
    if FINGRID_KEY:  # 245 = wind forecast (15 min), 75 = wind production actual
        now = datetime.now(TZ)
        for ds, src, a, b in ((245, "fingrid", now - timedelta(hours=2), now + timedelta(days=3)),
                              (75, "actual", now - timedelta(days=7), now)):
            r = await c.get(f"https://data.fingrid.fi/api/datasets/{ds}/data", headers={"x-api-key": FINGRID_KEY},
                            params={"startTime": a.isoformat(), "endTime": b.isoformat(), "pageSize": 20000, "sortOrder": "asc"})
            r.raise_for_status()
            upsert("wind", [(ts_of(x["startTime"]), x["value"]) for x in r.json()["data"]], src)
            await asyncio.sleep(7)  # Fingrid allows 10 requests/min
    cutoff = time.time() - 90 * 86400
    for t in ("prices", "forecast", "wind"):
        db.execute(f"DELETE FROM {t} WHERE ts<?", (cutoff,))
    db.commit()


# ---------------------------------------------------------------- notifications
def send_mail(to, subject, text):
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = SMTP["from"] or SMTP["user"], to, subject
    msg.set_content(text)
    ctx = ssl.create_default_context()
    if SMTP["verify"].lower() == "false":
        ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE
    port, sec = int(SMTP["port"] or 587), SMTP["security"] or "starttls"
    with (smtplib.SMTP_SSL(SMTP["host"], port, context=ctx, timeout=20) if sec == "ssl"
          else smtplib.SMTP(SMTP["host"], port, timeout=20)) as smtp:
        if sec == "starttls":
            smtp.starttls(context=ctx)
        if SMTP["user"]:
            smtp.login(SMTP["user"], SMTP["pass"])
        smtp.send_message(msg)


async def notify(c, s, text, force=False):
    out = {}
    if s["wa_on"] or force:
        if s["wa_phone"] and s["wa_apikey"]:
            try:
                r = await c.get("https://api.callmebot.com/whatsapp.php",
                                params={"phone": s["wa_phone"], "text": text, "apikey": s["wa_apikey"]})
                ok = r.status_code == 200 and "error" not in r.text.lower()
                out["whatsapp"] = "sent" if ok else f"failed: {r.status_code} {r.text[:120]}"
            except Exception as e:
                out["whatsapp"] = f"failed: {e}"
        else:
            out["whatsapp"] = "missing phone or API key"
    if s["email_on"] or force:
        if s["email_to"] and SMTP["host"]:
            try:
                await asyncio.to_thread(send_mail, s["email_to"], "Electricity price alert", text)
                out["email"] = "sent"
            except Exception as e:
                out["email"] = f"failed: {e}"
        else:
            out["email"] = "missing recipient or SMTP_HOST"
    log.info("notify %s -> %s", text[:60], out)
    return out


# ---------------------------------------------------------------- alarms
def in_quiet(s):
    a, b, h = s["quiet_start"], s["quiet_end"], datetime.now(TZ).hour
    if a < 0 or b < 0 or a == b:
        return False
    return (h >= a or h < b) if a > b else (a <= h < b)


def price_of(s, ts, spot):
    sv, tot = costs(s, ts, spot)
    return tot if s["alarm_basis"] == "total" else sv


def fmt(ts):
    return datetime.fromtimestamp(ts, TZ).strftime("%H:%M")


def check_alarms(s):
    row = db.execute("SELECT ts, spot FROM prices WHERE ts<=? ORDER BY ts DESC LIMIT 1", (time.time(),)).fetchone()
    if not row or time.time() - row[0] > 3600:
        return []
    p, st, msgs, hy = price_of(s, *row), kv_get("alarm_state", {}), [], s["hysteresis"]
    for kind, on, trig, clear, word in (
        ("high", s["high_on"], p >= s["high"], p < s["high"] - hy, "ABOVE"),
        ("low", s["low_on"], p <= s["low"], p > s["low"] + hy, "BELOW"),
    ):
        if on and trig and not st.get(kind):
            st[kind] = True
            msgs.append(f"⚡ Price {word} {s[kind]} c/kWh: now {p:.2f} c/kWh ({fmt(row[0])}, {s['alarm_basis']})")
        elif st.get(kind) and (clear or not on):
            st[kind] = False
    kv_set("alarm_state", st)
    return [] if in_quiet(s) else msgs


def windows(rows, test):
    out, start, prev = [], None, None
    for ts, p in rows:
        if test(p) and start is None:
            start = ts
        if not test(p) and start is not None:
            out.append(f"{fmt(start)}–{fmt(ts)}")
            start = None
        prev = ts
    if start is not None:
        out.append(f"{fmt(start)}–{fmt(prev + 900)}")
    return ", ".join(out)


def daily_summary(s):
    day0 = datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    a, b, key = int(day0.timestamp()), int((day0 + timedelta(days=1)).timestamp()), day0.date().isoformat()
    if not s["summary_on"] or kv_get("summary_date") == key:
        return []
    rows = [(t, price_of(s, t, v)) for t, v in db.execute("SELECT ts, spot FROM prices WHERE ts>=? AND ts<? ORDER BY ts", (a, b))]
    if not rows or rows[-1][0] < b - 3600:
        return []
    kv_set("summary_date", key)
    ps = [p for _, p in rows]
    lo, hi = min(rows, key=lambda r: r[1]), max(rows, key=lambda r: r[1])
    msg = (f"📅 Tomorrow {day0:%d.%m.} ({s['alarm_basis']}): avg {sum(ps)/len(ps):.2f}, "
           f"min {lo[1]:.2f} @{fmt(lo[0])}, max {hi[1]:.2f} @{fmt(hi[0])} c/kWh")
    if s["high_on"] and (w := windows(rows, lambda p: p >= s["high"])):
        msg += f"\n🔴 ≥{s['high']}: {w}"
    if s["low_on"] and (w := windows(rows, lambda p: p <= s["low"])):
        msg += f"\n🟢 ≤{s['low']}: {w}"
    return [msg]


def has_tomorrow():
    end = datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=2)
    r = db.execute("SELECT MAX(ts) FROM prices").fetchone()[0]
    return bool(r and r >= end.timestamp() - 3600)


async def worker():
    last = {"p": 0, "f": 0}
    async with httpx.AsyncClient(timeout=30, headers={"User-Agent": "electricityfinland/1.0"}) as c:
        while True:
            now = time.time()
            waiting = not has_tomorrow() and datetime.now(TZ).hour >= 13
            for k, every, fn in (("p", 600 if waiting else 3600, fetch_prices), ("f", 3600, fetch_forecasts)):
                if now - last[k] > every:
                    last[k] = now
                    try:
                        await fn(c)
                    except Exception as e:
                        log.warning("%s failed: %s", fn.__name__, e)
                        last[k] = now - every + 300  # retry in 5 min
            try:
                s = settings()
                for m in check_alarms(s) + daily_summary(s):
                    await notify(c, s, m)
            except Exception:
                log.exception("alarm check failed")
            await asyncio.sleep(60)


# ---------------------------------------------------------------- web api
@asynccontextmanager
async def lifespan(_):
    task = asyncio.create_task(worker())
    yield
    task.cancel()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)
FAILS: dict[str, list[float]] = {}
SESSION_DAYS = 30


def sign(exp):
    return hmac.new(SECRET, str(exp).encode(), hashlib.sha256).hexdigest()


def auth(request: Request):
    exp, _, sig = request.cookies.get("session", "").partition(".")
    if not (exp.isdigit() and int(exp) > time.time() and hmac.compare_digest(sig, sign(exp))):
        raise HTTPException(401, "login required")


@app.post("/api/login")
async def login(body: dict, request: Request, response: Response):
    ip = request.headers.get("x-real-ip") or request.client.host
    FAILS[ip] = [t for t in FAILS.get(ip, []) if t > time.time() - 900]
    if len(FAILS[ip]) >= 5:
        raise HTTPException(429, "too many attempts, wait 15 min")
    if not hmac.compare_digest(str(body.get("password", "")).encode(), APP_PASSWORD.encode()):
        FAILS[ip].append(time.time())
        raise HTTPException(401, "wrong password")
    exp = int(time.time()) + SESSION_DAYS * 86400
    response.set_cookie("session", f"{exp}.{sign(exp)}", max_age=SESSION_DAYS * 86400, httponly=True,
                        samesite="strict", secure=request.headers.get("x-forwarded-proto") == "https")
    return {"ok": True}


@app.post("/api/logout")
async def logout(response: Response):
    response.delete_cookie("session")
    return {"ok": True}


@app.get("/api/data", dependencies=[Depends(auth)])
async def data(days_back: int = 1):
    s, start = settings(), time.time() - max(1, min(days_back, 60)) * 86400
    q = lambda sql, *a: db.execute(sql, a).fetchall()
    actual = [[t, *costs(s, t, v)] for t, v in q("SELECT ts, spot FROM prices WHERE ts>=? ORDER BY ts", start)]
    last = actual[-1][0] if actual else 0
    fc = [[t, *costs(s, t, v)] for t, v in q("SELECT ts, spot FROM forecast WHERE ts>? ORDER BY ts", max(last, start))]
    fg = dict(q("SELECT ts, mw FROM wind WHERE src='fingrid' AND ts>=?", start))
    fg_end = max(fg) if fg else 0
    wind = sorted({**{t: v for t, v in q("SELECT ts, mw FROM wind WHERE src='npf' AND ts>=?", start)
                      if t > fg_end or not fg}, **fg}.items())
    act = q("SELECT ts, mw FROM wind WHERE src='actual' AND ts>=? ORDER BY ts", start)
    return {"actual": actual, "forecast": fc, "wind": wind, "wind_actual": act, "settings": s,
            "smtp": bool(SMTP["host"]), "fingrid": bool(FINGRID_KEY)}


@app.put("/api/settings", dependencies=[Depends(auth)])
async def put_settings(body: dict):
    s = settings()
    for k, v in body.items():
        if k in DEFAULTS:
            d = DEFAULTS[k]
            try:
                s[k] = bool(v) if isinstance(d, bool) else type(d)(v)
            except (TypeError, ValueError):
                raise HTTPException(400, f"invalid value for {k}")
    if s["alarm_basis"] not in ("total", "spot"):
        raise HTTPException(400, "alarm_basis must be total or spot")
    kv_set("settings", s)
    kv_set("alarm_state", {})  # re-evaluate alarms with new thresholds
    return s


@app.post("/api/test-notify", dependencies=[Depends(auth)])
async def test_notify():
    async with httpx.AsyncClient(timeout=30) as c:
        return await notify(c, settings(), "✅ Test message from Electricity Finland", force=True)
