"""Run migrations and create the first production administrator once."""
import os
import secrets
import runpy
from pathlib import Path
from flask_migrate import upgrade
from app import db
from app.models import User
from deploy.wsgi import app

with app.app_context():
    upgrade()
    if not User.query.first() and os.environ.get('RDM_USER_SEED'):
        runpy.run_module('deploy.seed_users', run_name='__main__')
    elif not User.query.first():
        password = secrets.token_urlsafe(24)
        user = User(username='admin', role='admin')
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        credentials = Path('/data/initial-admin-login.txt')
        descriptor = os.open(credentials, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as output:
            output.write(f'Username: admin\nPassword: {password}\n')
        print('Initial login saved in /data/initial-admin-login.txt; retrieve it over SSH.')
    print('Production schema ready.')
