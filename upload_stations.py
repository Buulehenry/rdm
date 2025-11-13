import pandas as pd
from sqlalchemy.exc import IntegrityError
from app import create_app, db
from app.models import Station, Competitor, create_station

# ====== CONFIG ======
EXCEL_FILE = "stations.xlsx"
NAME_COL = "name"
LAT_COL = "latitude"
LON_COL = "longitude"
CATEGORY_COL = "category"
PIN_SHAPE_COL = "pin_shape"
PIN_COLOR_COL = "pin_color"
COMPETITOR_NAME_COL = "competitor_name"

app = create_app()
with app.app_context():
    df = pd.read_excel(EXCEL_FILE)

    for _, row in df.iterrows():
        name = str(row[NAME_COL]).strip()
        lat = row[LAT_COL]
        lon = row[LON_COL]
        category = str(row.get(CATEGORY_COL, "rubis")).strip().lower()
        pin_shape = str(row.get(PIN_SHAPE_COL, "marker")).strip()
        pin_color = str(row.get(PIN_COLOR_COL, "#2E7D32")).strip()
        competitor_name = row.get(COMPETITOR_NAME_COL)

        competitor_id = None
        if category == "competitor" and competitor_name:
            comp = Competitor.query.filter_by(name=str(competitor_name).strip()).first()
            if comp:
                competitor_id = comp.id
            else:
                print(
                    f"⚠️ Competitor '{competitor_name}' not found for station '{name}'. Skipping."
                )
                continue

        existing = Station.query.filter_by(
            name=name, latitude=lat, longitude=lon
        ).first()
        if existing:
            # Station already exists with same coordinates — no update needed
            print(f"ℹ️ Station already exists with same coordinates: {name}")
        else:
            try:
                create_station(
                    name=name,
                    latitude=lat,
                    longitude=lon,
                    category=category,
                    pin_shape=pin_shape,
                    pin_color=pin_color,
                    competitor_id=competitor_id,
                )
                print(f"✅ Added station: {name}")
            except ValueError as ve:
                print(f"❌ Validation error for station '{name}': {ve}")
                continue

    try:
        db.session.commit()
        print("🎯 Station upload complete.")
    except IntegrityError as e:
        db.session.rollback()
        print(f"❌ Database error: {e}")
