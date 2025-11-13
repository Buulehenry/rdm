# app/routes/districts.py
from __future__ import annotations

import csv
import io
import json
import os
from functools import wraps
from typing import Any, Dict, List, Optional, Tuple

from flask import Blueprint, abort, current_app, jsonify, request
from flask_login import current_user, login_required

from app import db
from app.models import District

bp = Blueprint("districts", __name__, url_prefix="/api/districts")


# ------------------------- RBAC helpers -------------------------


def require_role(*allowed_roles: str):
    """
    Guard for mutation endpoints. Assumes User has a 'role' column with values like:
    'admin' | 'analyst' | 'viewer'
    """

    def deco(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            if not current_user.is_authenticated:
                return jsonify({"error": "login required"}), 401
            role = getattr(current_user, "role", "viewer")
            if role not in allowed_roles:
                return (
                    jsonify(
                        {
                            "error": "forbidden",
                            "detail": f"requires role in {', '.join(allowed_roles)}",
                            "role": role,
                        }
                    ),
                    403,
                )
            return f(*args, **kwargs)

        return wrapper

    return deco


def _parse_bool(val: Optional[str], default=True) -> bool:
    if val is None:
        return default
    return str(val).strip().lower() in ("1", "true", "yes", "y", "on")


# ------------------------- Static fallback loader -------------------------


def _load_districts_from_static(
    with_geom: bool = True, region: Optional[str] = None
) -> Dict[str, Any]:
    """
    Supports two static formats placed at app/static/data/districts.json:

    A) GeoJSON FeatureCollection (properties: name, region[, id])
       -> returned as FeatureCollection (id auto if missing)

    B) Simple list:
       {"districts":[{"name":"Abim","region":"Northern"}, ...]}
       or {"districts":["Abim","Arua", ...]} (region blank)
    """
    path = os.path.join(current_app.root_path, "static", "data", "districts.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return {"type": "FeatureCollection", "features": []}

    # Case A: already a FeatureCollection
    if isinstance(data, dict) and data.get("type") == "FeatureCollection":
        feats = []
        for idx, ft in enumerate(data.get("features", []), 1):
            props = ft.get("properties") or {}
            nm = str(props.get("name", "")).strip()
            reg = str(props.get("region", "")).strip()
            if region and reg != region:
                continue
            geom = ft.get("geometry") if with_geom else None
            feats.append(
                {
                    "type": "Feature",
                    "geometry": geom,
                    "properties": {
                        "id": props.get("id", idx),
                        "name": nm,
                        "region": reg,
                    },
                }
            )
        return {"type": "FeatureCollection", "features": feats}

    # Case B: simple list
    feats = []
    districts = data.get("districts", []) if isinstance(data, dict) else []
    for i, item in enumerate(districts, 1):
        if isinstance(item, dict):
            nm = str(item.get("name", "")).strip()
            reg = str(item.get("region", "")).strip()
        else:
            nm, reg = str(item).strip(), ""
        if not nm:
            continue
        if region and reg != region:
            continue
        feats.append(
            {
                "type": "Feature",
                "geometry": None,
                "properties": {"id": i, "name": nm, "region": reg},
            }
        )
    return {"type": "FeatureCollection", "features": feats}


# ------------------------- Read endpoints (viewer+ ) -------------------------


@bp.route("/", methods=["GET"])
@login_required
def list_districts():
    """
    Returns GeoJSON FeatureCollection of districts.

    Query params:
      region=<name>         optional
      with_geom=0|1         default 1
      source=static|db      default db (fallback to static if DB empty)
    """
    region = request.args.get("region")
    with_geom = _parse_bool(request.args.get("with_geom"), default=True)
    force_source = (request.args.get("source") or "").lower()

    # Prefer DB unless forced to static
    feats = []
    if force_source != "static":
        q = District.query
        if region:
            q = q.filter(District.region == region)
        q = q.order_by(District.name)
        rows = q.all()
        if rows:
            for d in rows:
                geom = None
                if with_geom and d.geojson:
                    try:
                        geom = (
                            d.geojson
                            if isinstance(d.geojson, dict)
                            else json.loads(d.geojson)
                        )
                    except Exception:
                        geom = None
                feats.append(
                    {
                        "type": "Feature",
                        "geometry": geom,
                        "properties": {"id": d.id, "name": d.name, "region": d.region},
                    }
                )
            return jsonify({"type": "FeatureCollection", "features": feats})

    # Fallback to static
    return jsonify(_load_districts_from_static(with_geom=with_geom, region=region))


@bp.route("/meta", methods=["GET"])
@login_required
def list_meta():
    """Lightweight list for admin table (no polygons)."""
    rows = District.query.order_by(District.region, District.name).all()
    return jsonify([{"id": d.id, "name": d.name, "region": d.region} for d in rows])


# ------------------------- Mutations (RBAC) -------------------------


@bp.route("/", methods=["POST"])
@login_required
@require_role("admin", "analyst")
def create_district():
    payload = request.get_json(force=True) or {}
    name = (payload.get("name") or "").strip()
    region = (payload.get("region") or "").strip()
    if not name or not region:
        return jsonify({"error": "name and region are required"}), 400

    geom = payload.get("geojson")
    geojson_txt = json.dumps(geom) if isinstance(geom, (dict, list)) else (geom or None)

    d = District(name=name, region=region, geojson=geojson_txt)
    db.session.add(d)
    db.session.commit()
    return jsonify({"id": d.id, "name": d.name, "region": d.region}), 201


@bp.route("/<int:district_id>", methods=["PATCH"])
@login_required
@require_role("admin", "analyst")
def update_district(district_id: int):
    d = District.query.get_or_404(district_id)
    payload = request.get_json(force=True) or {}

    if "name" in payload:
        nm = (payload["name"] or "").strip()
        if not nm:
            return jsonify({"error": "name cannot be empty"}), 400
        d.name = nm

    if "region" in payload:
        rg = (payload["region"] or "").strip()
        if not rg:
            return jsonify({"error": "region cannot be empty"}), 400
        d.region = rg

    if "geojson" in payload:
        geom = payload["geojson"]
        if geom is None:
            d.geojson = None
        elif isinstance(geom, (dict, list)):
            d.geojson = json.dumps(geom)
        else:
            d.geojson = str(geom)

    db.session.commit()
    return jsonify({"id": d.id, "name": d.name, "region": d.region})


@bp.route("/<int:district_id>", methods=["DELETE"])
@login_required
@require_role("admin")
def delete_district(district_id: int):
    d = District.query.get_or_404(district_id)
    db.session.delete(d)
    db.session.commit()
    return jsonify({"ok": True})


# ------------------------- CSV boundary upload (optional) -------------------------


@bp.route("/<int:district_id>/geojson-csv", methods=["POST"])
@login_required
@require_role("admin", "analyst")
def upload_district_boundary_csv(district_id: int):
    """
    Accept a CSV file with columns like:
      lat,lon
      -0.123,30.456
      ...

    Will store as a Polygon (closed ring) in the `geojson` column.
    """
    d = District.query.get_or_404(district_id)

    if "file" not in request.files:
        return jsonify({"error": "no file part named 'file'"}), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "empty filename"}), 400

    try:
        points = _read_latlon_csv(f)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    if len(points) < 3:
        return jsonify({"error": "need at least 3 points"}), 400

    # Close ring if not closed
    if points[0] != points[-1]:
        points.append(points[0])

    poly = {
        "type": "Polygon",
        "coordinates": [points],  # GeoJSON expects [ [ [lon,lat], ... ] ]
    }
    d.geojson = json.dumps(poly)
    db.session.commit()
    return jsonify({"ok": True, "id": d.id})


# ------------------------- CSV helper -------------------------


def _read_latlon_csv(file_storage) -> List[List[float]]:
    """
    Reads a CSV and returns list of [lon, lat].
    Accepts headers in any of these forms:
      lat, lon
      latitude, longitude
      y, x
    """
    stream = io.TextIOWrapper(file_storage.stream, encoding="utf-8", errors="replace")
    reader = csv.DictReader(stream)
    # Normalize headers
    headers = {h.lower().strip(): h for h in reader.fieldnames or []}
    lat_key = next((headers[k] for k in ("lat", "latitude", "y")), None)
    lon_key = next((headers[k] for k in ("lon", "lng", "longitude", "x")), None)
    if not lat_key or not lon_key:
        raise ValueError("CSV must contain lat/latitude and lon/lng/longitude columns")

    pts: List[List[float]] = []
    for row in reader:
        try:
            lat = float(str(row[lat_key]).strip())
            lon = float(str(row[lon_key]).strip())
        except Exception:
            # skip bad rows
            continue
        if -90 <= lat <= 90 and -180 <= lon <= 180:
            pts.append([lon, lat])  # GeoJSON order
    if not pts:
        raise ValueError("No valid coordinate rows found")
    return pts
