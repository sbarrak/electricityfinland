"""Backend tests: python -m pytest tests  (needs fastapi, httpx, pytest)."""
import asyncio, os, sys
from datetime import datetime
from pathlib import Path

os.environ["DB_PATH"] = ":memory:"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))
import main  # noqa: E402

FEES = {**main.DEFAULTS, "margin": 0.6, "transfer_day": 3.0, "transfer_night": 1.0, "tax": 2.827, "night_start": 22, "night_end": 7}
HELSINKI = main.TZ


def ts(y, m, d, h, mi=0):
    return int(datetime(y, m, d, h, mi, tzinfo=HELSINKI).timestamp())


def test_total_includes_vat_margin_transfer_and_tax():
    s = {**FEES, "tax": 0.0}
    night = ts(2026, 11, 10, 5, 15)  # the case of the screenshot: spot 0.92, margin 0.60, night transfer 1.00
    assert round(main.value(s, night, 0.92, "total", True), 2) == 2.75
    assert round(main.value(s, night, 0.92, "total", False), 2) == 2.19
    assert round(main.value(s, night, 0.92, "transfer", True), 2) == 1.00


def test_day_and_night_rate_follow_finnish_time():
    day, night = ts(2026, 11, 10, 12), ts(2026, 11, 10, 23)
    assert main.value(FEES, day, 1.0, "transfer") == 3.0 + 2.827
    assert main.value(FEES, night, 1.0, "transfer") == 1.0 + 2.827


def test_negative_spot_gets_no_vat():
    s = {**FEES, "margin": 0, "transfer_day": 0, "transfer_night": 0, "tax": 0}
    assert main.value(s, ts(2026, 11, 10, 12), -2.0, "total") == -2.0


def test_feed_vat_is_stripped_once():
    assert round(main.ex_vat(1.255), 6) == 1.0
    assert main.ex_vat(-3.0) == -3.0


def recipients(**kw):
    return [{"name": "A", "phone": kw.get("phone", ""), "apikey": kw.get("apikey", ""), "email": kw.get("email", ""), "wa": True, "mail": True}]


def test_can_send_needs_a_real_channel():
    base = {**main.DEFAULTS, "wa_on": True, "email_on": True, "smtp_host": ""}
    assert not main.can_send({**base, "recipients": []})
    assert not main.can_send({**base, "recipients": recipients(phone="+358401234567")})  # phone without API key
    assert not main.can_send({**base, "recipients": recipients(email="a@b.fi")})  # address, but no email server
    assert main.can_send({**base, "recipients": recipients(phone="+358401234567", apikey="k")})
    assert main.can_send({**base, "smtp_host": "smtp.x.fi", "recipients": recipients(email="a@b.fi")})
    assert not main.can_send({**base, "wa_on": False, "recipients": recipients(phone="+358401234567", apikey="k")})


def test_scheduled_message_without_setup_is_skipped_not_failed():
    s = {**main.DEFAULTS, "wa_on": True, "email_on": True, "smtp_host": "",
         "recipients": recipients(phone="+358401234567", email="a@b.fi")}
    out = asyncio.run(main.notify(None, s, {"subject": "x", "wa": "x", "text": "x"}))
    assert out and all(main.skipped(v) for v in out.values()), out
    due = {"slot": "daily", "key": "2026-11-10", "time": "14:00"}
    main.record_send(1, due, out)
    assert main.kv_get("tries:1:daily") is None  # nothing counted as a failure, nothing to retry
    assert main.kv_get("last_send:1") is None


def test_test_message_still_explains_what_is_missing():
    s = {**main.DEFAULTS, "smtp_host": "", "recipients": recipients(phone="+358401234567", email="a@b.fi")}
    out = asyncio.run(main.notify(None, s, {"subject": "x", "wa": "x", "text": "x"}, force="all"))
    assert out["A WhatsApp"] == "missing CallMeBot API key" and out["A email"] == "email server not configured"


def test_real_failure_is_still_retried():
    main.record_send(2, {"slot": "daily", "key": "k", "time": "14:00"}, {"A email": "failed: boom"})
    assert main.kv_get("tries:2:daily")["n"] == 1
