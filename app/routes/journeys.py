"""Authenticated journey APIs. Mutations require a session-bound CSRF token."""
import hmac
import secrets
from datetime import date, datetime
from functools import wraps
from flask import Blueprint, current_app, jsonify, request, session, abort
from flask_login import current_user
from sqlalchemy import or_
from sqlalchemy.orm.exc import StaleDataError
from app import db
from app.models import Station, User
from app.journey_models import Journey, JourneyStop, JourneyBase, utcnow
from app.services.osrm import RoutingError, coordinate
from app.services.journeys import normalize_spec, plan_journey, candidates, generate, integer, text

bp = Blueprint('journeys', __name__, url_prefix='/api/journeys')


@bp.after_request
def private_response(response):
    response.headers['Cache-Control'] = 'no-store'
    return response


@bp.before_request
def protect():
    if not current_user.is_authenticated:
        abort(401, description='Please sign in again.')
    if request.method != 'GET':
        token = session.get('journey_csrf', '')
        if not token or not hmac.compare_digest(token, request.headers.get('X-RDM-CSRF', '')):
            abort(403, description='Session verification failed. Refresh the page.')


@bp.errorhandler(ValueError)
def invalid(error):
    db.session.rollback()
    return jsonify(error=str(error)), 400


@bp.errorhandler(RoutingError)
def routing_error(error):
    db.session.rollback()
    current_app.logger.warning('Routing request failed (status %s)', error.status)
    return jsonify(error=str(error)), error.status


@bp.errorhandler(StaleDataError)
def stale(error):
    db.session.rollback()
    return jsonify(error='This journey changed in another session. Reopen it before continuing.'), 409


def body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ValueError('A JSON object is required.')
    return data


def engine():
    osrm = current_app.extensions['osrm']
    osrm.throttle(current_user.id)
    return osrm


def manager():
    if current_user.role not in ('admin', 'analyst'):
        abort(403, description='An analyst or administrator role is required to plan journeys.')


def visible():
    query = Journey.query
    if current_user.role != 'admin':
        query = query.filter(or_(Journey.creator_id == current_user.id, Journey.assigned_user_id == current_user.id))
    return query


def journey(jid, editing=False):
    item = visible().filter_by(id=jid).first_or_404()
    if editing and current_user.role != 'admin' and item.creator_id != current_user.id:
        abort(403, description='Only the creator or an administrator can change this plan.')
    return item


def version(item, data):
    if data.get('version') != item.version:
        abort(409, description='This journey has changed. Reopen it before continuing.')


def apply_plan(item, data):
    spec = normalize_spec(data.get('specification', {}))
    status = data.get('status', 'draft')
    if status not in ('draft', 'planned'):
        raise ValueError('Save a journey as draft or planned.')
    assigned = integer(data.get('assigned_user_id', current_user.id), 1, 2147483647, 'Assigned user')
    if assigned != current_user.id and current_user.role != 'admin':
        abort(403, description='Only an administrator can assign a journey to another user.')
    if db.session.get(User, assigned) is None:
        raise ValueError('Assigned user does not exist.')
    plan = plan_journey(spec, engine()) if status == 'planned' else None
    if plan and not plan['feasible']:
        raise ValueError('Visits exceed working hours. Adjust the plan before saving as planned; you can save a draft.')
    if plan:
        spec['stops'] = [{k: s[k] for k in ('station_id', 'visit_minutes', 'required', 'priority')} for s in plan['stops']]
    item.name, item.journey_date = spec['name'], date.fromisoformat(spec['journey_date'])
    item.assigned_user_id, item.specification, item.plan = assigned, spec, plan
    item.status, item.paused = status, False
    # Flush deletions first to avoid colliding with the unique sequence constraint.
    item.stops.clear()
    if item.id:
        db.session.flush()
    for index, stop in enumerate(spec['stops']):
        arrival = datetime.fromisoformat(plan['stops'][index]['planned_arrival']) if plan else None
        item.stops.append(JourneyStop(station_id=stop['station_id'], sequence=index+1,
                                      visit_minutes=stop['visit_minutes'], planned_arrival=arrival))


@bp.get('/config')
def configuration():
    if 'journey_csrf' not in session:
        session['journey_csrf'] = secrets.token_urlsafe(32)
    return jsonify(csrf_token=session['journey_csrf'], routing_configured=bool(current_app.config['OSRM_BASE_URL']),
                   arrival_meters=current_app.config['NAV_ARRIVAL_METERS'],
                   deviation_meters=current_app.config['NAV_DEVIATION_METERS'],
                   max_accuracy_meters=current_app.config['NAV_MAX_ACCURACY_METERS'],
                   max_stops=current_app.config['JOURNEY_MAX_STOPS'], user_id=current_user.id,
                   can_plan=current_user.role in ('admin', 'analyst'), can_assign=current_user.role == 'admin')


@bp.get('/users')
def users():
    rows = User.query.order_by(User.username).all() if current_user.role == 'admin' else [current_user]
    return jsonify([dict(id=u.id, username=u.username) for u in rows])


@bp.get('/stations')
def stations():
    return jsonify(candidates(request.args))


@bp.route('/base', methods=['GET', 'PUT'])
def base():
    row = JourneyBase.query.filter_by(user_id=current_user.id).first()
    if request.method == 'PUT':
        data = body()
        point = coordinate(data)
        if row is None:
            row = JourneyBase(user_id=current_user.id)
            db.session.add(row)
        row.name = text(data.get('name'), 100, 'Base name')
        row.latitude, row.longitude = point['latitude'], point['longitude']
        db.session.commit()
    return jsonify(dict(name=row.name, latitude=row.latitude, longitude=row.longitude) if row else None)


@bp.post('/route')
def route():
    data = body()
    origin = coordinate(data.get('origin'))
    if data.get('station_id') is None and data.get('destination') is not None:
        destination = coordinate(data['destination'])
        return jsonify(route=engine().route([origin, destination]),
                       destination=dict(name='Journey ending point', **destination))
    station = db.session.get(Station, integer(data.get('station_id'), 1, 2147483647, 'Station ID'))
    if station is None:
        abort(404)
    destination = coordinate(dict(latitude=station.latitude, longitude=station.longitude))
    return jsonify(route=engine().route([origin, destination]), destination=dict(id=station.id, name=station.name, **destination))


@bp.post('/preview')
def preview():
    spec = normalize_spec(body())
    return jsonify(specification=spec, plan=plan_journey(spec, engine()))


@bp.post('/generate')
def generate_journey():
    manager()
    return jsonify(generate(body(), engine()))


@bp.route('', methods=['GET', 'POST'])
def collection():
    if request.method == 'GET':
        page = request.args.get('page', 1, type=int)
        page = max(1, min(page, 10000))
        query = visible()
        if request.args.get('status'):
            query = query.filter_by(status=request.args['status'])
        rows = query.order_by(Journey.journey_date.desc(), Journey.id.desc()).offset((page-1)*30).limit(31).all()
        return jsonify(items=[dict(id=j.id, name=j.name, journey_date=j.journey_date.isoformat(),
                                   assigned_user=j.assigned_user.username, status=j.status,
                                   paused=j.paused, stop_count=len(j.stops)) for j in rows[:30]],
                       page=page, has_more=len(rows)>30)
    manager()
    item = Journey(creator_id=current_user.id)
    apply_plan(item, body())
    db.session.add(item)
    db.session.commit()
    return jsonify(item.to_dict()), 201


@bp.route('/<int:jid>', methods=['GET', 'PUT'])
def detail(jid):
    item = journey(jid, editing=request.method == 'PUT')
    if request.method == 'PUT':
        manager()
        data = body()
        version(item, data)
        if item.status not in ('draft', 'planned'):
            abort(409, description='Only drafts and planned journeys can be edited.')
        apply_plan(item, data)
        db.session.commit()
    return jsonify(item.to_dict())


@bp.post('/<int:jid>/duplicate')
def duplicate(jid):
    manager()
    original = journey(jid)
    item = Journey(creator_id=current_user.id)
    spec = {**original.specification, 'name': (original.name[:150] + ' (copy)')}
    apply_plan(item, dict(specification=spec, assigned_user_id=current_user.id, status='draft'))
    db.session.add(item)
    db.session.commit()
    return jsonify(item.to_dict()), 201


@bp.post('/<int:jid>/action')
def action(jid):
    item = journey(jid)
    data = body()
    version(item, data)
    action = data.get('action')
    if action == 'start' and item.status == 'planned':
        item.status = 'in_progress'
    elif action == 'pause' and item.status == 'in_progress' and not item.paused:
        item.paused = True
    elif action == 'resume' and item.status == 'in_progress' and item.paused:
        item.paused = False
    elif action == 'finish' and item.status == 'in_progress':
        if any(s.status in ('pending', 'arrived') for s in item.stops):
            abort(409, description='Complete or skip the remaining visits before finishing.')
        item.status, item.paused = 'completed', False
    elif action == 'cancel' and item.status in ('draft', 'planned', 'in_progress'):
        if any(s.status == 'arrived' for s in item.stops):
            abort(409, description='Check out of the current visit before cancelling.')
        item.status, item.paused = 'cancelled', False
    else:
        abort(409, description='That action is not available for this journey status.')
    db.session.commit()
    return jsonify(item.to_dict())


@bp.post('/<int:jid>/stops/<int:sid>')
def visit(jid, sid):
    item = journey(jid)
    data = body()
    version(item, data)
    if item.status != 'in_progress' or item.paused:
        abort(409, description='Resume an active journey before recording a visit.')
    pending = next((s for s in item.stops if s.status in ('pending', 'arrived')), None)
    if pending is None or pending.id != sid:
        abort(409, description='Record the next pending visit in sequence.')
    notes = data.get('notes', '')
    if not isinstance(notes, str) or len(notes) > 5000:
        raise ValueError('Visit notes must be at most 5000 characters.')
    if data.get('action') == 'check_in' and pending.status == 'pending':
        pending.arrival_at, pending.status = utcnow(), 'arrived'
    elif data.get('action') == 'check_out' and pending.status == 'arrived':
        pending.departure_at, pending.status = utcnow(), 'completed'
    elif data.get('action') == 'skip' and pending.status == 'pending':
        pending.status = 'skipped'
    else:
        abort(409, description='That visit action is not available.')
    pending.notes = notes
    item.updated_at = utcnow()  # advances journey version for concurrent visit updates
    db.session.commit()
    return jsonify(item.to_dict())
