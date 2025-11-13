#!/usr/bin/env python3
from app import create_app

app = create_app()

if __name__ == "__main__":
    # Bind to 0.0.0.0 so it’s reachable from your network
    app.run(host="0.0.0.0", port=5000, debug=True)
