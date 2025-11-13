import os

basedir = os.path.abspath(os.path.dirname(__file__))

class Config:
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
