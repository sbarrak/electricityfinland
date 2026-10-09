# electricityfinland

Self-hosted monitor for Finnish electricity spot prices (Nord Pool day-ahead, 15-min), price estimates for the coming week, and wind power forecasts — with WhatsApp / email alarms. Runs in Docker on a NAS behind a reverse proxy.

## Features
- **Zoomable chart**: hours on the axis with the day below, 15-minute steps at the closest zoom and up to one point per day when zoomed out. Opens on today −3 days … +2 days.
  - Zoom: pinch on the trackpad (or Ctrl + mouse wheel), pinch on iPad/iPhone, or the − / + buttons (⇔ time, ⇕ price). **Reset** returns to the default view.
  - Move: scroll bars under and beside the chart, two-finger swipe on the trackpad, or drag sideways on a touch screen.
  - **From / To** dates and presets (last week, month, 3 months, year). **Average** shows three averages for the visible period, each over its own part of the chart: past published prices (blue), fixed future prices (green) and the estimate (orange). The labels move apart when they would overlap.
  - **Spot / Total cost** buttons with an **Incl. VAT** checkbox. Colours: **blue** = published price up to now, **green** = published future price (fixed), **orange dashed** = estimate (not fixed yet). Red / green dashed lines = your high / low limits. The Average value has a yellow label.
  - Click a point to see its **price breakdown** (spot, VAT, margin, transfer, tax, monthly fees) in the box next to Monthly fees.
  - **Estimate vs actual** checkbox adds a tab comparing the estimate made *before* the price was published with the real price, with the average error.
- The latest prices are fetched automatically when the app starts and when the page opens; **⟳ Refresh prices** fetches them again on demand. Up to a year of past prices is loaded from [sahkotin.fi](https://sahkotin.fi).
- **Login and users**: the first login is `admin` / `admin`; you then pick your own username and password and become the **admin** (Account button to change it later). The admin can add users, **reset their password** and remove them in the **Users** box (username + temporary password; the new user chooses their own password at first login). Every user has their **own recipients, email server, alarms, messages and costs**, and gets their own daily 14:00 message.
- **Alarms** (row above the chart, saved automatically): Nord Pool fixes the next day's prices around 13:45, so **one message per day is sent between 14:00 and 14:05** with the fixed prices from 14:00 to 14:00 the next day. It starts with a summary and lists every time the price goes **up to or above the high limit** or **down to or below the low limit**, with the price, day and time and how long it lasts, e.g. `🔴 High price 25.40 c/kWh · Sat 11.10. 17:00–19:15 (2 h 15 min) · limit 20`. If the prices are published late, the message is sent as soon as they arrive.
- **Customizable messages** (✉ Customize messages, under Recipients): edit the high, low and daily-summary texts with placeholders like `{price}`, `{date}`, `{time}`, `{end}`, `{duration}`, `{limit}`, with a live example. Save or Cancel closes the window.
- **Cards** with an ⓘ button explaining each value; a Transfer card shows the current transfer fee + tax.
- Costs, monthly fees, recipients and email server settings are **saved automatically** while you type.
- **Several recipients**, each with their own WhatsApp number (CallMeBot key) and/or email: WhatsApp goes to rows with a phone and key, email to rows with an address. Tick the box at the start of a row to select it, then **💬 Send WhatsApp** or **✉️ Send email** to send a test message to the selected rows.
- **Email server menu** for your SMTP relay (server, port, STARTTLS/SSL, username, password) with a test button.
- **Chart** also shows wind power forecast + actuals (MW, right axis) and a "now" line.
- Total cost = spot + VAT + provider margin + transfer (day/night) + electricity tax + other, optionally plus monthly fees spread per kWh.
- **Notifications**: WhatsApp (free, via CallMeBot) and email (your own SMTP, e.g. Synology Mail Server).
- Responsive layout for iPhone, iPad and desktop; light/dark mode; password login.

## Data sources (all free)
| Data | Source | Key |
|---|---|---|
| Day-ahead prices | [spot-hinta.fi](https://spot-hinta.fi), fallback [porssisahko.net](https://porssisahko.net) | none |
| Price estimate + wind forecast (~7 days) | [nordpool-predict-fi](https://github.com/vividfog/nordpool-predict-fi) | none |
| Official wind forecast + actual production (optional) | [Fingrid Open Data](https://data.fingrid.fi) datasets 245 / 75 | free API key |

The estimate is a machine-learning forecast and can be badly off on volatile days; only the solid line is the real price.

## Three ways to run
| | Docker (NAS) | Local server (test on your computer) | Standalone (double-click) |
|---|---|---|---|
| Start | `docker compose up -d` | `run.bat` (Windows) / `./run.sh` (Mac/Linux) | open `ElectricityFinland.html` |
| Needs | Docker | Python 3.10+ | a browser |
| Alarms | 24/7 on the server | while the script runs | only while the page is open |
| Email | your SMTP server (`.env`) | your SMTP server (`.env`) | free [EmailJS](https://www.emailjs.com) account |
| Login | admin/admin, then your own; admin adds users | admin/admin, then your own; admin adds users | none (local only, one user) |
| Settings stored | SQLite on the NAS | SQLite in `./data` | browser localStorage |

All three use the same `web/` page and the Docker and local server use the same `app/main.py`. Without nginx, the Python app serves `web/` itself. Opened from disk (`file://`), `web/local.js` takes over the backend's job in the browser.

## Local server (no Docker, no nginx)
Behaves exactly like the NAS version, so it's the best way to test before deploying.
1. Install [Python 3.10+](https://www.python.org/downloads/) (Windows: tick *Add python.exe to PATH*).
2. Download the repo and double-click **`run.bat`** (Windows) or run **`./run.sh`** (Mac/Linux).
3. The first start creates `.env` from `.env.example` and installs dependencies into `.venv`. Your browser then opens http://localhost:8000. Log in with `admin` / `admin` and choose your own username and password. Set up the email server in the page.
4. Stop with Ctrl+C or by closing the window. Data is kept in `./data`.

**Dev mode without login:** start **`./run-dev.sh`** (Mac/Linux) or **`run-dev.bat`** (Windows) instead. Same app and data, but no login screen (you are the admin). It only listens on this computer (localhost); never use it on the NAS.

## Standalone (no Docker)
1. Download the repo (Code → Download ZIP) and unzip.
2. Double-click **`ElectricityFinland.html`** (Chrome, Edge, Firefox or Safari; needs internet).
3. Fill in costs/alarms/notifications and Save. Keep the tab open for alarms. Background tabs are checked once a minute, which is enough.

Email in standalone mode: create a free EmailJS account, add an email service (e.g. Gmail/Outlook), and a template with *To* = `{{to_email}}`, subject `{{subject}}`, body `{{message}}`. Enter the service ID, template ID and public key under **Email**. If a data source blocks requests from a local file, the footer shows a ⚠ message.

## Install (Synology / any Docker host)
```sh
git clone https://github.com/sbarrak/electricityfinland.git && cd electricityfinland
cp .env.example .env   # optional: FINGRID_API_KEY
docker compose up -d --build
```
Open `http://<nas-ip>:8088`. On Synology you can also do this in **Container Manager → Project → Create** pointing at the folder.

### Portainer (Synology, nothing cloned)
Create a stack from **`docker-compose.portainer.yml`** (paste it into the Portainer web editor) and add the environment variables from `.env.example` as `stack.env` (or via *Load variables from .env file*), plus `DATA_DIR` (e.g. `/volume1/docker/electricity_price`) and `WEB_PORT`. Everything is pulled from GitHub; a short-lived `setup` container copies the web files and `nginx/default.conf` into `$DATA_DIR/web` and `$DATA_DIR/nginx` on the NAS, and the user data lives in `$DATA_DIR/data`. Nothing is lost on update: re-deploy the stack with *Re-pull image / rebuild* and the web files are refreshed, the data is untouched.

### Reverse proxy (HTTPS)
DSM → **Control Panel → Login Portal → Advanced → Reverse Proxy → Create**:
- Source: `HTTPS`, your hostname (e.g. `power.example.com`), port 443
- Destination: `HTTP`, `localhost`, port `8088`

Use HTTPS: the login cookie is marked `Secure` when the proxy forwards `X-Forwarded-Proto: https` (DSM does by default).

### WhatsApp (CallMeBot)
1. Add **+34 644 51 95 23** to your phone contacts, send it the WhatsApp message `I allow callmebot to send me messages`.
2. You receive an API key. Under **Recipients** press **+ Add recipient**, enter the name, phone (`+358…`) and key, tick the box at the start of the row and press **💬 Send WhatsApp**. Repeat for every person who should get messages (each needs their own key).

### Email server
Open **Email server** in the page: server (default `mail.laseleka.com`), port `587`, security `starttls`, and your relay username and password. Fill in **From address** with a real address on your domain (e.g. `power@laseleka.com`) when the relay username is not an email address, otherwise the server refuses the message. Untick *Verify server certificate* only for a self-signed certificate. Select recipients and press **Test email to selected**; a failure shows the reason (wrong username/password, untrusted certificate, missing From address). The password is stored on the server and never sent back to the browser.

### Blank page or old screens after an update?
The app tells browsers to always check for new files, but a browser that cached an older version before this fix may still show it once. Reload with **Cmd+Option+R** (Safari) or **Ctrl+Shift+R** (Chrome/Edge/Firefox). If the server is not running, the login screen now says so instead of staying blank.

### Forgot the login?
Add `RESET_ADMIN=1` to `.env`, restart once, log in with `admin` / `admin` (this resets the admin account; other users are not touched), choose new credentials, then remove the line. A user who forgot their password: the admin presses **Reset password** next to them and gives them a temporary one.

## Costs
Enter all per-kWh fees in **c/kWh including VAT**, as they appear on Finnish invoices. Default electricity tax (class I incl. security-of-supply fee) is 2.827 c/kWh. Monthly fees are shown as €/month; tick *Spread monthly fees* and enter your monthly consumption to include them in the total c/kWh.

## Layout
```
docker-compose.yml   nginx (static + /api proxy) + app
docker-compose.portainer.yml  same for Portainer/Synology: builds from GitHub, keeps data + web files on the NAS
setup/Dockerfile     one-shot container that copies web/ and nginx config to the NAS folders
app/main.py          FastAPI: fetchers, cost calc, alarms, notifications, login (SQLite in ./data)
web/                 index.html, app.js, style.css (Chart.js), local.js (standalone backend)
ElectricityFinland.html  double-click launcher for standalone mode
run.bat / run.sh     local server launcher (no Docker/nginx)
run-dev.bat / run-dev.sh  same without login, for testing
nginx/default.conf
```
Update: `git pull && docker compose up -d --build`.
