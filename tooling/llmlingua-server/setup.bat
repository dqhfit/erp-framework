@echo off
REM Cài đặt LLMLingua sidecar server
echo === Cai dat LLMLingua sidecar ===

REM Tạo venv nếu chưa có
if not exist ".venv" (
    echo Tao virtual environment...
    python -m venv .venv
)

REM Cài dependencies
echo Cai dependencies...
.venv\Scripts\pip install -r requirements.txt

echo.
echo === Xong! Chay server: ===
echo   .venv\Scripts\python server.py
echo.
echo Server mac dinh o http://localhost:8908
