# app/__init__.py
from flask import Flask, jsonify, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from werkzeug.exceptions import HTTPException
from flask_login import LoginManager

from config import Config

# Initialize extensions
db = SQLAlchemy()
migrate = Migrate()
login_manager = LoginManager()


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    # Initialize extensions
    db.init_app(app)
    migrate.init_app(app, db)
    login_manager.init_app(app)

    # Redirect unauthorized users to login
    login_manager.login_view = 'auth.login'
    login_manager.login_message = 'Please log in to access this page.'

    # Register blueprints
    from app.routes.auth import auth_bp
    from app.routes import init_app as init_routes

    app.register_blueprint(auth_bp)      # <— our auth routes (/login, /logout)
    init_routes(app)                     # <— your existing blueprint registrar

    # Root URL → dashboard (will be @login_required in dashboard blueprint)
    @app.route('/')
    def index():
        return redirect(url_for('dashboard_ui.dashboard'))

    # Error handlers
    register_error_handlers(app)

    return app


def register_error_handlers(app):
    @app.errorhandler(HTTPException)
    def handle_http_exception(e):
        # Return JSON for API calls
        return jsonify(error=e.description, code=e.code), e.code

    @app.errorhandler(Exception)
    def handle_unexpected(e):
        app.logger.exception("Unhandled exception")
        return jsonify(error="Internal server error"), 500


# User loader for Flask-Login
from app.models import User
@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))
