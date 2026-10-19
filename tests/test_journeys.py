import copy
import http.client
import json
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch, MagicMock
from app import create_app, db
from app.models import User, Station
from app.services.osrm import OSRM, RoutingError, coordinate
from tests.test_basic import TestConfig


class FakeOSRM:
    """Deterministic road fixture; never used in application runtime."""
    def throttle(self, user):
        pass

    def route(self, points):
        legs = [dict(distance=1000, duration=600, steps=[]) for _ in points[1:]]
        return dict(distance=1000*len(legs), duration=600*len(legs), legs=legs,
                    geometry=dict(type='LineString', coordinates=[[p['longitude'], p['latitude']] for p in points]))

    def table(self, points):
        return dict(durations=[[0 if a == b else (abs(a-b)*100+100) for b in range(len(points))] for a in range(len(points))])

    def trip_order(self, points, roundtrip):
        return [0] + list(reversed(range(1, len(points)))) if roundtrip else [0] + list(reversed(range(1, len(points)-1))) + [len(points)-1]


class JourneyTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(TestConfig)
        self.ctx = self.app.app_context()
        self.ctx.push()
        db.create_all()
        for name, role in [('alice', 'analyst'), ('bob', 'analyst'), ('admin', 'admin'), ('viewer', 'viewer')]:
            u = User(username=name, role=role)
            u.set_password('password')
            db.session.add(u)
        for i, category in enumerate(['rubis', 'target', 'competitor']):
            db.session.add(Station(name=f'Station {i}', latitude=.3+i*.01, longitude=32.5+i*.01, category=category, region='Mukono'))
        db.session.commit()
        self.app.extensions['osrm'] = FakeOSRM()
        self.client = self.app.test_client()
        self.login('alice')
        self.spec = dict(name='Mukono visits', journey_date='2026-10-20', departure_time='08:00', working_end='17:00',
                         start=dict(latitude=.3, longitude=32.5), stops=[dict(station_id=1, visit_minutes=30)], optimize=False)

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        db.engine.dispose()
        self.ctx.pop()

    def login(self, name):
        self.client.get('/logout')
        self.client.post('/login', data=dict(username=name, password='password'))
        self.csrf = self.client.get('/api/journeys/config').json['csrf_token']

    def post(self, path, data):
        return self.client.post('/api/journeys'+path, json=data, headers={'X-RDM-CSRF': self.csrf})

    def create(self, status='planned'):
        response = self.post('', dict(specification=self.spec, status=status))
        self.assertEqual(response.status_code, 201, response.json)
        return response.json

    def act(self, item, action):
        return self.post(f"/{item['id']}/action", dict(version=item['version'], action=action))

    def test_navigation_station_and_prospect(self):
        for sid in (1, 2):
            response = self.post('/route', dict(origin=self.spec['start'], station_id=sid))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json['destination']['id'], sid)
            self.assertIn('geometry', response.json['route'])
        ending = self.post('/route', dict(origin=self.spec['start'], destination=dict(latitude=.4, longitude=32.6)))
        self.assertEqual(ending.status_code, 200)

    def test_validation_and_csrf(self):
        self.assertEqual(self.client.post('/api/journeys/preview', json=self.spec).status_code, 403)
        for val in (float('nan'), float('inf'), 91, True):
            spec = {**self.spec, 'start': dict(latitude=val, longitude=32)}
            self.assertEqual(self.post('/preview', spec).status_code, 400)
        self.assertEqual(self.post('/route', dict(origin=self.spec['start'], station_id=999)).status_code, 404)
        self.assertEqual(self.post('/preview', {**self.spec, 'stops': [{'station_id': 999}]}).status_code, 400)
        self.assertEqual(self.post('/preview', {**self.spec, 'stops': self.spec['stops']*2}).status_code, 400)

    def test_fixed_optimized_and_return(self):
        self.spec['stops'] = [dict(station_id=i, visit_minutes=30) for i in (1, 2, 3)]
        fixed = self.post('/preview', self.spec).json['plan']
        optimized = self.post('/preview', {**self.spec, 'return_to_start': True, 'optimize': True}).json['plan']
        self.assertEqual([s['station_id'] for s in fixed['stops']], [1, 2, 3])
        self.assertEqual([s['station_id'] for s in optimized['stops']], [3, 2, 1])
        self.assertEqual(optimized['route']['geometry']['coordinates'][0], optimized['route']['geometry']['coordinates'][-1])
        self.assertEqual(optimized['visit_seconds'], 5400)
        open_plan = self.post('/preview', {**self.spec, 'optimize': True})
        self.assertEqual(open_plan.status_code, 200)
        end_plan = self.post('/preview', {**self.spec, 'optimize': True, 'end': dict(latitude=.4, longitude=32.7)})
        self.assertEqual(end_plan.status_code, 200)

    def test_draft_reopen_edit_duplicate(self):
        item = self.create('draft')
        self.assertIsNone(item['plan'])
        self.assertEqual(self.client.get(f"/api/journeys/{item['id']}").json['name'], 'Mukono visits')
        response = self.client.put(f"/api/journeys/{item['id']}", json=dict(version=item['version'], status='planned', specification=self.spec), headers={'X-RDM-CSRF': self.csrf})
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json['status'], 'planned')
        duplicate = self.post(f"/{item['id']}/duplicate", {})
        self.assertEqual(duplicate.status_code, 201)
        self.assertNotEqual(duplicate.json['id'], item['id'])
        self.assertEqual(duplicate.json['status'], 'draft')

    def test_lifecycle_skip_pause_resume_and_visits(self):
        self.spec['stops'].append(dict(station_id=2, visit_minutes=20))
        item = self.act(self.create(), 'start').json
        item = self.act(item, 'pause').json
        sid = item['stops'][0]['id']
        self.assertEqual(self.post(f"/{item['id']}/stops/{sid}", dict(action='skip', version=item['version'])).status_code, 409)
        item = self.act(item, 'resume').json
        item = self.post(f"/{item['id']}/stops/{sid}", dict(action='skip', version=item['version'], notes='Closed')).json
        self.assertEqual(item['stops'][0]['status'], 'skipped')
        self.assertEqual(self.act(item, 'finish').status_code, 409)
        sid = item['stops'][1]['id']
        item = self.post(f"/{item['id']}/stops/{sid}", dict(action='check_in', version=item['version'])).json
        self.assertIsNotNone(item['stops'][1]['arrival_at'])
        item = self.post(f"/{item['id']}/stops/{sid}", dict(action='check_out', version=item['version'], notes='Inspection complete')).json
        self.assertIsNotNone(item['stops'][1]['departure_at'])
        item = self.act(item, 'finish').json
        self.assertEqual(item['status'], 'completed')
        rows = self.client.get('/api/journeys/stations?visit_status=visited').json
        self.assertEqual([r['id'] for r in rows], [2])

    def test_ownership_assignment_and_stale_version(self):
        item = self.create()
        self.login('bob')
        self.assertEqual(self.client.get(f"/api/journeys/{item['id']}").status_code, 404)
        self.assertEqual(self.act(item, 'start').status_code, 404)
        bob = self.create()
        self.assertEqual(len(self.client.get('/api/journeys').json['items']), 1)
        self.login('alice')
        self.assertEqual(self.client.get(f"/api/journeys/{bob['id']}").status_code, 404)
        self.assertEqual(self.post('', dict(specification=self.spec, status='draft', assigned_user_id=2)).status_code, 403)
        old = copy.deepcopy(item)
        self.act(item, 'start')
        self.assertEqual(self.act(old, 'start').status_code, 409)
        self.login('admin')
        assigned = self.post('', dict(specification=self.spec, status='planned', assigned_user_id=4)).json
        self.login('viewer')
        self.assertEqual(self.post('', dict(specification=self.spec, status='draft')).status_code, 403)
        self.assertEqual(self.act(assigned, 'start').status_code, 200)

    def test_outage_and_working_hours(self):
        with patch.object(self.app.extensions['osrm'], 'route', side_effect=RoutingError('No road route.', 422)):
            self.assertEqual(self.post('/route', dict(origin=self.spec['start'], station_id=1)).status_code, 422)
        with patch.object(self.app.extensions['osrm'], 'route', side_effect=RoutingError('Timeout', 504)):
            self.assertEqual(self.post('/preview', self.spec).status_code, 504)
            self.create('draft')
        self.spec['working_end'] = '08:15'
        plan = self.post('/preview', self.spec).json['plan']
        self.assertFalse(plan['feasible'])
        self.assertEqual(self.post('', dict(specification=self.spec, status='planned')).status_code, 400)

    def test_generator_reports_exclusions_and_keeps_required(self):
        payload = {**self.spec, 'working_end': '09:00', 'max_stops': 2, 'visit_minutes': 30,
                   'filters': {'territory': 'Mukono'}, 'stops': [dict(station_id=2, visit_minutes=30, required=True)]}
        response = self.post('/generate', payload)
        self.assertEqual(response.status_code, 200, response.json)
        self.assertIn(2, [s['station_id'] for s in response.json['plan']['stops']])
        self.assertTrue(response.json['excluded'])
        self.assertIn('unavailable', response.json['data_notice'])


class OSRMTests(unittest.TestCase):
    def setUp(self):
        self.config = dict(OSRM_BASE_URL='https://routing.example.com', OSRM_CONNECT_TIMEOUT=2,
                           OSRM_READ_TIMEOUT=4, OSRM_CACHE_SECONDS=30, ROUTING_REQUESTS_PER_MINUTE=2)
        self.osrm = OSRM(self.config)
        self.points = [dict(latitude=.3, longitude=32.5), dict(latitude=.4, longitude=32.6)]

    @patch('app.services.osrm.http.client.HTTPSConnection')
    def test_coordinates_cache_and_no_redirects(self, connection):
        conn = connection.return_value
        response = conn.getresponse.return_value
        response.status = 200
        response.read.return_value = json.dumps(dict(code='Ok', routes=[FakeOSRM().route(self.points)])).encode()
        self.osrm.route(self.points)
        self.osrm.route(self.points)
        self.assertEqual(conn.request.call_count, 1)
        self.assertIn('32.500000,0.300000;32.600000,0.400000', conn.request.call_args.args[1])
        self.osrm.cache.clear()
        response.status = 302
        with self.assertRaises(RoutingError):
            self.osrm.route(self.points)

    @patch('app.services.osrm.http.client.HTTPSConnection')
    def test_timeout_no_route_and_malformed(self, connection):
        connection.return_value.connect.side_effect = TimeoutError()
        with self.assertRaises(RoutingError) as error:
            self.osrm.route(self.points)
        self.assertEqual(error.exception.status, 504)
        connection.return_value.connect.side_effect = None
        response = connection.return_value.getresponse.return_value
        response.status = 400
        for code in ('NoRoute', 'NoTrips', 'NoSegment', 'NoTable'):
            response.read.return_value = json.dumps(dict(code=code)).encode()
            with self.assertRaises(RoutingError) as error:
                self.osrm.route(self.points)
            self.assertEqual(error.exception.status, 422)
        response.status = 200
        response.read.return_value = b'not JSON'
        with self.assertRaises(RoutingError):
            self.osrm.route(self.points)

    def test_throttle_thread_safety_and_configuration(self):
        def call(_):
            try:
                self.osrm.throttle(1)
                return True
            except RoutingError:
                return False
        with ThreadPoolExecutor(max_workers=20) as pool:
            self.assertEqual(sum(pool.map(call, range(20))), 2)
        self.config['OSRM_BASE_URL'] = ''
        with self.assertRaises(RoutingError):
            self.osrm.route(self.points)
