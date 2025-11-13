# app/routes/station_volumes.py
from __future__ import annotations

import csv
import io
import re
import difflib
import calendar
from datetime import date
from flask import Blueprint, request, jsonify, abort
from flask_login import login_required, current_user
from sqlalchemy import func

from app import db
from app.models import (
    Station,
    StationVolume,
    District,
)  # models already define StationVolume

bp = Blueprint("station_volumes", __name__, url_prefix="/api")


# ---- simple RBAC helper ----
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


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (s or "").strip().lower())


# ---------- Upload CSV ----------
@bp.route("/station_volumes/upload", methods=["POST"])
@login_required
@roles_required("admin", "analyst")
def upload_volumes():
    """
    CSV headers (choose one of the keys for station):
      - station_id,date,volume
      - station_name,date,volume
    Query params:
      fuzzy=true|false (default false)
      min_ratio=0.88   (for fuzzy)
      dry_run=true|false
    """
    # read body/file
    file = request.files.get("file")
    content = (
        file.read().decode("utf-8", errors="ignore")
        if file
        else (request.get_data(as_text=True) or "")
    )
    if not content:
        abort(400, description="No CSV provided")

    rdr = csv.DictReader(io.StringIO(content))
    if not rdr.fieldnames:
        abort(400, description="CSV missing header row")

    headers = {h.strip().lower() for h in rdr.fieldnames}
    has_id = "station_id" in headers
    has_name = "station_name" in headers
    if not (has_id or has_name):
        abort(400, description="CSV must include station_id or station_name header")
    if "date" not in headers or "volume" not in headers:
        abort(400, description="CSV must include date and volume headers")

    # options
    fuzzy = (request.args.get("fuzzy") or "false").lower() == "true"
    try:
        min_ratio = float(request.args.get("min_ratio", "0.9"))
    except ValueError:
        min_ratio = 0.9
    dry_run = (request.args.get("dry_run") or "false").lower() == "true"

    # preload stations (all; or change to filter by category='rubis' if desired)
    stations = Station.query.with_entities(Station.id, Station.name).all()
    by_norm = {}
    for sid, nm in stations:
        key = _norm(nm)
        by_norm.setdefault(key, []).append(sid)  # handle collisions

    rows = 0
    inserted = updated = 0
    matched_exact = matched_fuzzy = 0
    skipped_ambiguous = skipped_missing = 0
    errors = []

    upserts = []  # (sid, dt, vol)

    for raw in rdr:
        rows += 1
        try:
            dt = date.fromisoformat(str(raw.get("date")).strip())
            vol = float(str(raw.get("volume")).strip())
        except Exception:
            errors.append(f"Row {rows}: invalid date/volume")
            continue

        sid = None
        if has_id:
            try:
                sid = int(str(raw.get("station_id")).strip())
            except Exception:
                errors.append(f"Row {rows}: invalid station_id")
                continue
            if sid not in {s[0] for s in stations}:
                errors.append(f"Row {rows}: station_id {sid} not found")
                continue
            matched_exact += 1
        else:
            name = str(raw.get("station_name") or "").strip()
            if not name:
                errors.append(f"Row {rows}: empty station_name")
                continue
            key = _norm(name)
            ids = by_norm.get(key) or []
            if len(ids) == 1:
                sid = ids[0]
                matched_exact += 1
            elif len(ids) > 1:
                # multiple exact normalized matches -> ambiguous
                skipped_ambiguous += 1
                errors.append(
                    f"Row {rows}: ambiguous name '{name}' matches {len(ids)} stations"
                )
                continue
            elif fuzzy:
                # fuzzy match across all station names
                choices = [(s[0], s[1]) for s in stations]
                best_sid, best_ratio = None, 0.0
                for cand_sid, cand_nm in choices:
                    r = difflib.SequenceMatcher(
                        None, name.lower(), cand_nm.lower()
                    ).ratio()
                    if r > best_ratio:
                        best_sid, best_ratio = cand_sid, r
                if best_ratio >= min_ratio:
                    sid = best_sid
                    matched_fuzzy += 1
                else:
                    skipped_missing += 1
                    errors.append(
                        f"Row {rows}: no match for '{name}' (best match {best_ratio:.2f} < {min_ratio})"
                    )
                    continue
            else:
                skipped_missing += 1
                errors.append(f"Row {rows}: station '{name}' not found")
                continue

        upserts.append((sid, dt, vol))

    # perform upserts
    if not dry_run:
        for sid, dt, vol in upserts:
            existing = StationVolume.query.filter_by(station_id=sid, d=dt).first()
            if existing:
                if existing.volume != vol:
                    existing.volume = vol
                    updated += 1
            else:
                db.session.add(StationVolume(station_id=sid, d=dt, volume=vol))
                inserted += 1
        db.session.commit()

    return jsonify(
        {
            "rows": rows,
            "inserted": inserted,
            "updated": updated,
            "matched_by": {"exact": matched_exact, "fuzzy": matched_fuzzy},
            "skipped": {"ambiguous": skipped_ambiguous, "missing": skipped_missing},
            "errors": errors[:50],  # cap
            "dry_run": dry_run,
        }
    )


# ---------- Per-station time series ----------
@bp.route("/station_volumes/<int:station_id>", methods=["GET"])
@login_required
def station_timeseries(station_id: int):
    _ = Station.query.get_or_404(station_id)
    q = StationVolume.query.filter(StationVolume.station_id == station_id)
    start = request.args.get("start")
    end = request.args.get("end")
    if start:
        q = q.filter(StationVolume.d >= date.fromisoformat(start))
    if end:
        q = q.filter(StationVolume.d <= date.fromisoformat(end))
    q = q.order_by(StationVolume.d.asc())
    return jsonify([{"date": sv.d.isoformat(), "volume": sv.volume} for sv in q.all()])


# ---------- Rankings ----------
@bp.route("/stations/rankings", methods=["GET"])
@login_required
def rankings():
    period = (request.args.get("period") or "this_month").lower()
    category = (request.args.get("category") or "rubis").lower()

    today = date.today()
    if period in ("this_month", "last_month"):
        y, m = today.year, today.month
        if period == "last_month":
            y, m = (y - 1, 12) if m == 1 else (y, m - 1)
        start = date(y, m, 1)
        end = date(y, m, calendar.monthrange(y, m)[1])
    else:
        start = date.fromisoformat(request.args["start"])
        end = date.fromisoformat(request.args["end"])

    stq = Station.query
    if category:
        stq = stq.filter(Station.category == category)

    region = (request.args.get("region") or "").strip()
    district = (request.args.get("district") or "").strip()
    if region:
        stq = stq.filter(Station.region == region)
    if district:
        stq = stq.join(District, isouter=True).filter(
            func.lower(District.name) == district.lower()
        )

    res = (
        db.session.query(
            Station.id.label("station_id"),
            Station.name.label("station_name"),
            func.sum(StationVolume.volume).label("total_volume"),
        )
        .join(StationVolume, Station.id == StationVolume.station_id)
        .filter(StationVolume.d >= start, StationVolume.d <= end)
        .filter(Station.id.in_(stq.with_entities(Station.id)))
        .group_by(Station.id, Station.name)
        .order_by(func.sum(StationVolume.volume).desc())
        .all()
    )

    return jsonify(
        [
            {
                "station_id": r.station_id,
                "station_name": r.station_name,
                "total_volume": float(r.total_volume or 0.0),
            }
            for r in res
        ]
    )
