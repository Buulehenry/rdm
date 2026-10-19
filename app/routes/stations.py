import csv, io
from datetime import datetime
from sqlalchemy import func
from flask import Blueprint, request, jsonify, abort
from flask_login import login_required, current_user
from app import db
from app.models import (
    Station,
    Competitor,
    District,
    STATION_CATEGORIES,
    PIN_SHAPES,
    HEX_COLOR_RE,
)

bp = Blueprint("stations", __name__, url_prefix="/api/stations")


# --- RBAC helper (fixed) ---
def roles_required(*roles):
    from functools import wraps

    def deco(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            if not current_user.is_authenticated:
                abort(401)
            if current_user.role not in roles:
                abort(403)
            return fn(*a, **kw)

        return wrapper

    return deco


# --- CSV TEMPLATE ---
@bp.route("/template.csv", methods=["GET"])
@login_required
@roles_required("admin", "analyst")
def stations_template_csv():
    """
    Download a sample CSV for bulk upload.
    Columns: id(optional),name,latitude,longitude,category,pin_shape,pin_color,competitor_id,competitor_name,region,district
    """
    from flask import Response

    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(
        [
            "id",
            "name",
            "latitude",
            "longitude",
            "category",
            "pin_shape",
            "pin_color",
            "competitor_id",
            "competitor_name",
            "region",
            "district",
        ]
    )
    w.writerow(
        [
            "",
            "Rubis Bukoto",
            "0.3514",
            "32.6022",
            "rubis",
            "rubis_pin",
            "#2E7D32",
            "",
            "",
            "Kampala Central",
            "Kampala",
        ]
    )
    w.writerow(
        [
            "",
            "Shell Ntinda",
            "0.3581",
            "32.6069",
            "competitor",
            "shell_pin",
            "#cc3333",
            "",
            "Shell",
            "Kampala Central",
            "Kampala",
        ]
    )
    w.writerow(
        [
            "",
            "Target Hoima",
            "1.4356",
            "31.3432",
            "target",
            "circle",
            "#ff9900",
            "",
            "",
            "Western",
            "Hoima",
        ]
    )
    csv_bytes = out.getvalue()
    headers = {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="stations_template.csv"',
    }
    return Response(csv_bytes, headers=headers)


# --- BULK UPLOAD ---
@bp.route("/bulk_upload", methods=["POST"])
@login_required
@roles_required("admin", "analyst")
def stations_bulk_upload():
    """
    Bulk create/update stations from CSV.
    Accepts multipart/form-data with field 'file' (or raw CSV in body).
    Optional form/query flags:
      - update_existing=1 (default 1): if a row has 'id', update that station
      - atomic=1 (default 0): all-or-nothing; rollback if any error
      - dry_run=1 (default 0): validate only, no commit
      - auto_create_competitor=1 (default 0): create competitor by competitor_name if missing
    CSV headers (case-insens ok):
      id, name, latitude, longitude, category, pin_shape, pin_color,
      competitor_id, competitor_name, region, district
    """
    update_existing = (request.form.get("update_existing", "1") == "1") or (
        request.args.get("update_existing") == "1"
    )
    atomic = (request.form.get("atomic", "0") == "1") or (
        request.args.get("atomic") == "1"
    )
    dry_run = (request.form.get("dry_run", "0") == "1") or (
        request.args.get("dry_run") == "1"
    )
    auto_create_comp = (request.form.get("auto_create_competitor", "0") == "1") or (
        request.args.get("auto_create_competitor") == "1"
    )

    file = request.files.get("file")
    if file:
        content = file.read().decode("utf-8", errors="ignore")
    else:
        content = request.get_data(as_text=True) or ""
        if not content:
            abort(400, description="No CSV provided")

    rdr = csv.DictReader(io.StringIO(content))
    if not rdr.fieldnames:
        abort(400, description="CSV missing header row")
    hdrs = [h.strip().lower() for h in rdr.fieldnames]

    required = {"name", "latitude", "longitude"}
    if not required.issubset(set(hdrs)):
        abort(
            400, description=f"CSV must include headers: {', '.join(sorted(required))}"
        )

    def _get(d, *keys, default=None):
        for k in keys:
            if k in d:
                return (d[k] or "").strip()
            kl = k.lower()
            if kl in d:
                return (d[kl] or "").strip()
        return (default or "").strip() if default is not None else ""

    rows = inserted = updated = 0
    errors = []

    # Use nested tx for atomic or dry-run
    if atomic or dry_run:
        db.session.begin_nested()

    try:
        for raw in rdr:
            rows += 1
            rownum = rows + 1

            sid = _get(raw, "id")
            name = _get(raw, "name")
            lat_s = _get(raw, "latitude")
            lng_s = _get(raw, "longitude")
            cat = _get(raw, "category", default="rubis").lower()
            pin_shape = _get(raw, "pin_shape", default="marker")
            pin_color = _get(raw, "pin_color", default="#2E7D32")
            competitor_id_s = _get(raw, "competitor_id")
            competitor_name = _get(raw, "competitor_name")
            region = _get(raw, "region")
            district_name = _get(raw, "district")

            if not name:
                errors.append(f"Row {rownum}: name is required")
                if not atomic:
                    continue

            try:
                lat = float(lat_s)
                lng = float(lng_s)
            except Exception:
                errors.append(f"Row {rownum}: invalid latitude/longitude")
                if not atomic:
                    continue
                else:
                    raise

            if not (-90 <= lat <= 90 and -180 <= lng <= 180):
                errors.append(f"Row {rownum}: coordinates out of range")
                if not atomic:
                    continue

            if cat and cat not in STATION_CATEGORIES:
                errors.append(f"Row {rownum}: invalid category '{cat}'")
                if not atomic:
                    continue

            if pin_shape and pin_shape not in PIN_SHAPES:
                errors.append(f"Row {rownum}: invalid pin_shape '{pin_shape}'")
                if not atomic:
                    continue

            if pin_color and not HEX_COLOR_RE.match(pin_color):
                errors.append(f"Row {rownum}: invalid pin_color '{pin_color}'")
                if not atomic:
                    continue

            comp_obj = None
            comp_id = None
            if cat == "competitor":
                if competitor_id_s:
                    try:
                        comp_id = int(competitor_id_s)
                    except ValueError:
                        errors.append(f"Row {rownum}: competitor_id must be integer")
                        if not atomic:
                            continue
                    comp_obj = Competitor.query.get(comp_id)
                    if not comp_obj:
                        errors.append(
                            f"Row {rownum}: competitor_id {comp_id} not found"
                        )
                        if not atomic:
                            continue
                elif competitor_name:
                    comp_obj = Competitor.query.filter(
                        func.lower(Competitor.name) == competitor_name.lower()
                    ).first()
                    if not comp_obj:
                        if auto_create_comp:
                            comp_obj = Competitor(
                                name=competitor_name, pin_color="#cc3333"
                            )
                            db.session.add(comp_obj)
                            db.session.flush()
                        else:
                            errors.append(
                                f"Row {rownum}: competitor_name '{competitor_name}' not found"
                            )
                            if not atomic:
                                continue
                    comp_id = comp_obj.id
                else:
                    errors.append(
                        "Row {rownum}: competitor station requires competitor_id or competitor_name"
                    )
                    if not atomic:
                        continue

            # district mapping
            dist_obj = None
            if district_name:
                dist_obj = District.query.filter(
                    func.lower(District.name) == district_name.lower()
                ).first()
                if not dist_obj:
                    errors.append(f"Row {rownum}: district '{district_name}' not found")
                    if not atomic:
                        continue

            st = None
            if sid and update_existing:
                try:
                    sid_i = int(sid)
                except ValueError:
                    errors.append(f"Row {rownum}: id must be integer")
                    if not atomic:
                        continue
                st = Station.query.get(sid_i)
                if not st:
                    errors.append(
                        f"Row {rownum}: station id {sid_i} not found for update"
                    )
                    if not atomic:
                        continue

            if not st:
                st = Station(
                    name=name,
                    latitude=lat,
                    longitude=lng,
                    category=cat or "rubis",
                    pin_shape=pin_shape or "marker",
                    pin_color=pin_color or "#2E7D32",
                    competitor_id=comp_id,
                )
                if dist_obj:
                    st.district = dist_obj
                    st.region = dist_obj.region
                else:
                    st.region = region or None
                db.session.add(st)
                if not dry_run:
                    db.session.flush()
                inserted += 1
            else:
                st.name = name
                st.latitude = lat
                st.longitude = lng
                if cat:
                    st.category = cat
                if pin_shape:
                    st.pin_shape = pin_shape
                if pin_color:
                    st.pin_color = pin_color
                st.competitor_id = comp_id if cat == "competitor" else None
                if dist_obj:
                    st.district = dist_obj
                    st.region = dist_obj.region
                else:
                    st.region = region or st.region
                updated += 1

        if dry_run:
            db.session.rollback()
            return jsonify(
                {
                    "rows": rows,
                    "inserted": inserted,
                    "updated": updated,
                    "errors": errors,
                    "dry_run": True,
                }
            )

        if errors and atomic:
            db.session.rollback()
            return (
                jsonify(
                    {
                        "rows": rows,
                        "inserted": 0,
                        "updated": 0,
                        "errors": errors,
                        "atomic": True,
                    }
                ),
                400,
            )

        db.session.commit()
        return jsonify(
            {"rows": rows, "inserted": inserted, "updated": updated, "errors": errors}
        )

    except Exception as ex:
        db.session.rollback()
        abort(400, description=f"Bulk upload failed: {ex}")


# --- LIST with filters ---
@bp.route("/", methods=["GET"])
@login_required
def list_stations():
    """
    Return stations as GeoJSON FeatureCollection.
    Optional filters:
      ?region=<name>
      ?district=<name>       (matches District.name)
      ?category=rubis|competitor|target
      ?competitor_id=<id>
    """
    q = Station.query

    region = (request.args.get("region") or "").strip()
    district = (request.args.get("district") or "").strip()
    category = (request.args.get("category") or "").strip()
    competitor_id = request.args.get("competitor_id")

    if region:
        q = q.filter(Station.region == region)

    if district:
        q = q.join(District, isouter=True).filter(
            func.lower(District.name) == district.lower()
        )

    if category:
        if category not in STATION_CATEGORIES:
            abort(400, description="Invalid `category`")
        q = q.filter(Station.category == category)

    if competitor_id:
        try:
            cid = int(competitor_id)
        except ValueError:
            abort(400, description="`competitor_id` must be integer")
        q = q.filter(Station.competitor_id == cid)

    stations = q.all()
    features = [s.to_feature() for s in stations]
    return jsonify({"type": "FeatureCollection", "features": features})


# --- CREATE (RBAC) ---
@bp.route("/", methods=["POST"])
@login_required
@roles_required("admin", "analyst")
def create_station():
    """
    JSON body:
    {
      "name": "...",
      "latitude": 1.23,
      "longitude": 32.56,
      "category": "rubis"|"competitor"|"target",
      "pin_shape": "...",
      "pin_color": "#RRGGBB",
      "competitor_id": <id>,          # required if category="competitor"
      "district": "Kampala",          # optional (by name, case-insensitive)
      "region": "Kampala Central"     # optional, used if district not provided or not found
    }
    """
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    lat = data.get("latitude")
    lng = data.get("longitude")
    category = data.get("category", "rubis")
    pin_shape = data.get("pin_shape", "marker")
    pin_color = data.get("pin_color", "#2E7D32")
    competitor_id = data.get("competitor_id")
    district_name = (data.get("district") or "").strip()
    region_name = (data.get("region") or "").strip()

    if not name:
        abort(400, description="`name` is required")
    if lat is None or lng is None:
        abort(400, description="`latitude` and `longitude` are required")
    try:
        lat = float(lat)
        lng = float(lng)
    except ValueError:
        abort(400, description="`latitude` and `longitude` must be numeric")
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        abort(400, description="Coordinates out of range")

    if category not in STATION_CATEGORIES:
        abort(400, description="Invalid `category`")
    if pin_shape not in PIN_SHAPES:
        abort(400, description="Invalid `pin_shape`")
    if not HEX_COLOR_RE.match(pin_color):
        abort(400, description="Invalid `pin_color`")

    dist_obj = None
    if district_name:
        dist_obj = District.query.filter(
            func.lower(District.name) == district_name.lower()
        ).first()
        if not dist_obj:
            # not fatal; we can proceed and just use region_name
            dist_obj = None

    if category == "competitor":
        if not competitor_id:
            abort(400, description="`competitor_id` required for competitor stations")
        competitor = Competitor.query.get(competitor_id)
        if not competitor:
            abort(404, description="Competitor not found")
    else:
        competitor_id = None

    station = Station(
        name=name,
        latitude=lat,
        longitude=lng,
        category=category,
        pin_shape=pin_shape,
        pin_color=pin_color,
        competitor_id=competitor_id,
    )
    if dist_obj:
        station.district = dist_obj
        station.region = dist_obj.region
    else:
        station.region = region_name or None

    db.session.add(station)
    db.session.commit()
    return jsonify(station.to_feature()), 201


# --- UPDATE (RBAC) ---
@bp.route("/<int:station_id>", methods=["PUT"])
@login_required
@roles_required("admin", "analyst")
def update_station(station_id):
    """
    Partial update of a station. Accepts same optional `district`/`region` as create.
    """
    station = Station.query.get_or_404(station_id)
    data = request.get_json() or {}

    if "name" in data:
        name = (data["name"] or "").strip()
        if not name:
            abort(400, description="`name` cannot be empty")
        station.name = name

    if "latitude" in data or "longitude" in data:
        lat = data.get("latitude", station.latitude)
        lng = data.get("longitude", station.longitude)
        try:
            lat = float(lat)
            lng = float(lng)
        except ValueError:
            abort(400, description="`latitude`/`longitude` must be numeric")
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            abort(400, description="Coordinates out of range")
        station.latitude = lat
        station.longitude = lng

    if "category" in data:
        cat = data["category"]
        if cat not in STATION_CATEGORIES:
            abort(400, description="Invalid `category`")
        station.category = cat
        if cat != "competitor":
            station.competitor_id = None

    if "competitor_id" in data:
        comp_id = data["competitor_id"]
        if station.category != "competitor":
            abort(
                400,
                description="Cannot set `competitor_id` unless category='competitor'",
            )
        comp = Competitor.query.get(comp_id)
        if not comp:
            abort(404, description="Competitor not found")
        station.competitor_id = comp.id

    if "pin_shape" in data:
        if data["pin_shape"] not in PIN_SHAPES:
            abort(400, description="Invalid `pin_shape`")
        station.pin_shape = data["pin_shape"]

    if "pin_color" in data:
        if not HEX_COLOR_RE.match(data["pin_color"]):
            abort(400, description="Invalid `pin_color`")
        station.pin_color = data["pin_color"]

    # Optional district/region update
    if "district" in data or "region" in data:
        district_name = (data.get("district") or "").strip()
        region_name = (data.get("region") or "").strip()
        if district_name:
            dist_obj = District.query.filter(
                func.lower(District.name) == district_name.lower()
            ).first()
            if not dist_obj:
                abort(400, description=f"District '{district_name}' not found")
            station.district = dist_obj
            station.region = dist_obj.region
        else:
            # No district provided: allow region override explicitly
            if region_name:
                station.district = None
                station.region = region_name

    db.session.commit()
    return jsonify(station.to_feature())


# --- DELETE (RBAC) ---
@bp.route("/<int:station_id>", methods=["DELETE"])
@login_required
@roles_required("admin")
def delete_station(station_id):
    station = Station.query.get_or_404(station_id)
    from app.journey_models import JourneyStop
    if JourneyStop.query.filter_by(station_id=station_id).first():
        abort(409, description='This station is referenced by a journey. Keep it to preserve visit history.')
    db.session.delete(station)
    db.session.commit()
    return ("", 204)
