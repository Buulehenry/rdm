"""Run the local test instance on loopback with debug mode disabled."""
from pathlib import Path
import os
import secrets
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
env_file = ROOT / '.env'
if not env_file.exists():
    env_file.write_text('SECRET_KEY=' + secrets.token_hex(32) + '\n', encoding='utf-8')
load_dotenv(env_file)

from app import create_app
from waitress import serve

if __name__ == '__main__':
    (ROOT / 'local.pid').write_text(str(os.getpid()), encoding='ascii')
    serve(create_app(), host='127.0.0.1', port=5055)
