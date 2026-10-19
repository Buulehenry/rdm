"""HTTPS production entry point behind the single Caddy reverse proxy."""
import os
from app import create_app
from werkzeug.middleware.proxy_fix import ProxyFix

if len(os.environ.get('SECRET_KEY', '')) < 32:
    raise RuntimeError('A unique production SECRET_KEY of at least 32 characters is required.')
if not os.environ.get('DATABASE_URL'):
    raise RuntimeError('Production DATABASE_URL is required.')

app = create_app()
app.config.update(
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    REMEMBER_COOKIE_SECURE=True,
    REMEMBER_COOKIE_HTTPONLY=True,
    REMEMBER_COOKIE_SAMESITE='Lax',
)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

@app.after_request
def secure_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    # Public map tile services require a referring site. Send only our origin
    # cross-origin, never the dashboard path or query string.
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000'
    return response
