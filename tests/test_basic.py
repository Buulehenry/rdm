import unittest
from app import create_app, db
from app.models import User
from config import Config


class TestConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'
    SECRET_KEY = 'test-only'


class BasicTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(TestConfig)
        self.ctx = self.app.app_context()
        self.ctx.push()
        db.create_all()
        user = User(username='tester', role='admin')
        user.set_password('test-password')
        db.session.add(user)
        db.session.commit()
        self.client = self.app.test_client()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        db.engine.dispose()
        self.ctx.pop()

    def test_auth_and_dashboard(self):
        self.assertEqual(self.client.get('/dashboard').status_code, 302)
        self.client.post('/login', data={'username': 'tester', 'password': 'wrong'})
        self.assertEqual(self.client.get('/dashboard').status_code, 302)
        response = self.client.post('/login', data={
            'username': 'tester', 'password': 'test-password'
        }, follow_redirects=True)
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'id="map"', response.data)
        for path in ['/api/stations/', '/api/competitors/', '/api/targets/',
                     '/api/districts/', '/api/districts/meta', '/api/stations/rankings']:
            with self.subTest(path=path):
                result = self.client.get(path)
                self.assertEqual(result.status_code, 200)
                self.assertTrue(result.is_json)


if __name__ == '__main__':
    unittest.main()
