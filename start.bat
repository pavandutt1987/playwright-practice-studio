@echo off
echo ========================================================
echo    🎭 Launching Playwright Practice Studio...
echo ========================================================
echo.
echo Opening browser to http://localhost:8000 ...
start "" http://localhost:8000
echo Starting FastAPI Web Server...
echo (Press Ctrl + C in this terminal to stop the server)
echo.
python -m uvicorn app.server:app --host 127.0.0.1 --port 8000
pause
