"""Create requested production users from a private JSON file of password hashes.

Run using docker compose exec -T web python - < deploy/seed_users.py with
RDM_USER_SEED=/data/users-to-seed.json. Existing users are never overwritten.
"""
import json
import os
from pathlib import Path
from app import db
from app.models import User
from deploy.wsgi import app

path = Path(os.environ['RDM_USER_SEED'])
records = json.loads(path.read_text())
with app.app_context():
    for record in records:
        name, role, password_hash = record['username'], record['role'], record['password_hash']
        if role not in {'admin', 'analyst', 'viewer'} or not password_hash.startswith('scrypt:'):
            raise ValueError('Invalid seed record.')
        if User.query.filter_by(username=name).first():
            raise RuntimeError(f'User {name} already exists; refusing to replace credentials.')
        db.session.add(User(username=name, role=role, password_hash=password_hash))
    db.session.commit()
print(f'Created {len(records)} production accounts.')
