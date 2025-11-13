# app/routes/__init__.py
from flask import Flask


def init_app(app: Flask):
    from app.routes.stations import bp as stations_bp
    from app.routes.competitors import bp as competitors_bp
    from app.routes.targets import bp as targets_bp
    from app.routes.dashboard import bp as dashboard_bp
    from app.routes.districts import bp as districts_bp
    from app.routes.station_volumes import bp as station_volumes_bp
    from app.routes.volumes import bp as volumes_bp
    from app.routes.feedback import bp as feedback_bp

    app.register_blueprint(feedback_bp)
    app.register_blueprint(dashboard_bp)
    app.register_blueprint(stations_bp)
    app.register_blueprint(competitors_bp)
    app.register_blueprint(targets_bp)
    app.register_blueprint(districts_bp)
    app.register_blueprint(station_volumes_bp)
    app.register_blueprint(volumes_bp)
