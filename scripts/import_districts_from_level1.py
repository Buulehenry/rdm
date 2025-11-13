# scripts/import_districts_from_level1.py
import argparse
import json
from pathlib import Path

from app import create_app, db
from app.models import District


def coerce_multipolygon(geom: dict) -> dict | None:
    if not isinstance(geom, dict):
        return None
    t = geom.get("type")
    if t == "MultiPolygon":
        return geom
    if t == "Polygon":
        coords = geom.get("coordinates")
        if isinstance(coords, list):
            return {"type": "MultiPolygon", "coordinates": [coords]}
    return None


def norm(s: str | None) -> str:
    return (s or "").strip()


def import_level1(
    json_path: Path,
    name_field: str,
    region_field: str,
    truncate: bool,
    dry_run: bool,
    default_region: str | None,
    skip_missing_region: bool,
) -> tuple[int, int, int, int]:
    data = json.loads(json_path.read_text(encoding="utf-8"))
    feats = data.get("features") or []
    if not isinstance(feats, list):
        raise ValueError("Input is not a FeatureCollection (missing 'features').")

    if truncate and not dry_run:
        District.query.delete()
        db.session.commit()

    inserted = updated = skipped = missing = 0

    for f in feats:
        props = f.get("properties") or {}
        name = norm(props.get(name_field))
        region = norm(props.get(region_field))

        if not name:
            skipped += 1
            continue

        # Handle missing regions
        if not region:
            if default_region:
                region = default_region
            elif skip_missing_region:
                missing += 1
                continue
            else:
                # will still fail if DB has NOT NULL; provided for completeness
                region = None

        geom = coerce_multipolygon(f.get("geometry"))
        geom_str = json.dumps(geom) if geom is not None else None

        existing = District.query.filter_by(name=name).first()
        if existing:
            changed = False
            if region and existing.region != region:
                existing.region = region
                changed = True
            if geom_str and existing.geojson != geom_str:
                existing.geojson = geom_str
                changed = True
            if changed and not dry_run:
                db.session.add(existing)
                updated += 1
            else:
                skipped += 1
        else:
            row = District(name=name, region=region, geojson=geom_str)
            if not dry_run:
                db.session.add(row)
            inserted += 1

    if not dry_run:
        db.session.commit()

    return inserted, updated, skipped, missing


def main():
    ap = argparse.ArgumentParser(
        description="Import districts from a Level-1 GeoJSON (NAME_1=district, region=region)."
    )
    ap.add_argument("json_path", help="Path to gadm41_UGA_1.json")
    ap.add_argument(
        "--name-field",
        default="NAME_1",
        help="Property for district name (default: NAME_1)",
    )
    ap.add_argument(
        "--region-field", default="region", help="Property for region (default: region)"
    )
    ap.add_argument(
        "--truncate", action="store_true", help="Clear districts table before import"
    )
    ap.add_argument("--dry-run", action="store_true", help="Parse only; do not write")
    ap.add_argument(
        "--default-region", default=None, help="Fill missing region with this value"
    )
    ap.add_argument(
        "--skip-missing-region",
        action="store_true",
        default=True,
        help="Skip features with empty region (default: True)",
    )
    ap.add_argument(
        "--no-skip-missing-region",
        dest="skip_missing_region",
        action="store_false",
        help="Do not skip on missing region (NOT recommended if DB enforces NOT NULL).",
    )
    args = ap.parse_args()

    app = create_app()
    with app.app_context():
        print(f"DB URL -> {db.engine.url}")
        ins, upd, skp, miss = import_level1(
            Path(args.json_path),
            name_field=args.name_field,
            region_field=args.region_field,
            truncate=args.truncate,
            dry_run=args.dry_run,
            default_region=args.default_region,
            skip_missing_region=args.skip_missing_region,
        )
        if args.truncate and not args.dry_run:
            print("🔄 Truncated districts table.")
        tag = " (dry-run)" if args.dry_run else ""
        print(
            f"✅ Done{tag}. Inserted: {ins}, Updated: {upd}, Skipped (unchanged): {skp}, Skipped (missing region): {miss}"
        )


if __name__ == "__main__":
    main()
