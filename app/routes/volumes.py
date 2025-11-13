# app/routes/volumes.py
from flask import Blueprint, request, jsonify
from flask_login import login_required
from io import StringIO
import io, csv, datetime, re
from difflib import SequenceMatcher

from app import db
from app.models import Station, DailyVolume

bp = Blueprint("volumes", __name__, url_prefix="/api/volumes")


def _canon(s: str) -> str:
    if not s:
        return ""
    s = s.lower().strip()
    s = re.sub(r"[\s]+", " ", s)
    s = re.sub(r"[^\w\s]", "", s)
    s = re.sub(r"\b(service|filling)?\s*station\b", "", s)
    s = re.sub(r"\bps\b", "", s)
    return s.strip()


@bp.route("/upload", methods=["POST"])
@login_required
def upload_volumes_csv():
    f = request.files.get("file")
    if not f:
        return jsonify({"error": "No file uploaded"}), 400

    dry_run = request.args.get("dry_run", "false").lower() == "true"
    allow_fuzz = request.args.get("fuzzy", "false").lower() == "true"
    try:
        min_ratio = float(request.args.get("min_ratio", "0.9"))
    except Exception:
        min_ratio = 0.9

    # ---- Read the uploaded CSV safely (works on Windows/WSGI too)
    # Read all bytes, decode to text (strip BOM if present), then wrap in StringIO
    raw = f.read()
    if isinstance(raw, bytes):
        text = raw.decode("utf-8-sig", errors="replace")
    else:
        # Some servers hand us text already
        text = str(raw)
    reader = csv.DictReader(StringIO(text))

    # Build lookups
    stations = Station.query.all()
    id_map = {s.id: s for s in stations}
    name_map = {_canon(s.name): s.id for s in stations if s.name}

    rows = 0
    inserted = 0
    updated = 0
    unmatched = []
    errors = []

    for idx, row in enumerate(reader, start=2):  # header was line 1
        rows += 1
        sid_raw = (row.get("station_id") or "").strip()
        sname = (row.get("station_name") or "").strip()
        d_raw = (row.get("date") or "").strip()
        v_raw = (row.get("volume") or "").strip()

        # Resolve station_id
        station_id = None
        if sid_raw:
            try:
                sid = int(sid_raw)
                if sid in id_map:
                    station_id = sid
                else:
                    errors.append(f"Line {idx}: station_id {sid_raw} not found")
                    continue
            except Exception:
                errors.append(f"Line {idx}: invalid station_id '{sid_raw}'")
                continue
        else:
            if not sname:
                errors.append(f"Line {idx}: need station_id or station_name")
                continue
            key = _canon(sname)
            station_id = name_map.get(key)
            if not station_id and allow_fuzz and key:
                best_id, best_r = None, 0.0
                for k, sid in name_map.items():
                    r = SequenceMatcher(None, key, k).ratio()
                    if r > best_r:
                        best_r, best_id = r, sid
                if best_r >= min_ratio:
                    station_id = best_id
            if not station_id:
                unmatched.append(sname)
                continue

        # Date
        try:
            y, m, d = map(int, d_raw.split("-"))
            dt = datetime.date(y, m, d)
        except Exception:
            errors.append(f"Line {idx}: invalid date '{d_raw}' (YYYY-MM-DD)")
            continue

        # Volume
        try:
            vol = float(v_raw or 0)
        except Exception:
            errors.append(f"Line {idx}: invalid volume '{v_raw}'")
            continue

        if dry_run:
            exists = DailyVolume.query.filter_by(station_id=station_id, date=dt).first()
            if exists:
                updated += 1
            else:
                inserted += 1
            continue

        rec = DailyVolume.query.filter_by(station_id=station_id, date=dt).first()
        if rec:
            if rec.volume != vol:
                rec.volume = vol
                updated += 1
        else:
            db.session.add(DailyVolume(station_id=station_id, date=dt, volume=vol))
            inserted += 1

    if not dry_run:
        db.session.commit()

    return jsonify(
        {
            "rows": rows,
            "inserted": inserted,
            "updated": updated,
            "unmatched": unmatched[:200],
            "errors": errors[:200],
            "dry_run": dry_run,
            "fuzzy": allow_fuzz,
            "min_ratio": min_ratio,
        }
    )
