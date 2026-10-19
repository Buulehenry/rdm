$ErrorActionPreference = 'Stop'
$dataPath = Join-Path $PSScriptRoot 'data'
$imageName = 'ghcr.io/project-osrm/osrm-backend:v5.27.1@sha256:855614a38f464b0558a2ad6eaa7cb8c139f39887da9b38b485ce453c6e6e6124'
if (!(Test-Path -LiteralPath (Join-Path $dataPath 'uganda-latest.osm.pbf'))) {
    throw 'Download the Uganda .osm.pbf into private-osrm/data first. See ROUTING-AND-JOURNEYS.md.'
}
foreach ($phase in @('extract', 'partition', 'customize')) {
    $arguments = @('run', '--rm', '--memory=3g', '--cpus=2', '-v', "${dataPath}:/data", $imageName, "osrm-$phase", '--threads', '2')
    if ($phase -eq 'extract') { $arguments += @('-p', '/opt/car.lua', '/data/uganda-latest.osm.pbf') }
    else { $arguments += '/data/uganda-latest.osrm' }
    & docker @arguments
    if ($LASTEXITCODE -ne 0) { throw "OSRM $phase failed. Keep existing data and check memory and logs." }
}
docker compose -f (Join-Path $PSScriptRoot 'compose.yaml') up -d
if ($LASTEXITCODE -ne 0) { throw 'OSRM failed to start.' }
