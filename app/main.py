"""Electricity Finland: spot price + wind monitor with WhatsApp/email alarms."""
import asyncio, hashlib, hmac, html, json, logging, math, os, re, smtplib, sqlite3, ssl, threading, time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
for ENV_FILE in (ROOT / "stack.env", ROOT / ".env"):  # local run without Docker: read ../stack.env, then ../.env (real env vars win)
    if ENV_FILE.is_file():
        for line in ENV_FILE.read_text().splitlines():
            k, sep, v = line.partition("=")
            if sep and not k.strip().startswith("#"):
                os.environ.setdefault(k.strip(), v.strip())

log = logging.getLogger("elfi")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

TZ = ZoneInfo("Europe/Helsinki")
VAT_FEED = 1.255  # VAT included in the public feeds (porssisahko, forecast)
FINGRID_KEY = os.getenv("FINGRID_API_KEY", "")
HISTORY_DAYS = 366  # forecasts and wind are kept this long
MAX_HISTORY_DAYS = 2200  # published prices are kept (hourly rows, small) and can be loaded this far back on demand
NPF = "https://raw.githubusercontent.com/vividfog/nordpool-predict-fi/main/deploy/"
env = lambda k, d="": os.getenv("SMTP_" + k.upper()) or d  # empty values in .env fall back to the default

# Fee fields are c/kWh incl. VAT (as on Finnish invoices); monthly fees in EUR.
DEFAULTS = {
    "vat": 25.5, "margin": 0.0, "transfer_day": 0.0, "transfer_night": 0.0,
    "night_start": 22, "night_end": 7, "tax": 2.827, "other": 0.0,
    "monthly_provider": 0.0, "monthly_transfer": 0.0, "monthly_kwh": 0.0, "spread_monthly": False,
    "alarm_basis": "total", "alarm_vat": True, "high_on": True, "high": 20.0, "low_on": True, "low": 2.0,
    "summary_on": True, "extra_time_1": "", "extra_time_2": "", "extra_time_3": "",  # extra send times "HH:MM", empty = off
    "wa_on": True, "email_on": True, "recipients": [], "alerts_v2": False,  # alerts_v2: one-time switch-on of limits/channels done
    # message templates, placeholders: see fill() / web/costs.js. {limit} is the limit, {price} the highest / lowest hourly price
    "msg_high": "▲ Above {limit} c/kWh: {weekday} {date} {time}–{end} ({duration}), highest {price}",
    "msg_low": "▼ Below {limit} c/kWh: {weekday} {date} {time}–{end} ({duration}), lowest {price}",
    "msg_summary": "Electricity prices {from} – {to}\nAverage {avg} · lowest {min} ({min_time}) · highest {max} ({max_time}) c/kWh, {basis}",
    # email server (SMTP relay); SMTP_* env vars are used when a field is empty
    "smtp_host": env("host"), "smtp_port": int(env("port", "587") or 587),
    "smtp_security": env("security", "starttls"), "smtp_verify": env("verify", "true").lower() != "false",
    "smtp_user": env("user"), "smtp_pass": env("pass"), "smtp_from": env("from"),
}
SECRET_FIELDS = ("smtp_pass",)
OLD_MSGS = {  # earlier default texts: a saved copy of one of them is replaced by the new default
    "msg_high": ("🔴 High price {price} c/kWh · {weekday} {date} {time}–{end} ({duration}) · limit {limit}",),
    "msg_low": ("🟢 Low price {price} c/kWh · {weekday} {date} {time}–{end} ({duration}) · limit {limit}",),
    "msg_summary": ("📅 Prices {from} – {to}: avg {avg}, min {min} at {min_time}, max {max} at {max_time} c/kWh ({basis})",),
}
EXTRA_TIMES = ("extra_time_1", "extra_time_2", "extra_time_3")
TIME_RE = re.compile(r"([01]\d|2[0-3]):[0-5]\d")


class Result:  # rows already fetched, so nothing touches the connection after its lock is released
    def __init__(self, rows, lastrowid=None):
        self.rows, self.lastrowid = rows, lastrowid

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def __iter__(self):
        return iter(self.rows)


class Locked:
    """The one SQLite connection is used by the alarm worker and by the web threads at the same time. Unguarded, concurrent
    requests got empty results (random 500 errors and logouts), so every statement runs under a lock."""

    def __init__(self, path):
        self.con, self.lock = sqlite3.connect(path, check_same_thread=False), threading.RLock()

    def execute(self, sql, args=()):
        with self.lock:
            cur = self.con.execute(sql, args)
            return Result(cur.fetchall(), cur.lastrowid)

    def executemany(self, sql, rows):
        with self.lock:
            self.con.executemany(sql, rows)

    def executescript(self, sql):
        with self.lock:
            self.con.executescript(sql)

    def commit(self):
        with self.lock:
            self.con.commit()


db = Locked(os.getenv("DB_PATH", "/data/app.db"))
db.executescript("""
CREATE TABLE IF NOT EXISTS prices(ts INTEGER PRIMARY KEY, spot REAL);
CREATE TABLE IF NOT EXISTS forecast(ts INTEGER PRIMARY KEY, spot REAL);
CREATE TABLE IF NOT EXISTS wind(ts INTEGER, src TEXT, mw REAL, PRIMARY KEY(ts, src));
CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE COLLATE NOCASE,
  salt TEXT, hash TEXT, is_admin INTEGER, must_change INTEGER, gen INTEGER);
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


def settings(uid):  # every user has their own settings (recipients, email server, alarms, costs...)
    saved = kv_get(f"settings:{uid}", {})
    s = {**DEFAULTS, **{k: v for k, v in saved.items() if v not in OLD_MSGS.get(k, ())}}
    if not s["alerts_v2"]:  # one time: the limits are checked, and WhatsApp + Email are on when both were off (nothing would be sent)
        s.update(high_on=True, low_on=True, alerts_v2=True)
        if not (s["wa_on"] or s["email_on"]):
            s.update(wa_on=True, email_on=True)
    for k in ("smtp_host", "smtp_port", "smtp_security"):  # an empty saved value means "use the default"
        s[k] = s[k] or DEFAULTS[k]
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
    return sp if kind == "spot" else transfer * f if kind == "transfer" else sp + (transfer + energy) * f


def upsert(table, rows, src=None):
    if src:
        db.executemany(f"REPLACE INTO {table} VALUES(?,?,?)", [(t, src, v) for t, v in rows])
    else:
        db.executemany(f"REPLACE INTO {table} VALUES(?,?)", rows)
    db.commit()
    return len(rows)


# ---------------------------------------------------------------- fetchers
LAST_FETCH = [0.0]  # last successful price download (worker or Refresh)


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
    LAST_FETCH[0] = time.time()


BACKFILLED_FROM = [time.time()]  # oldest start already requested from sahkotin.fi, so a range it has no data for is not asked again


async def backfill(c, days=HISTORY_DAYS):
    """Load hourly history (sahkotin.fi, EUR/MWh excl. VAT) back `days` days without overwriting 15-min data. Returns the rows added, -1 if nothing was needed."""
    first = db.execute("SELECT MIN(ts) FROM prices").fetchone()[0] or time.time()
    start = time.time() - min(days, MAX_HISTORY_DAYS) * 86400
    if first - start < 2 * 86400 or start >= BACKFILLED_FROM[0]:
        return -1  # nothing to fetch
    iso = lambda t: datetime.fromtimestamp(int(t), timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    total, end = 0, first
    while end - start > 3600:  # one request per year of data
        a = max(start, end - HISTORY_DAYS * 86400)
        r = await c.get("https://sahkotin.fi/prices", params={"start": iso(a), "end": iso(end)})
        r.raise_for_status()
        rows = [(ts_of(x["date"]), x["value"] / 10) for x in r.json()["prices"]]
        db.executemany("INSERT OR IGNORE INTO prices VALUES(?,?)", rows)
        db.commit()
        total, end = total + len(rows), a
    if total:  # nothing at all is suspicious (source down?): ask again next time
        BACKFILLED_FROM[0] = start
    log.info("history backfill: %d rows", total)
    return total


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
    for t in ("forecast", "wind"):  # published prices are kept
        db.execute(f"DELETE FROM {t} WHERE ts<?", (cutoff,))
    db.commit()


# ---------------------------------------------------------------- notifications
def send_mail(s, to, subject, text, html=None):
    msg = EmailMessage()
    sender = s["smtp_from"] or s["smtp_user"]
    if "@" not in sender:
        raise ValueError("fill in 'From address' in Email server (the username is not an email address)")
    msg["From"], msg["To"], msg["Subject"] = sender, to, subject
    msg.set_content(text)
    if html:  # plain text for old clients, HTML (highlighted rows) for the rest
        msg.add_alternative(html, subtype="html")
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


WA_CHUNK = 1500  # CallMeBot takes the text in the URL: longer messages are sent as several parts


def wa_parts(text):
    parts, cur = [], ""
    for line in text.split("\n"):
        if cur and len(cur) + len(line) + 1 > WA_CHUNK:
            parts.append(cur.rstrip())
            cur = ""
        cur += line + "\n"
    return parts + [cur.rstrip()]


def sent_ok(v):
    return str(v).startswith("sent")


async def notify(c, s, m, force=None):
    """Send message m (see compose) to all recipients. force: None = scheduled message (respects the WhatsApp / Email switches),
    'all' | 'whatsapp' | 'email' = test. Returns {"<who> WhatsApp|email": "sent" | "failed: ...", ...}."""
    out = {}
    wa = force in ("all", "whatsapp") or (force is None and s["wa_on"])
    em = force in ("all", "email") or (force is None and s["email_on"])
    for r in s["recipients"]:
        who = r["name"] or r["phone"] or r["email"]
        if wa and r["phone"]:  # WhatsApp when a phone number is set, email when an address is set
            if not r["apikey"]:
                out[f"{who} WhatsApp"] = "missing CallMeBot API key"
            else:
                try:
                    for i, part in enumerate(wa_parts(m["wa"])):
                        if i:
                            await asyncio.sleep(3)
                        res = await c.get("https://api.callmebot.com/whatsapp.php",
                                          params={"phone": r["phone"], "text": part, "apikey": r["apikey"]})
                        if not (res.status_code == 200 and "error" not in res.text.lower()):
                            raise RuntimeError(f"{res.status_code} {res.text[:120]}")
                    out[f"{who} WhatsApp"] = "sent"
                except Exception as e:
                    out[f"{who} WhatsApp"] = f"failed: {e}"
        if em and r["email"]:
            if not s["smtp_host"]:
                out[f"{who} email"] = "email server not configured"
            else:
                try:
                    await asyncio.to_thread(send_mail, s, r["email"], m["subject"], m["text"], m.get("html"))
                    out[f"{who} email"] = "sent"
                except smtplib.SMTPAuthenticationError:
                    out[f"{who} email"] = "failed: the mail server refused the username or password"
                except ssl.SSLCertVerificationError:
                    out[f"{who} email"] = "failed: the server certificate is not trusted (untick 'Verify server certificate')"
                except Exception as e:
                    out[f"{who} email"] = f"failed: {type(e).__name__}: {e}"
    if not out:
        if force is None and not (wa or em):
            out["info"] = "the WhatsApp alerts and Email alerts switches are both off"
        else:
            out["info"] = {"whatsapp": "the selected recipients have no WhatsApp number",
                           "email": "the selected recipients have no email address"}.get(force, "no recipient with a WhatsApp number or email address")
    log.info("notify %s -> %s", m["subject"], out)
    return out


# ---------------------------------------------------------------- the message
def rnd(x, d):
    """Round half up to d decimals. Float noise is cleaned first, so the result is the same as rnd() in web/costs.js."""
    return math.floor(round(x, 9) * 10 ** d + 0.5) / 10 ** d


def price_of(s, ts, spot):  # c/kWh on the alarm basis, 3 decimals
    return rnd(value(s, ts, spot, s["alarm_basis"], s["alarm_vat"]), 3)


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


def dayname(ts):
    d = datetime.fromtimestamp(ts, TZ)
    return f"{WEEKDAYS[d.weekday()]} {d:%d.%m.}"


def hourly(s, rows, a, b):
    """Hourly prices for a..b: [{"t": start, "end": end, "p": average price}] (c/kWh on the alarm basis, 2 decimals).
    Slots (15 min or 1 h) are averaged per clock hour; a part hour at either end of the window stays a part hour."""
    acc = {}
    for i, (t, v) in enumerate(rows):
        step = min(3600, rows[i + 1][0] - t) if i + 1 < len(rows) else 900
        lo, hi = max(t, a), min(t + step, b)
        if hi > lo:
            h = acc.setdefault(lo // 3600, {"t": lo, "end": hi, "sum": 0.0})
            h["t"], h["end"] = min(h["t"], lo), max(h["end"], hi)
            h["sum"] += price_of(s, t, v) * (hi - lo)
    return [{"t": h["t"], "end": h["end"], "p": rnd(h["sum"] / (h["end"] - h["t"]), 2)} for _, h in sorted(acc.items())]


def window_fields(s, kind, w):
    ps = [p for p, _ in w["ps"]]
    d = datetime.fromtimestamp(w["start"], TZ)
    return {"price": f"{(max(ps) if kind == 'high' else min(ps)):.2f}",
            "avg": f"{sum(p * n for p, n in w['ps']) / sum(n for _, n in w['ps']):.2f}",
            "date": d.strftime("%d.%m."), "weekday": WEEKDAYS[d.weekday()], "time": fmt(w["start"]), "end": fmt(w["end"]),
            "duration": duration(w["end"] - w["start"]), "limit": f"{s[kind]:g}", "basis": basis(s)}


MARK = {"high": "▲", "low": "▼"}  # plain geometric marks (no emoji) so highlighted rows also show in plain text
BOLD = {"title", "alert_high", "alert_low", "row_high", "row_low"}


def compose(s, rows, a, b, test=False, note=""):
    """The message for the prices a..b (seconds), or None without any price in that period.
    Always: a summary and the hourly prices. A high / low limit that is switched on and crossed adds one line for every
    period at or above / below it (also one that began before a) and highlights those hours in the list.
    Returns {"subject", "wa" (WhatsApp, *bold*), "text" (plain email), "html", "alert"}. Mirrors composeMessage() in web/costs.js."""
    hours = hourly(s, rows, a, b)
    if not hours:
        return None
    hit = {"high": lambda p: p >= s["high"], "low": lambda p: p <= s["low"]}
    for h in hours:  # 2-decimal prices: what is shown is what is compared
        h["flag"] = next((k for k in hit if s[k + "_on"] and hit[k](h["p"])), None)
    spans = []  # periods in a row at or beyond a limit: (start, kind, line)
    for i, h in enumerate(hours):
        if h["flag"] and not (i and hours[i - 1]["flag"] == h["flag"] and hours[i - 1]["end"] == h["t"]):
            j = i
            while j + 1 < len(hours) and hours[j + 1]["flag"] == h["flag"] and hours[j + 1]["t"] == hours[j]["end"]:
                j += 1
            ps = [(x["p"], x["end"] - x["t"]) for x in hours[i:j + 1]]
            f = window_fields(s, h["flag"], {"start": h["t"], "end": hours[j]["end"], "ps": ps})
            spans.append((h["t"], h["flag"], fill(s["msg_" + h["flag"]], f)))
    sections = []
    if test:
        sections.append([("title", "TEST MESSAGE"), ("text", "Example of the scheduled message, with the prices from now on.")])
    if s["summary_on"]:
        tot = sum(h["end"] - h["t"] for h in hours)
        lo, hi = min(hours, key=lambda h: h["p"]), max(hours, key=lambda h: h["p"])
        d = datetime.fromtimestamp(a, TZ)
        text = fill(s["msg_summary"], {"from": daystamp(a), "to": daystamp(b), "avg": f"{sum(h['p'] * (h['end'] - h['t']) for h in hours) / tot:.2f}",
                                       "min": f"{lo['p']:.2f}", "min_time": daystamp(lo["t"]), "max": f"{hi['p']:.2f}",
                                       "max_time": daystamp(hi["t"]), "basis": basis(s), "weekday": WEEKDAYS[d.weekday()],
                                       "date": d.strftime("%d.%m.")})
        sections.append([("title" if i == 0 else "text", ln) for i, ln in enumerate(text.split("\n"))])
    if spans:
        sections.append([("alert_" + k, ln) for _, k, ln in sorted(spans)])
    elif s["high_on"] or s["low_on"]:
        lim = [f"{w} {s[k]:g}" for k, w in (("high", "above"), ("low", "below")) if s[k + "_on"]]
        sections.append([("text", f"No prices {' or '.join(lim)} c/kWh in this period.")])
    if note:
        sections.append([("text", note)])
    rowsec, day = [("heading", f"Hourly prices, c/kWh ({basis(s)})")], None
    for h in hours:
        if dayname(h["t"]) != day:
            day = dayname(h["t"])
            rowsec.append(("day", day))
        rowsec.append(("row_" + h["flag"] if h["flag"] else "row", f"{MARK[h['flag']] + ' ' if h['flag'] else ''}{fmt(h['t'])}  {h['p']:.2f}"))
    sections.append(rowsec)
    return {"subject": ("[TEST] " if test else "") + f"Electricity prices {dayname(a)}" + (" · price alert" if spans else ""),
            "wa": "\n\n".join("\n".join(f"*{t}*" if k in BOLD and t else t for k, t in sec) for sec in sections),
            "text": "\n\n".join("\n".join(t for _, t in sec) for sec in sections),
            "html": render_html(sections), "alert": bool(spans)}


def render_html(sections):
    hi, lo = "background:#fee2e2;color:#991b1b", "background:#dcfce7;color:#166534"
    style = {"title": "font-size:16px;font-weight:700", "text": "", "heading": "font-weight:700", "day": "color:#64748b;margin-top:8px",
             "row": "padding:1px 6px;white-space:pre",
             "alert_high": f"margin:4px 0;padding:6px 10px;font-weight:700;border-left:4px solid #dc2626;{hi}",
             "alert_low": f"margin:4px 0;padding:6px 10px;font-weight:700;border-left:4px solid #16a34a;{lo}",
             "row_high": f"padding:1px 6px;white-space:pre;font-weight:700;{hi}", "row_low": f"padding:1px 6px;white-space:pre;font-weight:700;{lo}"}
    body = "".join('<div style="margin:0 0 16px">' + "".join(f'<div style="{style[k]}">{html.escape(t)}</div>' for k, t in sec) + "</div>"
                   for sec in sections)
    return f'<div style="font:14px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;max-width:520px">{body}</div>'


# ---------------------------------------------------------------- when messages are sent
EXTRA_GRACE = 3 * 3600  # an extra time still sends up to 3 h late (waiting for the prices, or after a restart)
DAILY_GRACE = 10 * 3600  # the 14:00 message: any time until midnight
PARTIAL_AFTER = 90 * 60  # prices still not published this long after the send time: send what exists, with a note
RETRY_AFTER, MAX_TRIES = 300, 4  # a message nobody received (mail server / CallMeBot down) is tried again every 5 min


def schedule_times(s):
    """[(slot, "HH:MM")]: the daily 14:00 message plus the valid, distinct extra times."""
    daily = f"{SEND_HOUR}:00"
    out, seen = [("daily", daily)], {daily}
    for i, k in enumerate(EXTRA_TIMES):
        t = str(s.get(k) or "").strip()
        if TIME_RE.fullmatch(t) and t not in seen:
            seen.add(t)
            out.append((f"extra:{i}", t))
    return out


def sent_key(uid, slot):
    return f"daily_sent:{uid}" if slot == "daily" else f"extra_sent:{uid}:{slot[6:]}"


def due_messages(s, uid):
    """Messages whose time has come and that nobody has received yet: [{"slot", "key", "msg"}].
    The prices are the fixed ones from the send time to the same time the next day; when that time is before 14:00 the next
    day is not fixed yet, so the message ends at midnight. The same message for every recipient, at every time."""
    now, out = datetime.now(TZ), []
    for slot, t in schedule_times(s):
        for day in (now.date(), now.date() - timedelta(days=1)):  # yesterday too: the grace period may reach past midnight
            start = datetime.combine(day, datetime.min.time(), TZ).replace(hour=int(t[:2]), minute=int(t[3:]))
            late = (now - start).total_seconds()
            key = day.isoformat() if slot == "daily" else f"{day.isoformat()} {t}"
            if not 0 <= late < (DAILY_GRACE if slot == "daily" else EXTRA_GRACE) or kv_get(sent_key(uid, slot)) == key:
                continue
            tr = kv_get(f"tries:{uid}:{slot}") or {}
            if tr.get("key") == key and (tr["n"] >= MAX_TRIES or time.time() - tr["at"] < RETRY_AFTER):
                continue
            a = int(start.timestamp())
            end = start + timedelta(days=1) if start.hour >= SEND_HOUR else datetime.combine(day + timedelta(days=1), datetime.min.time(), TZ)
            b = int(end.timestamp())
            rows = db.execute("SELECT ts, spot FROM prices WHERE ts>=? ORDER BY ts", (a - 3600,)).fetchall()
            note = ""
            if not rows or rows[-1][0] < b - 3600:  # the end of the period is not published yet: wait for it
                if late < PARTIAL_AFTER or not rows or rows[-1][0] < a:
                    continue
                b, note = int(rows[-1][0] + 900), f"Prices after {daystamp(rows[-1][0] + 900)} are not published yet."
            msg = compose(s, rows, a, b, note=note)
            if msg:
                out.append({"slot": slot, "key": key, "time": t, "msg": msg})
    return out


def record_send(uid, due, out):
    """Remember the outcome: delivered to at least one recipient = done; only failures = try again later (up to MAX_TRIES);
    nobody to send to (switches off, no recipients) = nothing is used up, it is tried again until the grace period ends."""
    ok = [k for k, v in out.items() if sent_ok(v)]
    bad = {k: v for k, v in out.items() if k != "info" and not sent_ok(v)}
    if ok:
        kv_set(sent_key(uid, due["slot"]), due["key"])
    elif bad:
        tr = kv_get(f"tries:{uid}:{due['slot']}") or {}
        kv_set(f"tries:{uid}:{due['slot']}", {"key": due["key"], "at": time.time(), "n": (tr["n"] if tr.get("key") == due["key"] else 0) + 1})
        log.warning("message of %s not delivered, will try again: %s", due["time"], bad)
    if ok or bad:
        kv_set(f"last_send:{uid}", {"at": int(time.time()), "time": due["time"], "ok": bool(ok) and not bad, "results": out})


def schedule_info(uid, s):
    """For the page: what is scheduled, who would get it, and how the last scheduled message went."""
    return {"times": [t for _, t in schedule_times(s)], "last": kv_get(f"last_send:{uid}"),
            "wa": sum(1 for r in s["recipients"] if r["phone"] and r["apikey"]),
            "email": sum(1 for r in s["recipients"] if r["email"]) if s["smtp_host"] else 0}


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
            for (uid,) in db.execute("SELECT id FROM users").fetchall():
                try:
                    s = settings(uid)
                    for due in due_messages(s, uid):
                        record_send(uid, due, await notify(c, s, due["msg"]))
                except Exception:
                    log.exception("scheduled message failed for user %s", uid)
            await asyncio.sleep(60)


# ---------------------------------------------------------------- users (the first account is the admin)
USER_COLS = ("id", "username", "salt", "hash", "is_admin", "must_change", "gen")


def hash_pw(pw, salt):
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 200_000).hex()


def get_user(uid=None, name=None):
    r = db.execute(f"SELECT {','.join(USER_COLS)} FROM users WHERE " + ("id=?" if uid is not None else "username=?"),
                   (uid if uid is not None else name,)).fetchone()
    return dict(zip(USER_COLS, r)) if r else None


def set_password(uid, username, password, must_change):
    salt = os.urandom(16).hex()
    db.execute("UPDATE users SET username=?, salt=?, hash=?, must_change=?, gen=gen+1 WHERE id=?",  # new gen logs out old sessions
               (username, salt, hash_pw(password, salt), int(must_change), uid))
    db.commit()


def add_user(username, password, is_admin, must_change):
    salt = os.urandom(16).hex()
    cur = db.execute("INSERT INTO users(username, salt, hash, is_admin, must_change, gen) VALUES(?,?,?,?,?,1)",
                     (username, salt, hash_pw(password, salt), int(is_admin), int(must_change)))
    db.commit()
    return cur.lastrowid


def first_admin():
    return get_user(db.execute("SELECT MIN(id) FROM users WHERE is_admin=1").fetchone()[0])


if not db.execute("SELECT 1 FROM users").fetchone():  # first start: admin/admin (or the account of an older version)
    old = kv_get("account")
    if old:
        cur = db.execute("INSERT INTO users(username, salt, hash, is_admin, must_change, gen) VALUES(?,?,?,1,?,?)",
                         (old["username"], old["salt"], old["hash"], int(old["must_change"]), old["gen"] + 1))
        db.commit()
        uid = cur.lastrowid
    else:
        uid = add_user("admin", "admin", True, True)
    for k in ("settings", "daily_sent"):  # settings of the single-user version belong to the admin
        if kv_get(k) is not None:
            kv_set(f"{k}:{uid}", kv_get(k))
if os.getenv("RESET_ADMIN") == "1":  # forgotten password: the admin logs in with admin/admin again
    set_password(first_admin()["id"], "admin", "admin", True)
if not kv_get("secret"):
    kv_set("secret", os.urandom(32).hex())
SECRET = (os.getenv("SECRET_KEY") or kv_get("secret")).encode()
SESSION_DAYS = 30
DEV = os.getenv("DEV_NO_LOGIN") == "1"  # run-dev.sh: no login (you are the admin), for testing on your own computer only
if DEV:
    log.warning("DEV_NO_LOGIN=1: login is disabled. Never use this on a server reachable by others.")


def sign(msg):
    return hmac.new(SECRET, msg.encode(), hashlib.sha256).hexdigest()


def set_session(request, response, u):
    token = f"{int(time.time()) + SESSION_DAYS * 86400}.{u['id']}.{u['gen']}"
    response.set_cookie("session", f"{token}.{sign(token)}",
                        max_age=SESSION_DAYS * 86400, httponly=True, samesite="strict",
                        secure=request.headers.get("x-forwarded-proto") == "https")


def user_any(request: Request):  # logged in (may still have to change the password)
    if DEV:
        return first_admin()
    exp, uid, gen, sig = (request.cookies.get("session", "").split(".") + ["", "", "", ""])[:4]
    u = get_user(int(uid)) if uid.isdigit() else None
    if not (u and exp.isdigit() and int(exp) > time.time() and gen == str(u["gen"])
            and hmac.compare_digest(sig, sign(f"{exp}.{uid}.{gen}"))):
        raise HTTPException(401, "login required")
    return u


def user(request: Request):
    u = user_any(request)
    if u["must_change"] and not DEV:
        raise HTTPException(403, "choose your own password first")
    return u


def admin(u: dict = Depends(user)):
    if not u["is_admin"]:
        raise HTTPException(403, "only the admin can manage users")
    return u


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
    u = get_user(name=str(body["username"]).strip())
    if not (u and hmac.compare_digest(hash_pw(str(body.get("password", "")), u["salt"]), u["hash"])):
        raise HTTPException(401, "wrong username or password")
    set_session(request, response, u)
    return {"username": u["username"], "must_change": bool(u["must_change"])}


@app.get("/api/me")
async def me(u: dict = Depends(user_any)):
    return {"id": u["id"], "username": "dev mode, no login" if DEV else u["username"],
            "must_change": bool(u["must_change"]) and not DEV, "is_admin": bool(u["is_admin"]), "dev": DEV}


def check_new_login(username, password, uid=None):
    if len(username) < 3 or len(password) < 8:
        raise HTTPException(400, "username needs at least 3 characters and password at least 8")
    if username.lower() == "admin" or password == "admin":
        raise HTTPException(400, "choose a username and password different from admin/admin")
    other = get_user(name=username)
    if other and other["id"] != uid:
        raise HTTPException(400, f"the username {username} is already taken")


@app.post("/api/account")
async def change_account(body: dict, request: Request, response: Response, u: dict = Depends(user_any)):
    if not hmac.compare_digest(hash_pw(str(body.get("password", "")), u["salt"]), u["hash"]):
        raise HTTPException(400, "current password is wrong")
    name, pw = str(body.get("new_username", "")).strip(), str(body.get("new_password", ""))
    check_new_login(name, pw, u["id"])
    set_password(u["id"], name, pw, False)
    set_session(request, response, get_user(u["id"]))
    return {"username": name, "must_change": False}


@app.get("/api/users")
async def list_users(_: dict = Depends(admin)):
    return [{"id": i, "username": n, "is_admin": bool(a), "must_change": bool(m)}
            for i, n, a, m in db.execute("SELECT id, username, is_admin, must_change FROM users ORDER BY id")]


@app.post("/api/users")
async def create_user(body: dict, _: dict = Depends(admin)):
    name, pw = str(body.get("username", "")).strip(), str(body.get("password", ""))
    check_new_login(name, pw)
    add_user(name, pw, False, True)  # the new user chooses their own password at first login
    return await list_users(_)


@app.post("/api/users/{uid}/password")
async def reset_password(uid: int, body: dict, me_: dict = Depends(admin)):
    u, pw = get_user(uid), str(body.get("password", ""))
    if not u or u["id"] == me_["id"]:
        raise HTTPException(400, "unknown user (change your own password with Account)")
    if len(pw) < 8:
        raise HTTPException(400, "the temporary password needs at least 8 characters")
    set_password(uid, u["username"], pw, True)  # logs the user out; they choose a new password at next login
    return await list_users(me_)


@app.delete("/api/users/{uid}")
async def delete_user(uid: int, me_: dict = Depends(admin)):
    if uid == me_["id"]:
        raise HTTPException(400, "you cannot remove yourself")
    db.execute("DELETE FROM users WHERE id=?", (uid,))
    db.execute("DELETE FROM kv WHERE k IN (?, ?, ?) OR k LIKE ? OR k LIKE ?",
               (f"settings:{uid}", f"daily_sent:{uid}", f"last_send:{uid}", f"extra_sent:{uid}:%", f"tries:{uid}:%"))
    db.commit()
    return await list_users(me_)


@app.post("/api/logout")
async def logout(response: Response):
    response.delete_cookie("session")
    return {"ok": True}


@app.get("/api/data")
async def data(days_back: int = 60, u: dict = Depends(user)):
    start = time.time() - max(1, min(days_back, MAX_HISTORY_DAYS)) * 86400
    q = lambda sql, *a: db.execute(sql, a).fetchall()
    fg = dict(q("SELECT ts, mw FROM wind WHERE src='fingrid' AND ts>=?", start))
    fg_end = max(fg) if fg else 0
    wind = sorted({**{t: v for t, v in q("SELECT ts, mw FROM wind WHERE src='npf' AND ts>=?", start)
                      if t > fg_end or not fg}, **fg}.items())
    st = settings(u["id"])
    return {"actual": q("SELECT ts, spot FROM prices WHERE ts>=? ORDER BY ts", start),  # c/kWh excl. VAT
            "forecast": q("SELECT ts, spot FROM forecast WHERE ts>=? ORDER BY ts", start),
            "wind": wind, "wind_actual": q("SELECT ts, mw FROM wind WHERE src='actual' AND ts>=? ORDER BY ts", start),
            "settings": public(st), "schedule": schedule_info(u["id"], st), "fingrid": bool(FINGRID_KEY)}


LAST_REFRESH = [0.0]


HISTORY_LOCK = asyncio.Lock()


@app.post("/api/history", dependencies=[Depends(user)])
async def history(body: dict):
    """Fetch published prices back to the start of a period the user picked, if they are not stored yet."""
    try:
        days = int(body.get("days", 0))
    except (TypeError, ValueError):
        raise HTTPException(400, "days must be a number")
    async with HISTORY_LOCK:
        try:
            async with httpx.AsyncClient(timeout=60, headers={"User-Agent": "electricityfinland/1.0"}) as c:
                rows = await backfill(c, days)
        except Exception as e:
            raise HTTPException(502, f"history fetch failed: {e}")
    return {"rows": rows}


@app.post("/api/refresh", dependencies=[Depends(user)])
async def refresh(body: dict | None = None):
    if (body or {}).get("auto") and time.time() - LAST_FETCH[0] < 120:  # page just opened and prices are fresh
        return {"prices": "up to date"}
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


@app.put("/api/settings")
async def put_settings(body: dict, u: dict = Depends(user)):
    s = settings(u["id"])
    for k, v in body.items():
        if k not in DEFAULTS or (k in SECRET_FIELDS and not v):  # empty secret = keep the stored one
            continue
        d = DEFAULTS[k]
        try:
            if isinstance(d, list):
                s[k] = [clean_recipient(r) for r in v[:20] if isinstance(r, dict)]
            elif k in EXTRA_TIMES:
                s[k] = str(v or "").strip()
                if s[k] and not TIME_RE.fullmatch(s[k]):
                    raise ValueError
            else:
                s[k] = bool(v) if isinstance(d, bool) else type(d)(v)
        except (TypeError, ValueError):
            raise HTTPException(400, f"invalid value for {k}")
    if s["alarm_basis"] not in ("total", "spot", "transfer") or s["smtp_security"] not in ("starttls", "ssl", "none"):
        raise HTTPException(400, "invalid alarm basis or email security")
    kv_set(f"settings:{u['id']}", {k: v for k, v in s.items() if k in DEFAULTS})
    return public(s)


@app.post("/api/test-notify")
async def test_notify(body: dict | None = None, u: dict = Depends(user)):
    channel = (body or {}).get("channel", "all")
    if channel not in ("all", "whatsapp", "email"):
        raise HTTPException(400, "channel must be all, whatsapp or email")
    async with httpx.AsyncClient(timeout=30) as c:
        s = settings(u["id"])
        only = (body or {}).get("only")  # indexes of the recipients ticked for the test
        if isinstance(only, list):
            s["recipients"] = [r for i, r in enumerate(s["recipients"]) if i in only]
            if not s["recipients"]:
                raise HTTPException(400, "select at least one recipient")
        a = int(time.time() // 900 * 900)  # example: the scheduled message for the published prices from now on
        rows = db.execute("SELECT ts, spot FROM prices WHERE ts>=? ORDER BY ts", (a - 3600,)).fetchall()
        msg = compose(s, rows, a, a + 86400, test=True) or {
            "subject": "[TEST] Electricity prices", "wa": "TEST MESSAGE\nNo published prices yet.", "text": "TEST MESSAGE\nNo published prices yet.", "html": None}
        return await notify(c, s, msg, force=channel)


# Local run without nginx: serve the web page from ../web (in Docker nginx does this)
class NoCacheStatic(StaticFiles):  # always revalidate, so a browser never mixes old and new page files
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


if (ROOT / "web").is_dir():
    app.mount("/", NoCacheStatic(directory=ROOT / "web", html=True), name="web")
