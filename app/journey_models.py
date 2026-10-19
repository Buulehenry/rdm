"""Journey plans reference existing users and stations; GPS traces are never stored."""
from datetime import datetime, timezone
from app import db


def utcnow():
    return datetime.now(timezone.utc)


def timestamp(value):
    # SQLite drops timezone metadata. All actual event times are stored as UTC.
    if value is None:
        return None
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()


class Journey(db.Model):
    __tablename__ = 'journey'
    id = db.Column(db.Integer, primary_key=True)
    creator_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, index=True)
    assigned_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, index=True)
    name = db.Column(db.String(160), nullable=False)
    journey_date = db.Column(db.Date, nullable=False, index=True)
    status = db.Column(db.String(20), nullable=False, default='draft', index=True)
    paused = db.Column(db.Boolean, nullable=False, default=False)
    specification = db.Column(db.JSON, nullable=False)
    plan = db.Column(db.JSON, nullable=True)
    version = db.Column(db.Integer, nullable=False, default=1)
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    creator = db.relationship('User', foreign_keys=[creator_id])
    assigned_user = db.relationship('User', foreign_keys=[assigned_user_id])
    stops = db.relationship('JourneyStop', order_by='JourneyStop.sequence', cascade='all, delete-orphan', lazy='selectin')
    __mapper_args__ = {'version_id_col': version}

    def to_dict(self):
        return dict(id=self.id, name=self.name, creator_id=self.creator_id,
                    assigned_user_id=self.assigned_user_id, assigned_user=self.assigned_user.username,
                    journey_date=self.journey_date.isoformat(), status=self.status, paused=self.paused,
                    specification=self.specification, plan=self.plan, version=self.version,
                    created_at=timestamp(self.created_at), updated_at=timestamp(self.updated_at),
                    stops=[s.to_dict() for s in self.stops])


class JourneyStop(db.Model):
    __tablename__ = 'journey_stop'
    id = db.Column(db.Integer, primary_key=True)
    journey_id = db.Column(db.Integer, db.ForeignKey('journey.id'), nullable=False, index=True)
    station_id = db.Column(db.Integer, db.ForeignKey('station.id'), nullable=False, index=True)
    sequence = db.Column(db.Integer, nullable=False)
    visit_minutes = db.Column(db.Integer, nullable=False)
    planned_arrival = db.Column(db.DateTime(timezone=True), nullable=True)
    status = db.Column(db.String(20), nullable=False, default='pending')
    arrival_at = db.Column(db.DateTime(timezone=True), nullable=True)
    departure_at = db.Column(db.DateTime(timezone=True), nullable=True)
    notes = db.Column(db.Text, nullable=False, default='')
    station = db.relationship('Station')
    __table_args__ = (db.UniqueConstraint('journey_id', 'sequence', name='uq_journey_sequence'),)

    def to_dict(self):
        return dict(id=self.id, station_id=self.station_id, name=self.station.name,
                    latitude=self.station.latitude, longitude=self.station.longitude,
                    sequence=self.sequence, visit_minutes=self.visit_minutes, status=self.status,
                    planned_arrival=(self.planned_arrival.isoformat() if self.planned_arrival.tzinfo else self.planned_arrival.isoformat()+'+03:00') if self.planned_arrival else None,
                    arrival_at=timestamp(self.arrival_at), departure_at=timestamp(self.departure_at), notes=self.notes)


class JourneyBase(db.Model):
    __tablename__ = 'journey_base'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), unique=True, nullable=False)
    name = db.Column(db.String(100), nullable=False)
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
