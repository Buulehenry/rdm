"""Read-only production checks; run inside web with Python stdin from /app."""
from datetime import date
from app.models import User, Station
from deploy.wsgi import app

points = [dict(latitude=.3476, longitude=32.5825), dict(latitude=.3547, longitude=32.6138),
          dict(latitude=.3372, longitude=32.6060)]
with app.app_context():
    admin = User.query.filter_by(role='admin').first()
    assert admin is not None
    admin_id = admin.id
    expected_stops = [Station.query.filter_by(name=name).one().id for name in
                      ('Rubis Seeta Fuel Station', 'Rubis Jinja 1 Fuel Station', 'Rubis Bugiri Fuel Station')]
    print('Stations:', Station.query.count())
    print('Users:', ', '.join(f'{u.username} ({u.role})' for u in User.query.order_by(User.id)))
    engine = app.extensions['osrm']
    route = engine.route(points[:2])
    assert route['distance'] > 0 and len(route['geometry']['coordinates']) > 2
    assert engine.table(points)['durations'][0][1] > 0
    assert sorted(engine.trip_order(points, True)) == [0, 1, 2]
    fixed_end = engine.trip_order(points, False)
    assert fixed_end[0] == 0 and fixed_end[-1] == 2
    print('Private OSRM Route, Table, round-trip and fixed-end Trip: passed')
client = app.test_client()
assert client.get('/api/journeys/config').status_code == 401
with client.session_transaction() as session:
    session['_user_id'] = str(admin_id)
    session['_fresh'] = True
config = client.get('/api/journeys/config', base_url='https://localhost').get_json()
headers = {'X-RDM-CSRF': config['csrf_token']}
response = client.post('/api/journeys/route', json={'origin': points[0], 'destination': points[1]}, headers=headers, base_url='https://localhost')
assert response.status_code == 200, response.get_json()
assert response.get_json()['route']['distance'] > 0
spec = dict(name='Read-only deployment check', journey_date=date.today().isoformat(),
            start=points[0], departure_time='08:00', working_end='20:00', optimize=True,
            stops=[dict(station_id=sid, visit_minutes=15) for sid in expected_stops])
response = client.post('/api/journeys/preview', json=spec, headers=headers, base_url='https://localhost')
assert response.status_code == 200, response.get_json()
plan = response.get_json()['plan']
assert [s['station_id'] for s in plan['stops']] == expected_stops, [s['station_id'] for s in plan['stops']]
print('Journey preview: Seeta -> Jinja -> Bugiri')
with app.app_context():
    from app import db
    bugiri = db.session.get(Station, expected_stops[-1])
    assert abs(bugiri.latitude - .5728563578377932) < 1e-8
    assert abs(bugiri.longitude - 33.745726880470166) < 1e-8
print('Authenticated routing API, anonymous protection and Bugiri correction: passed')
