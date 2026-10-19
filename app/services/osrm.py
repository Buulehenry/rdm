"""Bounded, thread-safe OSRM client. Only the server-configured origin is used."""
import copy
import http.client
import json
import math
import socket
import time
from collections import OrderedDict, deque
from threading import RLock
from urllib.parse import urlsplit, urlencode


class RoutingError(Exception):
    def __init__(self, message, status=503):
        super().__init__(message)
        self.status = status


def coordinate(value):
    if not isinstance(value, dict):
        raise ValueError('A location needs latitude and longitude.')
    if any(isinstance(value.get(k), bool) for k in ('latitude', 'longitude')):
        raise ValueError('Coordinates must be finite numbers.')
    try:
        lat, lng = float(value['latitude']), float(value['longitude'])
    except (ValueError, TypeError, KeyError):
        raise ValueError('A location needs numeric latitude and longitude.') from None
    if not math.isfinite(lat) or not math.isfinite(lng) or not -90 <= lat <= 90 or not -180 <= lng <= 180:
        raise ValueError('Coordinates are outside valid geographic bounds.')
    return {'latitude': lat, 'longitude': lng}


class OSRM:
    def __init__(self, config):
        self.config = config
        self.cache = OrderedDict()
        self.requests = OrderedDict()
        self.lock = RLock()

    def throttle(self, user_id):
        now = time.monotonic()
        with self.lock:
            history = self.requests.setdefault(user_id, deque())
            while history and history[0] < now - 60:
                history.popleft()
            if len(history) >= self.config['ROUTING_REQUESTS_PER_MINUTE']:
                raise RoutingError('Too many routing requests. Wait a minute and try again.', 429)
            history.append(now)
            self.requests.move_to_end(user_id)
            if len(self.requests) > 2000:
                self.requests.popitem(last=False)

    def request(self, service, points, **options):
        if service not in {'route', 'trip', 'table'} or not 2 <= len(points) <= 42:
            raise ValueError('Routing needs between 2 and 42 coordinates.')
        coords = [coordinate(p) for p in points]
        # Refuse a faraway substitute road (e.g. a point outside the Uganda extract).
        radius = max(1, min(5000, self.config.get('OSRM_MAX_SNAP_METERS', 1000)))
        options['radiuses'] = ';'.join(str(radius) for _ in coords)
        origin = urlsplit(self.config.get('OSRM_BASE_URL', ''))
        if origin.scheme not in {'http', 'https'} or not origin.hostname or origin.username or origin.password or origin.query or origin.fragment:
            raise RoutingError('Routing is not configured. Ask an administrator to set OSRM_BASE_URL.')
        encoded = ';'.join(f"{p['longitude']:.6f},{p['latitude']:.6f}" for p in coords)
        path = origin.path.rstrip('/') + f'/{service}/v1/driving/{encoded}?' + urlencode(options)
        key = (origin.geturl(), path)
        now = time.monotonic()
        with self.lock:
            cached = self.cache.get(key)
            if cached and cached[0] > now:
                self.cache.move_to_end(key)
                return copy.deepcopy(cached[1])
        connection_cls = http.client.HTTPSConnection if origin.scheme == 'https' else http.client.HTTPConnection
        connection = connection_cls(origin.hostname, origin.port, timeout=self.config['OSRM_CONNECT_TIMEOUT'])
        try:
            connection.connect()
            connection.sock.settimeout(self.config['OSRM_READ_TIMEOUT'])
            connection.request('GET', path, headers={'Accept': 'application/json', 'User-Agent': 'RDM-routing/1.0'})
            response = connection.getresponse()
            raw = response.read(8 * 1024 * 1024 + 1)
            if len(raw) > 8 * 1024 * 1024:
                raise RoutingError('Routing response is too large. Reduce the number of stops.')
            # Never follow redirects to an unapproved origin.
            if response.status not in (200, 400):
                raise RoutingError('The routing service is temporarily unavailable.')
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise RoutingError('The routing service returned an invalid response.')
            if data.get('code') != 'Ok':
                if data.get('code') in {'NoRoute', 'NoTrips', 'NoSegment', 'NoTable'}:
                    raise RoutingError('No road route connects the requested locations.', 422)
                raise RoutingError('The routing service could not process this request.', 422)
        except (TimeoutError, socket.timeout):
            raise RoutingError('The routing service timed out. Please retry.', 504) from None
        except (OSError, http.client.HTTPException, ValueError):
            raise RoutingError('The routing service is unavailable or returned an invalid response.') from None
        finally:
            connection.close()
        with self.lock:
            ttl = max(0, self.config['OSRM_CACHE_SECONDS'])
            if ttl:
                self.cache[key] = (now + ttl, data)
                while len(self.cache) > 128:
                    self.cache.popitem(last=False)
        return copy.deepcopy(data)

    def route(self, points):
        data = self.request('route', points, steps='true', geometries='geojson', overview='full')
        routes = data.get('routes') or []
        if not routes or not routes[0].get('geometry') or len(routes[0].get('legs', [])) != len(points) - 1:
            raise RoutingError('The routing service returned an incomplete route.')
        result = routes[0]
        for field in ('distance', 'duration'):
            if not isinstance(result.get(field), (int, float)) or not math.isfinite(result[field]) or result[field] < 0:
                raise RoutingError('The routing service returned invalid route totals.')
        if (not isinstance(result['geometry'], dict) or result['geometry'].get('type') != 'LineString'
                or not isinstance(result['geometry'].get('coordinates'), list)
                or len(result['geometry']['coordinates']) < 2):
            raise RoutingError('The routing service returned invalid route geometry.')
        for leg in result['legs']:
            if (not isinstance(leg, dict) or not isinstance(leg.get('duration'), (int, float))
                    or not math.isfinite(leg['duration']) or leg['duration'] < 0):
                raise RoutingError('The routing service returned invalid route legs.')
        return {key: result[key] for key in ('distance', 'duration', 'geometry', 'legs')}

    def table(self, points):
        data = self.request('table', points, annotations='duration,distance')
        matrix = data.get('durations')
        if not isinstance(matrix, list) or len(matrix) != len(points) or any(not isinstance(r, list) or len(r) != len(points) for r in matrix):
            raise RoutingError('The routing service returned an incomplete travel matrix.')
        if any(v is not None and (not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0) for row in matrix for v in row):
            raise RoutingError('The routing service returned an invalid travel matrix.')
        return data

    def trip_order(self, points, roundtrip):
        data = self.request('trip', points, roundtrip=str(roundtrip).lower(), source='first',
                            destination='any' if roundtrip else 'last', geometries='geojson', overview='false')
        waypoints = data.get('waypoints', [])
        if len(data.get('trips', [])) != 1 or len(waypoints) != len(points) or any(w.get('trips_index') != 0 for w in waypoints):
            raise RoutingError('Some stops cannot be combined into one road journey.', 422)
        order = sorted(range(len(points)), key=lambda i: waypoints[i]['waypoint_index'])
        if sorted(w.get('waypoint_index', -1) for w in waypoints) != list(range(len(points))) or order[0] != 0 or (not roundtrip and order[-1] != len(points)-1):
            raise RoutingError('The routing service returned an invalid visiting order.')
        return order
