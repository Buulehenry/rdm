# app/routes/competitors.py

import re
from datetime import datetime

from flask import Blueprint, request, jsonify, abort
from flask_login import login_required
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from app import db
from app.models import Competitor, Station  # adjust if models are elsewhere

bp = Blueprint("competitors", __name__, url_prefix="/api/competitors")

# --- Validation Regex ---
HEX_COLOR_RE = re.compile(r"^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$")


# -----------------------
# Helper Functions
# -----------------------
def normalize_name(name: str) -> str:
    """Trim extra spaces (collapse internal whitespace)."""
    return " ".join((name or "").strip().split())


def competitor_to_dict(comp: Competitor, include_stations=False):
    """
    Serialize competitor with station_count.
    Optionally include simplified station list (IDs only) if requested.
    """
    station_count = len(comp.stations) if comp.stations is not None else (
        db.session.query(Station.id).filter(Station.competitor_id == comp.id).count()
    )
    data = {
        "id": comp.id,
        "name": comp.name,
        "pin_color": comp.pin_color,
        "created_at": comp.created_at.isoformat() if comp.created_at else None,
        "station_count": station_count
    }
    if include_stations:
        data["stations"] = [s.id for s in comp.stations]
    return data


def validate_hex_color(color: str):
    if not HEX_COLOR_RE.match(color or ""):
        abort(400, description="`pin_color` must be hex like #RRGGBB or #RGB")


def unique_name_exists(name: str, exclude_id=None) -> bool:
    """
    Case-insensitive uniqueness check.
    """
    q = Competitor.query.filter(func.lower(Competitor.name) == name.lower())
    if exclude_id:
        q = q.filter(Competitor.id != exclude_id)
    return db.session.query(q.exists()).scalar()


# -----------------------
# Routes
# -----------------------

@bp.route("/", methods=["GET"])
@login_required
def list_competitors():
    """
    List competitors with pagination.
    Query params:
        page (int, default=1)
        per_page (int, default=50, max=200)
        include_stations=(0|1) to include station IDs.
        q=<substring> optional case-insensitive name filter.
    """
    page = max(int(request.args.get("page", 1) or 1), 1)
    per_page = int(request.args.get("per_page", 50) or 50)
    per_page = min(per_page, 200)
    include_stations = request.args.get("include_stations") in ("1", "true", "True")
    q_text = (request.args.get("q") or "").strip()

    query = Competitor.query
    if q_text:
        ilike = f"%{q_text.lower()}%"
        query = query.filter(func.lower(Competitor.name).like(ilike))

    pagination = query.order_by(Competitor.name.asc()).paginate(page=page, per_page=per_page, error_out=False)

    items = [competitor_to_dict(c, include_stations=include_stations) for c in pagination.items]

    return jsonify({
        "items": items,
        "page": page,
        "per_page": per_page,
        "total_items": pagination.total,
        "total_pages": pagination.pages
    })


@bp.route("/<int:comp_id>", methods=["GET"])
def get_competitor(comp_id):
    comp = Competitor.query.get_or_404(comp_id)
    return jsonify(competitor_to_dict(comp, include_stations=True))


@bp.route("/", methods=["POST"])
@login_required
def create_competitor():
    """
    JSON body:
    {
      "name": "TOTAL",
      "pin_color": "#FF0000"
    }
    """
    data = request.get_json() or {}
    name = normalize_name(data.get("name", ""))
    pin_color = data.get("pin_color", "")

    if not name:
        abort(400, description="`name` is required")
    if not pin_color:
        abort(400, description="`pin_color` is required")
    validate_hex_color(pin_color)

    if unique_name_exists(name):
        abort(400, description="Competitor with that name already exists")

    comp = Competitor(
        name=name,
        pin_color=pin_color,
        created_at=datetime.utcnow()  # you can rely on model default if defined
    )
    db.session.add(comp)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        abort(400, description="Competitor with that name already exists")

    return jsonify(competitor_to_dict(comp)), 201


@bp.route("/<int:comp_id>", methods=["PUT"])
@login_required
def update_competitor(comp_id):
    """
    Partial update. JSON body may include:
    {
      "name": "...",
      "pin_color": "#00AAFF"
    }
    """
    comp = Competitor.query.get_or_404(comp_id)
    data = request.get_json() or {}

    if "name" in data:
        new_name = normalize_name(data.get("name", ""))
        if not new_name:
            abort(400, description="`name` cannot be empty")
        if unique_name_exists(new_name, exclude_id=comp.id):
            abort(400, description="Competitor with that name already exists")
        comp.name = new_name

    if "pin_color" in data:
        new_color = data.get("pin_color") or ""
        validate_hex_color(new_color)
        comp.pin_color = new_color

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        abort(400, description="Competitor with that name already exists")

    return jsonify(competitor_to_dict(comp))


@bp.route("/<int:comp_id>", methods=["DELETE"])
@login_required
def delete_competitor(comp_id):
    """
    Deletes competitor and (by cascade or manual) its stations.
    If you configured cascade delete on relationship, manual station deletion not needed.
    """
    comp = Competitor.query.get_or_404(comp_id)

    # If NO cascade is configured and you want to delete stations manually:
    # for st in list(comp.stations):
    #     db.session.delete(st)

    db.session.delete(comp)
    db.session.commit()
    return jsonify({"message": "deleted", "id": comp_id})
