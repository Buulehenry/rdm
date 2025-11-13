# app/models.py
from __future__ import annotations

import json
import re
from datetime import datetime, date

from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    DateTime,
    Date,
    Text,
    ForeignKey,
    UniqueConstraint,
    Index,
)
from sqlalchemy.orm import relationship, backref

from app import db

# ----------------------------
# Constants & Validators
# ----------------------------

# Frontend + routes consume these
STATION_CATEGORIES = {"rubis", "competitor", "target"}
PIN_SHAPES = {
    "marker",
    "circle",
    "square",
    "triangle",
    "rubis_pin",
    "shell_pin",
    "total_pin",
}
HEX_COLOR_RE = re.compile(r"^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$")

# Your region set (extend anytime)
REGION_CHOICES = [
    "Kampala Central",
    "Kampala Western",
    "Northern",
    "Western",
    "Eastern",
    "South Western",
]

# ----------------------------
# Auth / RBAC
# ----------------------------


class User(db.Model, UserMixin):
    __tablename__ = "user"

    id = Column(Integer, primary_key=True)
    username = Column(String(80), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    # roles: admin | analyst | viewer
    role = Column(String(20), nullable=False, default="viewer", index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def set_password(self, raw: str):
        self.password_hash = generate_password_hash(raw)

    def check_password(self, raw: str) -> bool:
        return check_password_hash(self.password_hash, raw)


# ----------------------------
# Master Data: Competitors
# ----------------------------


class Competitor(db.Model):
    __tablename__ = "competitor"

    id = Column(Integer, primary_key=True)
    name = Column(String(128), unique=True, nullable=False, index=True)
    pin_color = Column(String(16), nullable=False, default="#ff4d4d")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Station relationship (competitor stations)
    stations = relationship(
        "Station",
        backref=backref("competitor", lazy=True),
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="select",
        foreign_keys="Station.competitor_id",
    )


# ----------------------------
# Districts (optional GeoJSON boundaries)
# ----------------------------


class District(db.Model):
    __tablename__ = "district"

    id = Column(Integer, primary_key=True)
    name = Column(String(128), unique=True, nullable=False, index=True)
    # one of REGION_CHOICES; kept free-text for flexibility
    region = Column(String(64), nullable=False, index=True)
    # Optional boundary for drawing/filtering (MultiPolygon recommended)
    geojson = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def to_dict(self):
        gj = None
        if self.geojson:
            try:
                gj = json.loads(self.geojson)
            except Exception:
                gj = None
        return {"id": self.id, "name": self.name, "region": self.region, "geometry": gj}


# ----------------------------
# Stations
# ----------------------------


class Station(db.Model):
    __tablename__ = "station"

    id = Column(Integer, primary_key=True)
    name = Column(String(128), nullable=False, index=True)

    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)

    # "rubis" | "competitor" | "target"
    category = Column(String(20), nullable=False, default="rubis", index=True)

    # Styling
    pin_shape = Column(String(20), nullable=False, default="marker")
    pin_color = Column(String(16), nullable=False, default="#2E7D32")

    # Competitor link iff category="competitor"
    competitor_id = Column(
        Integer,
        ForeignKey("competitor.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Region/District linkage
    # Keep both (denormalized) for fast filters; district carries FK if available
    region = Column(String(64), nullable=True, index=True)
    district_id = Column(
        Integer,
        ForeignKey("district.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    district = relationship("District", backref=backref("stations", lazy=True))

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (Index("ix_station_lat_lng", "latitude", "longitude"),)

    # -------- GeoJSON helpers --------
    def _competitor_bits(self):
        cid = self.competitor_id
        cname = None
        if self.category == "competitor" and self.competitor:
            cname = self.competitor.name
        return cid, cname

    def to_feature(self) -> dict:
        """
        GeoJSON Feature for /api/stations (Point).
        """
        cid, cname = self._competitor_bits()
        props = {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "pin_shape": self.pin_shape,
            "pin_color": self.pin_color,
            "competitor_id": cid,
            "competitor_name": cname,
            "region": self.region,
            "district": self.district.name if self.district else None,
        }
        return {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [self.longitude, self.latitude],
            },
            "properties": props,
        }

    def to_dict(self) -> dict:
        cid, cname = self._competitor_bits()
        return {
            "id": self.id,
            "name": self.name,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "category": self.category,
            "pin_shape": self.pin_shape,
            "pin_color": self.pin_color,
            "competitor_id": cid,
            "competitor_name": cname,
            "region": self.region,
            "district_id": self.district_id,
            "district": self.district.name if self.district else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


# ----------------------------
# Target Areas (polygons)
# ----------------------------


class TargetArea(db.Model):
    __tablename__ = "target_area"

    id = Column(Integer, primary_key=True)
    name = Column(String(128), nullable=False, index=True)

    # Stored as text; should be a MultiPolygon GeoJSON object
    geojson = Column(Text, nullable=False)

    # Styling
    pin_shape = Column(String(20), nullable=False, default="circle")
    fill_color = Column(String(16), nullable=False, default="#FF0000")
    stroke_color = Column(String(16), nullable=False, default="#FF0000")
    fill_opacity = Column(Float, nullable=False, default=0.15)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def to_feature(self) -> dict:
        """
        GeoJSON Feature for /api/targets (MultiPolygon).
        """
        try:
            geom = json.loads(self.geojson)
        except Exception:
            geom = None

        return {
            "type": "Feature",
            "geometry": geom,
            "properties": {
                "id": self.id,
                "name": self.name,
                "pin_shape": self.pin_shape,
                "fill_color": self.fill_color,
                "outline_color": self.stroke_color,
                "fill_opacity": float(self.fill_opacity),
            },
        }


# ----------------------------
# Daily Volumes (Performance)
# ----------------------------


class DailyVolume(db.Model):
    __tablename__ = "daily_volume"
    id = db.Column(db.Integer, primary_key=True)
    station_id = db.Column(db.Integer, db.ForeignKey("station.id"), nullable=False)
    date = db.Column(db.Date, nullable=False)
    volume = db.Column(db.Float, nullable=False, default=0)

    __table_args__ = (
        UniqueConstraint("station_id", "date", name="uq_volume_station_date"),
    )


class StationVolume(db.Model):
    __tablename__ = "station_volume"

    id = Column(Integer, primary_key=True)
    station_id = Column(
        Integer,
        ForeignKey("station.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    d = Column("date", Date, nullable=False, index=True)
    volume = Column(Float, nullable=False)  # Liters (or your chosen unit)

    station = relationship(
        "Station",
        backref=backref("volumes", lazy="select", cascade="all, delete-orphan"),
    )

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("station_id", "date", name="uq_station_date"),
        Index("ix_station_volume_station_date", "station_id", "date"),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "station_id": self.station_id,
            "date": self.d.isoformat(),
            "volume": self.volume,
        }


# ----------------------------
# Utility: Assign region by district (optional helper)
# ----------------------------


def assign_station_region_from_district(st: Station):
    """
    Keep station.region in sync from its district (if present).
    """
    if st and st.district and st.district.region:
        st.region = st.district.region
