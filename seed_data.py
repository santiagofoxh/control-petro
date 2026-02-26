"""Seed the database with realistic GazPro demo data."""
import random
import numpy as np
from datetime import datetime, date, timedelta
from database import db, Station, FuelTransaction, InventorySnapshot


STATIONS = [
    {"code": "GP-001", "name": "Est. Tecnologico", "address": "Av. Tecnologico 4521, Col. Partido Iglesias", "lat": 31.6904, "lng": -106.4245, "mc": 50000, "pc": 25000, "dc": 50000},
    {"code": "GP-003", "name": "Est. Nogales", "address": "Col. Nogales 1102", "lat": 31.7020, "lng": -106.4400, "mc": 40000, "pc": 20000, "dc": 40000},
    {"code": "GP-007", "name": "Est. Pronaf", "address": "Av. Lincoln 890, Zona Pronaf", "lat": 31.7400, "lng": -106.4500, "mc": 45000, "pc": 25000, "dc": 35000},
    {"code": "GP-014", "name": "Est. Zaragoza Norte", "address": "Blvd. Zaragoza 3300", "lat": 31.6600, "lng": -106.3700, "mc": 55000, "pc": 30000, "dc": 45000},
    {"code": "GP-022", "name": "Est. Tomas Fernandez", "address": "Blvd. Tomas Fernandez 7800", "lat": 31.6800, "lng": -106.4100, "mc": 50000, "pc": 25000, "dc": 50000},
    {"code": "GP-031", "name": "Est. Panamericana Km12", "address": "Carr. Panamericana Km 12", "lat": 31.6300, "lng": -106.4000, "mc": 60000, "pc": 20000, "dc": 60000},
    {"code": "GP-038", "name": "Est. Americas", "address": "Av. de las Americas 1540", "lat": 31.7100, "lng": -106.4300, "mc": 40000, "pc": 20000, "dc": 35000},
    {"code": "GP-042", "name": "Est. Insurgentes", "address": "Av. Insurgentes 2280", "lat": 31.7200, "lng": -106.4600, "mc": 45000, "pc": 25000, "dc": 40000},
    {"code": "GP-047", "name": "Est. Partido Romero", "address": "Col. Partido Romero 560", "lat": 31.6500, "lng": -106.4200, "mc": 40000, "pc": 20000, "dc": 35000},
    {"code": "GP-055", "name": "Est. Torres", "address": "Av. de las Torres 5500", "lat": 31.6700, "lng": -106.3900, "mc": 50000, "pc": 25000, "dc": 45000},
    {"code": "GP-061", "name": "Est. Ejercito Nacional", "address": "Av. Ejercito Nacional 1200", "lat": 31.7300, "lng": -106.4400, "mc": 45000, "pc": 20000, "dc": 40000},
    {"code": "GP-067", "name": "Est. Zaragoza Sur", "address": "Blvd. Zaragoza 8900", "lat": 31.6400, "lng": -106.3600, "mc": 55000, "pc": 30000, "dc": 50000},
    {"code": "GP-073", "name": "Est. Gomez Morin", "address": "Paseo de la Victoria 3200", "lat": 31.7500, "lng": -106.4700, "mc": 40000, "pc": 25000, "dc": 35000},
    {"code": "GP-079", "name": "Est. Waterfill", "address": "Blvd. Waterfill 1800", "lat": 31.6950, "lng": -106.4150, "mc": 45000, "pc": 20000, "dc": 40000},
    {"code": "GP-085", "name": "Est. Juarez-Porvenir", "address": "Carr. Juarez-Porvenir Km 5", "lat": 31.6200, "lng": -106.3500, "mc": 50000, "pc": 20000, "dc": 55000},
    {"code": "GP-091", "name": "Est. Panamericana Sur", "address": "Carr. Panamericana Km 28", "lat": 31.5900, "lng": -106.3800, "mc": 55000, "pc": 25000, "dc": 60000},
    {"code": "GP-096", "name": "Est. Ramon Rayon", "address": "Av. Ramon Rayon 4500", "lat": 31.7050, "lng": -106.4350, "mc": 40000, "pc": 20000, "dc": 35000},
    {"code": "GP-100", "name": "Est. Paseo Triunfo", "address": "Paseo Triunfo de la Republica 6700", "lat": 31.7150, "lng": -106.4550, "mc": 50000, "pc": 25000, "dc": 45000},
    {"code": "GP-102", "name": "Est. Lopez Mateos", "address": "Av. Lopez Mateos 3100", "lat": 31.7250, "lng": -106.4650, "mc": 45000, "pc": 20000, "dc": 40000},
    {"code": "GP-105", "name": "Est. Hermanos Escobar", "address": "Av. Hermanos Escobar 5600", "lat": 31.7350, "lng": -106.4750, "mc": 40000, "pc": 25000, "dc": 35000},
]

# Base daily demand profiles (liters/day) by station size
DEMAND_PROFILES = {
    "high": {"magna": (3500, 600), "premium": (1200, 300), "diesel": (2800, 500)},
    "medium": {"magna": (2500, 400), "premium": (800, 200), "diesel": (2000, 350)},
    "low": {"magna": (1800, 300), "premium": (500, 150), "diesel": (1400, 250)},
}

# Day-of-week multipliers (Mon=0 through Sun=6)
DOW_MULTIPLIERS = [1.05, 1.0, 1.0, 1.02, 1.1, 0.9, 0.85]


def assign_demand_profile(station):
    capacity = station.magna_capacity + station.premium_capacity + station.diesel_capacity
    if capacity >= 120000:
        return "high"
    elif capacity >= 90000:
        return "medium"
    return "low"


def seed_database():
    """Create stations, transactions, and snapshots for the last 30 days."""
    print("Seeding stations...")
    stations = []
    for s in STATIONS:
        station = Station(
            code=s["code"], name=s["name"], address=s["address"],
            city="Ciudad Juarez", state="Chihuahua",
            latitude=s["lat"], longitude=s["lng"],
            magna_capacity=s["mc"], premium_capacity=s["pc"], diesel_capacity=s["dc"],
            active=True,
        )
        db.session.add(station)
        stations.append(station)
    db.session.flush()

    print(f"Created {len(stations)} stations. Generating 30 days of transaction data...")

    today = date.today()
    random.seed(42)
    np.random.seed(42)

    for station in stations:
        profile_name = assign_demand_profile(station)
        profile = DEMAND_PROFILES[profile_name]

        # Start with tanks at 70-90% full
        inventory = {}
        for ft in ["magna", "premium", "diesel"]:
            cap = getattr(station, f"{ft}_capacity")
            inventory[ft] = cap * random.uniform(0.7, 0.9)

        for day_offset in range(30, -1, -1):
            current_date = today - timedelta(days=day_offset)
            dow = current_date.weekday()
            dow_mult = DOW_MULTIPLIERS[dow]

            for ft in ["magna", "premium", "diesel"]:
                mean_demand, std_demand = profile[ft]
                daily_demand = max(0, np.random.normal(mean_demand * dow_mult, std_demand))
                cap = getattr(station, f"{ft}_capacity")

                # Simulate deliveries when inventory drops below 35%
                delivery = 0
                if inventory[ft] < cap * 0.35:
                    delivery = cap * random.uniform(0.55, 0.75)
                    delivery = round(delivery / 500) * 500

                # Apply transactions
                if delivery > 0:
                    hour = random.choice([5, 6, 7, 8])
                    ts = datetime.combine(current_date, datetime.min.time().replace(hour=hour, minute=random.randint(0, 59)))
                    tx = FuelTransaction(
                        station_id=station.id, fuel_type=ft,
                        transaction_type="received", liters=delivery,
                        price_per_liter={"magna": 21.50, "premium": 23.00, "diesel": 22.80}[ft],
                        timestamp=ts,
                    )
                    db.session.add(tx)
                    inventory[ft] += delivery

                # Distribute sales across the day (4 transaction blocks)
                remaining_demand = daily_demand
                for block_hour in [8, 12, 16, 20]:
                    block_pct = {8: 0.25, 12: 0.30, 16: 0.28, 20: 0.17}[block_hour]
                    block_liters = remaining_demand * block_pct * random.uniform(0.9, 1.1)
                    block_liters = min(block_liters, inventory[ft])
                    if block_liters > 0:
                        ts = datetime.combine(current_date, datetime.min.time().replace(
                            hour=block_hour, minute=random.randint(0, 59)
                        ))
                        tx = FuelTransaction(
                            station_id=station.id, fuel_type=ft,
                            transaction_type="sold", liters=round(block_liters, 1),
                            price_per_liter={"magna": 23.45, "premium": 25.12, "diesel": 24.78}[ft],
                            timestamp=ts,
                        )
                        db.session.add(tx)
                        inventory[ft] -= block_liters

                inventory[ft] = max(0, inventory[ft])

                # End-of-day snapshot
                snap = InventorySnapshot(
                    station_id=station.id, fuel_type=ft,
                    liters_on_hand=round(inventory[ft], 1),
                    capacity=cap,
                    snapshot_date=current_date,
                )
                db.session.add(snap)

        # Commit per station to avoid huge memory usage
        db.session.commit()

    print(f"Seeding complete. {len(stations)} stations with 30 days of data.")
    return len(stations)
