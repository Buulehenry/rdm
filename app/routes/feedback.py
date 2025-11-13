# app/routes/feedback.py
from flask import Blueprint, request, jsonify, current_app
from flask_login import login_required, current_user
from datetime import datetime
import os, json

bp = Blueprint("feedback", __name__, url_prefix="/api/feedback")


@bp.route("/", methods=["POST"])
@login_required
def submit_feedback():
    """Accepts JSON: {subject?, message, url?, user_agent?}. Writes to a log file."""
    data = request.get_json(silent=True) or {}
    msg = (data.get("message") or "").strip()
    if not msg:
        return jsonify({"error": "message is required"}), 400

    subj = (data.get("subject") or "").strip()
    url = (data.get("url") or "").strip()
    ua = (data.get("user_agent") or "").strip()
    who = getattr(current_user, "username", "unknown")

    entry = {
        "when": datetime.utcnow().isoformat(),
        "user": who,
        "subject": subj,
        "message": msg,
        "url": url,
        "user_agent": ua,
    }

    # Append to a simple file log; switch to DB later if you like
    log_dir = os.path.join(current_app.root_path, "data")
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, "feedback.log")
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    current_app.logger.info("Feedback: %s", entry)
    return jsonify({"ok": True}), 201
