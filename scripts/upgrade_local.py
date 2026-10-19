"""Back up and adopt the existing unversioned SQLite schema, then apply migrations."""
from pathlib import Path
from datetime import datetime
import sqlite3
from sqlalchemy import inspect
from flask_migrate import stamp, upgrade
from app import create_app, db


def main():
    app = create_app()
    with app.app_context():
        if db.engine.dialect.name != 'sqlite':
            raise RuntimeError('Use reviewed deployment migration steps for non-SQLite databases.')
        path = Path(db.engine.url.database)
        if path.exists():
            folder = path.parent / 'backups'
            folder.mkdir(exist_ok=True)
            backup = folder / ('rdm-before-journeys-' + datetime.now().strftime('%Y%m%d-%H%M%S') + '.db')
            with sqlite3.connect(str(path)) as source, sqlite3.connect(str(backup)) as destination:
                source.backup(destination)
            print('Backup:', backup)
        inspector = inspect(db.engine)
        tables = set(inspector.get_table_names())
        if tables and 'alembic_version' not in tables:
            legacy = {'user', 'station', 'competitor', 'district', 'target_area', 'daily_volume', 'station_volume'}
            if tables != legacy:
                raise RuntimeError('Unexpected schema; review it before stamping baseline 0001.')
            for name in legacy:
                existing = {c['name'] for c in inspector.get_columns(name)}
                expected = set(db.metadata.tables[name].columns.keys())
                if existing != expected:
                    raise RuntimeError(f'Schema differs for {name}; review before migrating.')
            stamp(revision='0001')
        upgrade()
        print('Migration complete.')


if __name__ == '__main__':
    main()
