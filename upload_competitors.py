import pandas as pd
from sqlalchemy.exc import IntegrityError
from app import create_app, db
from app.models import Competitor

# ====== CONFIG ======
EXCEL_FILE = "competitors.xlsx"
NAME_COLUMN = "name"
PIN_COLOR_COLUMN = "pin_color"

app = create_app()
with app.app_context():
    df = pd.read_excel(EXCEL_FILE)

    for _, row in df.iterrows():
        name = str(row[NAME_COLUMN]).strip()
        pin_color = (
            str(row[PIN_COLOR_COLUMN]).strip()
            if row.get(PIN_COLOR_COLUMN)
            else "#FF0000"
        )

        if not name:
            print("⚠️ Skipping row with empty name.")
            continue

        existing = Competitor.query.filter_by(name=name).first()
        if existing:
            # Update pin color if different
            if pin_color and existing.pin_color != pin_color:
                existing.pin_color = pin_color
                print(f"🔄 Updated pin color for competitor: {name}")
            else:
                print(f"⏩ Skipped competitor (no changes): {name}")
        else:
            db.session.add(Competitor(name=name, pin_color=pin_color))
            print(f"✅ Added competitor: {name}")

    try:
        db.session.commit()
        print("🎯 Competitor upload complete.")
    except IntegrityError as e:
        db.session.rollback()
        print(f"❌ Database error: {e}")
