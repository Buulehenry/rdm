# Local testing

Open http://127.0.0.1:5055. Login credentials are in `.env.local-login` (ignored by Git).

The server uses Waitress, binds only to this computer, and has debug mode disabled.
To restart, double-click `start-local.cmd`. Close its window or press Ctrl+C to stop.
For the background server, run `./stop-local.ps1` before restarting. The current
server PID is recorded in ignored `local.pid`.
Data persists in `stations.db`. The session secret is generated in `.env`.

## Recreate the setup

Run these commands from this folder in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-local.txt
.\.venv\Scripts\python.exe -m scripts.setup_local
$env:PYTHONIOENCODING = 'utf-8'
.\.venv\Scripts\python.exe upload_competitors.py
.\.venv\Scripts\python.exe upload_stations.py
.\.venv\Scripts\python.exe -m scripts.import_districts_from_level1 app/static/data/gadm41_UGA_1.json
.\.venv\Scripts\python.exe -m unittest discover -v
.\start-local.cmd
```

Initial data: 530 stations, 4 competitors, 56 districts. The importer skips two
districts without a region. No sales volumes are bundled, so rankings start empty.
Map tiles and frontend CDN dependencies require internet access.

Verified login, authentication rejection, dashboard rendering, six main read APIs,
and browser map rendering. This is a smoke test, not full deployment validation.
Test editing, imports, exports, rankings and permissions before deployment.

Hetzner deployment has not been performed. Production needs its own secret and
accounts, a backed-up database, HTTPS, service configuration and a security review.
