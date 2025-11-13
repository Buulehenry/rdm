import db
from sqlalchemy import text

conn = db.engine.connect()

# 1. Rename old table
conn.execute(text("ALTER TABLE stations RENAME TO stations_old;"))

# 2. Create new table with updated CHECK
conn.execute(
    text(
        """
CREATE TABLE stations (
    id INTEGER PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    competitor_id INTEGER,
    category VARCHAR(16) NOT NULL DEFAULT 'rubis',
    pin_shape VARCHAR(16) NOT NULL DEFAULT 'marker',
    pin_color VARCHAR(16) NOT NULL DEFAULT '#2E7D32',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK(category IN ('rubis','competitor','target')),
    CHECK(pin_shape IN ('marker','circle','square','triangle','rubis_pin','shell_pin','total_pin')),
    CHECK((substr(pin_color,1,1)='#' AND (length(pin_color)=7 OR length(pin_color)=4))),
    CHECK(((category='competitor' AND competitor_id IS NOT NULL) OR (category<>'competitor' AND competitor_id IS NULL)))
);
"""
    )
)

# 3. Copy existing data
conn.execute(
    text(
        """
INSERT INTO stations (id, name, latitude, longitude, competitor_id, category, pin_shape, pin_color, created_at, updated_at)
SELECT id, name, latitude, longitude, competitor_id, category, pin_shape, pin_color, created_at, updated_at
FROM stations_old;
"""
    )
)

# 4. Drop old table
conn.execute(text("DROP TABLE stations_old;"))

conn.close()
print("✅ SQLite updated: 'shell_pin' and 'total_pin' are now allowed.")
