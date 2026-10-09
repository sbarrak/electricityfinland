#!/bin/sh
# Run on your computer without Docker/nginx: http://localhost:8000
cd "$(dirname "$0")"
[ -f .env ] || cp .env.example .env
[ -d .venv ] || python3 -m venv .venv || exit 1
.venv/bin/pip install -q -r app/requirements.txt || exit 1
mkdir -p data
PORT=${PORT:-8000}
(sleep 3; python3 -m webbrowser "http://localhost:$PORT" >/dev/null 2>&1) &
DB_PATH=data/app.db exec .venv/bin/python -m uvicorn --app-dir app main:app --host 127.0.0.1 --port "$PORT"
