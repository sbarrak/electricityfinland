"""Electricity Finland: spot price + wind monitor with WhatsApp/email alarms."""
import asyncio, hashlib, hmac, json, logging, os, re, smtplib, sqlite3, ssl, time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from email.message import EmailMessage
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env"
if ENV_FILE.is_file():  # local run without Docker: read ../.env (real env vars win)
    for line in ENV_FILE.read_text().splitlines():
        k, sep, v = line.partition("=")
        if sep and not k.strip().startswith("#"):
            os.environ.setdefault(k.strip(), v.strip())

log = logging.getLogger("elfi")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

TZ = ZoneInfo("Europe/Helsinki")
VAT_FEED = 1.255  # VAT included in the public feeds (porssisahko, forecast)
FINGRID_KEY = os.getenv("FINGRID_API_KEY", "")
HISTORY_DAYS = 366
NPF = "https://raw.githubusercontent.com/vividfog/nordpool-predict-fi/main/deploy/"
env = lambda k, d="": os.getenv("SMTP_" + k.upper(), d)

# Fee fields are c/kWh incl. VAT (as on Finnish invoices); monthly fees in EUR.
DEFAULTS = {
    "vat": 25.5, "margin": 0.0, "transfer_day": 0.0, "transfer_night": 0.0,
    "night_start": 22, "night_end": 7, "tax": 2.827, "other": 0.0,
    "monthly_provider": 0.0, "monthly_transfer": 0.0, "monthly_kwh": 0.0, "spread_monthly": False,
    "alarm_basis": "total", "alarm_vat": True, "high_on": False, "high": 20.0, "low_on": False, "low": 2.0,
    "summary_on": True,
    "wa_on": False, "email_on": False, "recipients": [],
    # message templates, placeholders: see fill() / web/costs.js
    "msg_high": "🔴 High price {price} c/kWh · {weekday} {date} {time}–{end} ({duration}) · limit {limit}",
    "msg_low": "🟢 Low price {price} c/kWh · {weekday} {date} {time}–{end} ({duration}) · limit {limit}",
    "msg_summary": "📅 Prices {from} – {to}: avg {avg}, min {min} at {min_time}, max {max} at {max_time} c/kWh ({basis})",
    # email server (SMTP relay); SMTP_* env vars are used when a field is empty
    "smtp_host": env("host", "mail.laseleka.com"), "smtp_port": int(env("port", "587") or 587),
    "smtp_security": env("security", "starttls"), "smtp_verify": env("verify", "true").lower() != "false",
    "smtp_user": env("user"), "smtp_pass": env("pass"), "smtp_from": env("from"),
}
SECRET_FIELDS = ("smtp_pass",)

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


def clean_recipient(r):
    g = lambda k, n=200: str(r.get(k, "") or "").strip()[:n]
    return {"name": g("name", 60), "phone": g("phone", 30), "apikey": g("apikey", 60), "email": g("email"),
            "wa": bool(r.get("wa")), "mail": bool(r.get("mail"))}


def settings():
    s = {**DEFAULTS, **kv_get("settings", {})}
    if not s["recipients"] and (s.get("wa_phone") or s.get("email_to")):  # migrate single-recipient settings
        s["recipients"] = [clean_recipient({"name": "Me", "phone": s.get("wa_phone"), "apikey": s.get("wa_apikey"),
                                            "email": s.get("email_to"), "wa": True, "mail": True})]
    return s


def public(s):  # never send stored secrets back to the browser
    return {**s, **{k: "" for k in SECRET_FIELDS}, **{k + "_set": bool(s[k]) for k in SECRET_FIELDS}}


def ts_of(iso):
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())


def ex_vat(v):  # strip feed VAT (VAT is not applied to negative prices)
    return v / VAT_FEED if v > 0 else v


def value(s, ts, spot, kind="total", vat=True):
    """spot c/kWh excl. VAT -> c/kWh for kind spot|transfer|total. Mirrors web/costs.js."""
    k = 1 + s["vat"] / 100
    h, ns, ne = datetime.fromtimestamp(ts, TZ).hour, s["night_start"], s["night_end"]
    night = (h >= ns or h < ne) if ns > ne else (ns <= h < ne)
    per = 100 / s["monthly_kwh"] if s["spread_monthly"] and s["monthly_kwh"] > 0 else 0
    transfer = (s["transfer_night"] if night else s["transfer_day"]) + s["tax"] + s["monthly_transfer"] * per
    energy = s["margin"] + s["other"] + s["monthly_provider"] * per
    sp = (spot * k if spot > 0 else spot) if vat else spot
    f = 1 if vat else 1 / k
    return round(sp if kind == "spot" else transfer * f if kind == "transfer" else sp + (transfer + energy) * f, 3)


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


async def backfill(c):
    """Load up to a year of hourly history (sahkotin.fi, EUR/MWh excl. VAT) without overwriting 15-min data."""
    first = db.execute("SELECT MIN(ts) FROM prices").fetchone()[0] or time.time()
    start = time.time() - HISTORY_DAYS * 86400
    if first - start < 2 * 86400:
        return
    iso = lambda t: datetime.fromtimestamp(t, TZ).isoformat()
    r = await c.get("https://sahkotin.fi/prices", params={"start": iso(start), "end": iso(first)})
    r.raise_for_status()
    rows = [(ts_of(x["date"]), x["value"] / 10) for x in r.json()["prices"]]
    db.executemany("INSERT OR IGNORE INTO prices VALUES(?,?)", rows)
    db.commit()
    log.info("history backfill: %d rows", len(rows))


async def fetch_forecasts(c, fingrid=True):
    # keep only estimates for slots without a published price, so past estimates stay as they were before bidding
    last = db.execute("SELECT MAX(ts) FROM prices").fetchone()[0] or 0
    for name, table in (("prediction.json", "forecast"), ("windpower.json", "wind")):
        r = await c.get(NPF + name)
        r.raise_for_status()
        if table == "forecast":
            upsert(table, [(int(t / 1000), ex_vat(v)) for t, v in r.json() if t / 1000 > last])
        else:
            upsert(table, [(int(t / 1000), v) for t, v in r.json()], "npf")
    if FINGRID_KEY and fingrid:  # 245 = wind forecast (15 min), 75 = wind production actual
        now = datetime.now(TZ)
        for ds, src, a, b in ((245, "fingrid", now - timedelta(hours=2), now + timedelta(days=3)),
                              (75, "actual", now - timedelta(days=7), now)):
            r = await c.get(f"https://data.fingrid.fi/api/datasets/{ds}/data", headers={"x-api-key": FINGRID_KEY},
                            params={"startTime": a.isoformat(), "endTime": b.isoformat(), "pageSize": 20000, "sortOrder": "asc"})
            r.raise_for_status()
            upsert("wind", [(ts_of(x["startTime"]), x["value"]) for x in r.json()["data"]], src)
            await asyncio.sleep(7)  # Fingrid allows 10 requests/min
    cutoff = time.time() - (HISTORY_DAYS + 5) * 86400
    for t in ("prices", "forecast", "wind"):
        db.execute(f"DELETE FROM {t} WHERE ts<?", (cutoff,))
    db.commit()


# ---------------------------------------------------------------- notifications
def send_mail(s, to, subject, text):
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = s["smtp_from"] or s["smtp_user"], to, subject
    msg.set_content(text)
    ctx = ssl.create_default_context()
    if not s["smtp_verify"]:
        ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE
    port, sec = int(s["smtp_port"] or 587), s["smtp_security"] or "starttls"
    with (smtplib.SMTP_SSL(s["smtp_host"], port, context=ctx, timeout=20) if sec == "ssl"
          else smtplib.SMTP(s["smtp_host"], port, timeout=20)) as smtp:
        if sec == "starttls":
            smtp.starttls(context=ctx)
        if s["smtp_user"]:
            smtp.login(s["smtp_user"], s["smtp_pass"])
        smtp.send_message(msg)


async def notify(c, s, text, force=None):
    """Send to all recipients. force: None = alarm (respects switches), 'all' | 'whatsapp' | 'email' = test."""
    out = {}
    wa = force in ("all", "whatsapp") or (force is None and s["wa_on"])
    em = force in ("all", "email") or (force is None and s["email_on"])
    for r in s["recipients"]:
        who = r["name"] or r["phone"] or r["email"]
        if wa and r["wa"] and r["phone"]:
            if not r["apikey"]:
                out[f"{who} WhatsApp"] = "missing CallMeBot API key"
            else:
                try:
                    res = await c.get("https://api.callmebot.com/whatsapp.php",
                                      params={"phone": r["phone"], "text": text, "apikey": r["apikey"]})
                    ok = res.status_code == 200 and "error" not in res.text.lower()
                    out[f"{who} WhatsApp"] = "sent" if ok else f"failed: {res.status_code} {res.text[:120]}"
                except Exception as e:
                    out[f"{who} WhatsApp"] = f"failed: {e}"
        if em and r["mail"] and r["email"]:
            if not s["smtp_host"]:
                out[f"{who} email"] = "email server not configured"
            else:
                try:
                    await asyncio.to_thread(send_mail, s, r["email"], "Electricity price alert", text)
                    out[f"{who} email"] = "sent"
                except Exception as e:
                    out[f"{who} email"] = f"failed: {e}"
    if not out:
        out["info"] = "no recipient has this channel enabled"
    log.info("notify %s -> %s", text[:60], out)
    return out


# ---------------------------------------------------------------- alarms
def price_of(s, ts, spot):
    return value(s, ts, spot, s["alarm_basis"], s["alarm_vat"])


def basis(s):
    return ("spot" if s["alarm_basis"] == "spot" else "total cost") + (" incl. VAT" if s["alarm_vat"] else " excl. VAT")


def fmt(ts):
    return datetime.fromtimestamp(ts, TZ).strftime("%H:%M")


WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def fill(tpl, f):
    """Replace {name} placeholders; unknown ones stay as written. Mirrors fillTemplate() in web/costs.js."""
    return re.sub(r"\{(\w+)\}", lambda m: str(f.get(m[1], m[0])), tpl)


def duration(sec):
    h, m = divmod(int(sec) // 60, 60)
    return f"{h} h {m} min" if h and m else f"{h} h" if h else f"{m} min"


SEND_HOUR = 14  # Nord Pool publishes the next day around 13:45 Finnish time


def daystamp(ts):
    d = datetime.fromtimestamp(ts, TZ)
    return f"{WEEKDAYS[d.weekday()]} {d:%d.%m.} {d:%H:%M}"


def window_fields(s, kind, w):
    ps = [p for p, _ in w["ps"]]
    d = datetime.fromtimestamp(w["start"], TZ)
    return {"price": f"{(max(ps) if kind == 'high' else min(ps)):.2f}",
            "avg": f"{sum(p * n for p, n in w['ps']) / sum(n for _, n in w['ps']):.2f}",
            "date": d.strftime("%d.%m."), "weekday": WEEKDAYS[d.weekday()], "time": fmt(w["start"]), "end": fmt(w["end"]),
            "duration": duration(w["end"] - w["start"]), "limit": f"{s[kind]:g}", "basis": basis(s)}


def daily_message(s, rows, a, b):
    """Message for the fixed prices a..b: a summary line plus one line per crossing.
    High: price goes from below the limit to >= limit. Low: price goes from above the limit to <= limit.
    Mirrors dailyMessage() in web/costs.js."""
    pts = []
    for i, (t, v) in enumerate(rows):
        step = min(3600, rows[i + 1][0] - t) if i + 1 < len(rows) else 900
        pts.append((t, price_of(s, t, v), step))
    hit = {"high": lambda p: p >= s["high"], "low": lambda p: p <= s["low"]}
    lines = []
    for i in range(1, len(pts)):
        if not a <= pts[i][0] < b:
            continue
        for kind in ("high", "low"):
            if s[kind + "_on"] and hit[kind](pts[i][1]) and not hit[kind](pts[i - 1][1]):
                j, ps = i, []
                while j < len(pts) and hit[kind](pts[j][1]):
                    ps.append((pts[j][1], pts[j][2]))
                    j += 1
                end = pts[j][0] if j < len(pts) else pts[-1][0] + pts[-1][2]
                lines.append((pts[i][0], fill(s["msg_" + kind], window_fields(s, kind, {"start": pts[i][0], "end": end, "ps": ps}))))
    out = []
    day = [p for p in pts if a <= p[0] < b]
    if s["summary_on"] and day:
        lo, hi = min(day, key=lambda r: r[1]), max(day, key=lambda r: r[1])
        avg = sum(p * n for _, p, n in day) / sum(n for *_, n in day)
        out.append(fill(s["msg_summary"], {"from": daystamp(a), "to": daystamp(b), "avg": f"{avg:.2f}",
                                           "min": f"{lo[1]:.2f}", "min_time": daystamp(lo[0]), "max": f"{hi[1]:.2f}",
                                           "max_time": daystamp(hi[0]), "basis": basis(s),
                                           "weekday": WEEKDAYS[datetime.fromtimestamp(a, TZ).weekday()],
                                           "date": datetime.fromtimestamp(a, TZ).strftime("%d.%m.")}))
        if (s["high_on"] or s["low_on"]) and not lines:
            out.append("No crossings of your limits.")
    out += [text for _, text in sorted(lines)]
    return "\n".join(out)


def daily_alarm(s):
    """Once a day from 14:00 (normally 14:00–14:05): the fixed prices from 14:00 today to 14:00 tomorrow."""
    now = datetime.now(TZ)
    if now.hour < SEND_HOUR:
        return []
    start = now.replace(hour=SEND_HOUR, minute=0, second=0, microsecond=0)
    a, b, key = int(start.timestamp()), int((start + timedelta(days=1)).timestamp()), start.date().isoformat()
    if kv_get("daily_sent") == key:
        return []
    rows = db.execute("SELECT ts, spot FROM prices WHERE ts>=? ORDER BY ts", (a - 3600,)).fetchall()
    if not rows or rows[-1][0] < b - 900:  # next day not published yet
        return []
    kv_set("daily_sent", key)
    msg = daily_message(s, rows, a, b)
    return [msg] if msg else []


def has_tomorrow():
    end = datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=2)
    r = db.execute("SELECT MAX(ts) FROM prices").fetchone()[0]
    return bool(r and r >= end.timestamp() - 3600)


async def worker():
    last = {"p": 0, "f": 0, "h": 0}
    async with httpx.AsyncClient(timeout=30, headers={"User-Agent": "electricityfinland/1.0"}) as c:
        while True:
            now = time.time()
            waiting = not has_tomorrow() and datetime.now(TZ).hour >= 13
            for k, every, fn in (("p", 600 if waiting else 3600, fetch_prices), ("f", 3600, fetch_forecasts),
                                 ("h", 86400, backfill)):
                if now - last[k] > every:
                    last[k] = now
                    try:
                        await fn(c)
                    except Exception as e:
                        log.warning("%s failed: %s", fn.__name__, e)
                        last[k] = now - every + 300  # retry in 5 min
            try:
                s = settings()
                for m in daily_alarm(s):
                    await notify(c, s, m)
            except Exception:
                log.exception("alarm check failed")
            await asyncio.sleep(60)


# ---------------------------------------------------------------- account (single user, admin/admin until changed)
def hash_pw(pw, salt):
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 200_000).hex()


def new_account(username, password, must_change, gen=0):
    salt = os.urandom(16).hex()
    return {"username": username, "salt": salt, "hash": hash_pw(password, salt), "must_change": must_change, "gen": gen}


if os.getenv("RESET_ADMIN") == "1" or not kv_get("account"):  # first start, or forgotten password
    kv_set("account", new_account("admin", "admin", True, (kv_get("account") or {}).get("gen", 0) + 1))
if not kv_get("secret"):
    kv_set("secret", os.urandom(32).hex())
SECRET = (os.getenv("SECRET_KEY") or kv_get("secret")).encode()
SESSION_DAYS = 30


def sign(msg):
    return hmac.new(SECRET, msg.encode(), hashlib.sha256).hexdigest()


def set_session(request, response, a):
    exp = int(time.time()) + SESSION_DAYS * 86400
    token = f"{exp}.{a['gen']}"
    response.set_cookie("session", f"{token}.{sign(token)}",
                        max_age=SESSION_DAYS * 86400, httponly=True, samesite="strict",
                        secure=request.headers.get("x-forwarded-proto") == "https")


def auth_any(request: Request):  # logged in (may still have to change the default credentials)
    exp, gen, sig = (request.cookies.get("session", "").split(".") + ["", "", ""])[:3]
    if not (exp.isdigit() and int(exp) > time.time() and gen == str(kv_get("account")["gen"])
            and hmac.compare_digest(sig, sign(f"{exp}.{gen}"))):
        raise HTTPException(401, "login required")


def auth(request: Request):
    auth_any(request)
    if kv_get("account")["must_change"]:
        raise HTTPException(403, "change the default username and password first")


# ---------------------------------------------------------------- web api
@asynccontextmanager
async def lifespan(_):
    task = asyncio.create_task(worker())
    yield
    task.cancel()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)


@app.post("/api/login")
async def login(body: dict, request: Request, response: Response):
    if "username" not in body:  # an old cached page sends only a password
        raise HTTPException(400, "This page is outdated: reload it (Safari: Cmd+Option+R, others: Ctrl+Shift+R)")
    a = kv_get("account")
    user_ok = hmac.compare_digest(str(body["username"]).strip().lower().encode(), a["username"].lower().encode())
    pw_ok = hmac.compare_digest(hash_pw(str(body.get("password", "")), a["salt"]), a["hash"])
    if not (user_ok and pw_ok):
        raise HTTPException(401, "wrong username or password")
    set_session(request, response, a)
    return {"username": a["username"], "must_change": a["must_change"]}


@app.get("/api/me", dependencies=[Depends(auth_any)])
async def me():
    a = kv_get("account")
    return {"username": a["username"], "must_change": a["must_change"]}


@app.post("/api/account", dependencies=[Depends(auth_any)])
async def change_account(body: dict, request: Request, response: Response):
    a = kv_get("account")
    if not hmac.compare_digest(hash_pw(str(body.get("password", "")), a["salt"]), a["hash"]):
        raise HTTPException(400, "current password is wrong")
    user, pw = str(body.get("new_username", "")).strip(), str(body.get("new_password", ""))
    if len(user) < 3 or len(pw) < 8:
        raise HTTPException(400, "username needs at least 3 characters and password at least 8")
    if user.lower() == "admin" or pw == "admin":
        raise HTTPException(400, "choose a username and password different from admin/admin")
    a = new_account(user, pw, False, a["gen"] + 1)  # new gen logs out other sessions
    kv_set("account", a)
    set_session(request, response, a)
    return {"username": user, "must_change": False}


@app.post("/api/logout")
async def logout(response: Response):
    response.delete_cookie("session")
    return {"ok": True}


@app.get("/api/data", dependencies=[Depends(auth)])
async def data(days_back: int = 60):
    start = time.time() - max(1, min(days_back, HISTORY_DAYS)) * 86400
    q = lambda sql, *a: db.execute(sql, a).fetchall()
    fg = dict(q("SELECT ts, mw FROM wind WHERE src='fingrid' AND ts>=?", start))
    fg_end = max(fg) if fg else 0
    wind = sorted({**{t: v for t, v in q("SELECT ts, mw FROM wind WHERE src='npf' AND ts>=?", start)
                      if t > fg_end or not fg}, **fg}.items())
    return {"actual": q("SELECT ts, spot FROM prices WHERE ts>=? ORDER BY ts", start),  # c/kWh excl. VAT
            "forecast": q("SELECT ts, spot FROM forecast WHERE ts>=? ORDER BY ts", start),
            "wind": wind, "wind_actual": q("SELECT ts, mw FROM wind WHERE src='actual' AND ts>=? ORDER BY ts", start),
            "settings": public(settings()), "fingrid": bool(FINGRID_KEY)}


LAST_REFRESH = [0.0]


@app.post("/api/refresh", dependencies=[Depends(auth)])
async def refresh():
    if time.time() - LAST_REFRESH[0] < 30:
        raise HTTPException(429, "refreshed less than 30 s ago")
    LAST_REFRESH[0], out = time.time(), {}
    async with httpx.AsyncClient(timeout=30, headers={"User-Agent": "electricityfinland/1.0"}) as c:
        for name, fn in (("prices", fetch_prices), ("forecast", lambda c: fetch_forecasts(c, fingrid=False))):
            try:
                await fn(c)
                out[name] = "ok"
            except Exception as e:
                out[name] = f"failed: {e}"
    return out


@app.put("/api/settings", dependencies=[Depends(auth)])
async def put_settings(body: dict):
    s = settings()
    for k, v in body.items():
        if k not in DEFAULTS or (k in SECRET_FIELDS and not v):  # empty secret = keep the stored one
            continue
        d = DEFAULTS[k]
        try:
            if isinstance(d, list):
                s[k] = [clean_recipient(r) for r in v[:20] if isinstance(r, dict)]
            else:
                s[k] = bool(v) if isinstance(d, bool) else type(d)(v)
        except (TypeError, ValueError):
            raise HTTPException(400, f"invalid value for {k}")
    if s["alarm_basis"] not in ("total", "spot", "transfer") or s["smtp_security"] not in ("starttls", "ssl", "none"):
        raise HTTPException(400, "invalid alarm basis or email security")
    kv_set("settings", {k: v for k, v in s.items() if k in DEFAULTS})
    return public(s)


@app.post("/api/test-notify", dependencies=[Depends(auth)])
async def test_notify(body: dict | None = None):
    channel = (body or {}).get("channel", "all")
    if channel not in ("all", "whatsapp", "email"):
        raise HTTPException(400, "channel must be all, whatsapp or email")
    async with httpx.AsyncClient(timeout=30) as c:
        s = settings()
        a = int(time.time() // 900 * 900)  # example: the daily message for the published prices from now on
        rows = db.execute("SELECT ts, spot FROM prices WHERE ts>=? ORDER BY ts", (a - 3600,)).fetchall()
        text = "✅ Test message from Electricity Finland. Example of the daily message:\n" + (daily_message(s, rows, a, a + 86400) or "(no published prices yet)")
        return await notify(c, s, text, force=channel)


# Local run without nginx: serve the web page from ../web (in Docker nginx does this)
class NoCacheStatic(StaticFiles):  # always revalidate, so a browser never mixes old and new page files
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


if (ROOT / "web").is_dir():
    app.mount("/", NoCacheStatic(directory=ROOT / "web", html=True), name="web")
