# electricityfinland

Self-hosted monitor for Finnish electricity spot prices (Nord Pool day-ahead, 15-min), price estimates for the coming week, and wind power forecasts — with WhatsApp / email alarms. Runs in Docker on a NAS behind a reverse proxy.

## Features
- **Chart**: published Nord Pool day-ahead prices (solid), estimated prices beyond tomorrow (dashed), wind power forecast + actuals (MW, right axis), "now" line and alarm thresholds. Bars turn red/green when above/below your thresholds.
- **Spot + VAT / Total cost** toggle. Total = spot + VAT + provider margin + transfer (day/night) + electricity tax + other, optionally plus monthly fees spread per kWh.
- **Alarm bar**: high and low thresholds, on total cost or spot price. One message per crossing (re-arms after the price moves back by the re-arm margin), optional quiet hours, plus a daily summary when tomorrow's prices are published (~14:00) listing the hours above/below your thresholds.
- **Notifications**: WhatsApp (free, via CallMeBot) and email (your own SMTP, e.g. Synology Mail Server).
- Responsive layout for iPhone, iPad and desktop; light/dark mode; password login.

## Data sources (all free)
| Data | Source | Key |
|---|---|---|
| Day-ahead prices | [spot-hinta.fi](https://spot-hinta.fi), fallback [porssisahko.net](https://porssisahko.net) | none |
| Price estimate + wind forecast (~7 days) | [nordpool-predict-fi](https://github.com/vividfog/nordpool-predict-fi) | none |
| Official wind forecast + actual production (optional) | [Fingrid Open Data](https://data.fingrid.fi) datasets 245 / 75 | free API key |

The estimate is a machine-learning forecast and can be badly off on volatile days; only the solid line is the real price.

## Two ways to run
| | Docker (NAS) | Standalone (double-click) |
|---|---|---|
| Start | `docker compose up -d` | open `ElectricityFinland.html` |
| Alarms | 24/7 on the server | only while the page is open |
| Email | your SMTP server (`.env`) | free [EmailJS](https://www.emailjs.com) account |
| Login | password | none (local only) |
| Settings stored | SQLite on the NAS | browser localStorage |

Both use the same `web/` page. Opened from disk (`file://`), `web/local.js` takes over the backend's job in the browser.

## Standalone (no Docker)
1. Download the repo (Code → Download ZIP) and unzip.
2. Double-click **`ElectricityFinland.html`** (Chrome, Edge, Firefox or Safari; needs internet).
3. Fill in costs/alarms/notifications and Save. Keep the tab open for alarms. Background tabs are checked once a minute, which is enough.

Email in standalone mode: create a free EmailJS account, add an email service (e.g. Gmail/Outlook), and a template with *To* = `{{to_email}}`, subject `{{subject}}`, body `{{message}}`. Enter the service ID, template ID and public key under **Notifications**. If a data source blocks requests from a local file, the footer shows a ⚠ message.

## Install (Synology / any Docker host)
```sh
git clone https://github.com/sbarrak/electricityfinland.git && cd electricityfinland
cp .env.example .env   # set APP_PASSWORD, SECRET_KEY, optional SMTP_* and FINGRID_API_KEY
docker compose up -d --build
```
Open `http://<nas-ip>:8088`. On Synology you can also do this in **Container Manager → Project → Create** pointing at the folder.

### Reverse proxy (HTTPS)
DSM → **Control Panel → Login Portal → Advanced → Reverse Proxy → Create**:
- Source: `HTTPS`, your hostname (e.g. `power.example.com`), port 443
- Destination: `HTTP`, `localhost`, port `8088`

Use HTTPS: the login cookie is marked `Secure` when the proxy forwards `X-Forwarded-Proto: https` (DSM does by default).

### WhatsApp (CallMeBot)
1. Add **+34 644 51 95 23** to your phone contacts, send it the WhatsApp message `I allow callmebot to send me messages`.
2. You receive an API key. Enter your phone (`+358…`) and the key under **Notifications**, tick **WhatsApp**, press **Send test message**.

### Email (Synology Mail Server)
Set in `.env`: `SMTP_HOST=<nas-ip>`, `SMTP_PORT=587`, `SMTP_SECURITY=starttls`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. If the mail server uses a self-signed certificate, set `SMTP_VERIFY=false`. Then enter the recipient in **Notifications**.

## Costs
Enter all per-kWh fees in **c/kWh including VAT**, as they appear on Finnish invoices. Default electricity tax (class I incl. security-of-supply fee) is 2.827 c/kWh. Monthly fees are shown as €/month; tick *Spread monthly fees* and enter your monthly consumption to include them in the total c/kWh.

## Layout
```
docker-compose.yml   nginx (static + /api proxy) + app
app/main.py          FastAPI: fetchers, cost calc, alarms, notifications, login (SQLite in ./data)
web/                 index.html, app.js, style.css (Chart.js), local.js (standalone backend)
ElectricityFinland.html  double-click launcher for standalone mode
nginx/default.conf
```
Update: `git pull && docker compose up -d --build`.
