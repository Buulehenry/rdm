@echo off
cd /d "%~dp0"
echo Open http://127.0.0.1:5055 - press Ctrl+C to stop.
".venv\Scripts\python.exe" serve_local.py
