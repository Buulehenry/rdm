# DigitalOcean deployment

The production stack runs Gunicorn, a private Uganda OSRM engine, and Caddy for
automatic HTTPS. Only ports 80 and 443 are published; SSH is required for setup.
SQLite data, feedback and HTTPS certificates persist outside app containers.
Use a small single-server deployment initially. Configure automated off-server
database backups before relying on it for operational visit history.

## Prepare

1. Create an Ubuntu LTS Droplet with SSH-key authentication after choosing the
   monthly budget. Restrict SSH to the operator's IP in a DigitalOcean firewall;
   allow public TCP 80/443 and optionally UDP 443. Do not publish OSRM port 5000.
2. Install Docker Engine and Compose from Docker's official Ubuntu repository.
3. Clone this repository into `/opt/rdm`. Point an owned hostname's DNS A record
   to the server. HTTPS is required for browser geolocation on phones.
4. On the local PC, run `python -m scripts.prepare_deployment_database` once.
   It copies the station database into ignored `deploy/data/rdm.db`, removes local
   users/test journeys, and checks integrity. It never changes the local database.
   Transfer this file securely to the server before first initialization.
5. Transfer the already prepared `private-osrm/data/uganda-latest.osrm*` graph files
   to the matching directory on the server, keeping the pinned OSRM image version.
   The original PBF is not required at runtime. Local preprocessing allows a
   smaller server without needing enough RAM for the road extraction step.
   When uploading is too slow, `prepare_roads_budget.sh` can instead prepare the
   graph on the 1 GB server using swap and a 640 MB resident-memory limit. This is
   slow and intended for initial setup or a maintenance window, not normal use.
6. Create `deploy/feedback`; give `deploy/data` and `deploy/feedback` to UID 10001.
   Create a private `deploy/.env` containing a fresh random `SECRET_KEY` of at least
   32 characters and `RDM_HOST=your-hostname`. Do not reuse the local app secret.
   Set `RDM_IP` to the server's public IPv4 address. Caddy also serves trusted HTTPS
   directly on this address using Let's Encrypt's short-lived certificate profile;
   Caddy automatically renews these certificates. The hostname remains available.

## Start

From `/opt/rdm/deploy`, with `.env` mode 600:

```sh
docker compose build web
docker compose run --rm web python -m deploy.initialize
docker compose up -d
docker compose ps
```

The initializer upgrades migrations and creates a separate production admin once.
For requested accounts, mount a private hash-only seed file under `/data` and run
the initializer with `RDM_USER_SEED` set to that path. This creates those accounts
instead of the automatic administrator. Delete the seed file after verification.
Retrieve `data/initial-admin-login.txt` over SSH, store it privately, then remove
the credential file. Existing users are never reset by rerunning initialization.
Do not start with the local test administrator account.

Verify HTTPS `/login`, authenticated dashboard, station count, private OSRM Route,
Trip and Table, journey preview, and mobile location permission/live movement.
The container health check covers the login page; it does not prove routing or GPS.
`docker compose exec -T web python - < verify.py` checks private routing and the
authenticated route API without writing journeys. Adapt seed-specific station
names if deploying a different dataset.

## Backups and updates

The 1 GB budget pilot uses `-f compose.yaml -f budget.yaml` for every Compose
command. It is intended for light use and requires monitoring memory and latency;
the larger base configuration is the default for servers with more memory.
`backup.py` creates consistent snapshots when scheduled by root's cron. Keep a
copy off the server too; snapshots on the same Droplet are not disaster recovery.

Use SQLite's online backup API to create consistent database snapshots. Keep a
daily copy outside the Droplet and test a restore. A local backup on the same disk
does not protect against loss of the server. Avoid copying an active database
with plain `cp`.

Before updating, back up the database, fetch and review the new code, rebuild web,
run the migration initializer, then `docker compose up -d`. Keep the road graph and
mounted data directories. Never run `docker compose down -v` during normal updates.
Rollback code only to a revision compatible with the installed database schema.
