"""Seed the database with realistic GazPro demo data."""

import random
import numpy as np
from datetime import datetime, date, timedelta

from database import (
    db, Organization, RazonSocial, User, Station,
    FuelTransaction, InventorySnapshot,
)
from auth import hash_password

ORG = {"name": "GazPro", "slug": "gazpro"}

RAZONES = [
    {"name": "GazPro Norte", "rfc": "GNO210315AB1", "legal_name": "Gasolinera GazPro Norte SA de CV"},
    {"name": "GazPro Sur", "rfc": "GSU210315CD2", "legal_name": "Gasolinera GazPro Sur SA de CV"},
]

RAZON_STATIONS = {
    "GazPro Norte": ["GP-EJR", "GP-MOR", "GP-ANA", "GP-CHA"],
    "GazPro Sur": ["GP-K20", "GP-FUN", "GP-AME", "GP-INS"],
}

USERS = [
    {
        "username": "santiago",
        "email": "santiago@controlpetro.com",
        "password": "admin123",
        "name": "Santiago Fox",
        "phone": "+526561000001",
        "role": "platform_admin",
        "razon": None,
        "approved": True,
    },
    {
        "username": "carlos.medina",
        "email": "carlos@gazpro.mx",
        "password": "gazpro123",
        "name": "Carlos Medina",
        "phone": "+526561000002",
        "role": "org_admin",
        "razon": None,
        "approved": True,
    },
    {
        "username": "lucia.torres",
        "email": "lucia@gazpro.mx",
        "password": "gazpro123",
        "name": "Lucia Torres",
        "phone": "+526561000003",
        "role": "group_manager",
        "razon": "GazPro Norte",
        "approved": True,
    },
    {
        "username": "roberto.gonzalez",
        "email": "roberto@gazpro.mx",
        "password": "gazpro123",
        "name": "Roberto Gonzalez",
        "phone": "+526561000004",
        "role": "group_manager",
        "razon": "GazPro Sur",
        "approved": True,
    },
    {
        "username": "maria.sanchez",
        "email": "maria@gazpro.mx",
        "password": "operator1",
        "name": "Maria Sanchez",
        "phone": "+526561000005",
        "role": "operator",
        "razon": "GazPro Norte",
        "stations": ["GP-EJR", "GP-MOR"],
        "approved": True,
    },
    {
        "username": "jorge.ramirez",
        "email": "jorge@gazpro.mx",
        "password": "operator2",
        "name": "Jorge Ramirez",
        "phone": "+526561000006",
        "role": "operator",
        "razon": "GazPro Sur",
        "stations": ["GP-K20"],
        "approved": False,
    },
    {
        "username": "demogazpro",
        "email": "demo@gazpro.mx",
        "password": "demogazpro",
        "name": "Demo GazPro",
        "phone": "+526561000099",
        "role": "org_admin",
        "razon": None,
        "approved": True,
    },
]

STATIONS = [
    {"code": "GP-EJR", "name": "Gazpro Ejercito", "address": "Av. Ejercito Nacional 8694",
     "lat": 31.7282, "lng": -106.4468, "mc": 50000, "pc": 25000, "dc": 45000},
    {"code": "GP-MOR", "name": "Gazpro Morin", "address": "Blvd. Manuel Gomez Morin 7396",
     "lat": 31.7435, "lng": -106.4380, "mc": 50000, "pc": 25000, "dc": 45000},
    {"code": "GP-ANA", "name": "Gazpro Anapra", "address": "Blvd. Bernardo Norzagaray 3520",
     "lat": 31.7830, "lng": -106.5320, "mc": 45000, "pc": 20000, "dc": 40000},
    {"code": "GP-K20", "name": "Gazpro K20", "address": "Carr. Panamericana 10325",
     "lat": 31.6310, "lng": -106.3990, "mc": 55000, "pc": 20000, "dc": 55000},
    {"code": "GP-FUN", "name": "Gazpro Fundadores", "address": "Blvd. Talamas Camandari 1900",
     "lat": 31.6950, "lng": -106.4240, "mc": 45000, "pc": 25000, "dc": 40000},
    {"code": "GP-AME", "name": "Gazpro Americas", "address": "Av. de la Raza, Col. Centro",
     "lat": 31.7100, "lng": -106.4440, "mc": 40000, "pc": 20000, "dc": 35000},
    {"code": "GP-CHA", "name": "Gazpro Charro", "address": "Paseo Triunfo de la Republica / Av. del Charro",
     "lat": 31.7190, "lng": -106.4600, "mc": 50000, "pc": 25000, "dc": 45000},
    {"code": "GP-INS", "name": "Gazpro Insurgentes", "address": "Av. de los Insurgentes 2980",
     "lat": 31.7220, "lng": -106.4560, "mc": 45000, "pc": 20000, "dc": 40000},
]

DEMAND_PROFILES = {
    "high":   {"magna": (3500, 600), "premium": (1200, 300), "diesel": (2800, 500)},
    "medium": {"magna": (2500, 400), "premium": (800, 200),  "diesel": (2000, 350)},
    "low":    {"magna": (1800, 300), "premium": (500, 150),  "diesel": (1400, 250)},
}

DOW_MULTIPLIERS = [1.05, 1.0, 1.0, 1.02, 1.1, 0.9, 0.85]


def assign_demand_profile(station):
    capacity = station.magna_capacity + station.premium_capacity + station.diesel_capacity
    if capacity >= 120000:
        return "high"
    elif capacity >= 90000:
        return "medium"
    return "low"


def seed_database():
    print("Seeding organization...")
    org = Organization(name=ORG["name"], slug=ORG["slug"], active=True)
    db.session.add(org)
    db.session.flush()

    print("Seeding razones sociales...")
    razon_map = {}
    for r in RAZONES:
        rs = RazonSocial(
            organization_id=org.id, name=r["name"], rfc=r["rfc"],
            legal_name=r["legal_name"], active=True,
        )
        db.session.add(rs)
        razon_map[r["name"]] = rs
    db.session.flush()

    print("Seeding stations...")
    station_map = {}
    code_to_razon = {}
    for razon_name, codes in RAZON_STATIONS.items():
        for code in codes:
            code_to_razon[code] = razon_name

    stations = []
    for s in STATIONS:
        razon_name = code_to_razon.get(s["code"])
        razon = razon_map.get(razon_name) if razon_name else None
        station = Station(
            code=s["code"], name=s["name"], address=s["address"],
            city="Ciudad Juarez", state="Chihuahua",
            latitude=s["lat"], longitude=s["lng"],
            magna_capacity=s["mc"], premium_capacity=s["pc"], diesel_capacity=s["dc"],
            razon_social_id=razon.id if razon else None, active=True,
        )
        db.session.add(station)
        stations.append(station)
        station_map[s["code"]] = station
    db.session.flush()

    print("Seeding users...")
    for u in USERS:
        razon = razon_map.get(u.get("razon")) if u.get("razon") else None
        user = User(
            username=u["username"],
            email=u.get("email"),
            password_hash=hash_password(u["password"]),
            name=u["name"],
            phone=u.get("phone"),
            role=u["role"],
            organization_id=org.id,
            razon_social_id=razon.id if razon else None,
            active=True,
            approved_by_admin=u.get("approved", False),
        )
        db.session.add(user)
        db.session.flush()
        if u.get("stations"):
            for code in u["stations"]:
                st = station_map.get(code)
                if st:
                    user.assigned_stations.append(st)

    db.session.commit()
    print(f"Created {len(USERS)} users, 1 org, {len(RAZONES)} razones sociales.")
    db.session.commit()
    print(f"Created {len(USERS)} users, 1 org, {len(RAZONES)} razones sociales.")

    # ---- 5. Transaction data (30 days) ----
    print(f"Generating 30 days of transaction data for {len(stations)} stations...")
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
                    ts = datetime.combine(current_date, datetime.min.time().replace(
                        hour=hour, minute=random.randint(0, 59)
                    ))
                    tx = FuelTransaction(
                        station_id=station.id,
                        fuel_type=ft,
                        transaction_type="received",
                        liters=delivery,
                        price_per_liter={"magna": 17.20, "premium": 18.80, "diesel": 20.60}[ft],
                        timestamp=ts,
                        source="web",
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
                            station_id=station.id,
                            fuel_type=ft,
                            transaction_type="sold",
                            liters=round(block_liters, 1),
                            price_per_liter={"magna": 18.85, "premium": 20.60, "diesel": 22.50}[ft],
                            timestamp=ts,
                            source="web",
                        )
                        db.session.add(tx)
                        inventory[ft] -= block_liters

                inventory[ft] = max(0, inventory[ft])

                # End-of-day snapshot
                snap = InventorySnapshot(
                    station_id=station.id,
                    fuel_type=ft,
                    liters_on_hand=round(inventory[ft], 1),
                    capacity=cap,
                    snapshot_date=current_date,
                )
                db.session.add(snap)

        # Commit per station to avoid huge memory usage
        db.session.commit()

    print(f"Seeding complete. {len(stations)} stations with 30 days of data.")
    return len(stations)
