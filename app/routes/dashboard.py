from flask import Blueprint, render_template
from flask_login import login_required

bp = Blueprint('dashboard_ui', __name__)

@bp.route('/dashboard')
@login_required
def dashboard():
    return render_template('map_dashboard.html')

