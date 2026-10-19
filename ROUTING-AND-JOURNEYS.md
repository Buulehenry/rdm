# RDM navigation and journey planning

RDM keeps its Flask factory, SQLAlchemy database, Flask-Login roles, station data,
Leaflet map and existing import/export tools. Prospects use the existing `target`
station category. Target polygons are territories, not point destinations.

## Implementation files

- New backend: `app/journey_models.py`, `app/routes/journeys.py`,
  `app/services/osrm.py`, `app/services/journeys.py`.
- New frontend modules: `journeyApi.js`, `journeyPlanner.js`,
  `navigationEngine.js`, `navigationControl.js`, `snapshotControl.js` in
  `app/static/js/modules/`.
- Integration edits: `app/__init__.py`, `config.py`, `app/routes/stations.py`,
  `app/static/js/main.js`, `mapCore.js`, `toolbarControl.js`, `stationIcons.js`,
  `filtersControl.js`, `exportControl.js`, `app/static/css/styles.css`, and
  `app/templates/base.html`.
- New migration environment and revisions: `migrations/`; scripts:
  `scripts/upgrade_local.py`, `scripts/check_private_osrm.py`.
- Private engine: `private-osrm/compose.yaml`, `private-osrm/prepare.ps1`.
- Tests: `tests/test_journeys.py`, `tests/navigation.test.mjs` and existing
  `tests/test_basic.py`. Timezone dependency added to `requirements.txt`.
- Local setup work from this chat: `serve_local.py`, `start-local.cmd`,
  `stop-local.ps1`, `scripts/setup_local.py`, `requirements-local.txt`,
  `LOCAL-SETUP.md`, and repaired `upload_stations.py`.
- Runtime secrets, SQLite databases, backups, generated road files and benchmark
  output remain ignored. No commits, pushes or deployment have been performed.

## Local use

Open http://127.0.0.1:5055/dashboard and sign in with the local account in
`.env.local-login`. The first toolbar button opens Journey Planner.

1. New journeys automatically request a fresh current location and fill the start
   coordinates after permission is granted. The reading's accuracy is displayed;
   approximate readings need review. Refresh current location retries the lookup.
   Saved plans retain their original starting point. Enter a name, date and working
   hours. You can also enter coordinates, choose
   a map point, request one GPS reading, or use your personal saved base.
2. Search/filter stations and add stops, or turn on **Select stops on map** and
   click station markers. Reorder stops with arrows; set visit minutes and optional
   planning priorities. Uncheck **Required** for optional generation candidates.
3. Choose the ending point or return to start. Preview the road route. Suggested
   visiting orders are heuristics, not guaranteed global optima. Times are Uganda
   local time and exclude traffic, closures and unscheduled delays.
4. Review numbered stops, arrivals, totals, overrun and exclusions. Save a draft
   without a routing service, or save a feasible planned journey. New starts a
   separate plan; Edit updates the selected saved draft/planned journey.
5. **Saved journeys** includes drafts, active journeys and history. Open a plan
   and Start journey. Live navigation to the next stop starts automatically after
   GPS permission. Navigate to next stop also starts live navigation in one click.
   Reopening an active journey after a browser restart
   resumes its next pending visit; location permission is still required.
6. Near a station, the app asks you to confirm arrival. Confirm check-in, add notes,
   then check out to complete the visit. GPS never completes visits automatically.
   Skip records a skipped stop and routes to the next one. Pause stops GPS; Resume
   allows you to navigate again. Complete/skip all visits before Finish journey.
7. On any station popup choose Navigate for independent road navigation. End
   navigation stops the GPS watcher. The blue GPS marker updates continuously and
   the map follows it. Panning the map pauses following; **Follow me** resumes it.
   The green remaining road line shrinks as you move, and traveled sections fade.
   A reroute replaces the road line from the latest GPS position, then consumption
   continues. Poor readings remain visible with an accuracy circle while road
   guidance pauses, rather than pretending the reading is precise.
8. **Station pins**, available in the journey and live navigation panels, defaults
   to **Journey stops only**. Choose **Hide all station pins** to clear markers,
   or **All stations** to restore the usual map filters. GPS and road lines stay
   visible. Unrelated map filters do not hide selected journey stops.

User-reviewed seed coordinate corrections live in
`app/static/data/station_coordinate_corrections.json`. The station importer uses
them so a fresh install does not reintroduce the original spreadsheet's incorrect
Bugiri pin. `python -m scripts.apply_station_corrections` backs up local SQLite,
applies reviewed corrections, and recalculates affected untouched plans. It leaves
completed visit history intact. Bugiri was corrected using the coordinates supplied
by the user on 19 October 2026: `0.5728563578377932, 33.745726880470166`.

The server records planned locations and explicit visit timestamps/notes, not GPS
traces. GPS positions remain in browser memory except when sent to the configured
private engine through Flask to calculate a route. Navigation watches location
only after Start navigation and stops on End, page exit, pause or snapshot mode.

**Snapshot mode** temporarily enables dragging for all station marker shapes.
Save snapshot downloads a JPG and restores original positions. Done, Reset,
Escape and reload also restore them. No station update API is called. Snapshot
positions are never used for real navigation or journey planning. Top Stations
has been removed.

## Authorization and data availability

Administrators and analysts can create plans. Only creator/admin can edit a plan;
creator, assignee and admin can execute it. Only admin can assign another user.
Viewers can execute journeys assigned to them. Other users cannot read or modify
the journey. Updates carry a version to reject stale writes. New mutation APIs
require a session-bound CSRF token; routing requires authentication and is limited
to 30 requests per user per minute by default.

Priorities are explicit per-plan inputs, not invented station metadata. Last visit
is calculated from this module's recorded check-outs; no record means unavailable,
not never visited. RDM has no task or existing visit-form schema, so no tasks are
invented and notes are provided. Territory/district filters use actual station
relationships. The bundled station spreadsheet currently leaves these fields
unassigned; populate them using RDM's existing station edit/import tools. The
station picker supports up to 600 records; refine the server station filters if
the database grows beyond that. Generation evaluates at most 20 candidates and
reports excluded stations. Required stops can produce an explicit infeasibility
warning; optional stops are removed to fit hours. This is not a time-window solver.

## Configuration

Configure these in the service environment or `.env` (never commit secrets):

| Variable | Default | Purpose |
| --- | --- | --- |
| `OSRM_BASE_URL` | empty | Approved private OSRM origin, e.g. `http://127.0.0.1:5001` |
| `OSRM_CONNECT_TIMEOUT` | 3 | Connection timeout, seconds |
| `OSRM_READ_TIMEOUT` | 12 | Response read timeout, seconds |
| `OSRM_CACHE_SECONDS` | 60 | In-process routing cache TTL; 0 disables it |
| `OSRM_MAX_SNAP_METERS` | 1000 | Maximum distance from a coordinate to an eligible road |
| `ROUTING_REQUESTS_PER_MINUTE` | 30 | Per user, per app process |
| `NAV_ARRIVAL_METERS` | 100 | Arrival prompt radius |
| `NAV_DEVIATION_METERS` | 80 | Minimum off-route distance |
| `NAV_MAX_ACCURACY_METERS` | 100 | Reject poorer GPS readings |
| `DATABASE_URL` | local SQLite | Existing database connection |
| `SECRET_KEY` | existing default | Must be unique and secret in production |

OSRM requests use server-side configuration only. The browser cannot supply an
outbound URL. Redirects are rejected, TLS is verified for HTTPS origins, response
size is limited, errors are sanitized, and coordinates are finite/range checked.
No public demonstration server is a runtime dependency.

## Private Uganda OSRM on this PC

Docker Desktop must be running with its Linux engine. Source:
[Geofabrik Uganda](https://download.geofabrik.de/africa/uganda.html), with
[OSRM's official MLD preprocessing workflow](https://github.com/Project-OSRM/osrm-backend#quick-start).

The image is pinned to `ghcr.io/project-osrm/osrm-backend:v5.27.1`. Keep the same
image for extraction, partitioning, customization and serving; graph files are
version dependent. Data stays in ignored `private-osrm/data/`. The server exposes
only `127.0.0.1:5001`, has a 2 GB memory cap and two CPU threads. Preprocessing is
separate, capped at 3 GB and two threads; measure your own hardware.

The running image is additionally locked to digest
`sha256:855614a38f464b0558a2ad6eaa7cb8c139f39887da9b38b485ce453c6e6e6124`.
Server verbosity is WARNING to avoid retaining coordinate-bearing access logs.

```powershell
New-Item -ItemType Directory -Force private-osrm/data
curl.exe --fail --location --output private-osrm/data/uganda-latest.osm.pbf https://download.geofabrik.de/africa/uganda-latest.osm.pbf
curl.exe --fail --location --output private-osrm/data/uganda-latest.osm.pbf.md5 https://download.geofabrik.de/africa/uganda-latest.osm.pbf.md5
# Compare the provider checksum with Get-FileHash -Algorithm MD5 before processing.
docker pull ghcr.io/project-osrm/osrm-backend:v5.27.1
.\private-osrm\prepare.ps1
docker compose -f private-osrm/compose.yaml ps
```

Set `OSRM_BASE_URL=http://127.0.0.1:5001` in `.env`, restart RDM, then run:

```powershell
.\.venv\Scripts\python.exe -m scripts.check_private_osrm
docker stats --no-stream
```

The live check uses synthetic Kampala coordinates, validates Route, Trip and Table,
and records a 20-client uncached benchmark in `private-osrm/benchmark.json`.
The service restarts with Docker. Stop/start it with `docker compose -f
private-osrm/compose.yaml stop` / `up -d`. Update road data in a separate directory,
preprocess and test it before replacing the mounted directory during maintenance.
Uganda-only coverage will not route to Kenyan stations from the supplied dataset.

## Migrations and deployment

`migrations/versions/0001_existing_rdm_schema.py` represents the existing schema.
`0002_journeys_visits_and_saved_bases.py` adds journey, stop and personal base tables
with station/user foreign keys, sequence uniqueness and lookup indexes. Migrations
are now tracked rather than ignored. Fresh database: `flask --app run db upgrade`.

For this existing local SQLite database use:

```powershell
.\.venv\Scripts\python.exe -m scripts.upgrade_local
```

It creates a SQLite backup, checks existing table/column names before stamping
baseline 0001, then upgrades. It refuses unexpected schemas. For PostgreSQL back up
first, review schema types/constraints against 0001, stamp 0001 only if the baseline
matches, then upgrade to head. Never stamp an unknown production database blindly.

For Hetzner/Ubuntu install dependencies in a venv and use Gunicorn behind Nginx
with HTTPS and secure cookies. Mobile GPS requires HTTPS; localhost is the browser
exception. Load `.env` through the process environment (`run.py`/Flask CLI loads it
via python-dotenv) and use a separate production secret/accounts. Configure
`SESSION_COOKIE_SECURE=True` in the HTTPS deployment. Put OSRM on a private network,
or loopback on the same server, and restrict it with a firewall. If using another
host, set the approved private endpoint accordingly. Never expose unauthenticated
OSRM directly to the internet. Keep browser tile dependencies and OSM attribution.

The supplied Compose setup uses a host directory and works on Linux too. For
preprocessing on Ubuntu replace the PowerShell commands with the three equivalent
`docker run` commands from the official OSRM MLD guide, mounting `private-osrm/data`
as `/data`, then run the same Compose file. Benchmark road preparation and query
memory separately before cohosting with RDM. The in-memory cache/throttle is per
process; use a shared reverse-proxy rate limit for multiple Gunicorn workers. No
Redis or new application framework is required for the initial small deployment.

Back up the database regularly. Journey references prevent station deletion to
preserve history. Roll back code only to a version compatible with the new tables;
restore a verified backup for a full rollback. Migration downgrade drops journey
records and requires an explicit operational decision. Hetzner has not been deployed.

## Verification and limitations

```powershell
.\.venv\Scripts\python.exe -m unittest discover -v
node --experimental-default-type=module --test tests/navigation.test.mjs
```

Automated tests mock OSRM and GPS for deterministic permission, movement, accuracy,
arrival, deviation, request cancellation, lifecycle, authorization, scheduling,
outage, throttle and API checks. Live OSRM and browser checks supplement them.
See `VALIDATION.md` for actual executed results and remaining device checks.

Navigation is foreground browser guidance, without voice, offline maps or background
tracking. GPS and map-matching may be ambiguous on parallel/looping roads. Rerouting
needs three off-route readings and a minimum 20-second interval. Arrival prompts
need explicit confirmation. Field-test on a real phone before using for driving;
do not operate controls while moving. No field accuracy or production throughput
is claimed by a local synthetic benchmark. Routes, ETA and completion estimates
exclude real-time traffic, and a recently edited station can change future routing.
