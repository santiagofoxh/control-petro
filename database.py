"""Database models and initialization for Control Petro."""

import os
from datetime import datetime, timedelta
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


# ------------------------------------------------------------------ #
# Multi-tenant hierarchy: Organization > RazonSocial > Station
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
# Users & Authentication
# ------------------------------------------------------------------ #

class User(db.Model):
    """User account for web and WhatsApp access."""
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), unique=True, nullable=False)
    email = db.Column(db.String(255), unique=True, nullable=True)
    password_hash = db.Column(db.String(255), nullable=False)
    name = db.Column(db.String(200), nullable=False)
    phone = db.Column(db.String(20))
    whatsapp_verified = db.Column(db.Boolean, default=False)

    role = db.Column(db.String(30), nullable=False, default="operator")

    organization_id = db.Column(db.Integer, db.ForeignKey("organizations.id"), nullable=True)
    razon_social_id = db.Column(db.Integer, db.ForeignKey("razones_sociales.id"), nullable=True)

    active = db.Column(db.Boolean, default=True)
    approved_by_admin = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_login = db.Column(db.DateTime)

    assigned_stations = db.relationship(
        "Station", secondary="user_stations", backref="assigned_users"
    )

    razon_social = db.relationship("RazonSocial", backref="users")


user_stations = db.Table(
    "user_stations",
    db.Column("user_id", db.Integer, db.ForeignKey("users.id"), primary_key=True),
    db.Column("station_id", db.Integer, db.ForeignKey("stations.id"), primary_key=True),
)


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
    magna_capacity = db.Column(db.Float, default=40000)
    premium_capacity = db.Column(db.Float, default=20000)
    diesel_capacity = db.Column(db.Float, default=40000)
    active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    razon_social_id = db.Column(db.Integer, db.ForeignKey("razones_sociales.id"), nullable=True)

    transactions = db.relationship("FuelTransaction", backref="station", lazy="dynamic")
    reports = db.relationship("Report", backref="station", lazy="dynamic")


class FuelTransaction(db.Model):
    __tablename__ = "fuel_transactions"

    id = db.Column(db.Integer, primary_key=True)
    station_id = db.Column(db.Integer, db.ForeignKey("stations.id"), nullable=False)
    fuel_type = db.Column(db.String(20), nullable=False)
    transaction_type = db.Column(db.String(20), nullable=False)
    liters = db.Column(db.Float, nullable=False)
    price_per_liter = db.Column(db.Float)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    notes = db.Column(db.String(500))

    recorded_by_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    updated_by_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    updated_at = db.Column(db.DateTime, nullable=True)
    source = db.Column(db.String(20), default="web")

    recorded_by = db.relationship("User", foreign_keys=[recorded_by_id], backref="transactions")
    updated_by = db.relationship("User", foreign_keys=[updated_by_id], backref="edited_transactions")

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

    recorded_by_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    updated_by_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    updated_at = db.Column(db.DateTime, nullable=True)

    station_ref = db.relationship("Station", backref="snapshots")
    recorded_by = db.relationship("User", foreign_keys=[recorded_by_id])
    updated_by = db.relationship("User", foreign_keys=[updated_by_id])

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


# ------------------------------------------------------------------ #
# Pemex TAR Bot Models
# ------------------------------------------------------------------ #

class PemexCredential(db.Model):
    """Encrypted credentials for Portal Comercial Pemex."""
    __tablename__ = "pemex_credentials"

    id = db.Column(db.Integer, primary_key=True)
    razon_social_id = db.Column(db.Integer, db.ForeignKey("razones_sociales.id"), nullable=True)
    label = db.Column(db.String(200))  # friendly name, e.g. "MG Demo - Pemex TI"
    portal_url = db.Column(db.String(500), default="https://www.comercialrefinacion.pemex.com/portal/")
    username_enc = db.Column(db.Text, nullable=False)   # Fernet encrypted
    password_enc = db.Column(db.Text, nullable=False)   # Fernet encrypted
    is_active = db.Column(db.Boolean, default=True)
    last_login_at = db.Column(db.DateTime)
    last_login_ok = db.Column(db.Boolean)
    last_error = db.Column(db.Text)
    consecutive_failures = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    razon_social = db.relationship("RazonSocial", backref="pemex_credentials")
    scrape_logs = db.relationship("ScrapeLog", backref="credential", lazy="dynamic")


class TARTerminal(db.Model):
    """Pemex TAR (Terminal de Almacenamiento y Reparto) master data."""
    __tablename__ = "tar_terminals"

    id = db.Column(db.Integer, primary_key=True)
    pemex_id = db.Column(db.String(30), unique=True, nullable=False)  # Pemex internal ID
    name = db.Column(db.String(200), nullable=False)
    short_name = db.Column(db.String(50))
    state = db.Column(db.String(100))
    city = db.Column(db.String(100))
    region = db.Column(db.String(100))
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    has_magna = db.Column(db.Boolean, default=True)
    has_premium = db.Column(db.Boolean, default=True)
    has_diesel = db.Column(db.Boolean, default=True)
    storage_capacity_liters = db.Column(db.Float)
    active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    availability = db.relationship("TARAvailability", backref="terminal", lazy="dynamic")
    schedules = db.relationship("TARDeliverySchedule", backref="terminal", lazy="dynamic")
    prices = db.relationship("PemexPrice", backref="terminal", lazy="dynamic")
    alerts = db.relationship("PemexAlert", backref="terminal", lazy="dynamic")


class TARAvailability(db.Model):
    """Scraped TAR availability snapshots — the core data (every 15 min)."""
    __tablename__ = "tar_availability"

    id = db.Column(db.Integer, primary_key=True)
    tar_id = db.Column(db.Integer, db.ForeignKey("tar_terminals.id"), nullable=False)
    fuel_type = db.Column(db.String(20), nullable=False)  # magna, premium, diesel
    status = db.Column(db.String(30), nullable=False)      # available, limited, closed, maintenance, unknown
    level_percent = db.Column(db.Float)          # 0-100 if portal shows it
    estimated_liters = db.Column(db.Float)       # estimated volume
    wait_time_minutes = db.Column(db.Integer)    # queue estimate
    notes = db.Column(db.Text)                   # any extra text from portal
    scraped_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    scrape_log_id = db.Column(db.Integer, db.ForeignKey("scrape_logs.id"), nullable=True)

    __table_args__ = (
        db.Index("idx_tar_avail_tar_time", "tar_id", "scraped_at"),
        db.Index("idx_tar_avail_fuel", "fuel_type"),
    )


class TARDeliverySchedule(db.Model):
    """Client-specific delivery assignments scraped from Pemex portal."""
    __tablename__ = "tar_delivery_schedules"

    id = db.Column(db.Integer, primary_key=True)
    credential_id = db.Column(db.Integer, db.ForeignKey("pemex_credentials.id"), nullable=False)
    tar_id = db.Column(db.Integer, db.ForeignKey("tar_terminals.id"), nullable=False)
    scheduled_date = db.Column(db.Date, nullable=False)
    shift_code = db.Column(db.String(20))      # e.g. "T1", "T2", "T3"
    shift_time = db.Column(db.String(50))      # e.g. "06:00-10:00"
    fuel_type = db.Column(db.String(20))
    volume_liters = db.Column(db.Float)
    status = db.Column(db.String(30))          # pending, confirmed, completed, cancelled
    scraped_at = db.Column(db.DateTime, default=datetime.utcnow)
    scrape_log_id = db.Column(db.Integer, db.ForeignKey("scrape_logs.id"), nullable=True)

    credential = db.relationship("PemexCredential", backref="schedules")

    __table_args__ = (
        db.Index("idx_tar_sched_date", "scheduled_date"),
        db.Index("idx_tar_sched_cred", "credential_id"),
    )


class PemexPrice(db.Model):
    """Fuel pricing from Pemex portal."""
    __tablename__ = "pemex_prices"

    id = db.Column(db.Integer, primary_key=True)
    tar_id = db.Column(db.Integer, db.ForeignKey("tar_terminals.id"), nullable=True)
    region = db.Column(db.String(100))
    fuel_type = db.Column(db.String(20), nullable=False)
    price_per_liter = db.Column(db.Float, nullable=False)
    price_type = db.Column(db.String(50))      # referencia, venta, ingreso
    effective_date = db.Column(db.Date, nullable=False)
    scraped_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.Index("idx_pemex_price_date", "effective_date"),
        db.Index("idx_pemex_price_fuel", "fuel_type"),
    )


class PemexAlert(db.Model):
    """Operational alerts/communications from Pemex portal."""
    __tablename__ = "pemex_alerts"

    id = db.Column(db.Integer, primary_key=True)
    tar_id = db.Column(db.Integer, db.ForeignKey("tar_terminals.id"), nullable=True)
    alert_type = db.Column(db.String(50))       # closure, maintenance, delay, policy, info
    title = db.Column(db.String(500))
    description = db.Column(db.Text)
    severity = db.Column(db.String(20))         # critical, warning, info
    effective_from = db.Column(db.DateTime)
    effective_until = db.Column(db.DateTime)
    is_active = db.Column(db.Boolean, default=True)
    scraped_at = db.Column(db.DateTime, default=datetime.utcnow)
    scrape_log_id = db.Column(db.Integer, db.ForeignKey("scrape_logs.id"), nullable=True)


class ScrapeLog(db.Model):
    """Audit trail for every Pemex scrape attempt."""
    __tablename__ = "scrape_logs"

    id = db.Column(db.Integer, primary_key=True)
    credential_id = db.Column(db.Integer, db.ForeignKey("pemex_credentials.id"), nullable=False)
    started_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    finished_at = db.Column(db.DateTime)
    status = db.Column(db.String(20), nullable=False, default="running")  # running, success, partial, failed
    pages_scraped = db.Column(db.Integer, default=0)
    records_saved = db.Column(db.Integer, default=0)
    tar_count = db.Column(db.Integer, default=0)
    error_message = db.Column(db.Text)
    duration_seconds = db.Column(db.Float)

    __table_args__ = (
        db.Index("idx_scrape_log_time", "started_at"),
        db.Index("idx_scrape_log_cred", "credential_id"),
    )
