from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from flask import current_app
from sqlalchemy import func
from app import db
from app.models import Station
from app.journey_models import JourneyStop, timestamp
from app.services.osrm import coordinate, RoutingError

ZONE = ZoneInfo('Africa/Kampala')


def integer(value, minimum, maximum, label):
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError(f'{label} must be an integer between {minimum} and {maximum}.')
    return value


def text(value, limit, label):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
        raise ValueError(f'{label} is required (maximum {limit} characters).')
    return value.strip()


def normalize_spec(data):
    if not isinstance(data, dict):
        raise ValueError('A journey object is required.')
    raw = data.get('stops')
    if not isinstance(raw, list) or not 1 <= len(raw) <= current_app.config['JOURNEY_MAX_STOPS']:
        raise ValueError('Choose between 1 and 20 stops.')
    stops, seen = [], set()
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError('Each stop needs a station ID and visit duration.')
        sid = integer(item.get('station_id'), 1, 2147483647, 'Station ID')
        if sid in seen:
            raise ValueError('A station can only appear once in a journey.')
        station = db.session.get(Station, sid)
        if station is None:
            raise ValueError(f'Station {sid} no longer exists.')
        coordinate({'latitude': station.latitude, 'longitude': station.longitude})
        seen.add(sid)
        priority = integer(item.get('priority', 0), 0, 3, 'Planning priority')
        required = item.get('required', True)
        if not isinstance(required, bool):
            raise ValueError('Required stop must be true or false.')
        stops.append(dict(station_id=sid, visit_minutes=integer(item.get('visit_minutes', 30), 1, 480, 'Visit minutes'),
                          required=required, priority=priority))
    try:
        day = date.fromisoformat(data.get('journey_date', ''))
        depart = datetime.strptime(data.get('departure_time', '08:00'), '%H:%M').time()
        finish = datetime.strptime(data.get('working_end', '17:00'), '%H:%M').time()
    except (ValueError, TypeError):
        raise ValueError('Use a valid date and departure/end times (HH:MM).') from None
    if finish <= depart:
        raise ValueError('Working end must be later than departure on the same day.')
    start = coordinate(data.get('start'))
    end = coordinate(data['end']) if data.get('end') is not None else None
    for key in ('return_to_start', 'optimize'):
        if not isinstance(data.get(key, False), bool):
            raise ValueError(f'{key} must be true or false.')
    if data.get('return_to_start') and end:
        raise ValueError('Choose either a separate ending point or return to start.')
    return dict(name=text(data.get('name', 'New journey'), 160, 'Journey name'), journey_date=day.isoformat(),
                departure_time=depart.strftime('%H:%M'), working_end=finish.strftime('%H:%M'),
                start=start, end=end, return_to_start=data.get('return_to_start', False),
                optimize=data.get('optimize', False), stops=stops)


def station_point(sid):
    station = db.session.get(Station, sid)
    return coordinate(dict(latitude=station.latitude, longitude=station.longitude))


def plan_journey(spec, osrm):
    stops = list(spec['stops'])
    points = [spec['start']] + [station_point(s['station_id']) for s in stops]
    end = spec['start'] if spec['return_to_start'] else spec['end']
    method = 'Fixed visiting order'
    if spec['optimize'] and len(stops) > 1:
        if spec['return_to_start'] or end:
            trip_points = points if spec['return_to_start'] else points + [end]
            order = osrm.trip_order(trip_points, spec['return_to_start'])
            stops = [stops[i - 1] for i in order if 0 < i <= len(stops)]
            method = 'OSRM Trip heuristic; global optimality is not guaranteed'
        else:
            # Trip has constrained open-end support. A Table-based greedy order leaves the last stop free.
            matrix = osrm.table(points)['durations']
            remaining, order, previous = set(range(1, len(points))), [], 0
            while remaining:
                reachable = [i for i in remaining if matrix[previous][i] is not None]
                if not reachable:
                    raise RoutingError('Some stops are unreachable by road.', 422)
                nxt = min(reachable, key=lambda i: (matrix[previous][i], i))
                order.append(nxt)
                remaining.remove(nxt)
                previous = nxt
            stops = [stops[i-1] for i in order]
            method = 'Road-time greedy heuristic; global optimality is not guaranteed'
    points = [spec['start']] + [station_point(s['station_id']) for s in stops] + ([end] if end else [])
    route = osrm.route(points)
    clock = datetime.fromisoformat(spec['journey_date'] + 'T' + spec['departure_time']).replace(tzinfo=ZONE)
    departure = clock
    arrivals = []
    for index, stop in enumerate(stops):
        clock += timedelta(seconds=route['legs'][index]['duration'])
        station = db.session.get(Station, stop['station_id'])
        arrivals.append(dict(**stop, name=station.name, sequence=index+1, planned_arrival=clock.isoformat()))
        clock += timedelta(minutes=stop['visit_minutes'])
    if end:
        clock += timedelta(seconds=route['legs'][-1]['duration'])
    deadline = datetime.fromisoformat(spec['journey_date'] + 'T' + spec['working_end']).replace(tzinfo=ZONE)
    overrun = max(0, (clock-deadline).total_seconds())
    return dict(route=route, stops=arrivals, departure=departure.isoformat(), completion=clock.isoformat(),
                driving_seconds=route['duration'], distance_meters=route['distance'],
                visit_seconds=sum(s['visit_minutes']*60 for s in stops),
                total_seconds=(clock-departure).total_seconds(), overrun_seconds=overrun,
                feasible=overrun == 0, method=method,
                warning='Driving and arrival times are estimates from road data; traffic and delays are not included.')


def candidates(filters):
    if not hasattr(filters, 'get'):
        raise ValueError('Station filters must be an object.')
    query = Station.query
    for key, column in [('territory', Station.region), ('district', None), ('category', Station.category)]:
        value = filters.get(key, '')
        if not isinstance(value, str) or len(value) > 128:
            raise ValueError('Invalid station filter.')
        if value and column is not None:
            query = query.filter(column == value)
        elif value and key == 'district':
            from app.models import District
            query = query.join(Station.district).filter(District.name == value)
    search = filters.get('search', '')
    if not isinstance(search, str) or len(search) > 128:
        raise ValueError('Invalid station search.')
    if search:
        query = query.filter(Station.name.ilike('%' + search + '%'))
    rows = query.order_by(Station.name, Station.id).limit(600).all()
    # Real visit history is built only from recorded check-outs in this module.
    history = dict(db.session.query(JourneyStop.station_id, func.max(JourneyStop.departure_at))
                   .filter(JourneyStop.status == 'completed').group_by(JourneyStop.station_id).all())
    result = []
    for row in rows:
        last = history.get(row.id)
        status = 'visited' if last else 'no_recorded_visit'
        if filters.get('visit_status') and filters['visit_status'] != status:
            continue
        try:
            coordinate(dict(latitude=row.latitude, longitude=row.longitude))
            valid = True
        except ValueError:
            valid = False
        result.append(dict(**row.to_dict(), last_visit=timestamp(last),
                           visit_status=status, priority=None, outstanding_tasks=None, routable=valid))
    return result


def generate(data, osrm):
    """Structured selection; Table bounds scheduling, Route validates the final schedule."""
    maximum = integer(data.get('max_stops', 8), 1, 20, 'Maximum stops')
    duration = integer(data.get('visit_minutes', 30), 1, 480, 'Visit minutes')
    supplied = data.get('stops', [])
    if not isinstance(supplied, list):
        raise ValueError('Stops must be a list.')
    for stop in supplied:
        if not isinstance(stop, dict):
            raise ValueError('Each stop must be an object.')
        integer(stop.get('station_id'), 1, 2147483647, 'Station ID')
        integer(stop.get('priority', 0), 0, 3, 'Planning priority')
    required = [s for s in supplied if isinstance(s, dict) and s.get('required', True)]
    rows = candidates(data.get('filters', {}))
    overrides = {s.get('station_id'): s for s in supplied if isinstance(s, dict)}
    rows.sort(key=lambda s: (-overrides.get(s['id'], {}).get('priority', 0), s['last_visit'] or '', s['id']))
    required_ids = {s.get('station_id') for s in required}
    if len(required) > maximum:
        raise ValueError('Required stops exceed the maximum number of stops.')
    options, excluded = [], []
    for row in rows:
        if row['id'] in required_ids:
            continue
        if not row['routable']:
            excluded.append(dict(station_id=row['id'], name=row['name'], reason='Invalid coordinates'))
        elif len(options) < 20 - len(required):
            options.append(dict(station_id=row['id'], visit_minutes=duration, required=False,
                                priority=overrides.get(row['id'], {}).get('priority', 0)))
        else:
            excluded.append(dict(station_id=row['id'], name=row['name'], reason='Candidate limit (20)'))
    all_stops = required + options
    if not all_stops:
        raise ValueError('No stations match these filters.')
    spec = normalize_spec({**data, 'stops': all_stops, 'optimize': False})
    all_stops = spec['stops']
    pts = [spec['start']] + [station_point(s['station_id']) for s in all_stops]
    end = spec['start'] if spec['return_to_start'] else spec['end']
    if end:
        pts.append(end)
    matrix = osrm.table(pts)['durations']
    budget = (datetime.strptime(spec['working_end'], '%H:%M')-datetime.strptime(spec['departure_time'], '%H:%M')).total_seconds()
    remaining = list(range(1, len(all_stops)+1))
    selected, previous, elapsed = [], 0, 0
    while remaining:
        mandatory = [i for i in remaining if all_stops[i-1]['required']]
        pool = mandatory or remaining
        reachable = [i for i in pool if matrix[previous][i] is not None and (not end or matrix[i][-1] is not None)]
        if not reachable:
            if mandatory:
                raise RoutingError('A required stop is unreachable by road.', 422)
            for i in remaining:
                excluded.append(dict(station_id=all_stops[i-1]['station_id'], reason='No connecting road route'))
            break
        nxt = min(reachable, key=lambda i: (-all_stops[i-1]['priority'], matrix[previous][i], i))
        remaining.remove(nxt)
        stop = all_stops[nxt-1]
        travel = matrix[previous][nxt]
        total = elapsed + travel + stop['visit_minutes']*60 + (matrix[nxt][-1] if end else 0)
        if len(selected) >= maximum or (total > budget and not stop['required']):
            excluded.append(dict(station_id=stop['station_id'], reason='Working hours or stop limit'))
            continue
        selected.append(stop)
        elapsed += travel + stop['visit_minutes']*60
        previous = nxt
    if not selected:
        raise ValueError('No visits fit these working hours. Adjust your start, hours, or visit duration.')
    spec['stops'] = selected
    plan = plan_journey(spec, osrm)
    # The matrix is a scheduling aid; validate using the final road route. If the
    # route is slower, remove optional visits before reporting required overrun.
    for attempt in range(2):
        if plan['feasible']:
            break
        optional = [s for s in reversed(spec['stops']) if not s['required']]
        if not optional:
            break
        remove = []
        recovered = 0
        for stop in optional:
            remove.append(stop['station_id'])
            recovered += stop['visit_minutes'] * 60
            if attempt == 0 and recovered >= plan['overrun_seconds']:
                break
        for sid in remove:
            excluded.append(dict(station_id=sid, reason='Final road schedule exceeds working hours'))
        spec['stops'] = [s for s in spec['stops'] if s['station_id'] not in remove]
        if not spec['stops']:
            raise ValueError('No visits fit the final road schedule. Increase working hours or reduce visit time.')
        plan = plan_journey(spec, osrm)
    plan['method'] = 'Priority and road-time scheduling heuristic; review before saving'
    return dict(specification=spec, plan=plan, excluded=excluded,
                data_notice='Priorities are manual planning inputs. No recorded visit does not mean never visited. Task data is unavailable.')
