"""Seed TAR Terminal master data and mock availability.

Contains real Pemex TAR terminal locations across Mexico.
Also generates mock availability data for dashboard development.
"""

import random
from datetime import datetime, timedelta


# Real Pemex TAR terminals across Mexico (subset of 73 national TARs)
TAR_TERMINALS = [
    # Northern Mexico (most relevant for Chihuahua/Juarez clients)
    {"pemex_id": "TAR-CHI-001", "name": "TAR Ciudad Juarez", "short_name": "Juarez", "state": "Chihuahua", "city": "Ciudad Juarez", "region": "Norte", "lat": 31.6904, "lon": -106.4245},
    {"pemex_id": "TAR-CHI-002", "name": "TAR Chihuahua", "short_name": "Chihuahua", "state": "Chihuahua", "city": "Chihuahua", "region": "Norte", "lat": 28.6353, "lon": -106.0889},
    {"pemex_id": "TAR-NLE-001", "name": "TAR Cadereyta", "short_name": "Cadereyta", "state": "Nuevo Leon", "city": "Cadereyta", "region": "Norte", "lat": 25.5833, "lon": -99.9833},
    {"pemex_id": "TAR-NLE-002", "name": "TAR Monterrey", "short_name": "Monterrey", "state": "Nuevo Leon", "city": "Monterrey", "region": "Norte", "lat": 25.6866, "lon": -100.3161},
    {"pemex_id": "TAR-TAM-001", "name": "TAR Reynosa", "short_name": "Reynosa", "state": "Tamaulipas", "city": "Reynosa", "region": "Norte", "lat": 26.0508, "lon": -98.2303},
    {"pemex_id": "TAR-TAM-002", "name": "TAR Ciudad Madero", "short_name": "Cd Madero", "state": "Tamaulipas", "city": "Ciudad Madero", "region": "Norte", "lat": 22.2764, "lon": -97.8361},
    {"pemex_id": "TAR-COA-001", "name": "TAR Saltillo", "short_name": "Saltillo", "state": "Coahuila", "city": "Saltillo", "region": "Norte", "lat": 25.4232, "lon": -100.9924},
    {"pemex_id": "TAR-COA-002", "name": "TAR Monclova", "short_name": "Monclova", "state": "Coahuila", "city": "Monclova", "region": "Norte", "lat": 26.9072, "lon": -101.4200},
    {"pemex_id": "TAR-SON-001", "name": "TAR Hermosillo", "short_name": "Hermosillo", "state": "Sonora", "city": "Hermosillo", "region": "Noroeste", "lat": 29.0729, "lon": -110.9559},
    {"pemex_id": "TAR-SON-002", "name": "TAR Guaymas", "short_name": "Guaymas", "state": "Sonora", "city": "Guaymas", "region": "Noroeste", "lat": 27.9333, "lon": -110.9000},
    {"pemex_id": "TAR-SIN-001", "name": "TAR Culiacan", "short_name": "Culiacan", "state": "Sinaloa", "city": "Culiacan", "region": "Noroeste", "lat": 24.7994, "lon": -107.3940},
    {"pemex_id": "TAR-SIN-002", "name": "TAR Mazatlan", "short_name": "Mazatlan", "state": "Sinaloa", "city": "Mazatlan", "region": "Noroeste", "lat": 23.2494, "lon": -106.4111},
    {"pemex_id": "TAR-DUR-001", "name": "TAR Durango", "short_name": "Durango", "state": "Durango", "city": "Durango", "region": "Norte", "lat": 24.0278, "lon": -104.6532},
    {"pemex_id": "TAR-BCN-001", "name": "TAR Rosarito", "short_name": "Rosarito", "state": "Baja California", "city": "Rosarito", "region": "Noroeste", "lat": 32.3633, "lon": -117.0542},
    # Central Mexico
    {"pemex_id": "TAR-MEX-001", "name": "TAR Azcapotzalco", "short_name": "Azcapotzalco", "state": "CDMX", "city": "Ciudad de Mexico", "region": "Centro", "lat": 19.4978, "lon": -99.1836},
    {"pemex_id": "TAR-MEX-002", "name": "TAR Barranca del Muerto", "short_name": "Barranca", "state": "CDMX", "city": "Ciudad de Mexico", "region": "Centro", "lat": 19.3547, "lon": -99.1822},
    {"pemex_id": "TAR-MEX-003", "name": "TAR Satelite Norte", "short_name": "Satelite", "state": "Estado de Mexico", "city": "Tlanepantla", "region": "Centro", "lat": 19.5355, "lon": -99.2301},
    {"pemex_id": "TAR-PUE-001", "name": "TAR Puebla", "short_name": "Puebla", "state": "Puebla", "city": "Puebla", "region": "Centro", "lat": 19.0414, "lon": -98.2063},
    {"pemex_id": "TAR-QRO-001", "name": "TAR Queretaro", "short_name": "Queretaro", "state": "Queretaro", "city": "Queretaro", "region": "Centro", "lat": 20.5888, "lon": -100.3899},
    {"pemex_id": "TAR-GTO-001", "name": "TAR Leon", "short_name": "Leon", "state": "Guanajuato", "city": "Leon", "region": "Bajio", "lat": 21.1221, "lon": -101.6840},
    {"pemex_id": "TAR-GTO-002", "name": "TAR Salamanca", "short_name": "Salamanca", "state": "Guanajuato", "city": "Salamanca", "region": "Bajio", "lat": 20.5732, "lon": -101.1953},
    {"pemex_id": "TAR-AGS-001", "name": "TAR Aguascalientes", "short_name": "Aguascalientes", "state": "Aguascalientes", "city": "Aguascalientes", "region": "Bajio", "lat": 21.8818, "lon": -102.2916},
    {"pemex_id": "TAR-SLP-001", "name": "TAR San Luis Potosi", "short_name": "SLP", "state": "San Luis Potosi", "city": "San Luis Potosi", "region": "Centro", "lat": 22.1565, "lon": -100.9855},
    # Pacific / Western Mexico
    {"pemex_id": "TAR-JAL-001", "name": "TAR Guadalajara", "short_name": "Guadalajara", "state": "Jalisco", "city": "Guadalajara", "region": "Occidente", "lat": 20.6597, "lon": -103.3496},
    {"pemex_id": "TAR-JAL-002", "name": "TAR Zapopan", "short_name": "Zapopan", "state": "Jalisco", "city": "Zapopan", "region": "Occidente", "lat": 20.7175, "lon": -103.3900},
    {"pemex_id": "TAR-MIC-001", "name": "TAR Morelia", "short_name": "Morelia", "state": "Michoacan", "city": "Morelia", "region": "Occidente", "lat": 19.7060, "lon": -101.1950},
    {"pemex_id": "TAR-NAY-001", "name": "TAR Tepic", "short_name": "Tepic", "state": "Nayarit", "city": "Tepic", "region": "Occidente", "lat": 21.5085, "lon": -104.8946},
    {"pemex_id": "TAR-COL-001", "name": "TAR Manzanillo", "short_name": "Manzanillo", "state": "Colima", "city": "Manzanillo", "region": "Occidente", "lat": 19.1138, "lon": -104.3383},
    # Southern / Southeast Mexico
    {"pemex_id": "TAR-VER-001", "name": "TAR Veracruz", "short_name": "Veracruz", "state": "Veracruz", "city": "Veracruz", "region": "Golfo", "lat": 19.1738, "lon": -96.1342},
    {"pemex_id": "TAR-VER-002", "name": "TAR Poza Rica", "short_name": "Poza Rica", "state": "Veracruz", "city": "Poza Rica", "region": "Golfo", "lat": 20.5333, "lon": -97.4500},
    {"pemex_id": "TAR-OAX-001", "name": "TAR Salina Cruz", "short_name": "Salina Cruz", "state": "Oaxaca", "city": "Salina Cruz", "region": "Sur", "lat": 16.1658, "lon": -95.2000},
    {"pemex_id": "TAR-TAB-001", "name": "TAR Villahermosa", "short_name": "Villahermosa", "state": "Tabasco", "city": "Villahermosa", "region": "Sureste", "lat": 17.9892, "lon": -92.9475},
    {"pemex_id": "TAR-YUC-001", "name": "TAR Merida", "short_name": "Merida", "state": "Yucatan", "city": "Merida", "region": "Sureste", "lat": 20.9674, "lon": -89.5926},
    {"pemex_id": "TAR-CHP-001", "name": "TAR Tuxtla Gutierrez", "short_name": "Tuxtla", "state": "Chiapas", "city": "Tuxtla Gutierrez", "region": "Sureste", "lat": 16.7528, "lon": -93.1152},
    {"pemex_id": "TAR-GRO-001", "name": "TAR Acapulco", "short_name": "Acapulco", "state": "Guerrero", "city": "Acapulco", "region": "Sur", "lat": 16.8531, "lon": -99.8237},
    {"pemex_id": "TAR-QRO-002", "name": "TAR Progreso", "short_name": "Progreso", "state": "Yucatan", "city": "Progreso", "region": "Sureste", "lat": 21.2817, "lon": -89.6628},
]


def seed_tar_terminals(db_session):
    """Insert TAR terminal master data into the database."""
    from database import TARTerminal

    created = 0
    for t in TAR_TERMINALS:
        existing = TARTerminal.query.filter_by(pemex_id=t["pemex_id"]).first()
        if existing:
            continue
        terminal = TARTerminal(
            pemex_id=t["pemex_id"],
            name=t["name"],
            short_name=t["short_name"],
            state=t["state"],
            city=t["city"],
            region=t["region"],
            latitude=t["lat"],
            longitude=t["lon"],
            has_magna=True,
            has_premium=True,
            has_diesel=True,
            storage_capacity_liters=random.uniform(5_000_000, 50_000_000),
            active=True,
        )
        db_session.add(terminal)
        created += 1

    db_session.commit()
    print(f"Seeded {created} TAR terminals ({len(TAR_TERMINALS)} total defined)")
    return created


def seed_mock_availability(db_session, hours_back=24):
    """Generate mock availability data for all TARs for dashboard development.

    Creates realistic-looking data with some TARs closed, limited, etc.
    """
    from database import TARTerminal, TARAvailability

    terminals = TARTerminal.query.filter_by(active=True).all()
    if not terminals:
        print("No TAR terminals found. Run seed_tar_terminals first.")
        return

    now = datetime.utcnow()
    records = 0

    for terminal in terminals:
        # Each terminal gets a "personality" - some are usually available,
        # some are problematic
        reliability = random.uniform(0.5, 0.98)

        for minutes_ago in range(0, hours_back * 60, 15):
            timestamp = now - timedelta(minutes=minutes_ago)

            for fuel_type in ["magna", "premium", "diesel"]:
                # Determine status based on reliability and randomness
                roll = random.random()
                if roll < reliability * 0.8:
                    status = "available"
                    level = random.uniform(40, 95)
                elif roll < reliability * 0.95:
                    status = "limited"
                    level = random.uniform(15, 40)
                elif roll < 0.98:
                    status = "closed"
                    level = random.uniform(0, 15)
                else:
                    status = "maintenance"
                    level = None

                avail = TARAvailability(
                    tar_id=terminal.id,
                    fuel_type=fuel_type,
                    status=status,
                    level_percent=round(level, 1) if level else None,
                    estimated_liters=round(level / 100 * (terminal.storage_capacity_liters or 10_000_000) / 3, 0) if level else None,
                    wait_time_minutes=random.randint(0, 120) if status in ("available", "limited") else None,
                    scraped_at=timestamp,
                )
                db_session.add(avail)
                records += 1

    db_session.commit()
    print(f"Seeded {records} mock availability records for {len(terminals)} terminals")
    return records


def seed_mock_prices(db_session, days_back=30):
    """Generate mock Pemex price data."""
    from database import PemexPrice

    base_prices = {"magna": 22.50, "premium": 24.80, "diesel": 23.90}
    regions = ["Norte", "Noroeste", "Centro", "Bajio", "Occidente", "Golfo", "Sur", "Sureste"]
    records = 0

    for day in range(days_back):
        effective_date = (datetime.utcnow() - timedelta(days=day)).date()
        for region in regions:
            for fuel_type, base in base_prices.items():
                # Small daily variation
                variation = random.uniform(-0.30, 0.30)
                # Regional variation
                region_adj = {"Norte": 0.15, "Noroeste": 0.20, "Centro": 0, "Sur": -0.10}.get(region, 0.05)
                price = round(base + variation + region_adj, 2)

                p = PemexPrice(
                    region=region,
                    fuel_type=fuel_type,
                    price_per_liter=price,
                    price_type="referencia",
                    effective_date=effective_date,
                    scraped_at=datetime.combine(effective_date, datetime.min.time()),
                )
                db_session.add(p)
                records += 1

    db_session.commit()
    print(f"Seeded {records} mock price records")
    return records


def seed_mock_alerts(db_session):
    """Generate a few mock Pemex alerts."""
    from database import PemexAlert, TARTerminal

    terminals = TARTerminal.query.limit(5).all()
    now = datetime.utcnow()

    alerts_data = [
        {"type": "maintenance", "severity": "warning", "title": "Mantenimiento programado",
         "desc": "Mantenimiento preventivo en sistema de bombeo. Capacidad reducida al 50%."},
        {"type": "closure", "severity": "critical", "title": "Cierre temporal por inspeccion",
         "desc": "La terminal estara cerrada por inspeccion regulatoria de ASEA."},
        {"type": "delay", "severity": "warning", "title": "Demoras en carga",
         "desc": "Tiempos de espera superiores a 2 horas por alta demanda."},
        {"type": "info", "severity": "info", "title": "Nuevo horario de operacion",
         "desc": "A partir del lunes, horario extendido de 05:00 a 23:00 hrs."},
        {"type": "policy", "severity": "info", "title": "Actualizacion de tarifas",
         "desc": "Nuevas tarifas de servicio aplicables a partir del 1ro del mes."},
    ]

    records = 0
    for i, alert_info in enumerate(alerts_data):
        tar = terminals[i] if i < len(terminals) else None
        alert = PemexAlert(
            tar_id=tar.id if tar else None,
            alert_type=alert_info["type"],
            title=alert_info["title"],
            description=alert_info["desc"],
            severity=alert_info["severity"],
            effective_from=now - timedelta(hours=random.randint(1, 48)),
            effective_until=now + timedelta(hours=random.randint(24, 168)),
            is_active=True,
            scraped_at=now - timedelta(hours=random.randint(0, 6)),
        )
        db_session.add(alert)
        records += 1

    db_session.commit()
    print(f"Seeded {records} mock alerts")
    return records


def seed_all_pemex_data(db_session):
    """Run all Pemex seeding functions."""
    print("--- Seeding Pemex TAR data ---")
    seed_tar_terminals(db_session)
    seed_mock_availability(db_session, hours_back=24)
    seed_mock_prices(db_session, days_back=30)
    seed_mock_alerts(db_session)
    print("--- Pemex TAR data seeding complete ---")
