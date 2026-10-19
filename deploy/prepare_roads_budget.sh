#!/usr/bin/env bash
set -euo pipefail
# Low-RAM alternative when uploading the prepared graph is too slow.
# Disk swap makes preprocessing possible but substantially slower than real RAM.
if [ ! -e /rdm-build.swap ]; then
    fallocate -l 2G /rdm-build.swap
    chmod 600 /rdm-build.swap
    mkswap /rdm-build.swap
    swapon /rdm-build.swap
    printf '/rdm-build.swap none swap sw 0 0\n' >> /etc/fstab
fi
mkdir -p /opt/rdm/private-osrm/build-data
cd /opt/rdm/private-osrm/build-data
curl --fail --location --retry 3 -o uganda-latest.osm.pbf https://download.geofabrik.de/africa/uganda-latest.osm.pbf
curl --fail --location --retry 3 -o uganda-latest.osm.pbf.md5 https://download.geofabrik.de/africa/uganda-latest.osm.pbf.md5
md5sum --check uganda-latest.osm.pbf.md5
image=ghcr.io/project-osrm/osrm-backend:v5.27.1@sha256:855614a38f464b0558a2ad6eaa7cb8c139f39887da9b38b485ce453c6e6e6124
docker pull "$image"
docker run --rm --name rdm-road-extract --memory=640m --memory-swap=3g --cpus=1 -v "$PWD:/data" "$image" osrm-extract --threads 1 -p /opt/car.lua /data/uganda-latest.osm.pbf
docker run --rm --name rdm-road-partition --memory=640m --memory-swap=3g --cpus=1 -v "$PWD:/data" "$image" osrm-partition --threads 1 /data/uganda-latest.osrm
docker run --rm --name rdm-road-customize --memory=640m --memory-swap=3g --cpus=1 -v "$PWD:/data" "$image" osrm-customize --threads 1 /data/uganda-latest.osrm
for graph in uganda-latest.osrm*; do
    install -m 644 "$graph" /opt/rdm/private-osrm/data/
done
cd /opt/rdm/deploy
docker compose -f compose.yaml -f budget.yaml up -d osrm
printf 'Private Uganda routing engine started.\n'
