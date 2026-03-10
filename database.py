"""Database models and initialization for Control Petro."""
import os
from datetime import datetime, timedelta
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


# ------------------------------------------------------------------ #
#  Multi-tenant hierarchy: Organization > RazonSocial > Station
# ------------------------------------------------------------------ #
class Organization(db.Model):
    """Top-level company (e.g., GazPro). A client of ControlPetro."""
    __tablename__ = "organizations"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    slug = db.Column(db.String(100), unique=True, nullable=False)
    active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    razones = db.relationship("RazonSocial", backref="organization", lazy="dynamic")
    users = db.relationship("User", backref="organization", lazy="dynamic")


class RazonSocial(db.Model):
    """Business entity / LLC group within an organization. Has its own RFC."""
    __tablename__ = "razones_sociales"
    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organizations.id"), nullable=False)
    name = db.Column(db.String(200), nullable=False)
    rfc = db.Column(db.String(13), nullable=False)
    legal_name = db.Column(db.String(300))
    active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    stations = db.relationship("Station", backref="razon_social", lazy="dynamic")

    __table_args__ = (
        db.Index("idx_razon_org", "organization_id"),
    )


# ------------------------------------------------------------------ #
#  Users & Authentication
# ------------------------------------------------------------------ #
class User(db.Model):
    """User account for web and WhatsApp access."""
    __tablename__ = "users"
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    name = db.Column(db.String(200), nullable=False)
    phone = db.Column(db.String(20))  # WhatsApp number (e.g., +526561234567)
    whatsapp_verified = db.Column(db.Boolean, default=False)

    # Role: platform_admin, org_admin, group_manager, operator
    role = db.Column(db.String(30), nullable=False, default="operator")

    # Org + group scope
    organization_id = db.Column(db.Integer, db.ForeignKey("organizations.id"), nullable=True)
    # For group_manager: which Razon Social they manage
    razon_social_id = db.Column(db.Integer, db.ForeignKey("razones_sociales.id"), nullable=True)

    active = db.Column(db.Boolean, default=True)
    approved_by_admin = db.Column(db.Boolean, default=False)  # Admin approval for elevated access
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_login = db.Column(db.DateTime)

    # Stations this operator is assigned to (many-to-many)
    assigned_stations = db.relationship(
        "Station", secondary="user_stations", backref="assigned_users"
    )

    razon_social = db.relationship("RazonSocial", backref="users")


# Many-to-many: operators can be assigned to specific stations
user_stations = db.Table(
    "user_stations",
    db.Column("user_id", db.Integer, db.ForeignKey("users.id"), primary_key=True),
    db.Column("station_id", db.Integer, db.ForeignKey("stations.id"), primary_key=True),
)


# ------------------------------------------------------------------ #
#  Station (modified: now belongs to a RazonSocial)
# ------------------------------------------------------------------ #
class Station(db.Model):
    __tablename__ = "stations"
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(10), unique=True, nullable=False)
    name = db.Column(db.String(100), nullable=False)
    address = db.Column(db.String(200))
    city = db.Column(db.String(100), default="Ciudad Juarez")
    state = db.Column(db.String(100), default="Chihuahua")
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    magna_capacity = db.Column(db.Float, default=40000)  # liters
    premium_capacity = db.Column(db.Float, default=20000)
    diesel_capacity = db.Column(db.Float, default=40000)
    active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # NEW: link to Razon Social (nullable for backward compatibility during migration)
    razon_social_id = db.Column(db.Integer, db.ForeignKey("razones_sociales.id"), nullable=True)

    transactions = db.relationship("FuelTransaction", backref="station", lazy="dynamic")
    reports = db.relationship("Report", backref="station", lazy="dynamic")


# ------------------------------------------------------------------ #
#  Operational models (unchanged)
# ------------------------------------------------------------------ #
class FuelTransaction(db.Model):
    __tablename__ = "fuel_transactions"
    id = db.Column(db.Integer, primary_key=True)
    station_id = db.Column(db.Integer, db.ForeignKey("stations.id"), nullable=False)
    fuel_type = db.Column(db.String(20), nullable=False)  # magna, premium, diesel
    transaction_type = db.Column(db.String(20), nullable=False)  # received, sold
    liters = db.Column(db.Float, nullable=False)
    price_per_liter = db.Column(db.Float)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    notes = db.Column(db.String(500))
    # NEW: track who recorded this (nullable for old data)
    recorded_by_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    source = db.Column(db.String(20), default="web")  # web, whatsapp, api

    recorded_by = db.relationship("User", backref="transactions")

    __table_args__ = (
        db.Index("idx_station_date", "station_id", "timestamp"),
        db.Index("idx_fuel_type", "fuel_type"),
    )


class InventorySnapshot(db.Model):
    __tablename__ = "inventory_snapshots"
    id = db.Column(db.Integer, primary_key=True)
    station_id = db.Column(db.Integer, db.ForeignKey("stations.id"), nullable=False)
    fuel_type = db.Column(db.String(20), nullable=False)
    liters_on_hand = db.Column(db.Float, nullable=False)
    capacity = db.Column(db.Float, nullable=False)
    snapshot_date = db.Column(db.Date, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    station_ref = db.relationship("Station", backref="snapshots")

    __table_args__ = (
        db.UniqueConstraint("station_id", "fuel_type", "snapshot_date"),
        db.Index("idx_snapshot_date", "snapshot_date"),
    )


class Report(db.Model):
    __tablename__ = "reports"
    id = db.Column(db.Integer, primary_key=True)
    station_id = db.Column(db.Integer, db.ForeignKey("stations.id"), nullable=True)
    report_type = db.Column(db.String(50), nullable=False)
    report_date = db.Column(db.Date, nullable=False)
    status = db.Column(db.String(20), default="generated")
    file_path = db.Column(db.String(500))
    sent_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    details = db.Column(db.Text)
    # NEW: track who generated and for which group
    generated_by_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    razon_social_id = db.Column(db.Integer, db.ForeignKey("razones_sociales.id"), nullable=True)

    generated_by = db.relationship("User", backref="generated_reports")
    razon_social = db.relationship("RazonSocial", backref="reports")


class Prediction(db.Model):
    __tablename__ = "predictions"
    id = db.Column(db.Integer, primary_key=True)
    station_id = db.Column(db.Integer, db.ForeignKey("stations.id"), nullable=False)
    fuel_type = db.Column(db.String(20), nullable=False)
    recommended_liters = db.Column(db.Float, nullable=False)
    recommended_date = db.Column(db.DateTime, nullable=False)
    urgency = db.Column(db.String(20), default="normal")
    confidence = db.Column(db.Float, default=0.0)
    reason = db.Column(db.String(500))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    fulfilled = db.Column(db.Boolean, default=False)

    station_ref = db.relationship("Station", backref="predictions")
