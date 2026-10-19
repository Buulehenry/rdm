"""Live Route/Trip/Table checks and bounded 20-client benchmark; synthetic points only."""
import json
import math
import statistics
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()
from app import create_app
from app.services.osrm import OSRM


def main():
    app = create_app()
    client = OSRM({**app.config, 'OSRM_CACHE_SECONDS': 0})
    points = [dict(latitude=.3476, longitude=32.5825), dict(latitude=.3547, longitude=32.6138),
              dict(latitude=.3372, longitude=32.6060)]
    route = client.route(points[:2])
    assert route['distance'] > 0 and route['duration'] > 0
    assert len(route['geometry']['coordinates']) > 2
    assert any(leg.get('steps') for leg in route['legs'])
    table = client.table(points)
    assert table['durations'][0][1] is not None
    order = client.trip_order(points, True)
    assert sorted(order) == [0, 1, 2] and order[0] == 0
    fixed_end = client.trip_order(points, False)
    assert fixed_end[0] == 0 and fixed_end[-1] == 2
    def timed(i):
        started = time.perf_counter()
        try:
            client.route([dict(latitude=.3476+i*.00001, longitude=32.5825), points[1]])
            return time.perf_counter()-started, True
        except Exception:
            return time.perf_counter()-started, False
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=20) as pool:
        results = list(pool.map(timed, range(20)))
    latencies = sorted(duration for duration, ok in results)
    report = dict(route_distance_m=route['distance'], route_duration_s=route['duration'],
                  geometry_points=len(route['geometry']['coordinates']), route_trip_table='passed',
                  concurrent_clients=20, cache='disabled', successful=sum(ok for _,ok in results),
                  batch_seconds=round(time.perf_counter()-started, 3),
                  median_seconds=round(statistics.median(latencies), 3),
                  p95_seconds=round(latencies[math.ceil(len(latencies)*.95)-1], 3))
    Path('private-osrm/benchmark.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
    if report['successful'] != 20:
        raise RuntimeError('Some concurrent routing requests failed.')


if __name__ == '__main__':
    main()
