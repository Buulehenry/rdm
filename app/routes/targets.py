from flask import Blueprint, request, jsonify, abort
from flask_login import login_required
from app import db
from app.models import TargetArea, PIN_SHAPES, HEX_COLOR_RE
import json

bp = Blueprint('targets', __name__, url_prefix='/api/targets')


@bp.route('/', methods=['GET'])
@login_required
def list_targets():
    areas = TargetArea.query.all()
    features = [a.to_feature() for a in areas]
    return jsonify({"type": "FeatureCollection", "features": features})


@bp.route('/', methods=['POST'])
@login_required
def create_target():
    """
    JSON body:
    {
      "name": "...",
      "geometry": { GeoJSON Polygon or MultiPolygon },
      "pin_shape": "...",
      "fill_color": "#RRGGBB",
      "stroke_color": "#RRGGBB",
      "fill_opacity": 0.15
    }
    """
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    geometry = data.get('geometry')
    pin_shape = data.get('pin_shape', 'circle')
    fill_color = data.get('fill_color', '#FF0000')
    stroke_color = data.get('stroke_color', '#FF0000')
    fill_opacity = data.get('fill_opacity', 0.15)

    if not name:
        abort(400, description="`name` is required")
    if not geometry:
        abort(400, description="`geometry` is required")

    # Validate pin shape & colors
    if pin_shape not in PIN_SHAPES:
        abort(400, description="Invalid `pin_shape`")
    for label, color in [('fill_color', fill_color), ('stroke_color', stroke_color)]:
        if not HEX_COLOR_RE.match(color):
            abort(400, description=f"Invalid {label}")

    # Accept Polygon -> wrap as MultiPolygon
    g_type = geometry.get('type')
    if g_type == 'Polygon':
        multi = {
            "type": "MultiPolygon",
            "coordinates": [geometry.get('coordinates', [])]
        }
    elif g_type == 'MultiPolygon':
        multi = geometry
    else:
        abort(400, description="`geometry` must be Polygon or MultiPolygon")

    # Persist
    area = TargetArea(
        name=name,
        geojson=json.dumps(multi),
        pin_shape=pin_shape,
        fill_color=fill_color,
        stroke_color=stroke_color,
        fill_opacity=float(fill_opacity)
    )
    db.session.add(area)
    db.session.commit()
    return jsonify(area.to_feature()), 201


@bp.route('/<int:area_id>', methods=['PUT'])
@login_required
def update_target(area_id):
    area = TargetArea.query.get_or_404(area_id)
    data = request.get_json() or {}

    if 'name' in data:
        nm = (data['name'] or '').strip()
        if not nm:
            abort(400, description="`name` cannot be empty")
        area.name = nm

    if 'geometry' in data:
        geometry = data['geometry']
        if geometry.get('type') == 'Polygon':
            geometry = {
                "type": "MultiPolygon",
                "coordinates": [geometry.get('coordinates', [])]
            }
        if geometry.get('type') != 'MultiPolygon':
            abort(400, description="`geometry` must be Polygon or MultiPolygon")
        area.geojson = json.dumps(geometry)

    if 'pin_shape' in data:
        if data['pin_shape'] not in PIN_SHAPES:
            abort(400, description="Invalid `pin_shape`")
        area.pin_shape = data['pin_shape']

    for field in ['fill_color', 'stroke_color']:
        if field in data:
            if not HEX_COLOR_RE.match(data[field]):
                abort(400, description=f"Invalid `{field}`")
            setattr(area, field, data[field])

    if 'fill_opacity' in data:
        try:
            opv = float(data['fill_opacity'])
        except ValueError:
            abort(400, description="`fill_opacity` must be numeric")
        if not (0 <= opv <= 1):
            abort(400, description="`fill_opacity` must be between 0 and 1")
        area.fill_opacity = opv

    db.session.commit()
    return jsonify(area.to_feature())


@bp.route('/<int:area_id>', methods=['DELETE'])
@login_required
def delete_target(area_id):
    area = TargetArea.query.get_or_404(area_id)
    db.session.delete(area)
    db.session.commit()
    return jsonify({"message": "Deleted"}), 204
