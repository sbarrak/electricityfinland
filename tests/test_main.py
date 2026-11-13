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
    due = {"slot": "extra:0", "key": "2026-11-10 14:25", "time": "14:25"}
    main.record_send(1, due, out)
    assert main.kv_get("tries:1:extra:0") is None  # nothing counted as a failure, nothing to retry
    assert main.kv_get("last_send:1") is None


def test_test_message_still_explains_what_is_missing():
    s = {**main.DEFAULTS, "smtp_host": "", "recipients": recipients(phone="+358401234567", email="a@b.fi")}
    out = asyncio.run(main.notify(None, s, {"subject": "x", "wa": "x", "text": "x"}, force="all"))
    assert out["A WhatsApp"] == "missing CallMeBot API key" and out["A email"] == "email server not configured"


def test_real_failure_is_still_retried():
    main.record_send(2, {"slot": "extra:0", "key": "k", "time": "14:25"}, {"A email": "failed: boom"})
    assert main.kv_get("tries:2:extra:0")["n"] == 1


def test_no_built_in_14_00_message_and_14_25_is_only_a_default():
    assert main.schedule_times(main.settings(901)) == [("extra:0", "14:25")]  # a new user: the standard time
    main.kv_set("settings:902", {**main.DEFAULTS, "sched_v2": True, "extra_time_1": ""})  # the user removed it
    assert main.schedule_times(main.settings(902)) == []


def test_settings_saved_before_get_14_25_in_the_first_free_time():
    old = {k: v for k, v in main.DEFAULTS.items() if k != "sched_v2"}
    main.kv_set("settings:903", {**old, "extra_time_1": "07:49", "extra_time_2": ""})
    assert [t for _, t in main.schedule_times(main.settings(903))] == ["07:49", "14:25"]
    main.kv_set("settings:904", {**old, "extra_time_1": "06:00", "extra_time_2": "12:00", "extra_time_3": "20:00"})
    assert [t for _, t in main.schedule_times(main.settings(904))] == ["06:00", "12:00", "20:00"]  # no free time: nothing is replaced


class At(datetime):  # a fixed "now" for due_messages()
    fixed = None

    @classmethod
    def now(cls, tz=None):
        return cls.fixed


def due_at(monkeypatch, send, now, last_price):
    """The messages due at `now` (h, min) for the send time `send`, with prices stored up to `last_price` (a timestamp)."""
    monkeypatch.setattr(main, "datetime", At)
    At.fixed = At(2026, 11, 10, *now, tzinfo=HELSINKI)
    main.db.execute("DELETE FROM prices")
    main.db.execute("DELETE FROM kv WHERE k LIKE 'extra_sent:%' OR k LIKE 'tries:%'")
    main.upsert("prices", [(t, 5.0) for t in range(ts(2026, 11, 10, 0), last_price + 1, 900)])
    s = {**main.DEFAULTS, "sched_v2": True, "extra_time_1": send}
    return [d["time"] for d in main.due_messages(s, 905)]


def test_14_25_message_waits_for_tomorrows_prices(monkeypatch):
    today, tomorrow = ts(2026, 11, 10, 23, 45), ts(2026, 11, 11, 23, 45)
    assert due_at(monkeypatch, "14:25", (14, 24), tomorrow) == []  # not yet time
    assert due_at(monkeypatch, "14:25", (14, 25), today) == []  # tomorrow is not there yet: wait
    assert due_at(monkeypatch, "14:25", (14, 25), tomorrow) == ["14:25"]
    assert due_at(monkeypatch, "14:25", (16, 0), today) == ["14:25"]  # still missing after 90 min: sent with estimates
    assert due_at(monkeypatch, "14:25", (17, 30), tomorrow) == []  # more than 3 h late


def test_a_time_before_14_20_does_not_wait_for_tomorrow(monkeypatch):
    today = ts(2026, 11, 10, 23, 45)
    assert due_at(monkeypatch, "14:19", (14, 19), today) == ["14:19"]
    assert due_at(monkeypatch, "14:20", (14, 20), today) == []
