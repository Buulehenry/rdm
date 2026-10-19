"""Copy operational data for a fresh deployment, excluding local accounts/journeys.

Never modifies the local database. The output is ignored by Git.
"""
import sqlite3
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[1]
    source = root / 'stations.db'
    target = root / 'deploy/data/rdm.db'
    if not source.is_file():
        raise RuntimeError('Local station database is missing.')
    if target.exists():
        raise RuntimeError('Deployment database already exists; refusing to overwrite it.')
    target.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as original:
        with sqlite3.connect(target) as destination:
            original.backup(destination)
            for table in ('journey_stop', 'journey', 'journey_base', 'user'):
                destination.execute(f'DELETE FROM "{table}"')
            destination.commit()
            destination.execute('VACUUM')
            result = destination.execute('PRAGMA integrity_check').fetchone()[0]
            if result != 'ok':
                raise RuntimeError('Deployment database failed integrity validation.')
            count = destination.execute('SELECT count(*) FROM station').fetchone()[0]
    print(f'Deployment copy ready: {count} stations; no local users or test journeys.')


if __name__ == '__main__':
    main()
