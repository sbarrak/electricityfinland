@echo off
rem Like run.bat but WITHOUT login, for testing on this computer only (http://localhost:8000).
set DEV_NO_LOGIN=1
call "%~dp0run.bat"
