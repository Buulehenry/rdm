"""Create a consistent SQLite snapshot; run daily from root's cron."""
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

os.umask(0o077)
source = Path('/opt/rdm/deploy/data/rdm.db')
folder = Path('/opt/rdm/backups')
folder.mkdir(parents=True, exist_ok=True)
target = folder / ('rdm-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.db')
with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as database:
    with sqlite3.connect(target) as backup:
        database.backup(backup)
        if backup.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('Backup failed integrity check.')
print('Database snapshot created:', target.name)
