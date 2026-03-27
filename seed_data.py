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



def seed_mgdemo():
    """Seed the MG Demo organization with 10 stations and mock data."""
    from database import db, Organization, RazonSocial, User, Station, FuelTransaction, InventorySnapshot
    from auth import hash_password
    import random
    from datetime import datetime, date, timedelta

    # Check if already seeded
    existing = Organization.query.filter_by(slug="mgdemo").first()
    if existing:
        print("MG Demo already seeded, skipping.")
        return 0

    # --- Organization ---
    org = Organization(name="MG Combustibles", slug="mgdemo")
    db.session.add(org)
    db.session.flush()

    # --- Razones Sociales ---
    razon_norte = RazonSocial(
        organization_id=org.id,
        name="MG Combustibles Norte",
        rfc="MCN230101AA1",
        legal_name="MG Combustibles del Norte SA de CV",
    )
    razon_sur = RazonSocial(
        organization_id=org.id,
        name="MG Combustibles Sur",
        rfc="MCS230101BB2",
        legal_name="MG Combustibles del Sur SA de CV",
    )
    db.session.add_all([razon_norte, razon_sur])
    db.session.flush()

    # --- 10 Stations in Monterrey ---
    MG_STATIONS = [
        {"code": "MG-CTR", "name": "MG Centro", "address": "Av. Constitucion 1500, Centro",
         "lat": 25.6714, "lng": -100.3090, "mc": 50000, "pc": 25000, "dc": 45000, "razon": "norte"},
        {"code": "MG-GAR", "name": "MG Garza Sada", "address": "Av. Eugenio Garza Sada 4200",
         "lat": 25.6300, "lng": -100.2880, "mc": 55000, "pc": 30000, "dc": 50000, "razon": "norte"},
        {"code": "MG-SPN", "name": "MG San Pedro Norte", "address": "Av. Vasconcelos 1200, San Pedro",
         "lat": 25.6600, "lng": -100.3560, "mc": 45000, "pc": 30000, "dc": 35000, "razon": "norte"},
        {"code": "MG-LIN", "name": "MG Lincoln", "address": "Av. Lincoln 3800, Col. Mitras",
         "lat": 25.7050, "lng": -100.3350, "mc": 50000, "pc": 25000, "dc": 40000, "razon": "norte"},
        {"code": "MG-UNI", "name": "MG Universidad", "address": "Av. Universidad 1000, San Nicolas",
         "lat": 25.7460, "lng": -100.2870, "mc": 60000, "pc": 25000, "dc": 55000, "razon": "norte"},
        {"code": "MG-SUR", "name": "MG Contry", "address": "Av. Lazaro Cardenas 2500, Contry",
         "lat": 25.6480, "lng": -100.3150, "mc": 45000, "pc": 20000, "dc": 40000, "razon": "sur"},
        {"code": "MG-APO", "name": "MG Apodaca", "address": "Blvd. Miguel de la Madrid 500, Apodaca",
         "lat": 25.7720, "lng": -100.2100, "mc": 55000, "pc": 20000, "dc": 60000, "razon": "sur"},
        {"code": "MG-ESC", "name": "MG Escobedo", "address": "Carr. a Laredo Km 15, Escobedo",
         "lat": 25.7980, "lng": -100.3200, "mc": 50000, "pc": 20000, "dc": 55000, "razon": "sur"},
        {"code": "MG-GPE", "name": "MG Guadalupe", "address": "Av. Eloy Cavazos 3200, Guadalupe",
         "lat": 25.6770, "lng": -100.2540, "mc": 45000, "pc": 25000, "dc": 40000, "razon": "sur"},
        {"code": "MG-STA", "name": "MG Santa Catarina", "address": "Carr. Saltillo 2000, Santa Catarina",
         "lat": 25.6730, "lng": -100.4580, "mc": 50000, "pc": 20000, "dc": 50000, "razon": "sur"},
    ]

    stations = []
    for s in MG_STATIONS:
        razon = razon_norte if s["razon"] == "norte" else razon_sur
        station = Station(
            code=s["code"],
            name=s["name"],
            address=s["address"],
            city="Monterrey",
            state="Nuevo Leon",
            latitude=s["lat"],
            longitude=s["lng"],
            magna_capacity=s["mc"],
            premium_capacity=s["pc"],
            diesel_capacity=s["dc"],
            razon_social_id=razon.id,
        )
        db.session.add(station)
        stations.append(station)
    db.session.flush()

    # --- Update mgdemo user ---
    mgdemo_user = User.query.filter_by(email="mgdemo").first()
    if not mgdemo_user:
        mgdemo_user = User.query.filter(
            (User.name == "mgdemo") | (User.email.like("%mgdemo%"))
        ).first()
    if mgdemo_user:
        mgdemo_user.organization_id = org.id
        mgdemo_user.razon_social_id = razon_norte.id
        mgdemo_user.role = "org_admin"
        mgdemo_user.approved_by_admin = True
        mgdemo_user.stations = stations
    else:
        mgdemo_user = User(
            email="mgdemo",
            password_hash=hash_password("hdcb1352"),
            name="MG Demo Admin",
            role="org_admin",
            organization_id=org.id,
            approved_by_admin=True,
        )
        db.session.add(mgdemo_user)
        db.session.flush()
        mgdemo_user.stations = stations

    # --- Generate 30 days of mock transactions ---
    DEMAND = {
        "MG-CTR": {"magna": (4000, 700), "premium": (1500, 400), "diesel": (3000, 600)},
        "MG-GAR": {"magna": (4500, 800), "premium": (2000, 500), "diesel": (3500, 700)},
        "MG-SPN": {"magna": (3000, 500), "premium": (2500, 600), "diesel": (2000, 400)},
        "MG-LIN": {"magna": (3500, 600), "premium": (1200, 300), "diesel": (2800, 500)},
        "MG-UNI": {"magna": (5000, 900), "premium": (1500, 400), "diesel": (4000, 800)},
        "MG-SUR": {"magna": (3200, 550), "premium": (1000, 250), "diesel": (2500, 500)},
        "MG-APO": {"magna": (4200, 750), "premium": (800, 200), "diesel": (4500, 900)},
        "MG-ESC": {"magna": (3800, 650), "premium": (900, 220), "diesel": (4000, 800)},
        "MG-GPE": {"magna": (3000, 500), "premium": (1100, 280), "diesel": (2500, 500)},
        "MG-STA": {"magna": (3500, 600), "premium": (800, 200), "diesel": (3500, 700)},
    }
    PRICES = {"magna": 19.25, "premium": 21.10, "diesel": 23.00}
    today = date.today()
    start_date = today - timedelta(days=30)

    for station in stations:
        demand_profile = DEMAND.get(station.code, {"magna": (3500, 600), "premium": (1200, 300), "diesel": (2800, 500)})
        for ft in ["magna", "premium", "diesel"]:
            cap = {"magna": station.magna_capacity, "premium": station.premium_capacity, "diesel": station.diesel_capacity}[ft]
            inventory = cap * random.uniform(0.5, 0.8)
            mean_demand, std_demand = demand_profile[ft]

            current_date = start_date
            while current_date <= today:
                daily_demand = max(500, random.gauss(mean_demand, std_demand))

                # Delivery if below 40%
                if inventory < cap * 0.4:
                    delivery = cap * random.uniform(0.5, 0.7)
                    ts = datetime.combine(current_date, datetime.min.time().replace(
                        hour=random.choice([5, 6, 7]), minute=random.randint(0, 59)
                    ))
                    tx = FuelTransaction(
                        station_id=station.id, fuel_type=ft, transaction_type="received",
                        liters=round(delivery, 1),
                        price_per_liter={"magna": 17.80, "premium": 19.60, "diesel": 21.40}[ft],
                        timestamp=ts, source="web",
                    )
                    db.session.add(tx)
                    inventory += delivery

                # Sales across the day
                remaining = daily_demand
                for bh in [8, 12, 16, 20]:
                    pct = {8: 0.25, 12: 0.30, 16: 0.28, 20: 0.17}[bh]
                    block = remaining * pct * random.uniform(0.9, 1.1)
                    block = min(block, inventory)
                    if block > 0:
                        ts = datetime.combine(current_date, datetime.min.time().replace(
                            hour=bh, minute=random.randint(0, 59)
                        ))
                        tx = FuelTransaction(
                            station_id=station.id, fuel_type=ft, transaction_type="sold",
                            liters=round(block, 1), price_per_liter=PRICES[ft],
                            timestamp=ts, source="web",
                        )
                        db.session.add(tx)
                        inventory -= block
                    inventory = max(0, inventory)

                # End-of-day snapshot
                snap = InventorySnapshot(
                    station_id=station.id, fuel_type=ft,
                    liters_on_hand=round(inventory, 1), capacity=cap,
                    snapshot_date=current_date,
                )
                db.session.add(snap)
                current_date += timedelta(days=1)

        db.session.commit()

    print(f"MG Demo seeded: {len(stations)} stations with 30 days of data.")
    return len(stations)
