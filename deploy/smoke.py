"""Smoke check for the production image, run with an isolated /data tmpfs."""
import runpy
from pathlib import Path

runpy.run_module('deploy.initialize', run_name='__main__')
from deploy.wsgi import app
from app.models import User

password = Path('/data/initial-admin-login.txt').read_text().split('Password: ', 1)[1].strip()
with app.app_context():
    assert User.query.count() == 1
client = app.test_client()
assert client.get('/dashboard', base_url='https://rdm.example.com').status_code == 302
response = client.post('/login', data={'username': 'admin', 'password': password}, base_url='https://rdm.example.com')
assert response.status_code == 302
cookie = response.headers['Set-Cookie']
assert 'Secure' in cookie and 'HttpOnly' in cookie and 'SameSite=Lax' in cookie
assert client.get('/dashboard', base_url='https://rdm.example.com').status_code == 200
assert client.get('/api/journeys/config', base_url='https://rdm.example.com').status_code == 200
runpy.run_module('deploy.initialize', run_name='__main__')
with app.app_context():
    assert User.query.count() == 1
print('PASS: migrations, idempotent admin setup, authentication, dashboard, journey config, secure cookies')
