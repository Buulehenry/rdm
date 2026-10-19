# Executed validation — 19 October 2026

## Live navigation follow-up

- Current-location and navigation JavaScript suite: **12 tests passed**, including
  automatic live watching, position updates, route splitting at the current GPS
  projection, approximate readings without false route progress, and continued
  progress after a route replacement.
- An isolated browser replay with synthetic GPS and real private-OSRM geometry
  showed the moving blue marker, map following, shrinking green route, fading
  traveled section, and an automatic detour reroute (route request count 1 → 2).
  This replay does not claim real-phone movement or GPS accuracy validation.
- Journey pin visibility checked in the actual RDM browser: three journey markers,
  zero station markers in hidden mode, and restoration of the full station layer.
- User supplied Bugiri coordinates were applied with a database backup. Both
  untouched active journeys were recalculated. The three-stop order is now
  **Seeta → Jinja 1 → Bugiri**; the four-stop order includes Seeta Highway between
  Seeta and Jinja 1. No visit completion records were fabricated.

The isolated visual replay can be rebuilt with
`python -m scripts.build_navigation_preview`; generated files stay under ignored
`artifacts/live-navigation-test/` and are not part of the product UI.

## Automated checks

- `python -m unittest discover -v`: **12 tests passed**. Authenticated dashboard
  and existing read APIs; station/prospect routing; invalid coordinates/IDs;
  CSRF; fixed/open/return/fixed-end optimized plans; drafts, reopen, editing and
  duplication; start/pause/resume/skip/check-in/check-out/finish; real recorded
  visit history; separate users and unauthorized access; assignment and stale
  versions; route outage/timeouts and working-hours overrun; generated exclusions;
  OSRM coordinate ordering, caching, redirects, invalid responses and thread-safe
  throttling. OSRM responses are mocked in this suite.
- `node --experimental-default-type=module --test tests/navigation.test.mjs`:
  **5 tests passed**. Simulated GPS denial; movement and remaining road distance;
  explicit start/stop and watcher cleanup; inaccurate GPS; repeated deviation and
  debounced rerouting; arrival prompt deduplication; stale async result cancellation;
  geometry progress and maneuver text. These are deterministic GPS engine tests,
  not proof of physical device accuracy.
- Python compile and new JavaScript syntax checks passed.
- `git diff --check` passed (Windows line-ending notices only).
- Fresh schema migrations 0001 and 0002 applied to a separate empty test SQLite
  database. `flask db check`: **No new upgrade operations detected**.
- Existing local database backed up to `backups/rdm-before-journeys-20261019-205057.db`,
  baseline table/column names checked, then migration 0002 applied successfully.
  Existing stations, competitors and districts remain available.

## Private engine and live routing

- Docker Desktop's failed startup was traced to a stale analytics socket. It was
  moved to a backup name through WSL; Docker then started normally. No Docker
  volumes or application databases were reset.
- Geofabrik Uganda source: **2026-10-18T20:25:06Z**, approximately **354 MB**.
  Download checksum matched the provider's MD5 before preprocessing.
- Official OSRM **v5.27.1**, image digest
  `sha256:855614a38f464b0558a2ad6eaa7cb8c139f39887da9b38b485ce453c6e6e6124`.
- Extract, partition and customize completed. Reported extraction peak:
  **2,174,238,720 bytes (~2.03 GiB)**. Serving memory after live checks:
  **417.6 MiB**, within the 2 GB container cap.
- Private listener verified: **127.0.0.1:5001**. RDM's ignored `.env` points to it.
  No public demo routing service is configured.
- `python -m scripts.check_private_osrm`: real **Route, round-trip Trip,
  fixed-end Trip, and Table passed**. Sample Kampala route was **5,154 m**,
  **428.1 seconds**, with **199 road geometry points** and maneuver steps.
- **20 simultaneous uncached routing clients, 20 successes**: median **55 ms**,
  p95 **74 ms**, whole batch **91 ms** in that local run. This is a short synthetic
  engine benchmark, not a full RDM, WAN or production workload benchmark. Repeat
  on Hetzner with representative journeys before choosing server capacity.

## Browser checks

- Existing map, branded station markers, filters, login, toolbar and exports still
  render. Compact desktop and narrow-panel layouts inspected. Top Stations is absent.
- Snapshot mode: dragged the Gulu Rubis marker to a temporary position, selected
  Save snapshot, observed export completion status and original marker restoration.
  Changes remain in client memory; no station update endpoint is used.
- Journey Planner: searched for Rubis Ntinda, added a 30-minute stop, entered a
  starting point, saved a draft, reopened it from Saved journeys, edited it,
  previewed a real road route through the private engine, and saved it as planned.
  Preview showed approximately **5.7 km**, **8 minutes driving**, **30 minutes
  visiting**, and **38 minutes total**, with a numbered stop and planned arrival.
- A clearly named **Local test — journey planner** sample plan remains available
  for the user. No artificial completed visits were added to station history.
- Browser console contained no startup JavaScript errors during these checks.

## Remaining operational checks

Real-phone GPS permission UI, GPS accuracy while moving, mobile battery behavior,
HTTPS device access, route compliance, closures and actual arrivals require a field
test. This PC's localhost URL cannot be opened as localhost on another phone.
Device guidance is foreground only, without voice or offline maps. The app stops
location watching when its tab is hidden or leaves the page. Route progress and
remaining travel time are approximate; they do not include live traffic.

Uganda-only routing rejects points too far from an eligible road. Some supplied
stations are outside Uganda; add a separately benchmarked regional extract if those
must be visited. The maximum road snapping radius defaults to 1 km.

No Hetzner deployment, production database migration, public hostname, HTTPS
certificate or production load test has been performed. See
`ROUTING-AND-JOURNEYS.md` for setup, user guide, configuration and deployment steps.
