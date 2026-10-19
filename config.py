import os

basedir = os.path.abspath(os.path.dirname(__file__))

class Config:
    OSRM_BASE_URL = os.environ.get('OSRM_BASE_URL', '')
    OSRM_CONNECT_TIMEOUT = float(os.environ.get('OSRM_CONNECT_TIMEOUT', 3))
    OSRM_READ_TIMEOUT = float(os.environ.get('OSRM_READ_TIMEOUT', 12))
    OSRM_CACHE_SECONDS = int(os.environ.get('OSRM_CACHE_SECONDS', 60))
    OSRM_MAX_SNAP_METERS = int(os.environ.get('OSRM_MAX_SNAP_METERS', 1000))
    ROUTING_REQUESTS_PER_MINUTE = int(os.environ.get('ROUTING_REQUESTS_PER_MINUTE', 30))
    JOURNEY_MAX_STOPS = 20
    NAV_ARRIVAL_METERS = int(os.environ.get('NAV_ARRIVAL_METERS', 100))
    NAV_DEVIATION_METERS = int(os.environ.get('NAV_DEVIATION_METERS', 80))
    NAV_MAX_ACCURACY_METERS = int(os.environ.get('NAV_MAX_ACCURACY_METERS', 100))
    MAX_CONTENT_LENGTH = 5 * 1024 * 1024
    # Security
    SECRET_KEY = os.environ.get('SECRET_KEY', 'you-will-change-this')

    # Database
    # Use DATABASE_URL env var, e.g., postgresql://user:pass@localhost/dbname
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        'DATABASE_URL',
        'sqlite:///' + os.path.join(basedir, 'stations.db')
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # PostGIS geometry support
    # (Ensure your database has PostGIS extension enabled)

    # Flask-Migrate settings
    MIGRATION_DIR = os.environ.get('MIGRATION_DIR', 'migrations')

    # Map settings (optional)
    # Default tile layer; can override via env var
    MAP_TILE_URL = os.environ.get(
        'MAP_TILE_URL',
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
    )
    MAP_ATTRIBUTION = os.environ.get(
        'MAP_ATTRIBUTION',
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    )

    # Pagination defaults
    ITEMS_PER_PAGE = int(os.environ.get('ITEMS_PER_PAGE', 20))
