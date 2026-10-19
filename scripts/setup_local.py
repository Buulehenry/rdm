"""Initialize local tables and create a test admin without resetting existing users."""
from pathlib import Path
import secrets
from app import create_app, db
from app.models import User

def main():
    app = create_app()
    with app.app_context():
        db.create_all()
        if not User.query.filter_by(username='localadmin').first():
            password = secrets.token_urlsafe(12)
            user = User(username='localadmin', role='admin')
            user.set_password(password)
            db.session.add(user)
            db.session.commit()
            Path('.env.local-login').write_text(
                f'Username: localadmin\nPassword: {password}\n', encoding='utf-8'
            )
        print('Local database and admin ready. Login details: .env.local-login')

if __name__ == '__main__':
    main()
