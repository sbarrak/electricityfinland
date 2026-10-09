@echo off
rem Run on your computer without Docker/nginx: http://localhost:8000
cd /d "%~dp0"
if not exist .env copy .env.example .env
if not exist .venv python -m venv .venv || goto :err
.venv\Scripts\python -m pip install -q -r app\requirements.txt || goto :err
if not exist data mkdir data
set DB_PATH=data\app.db
start "" cmd /c "timeout /t 3 >nul & start http://localhost:8000"
.venv\Scripts\python -m uvicorn --app-dir app main:app --host 127.0.0.1 --port 8000
:err
pause
