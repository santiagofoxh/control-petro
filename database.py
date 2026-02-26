"""Database models and initialization for Control Petro."""
import os
from datetime import datetime, timedelta
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


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

    transactions = db.relationship("FuelTransaction", backref="station", lazy="dynamic")
    reports = db.relationship("Report", backref="station", lazy="dynamic")


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
    report_type = db.Column(db.String(50), nullable=False)  # sat_volumetric, cne_weekly, etc.
    report_date = db.Column(db.Date, nullable=False)
    status = db.Column(db.String(20), default="generated")  # generated, sent, error
    file_path = db.Column(db.String(500))
    sent_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    details = db.Column(db.Text)


class Prediction(db.Model):
    __tablename__ = "predictions"
    id = db.Column(db.Integer, primary_key=True)
    station_id = db.Column(db.Integer, db.ForeignKey("stations.id"), nullable=False)
    fuel_type = db.Column(db.String(20), nullable=False)
    recommended_liters = db.Column(db.Float, nullable=False)
    recommended_date = db.Column(db.DateTime, nullable=False)
    urgency = db.Column(db.String(20), default="normal")  # urgent, high, normal
    confidence = db.Column(db.Float, default=0.0)
    reason = db.Column(db.String(500))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    fulfilled = db.Column(db.Boolean, default=False)

    station_ref = db.relationship("Station", backref="predictions")
