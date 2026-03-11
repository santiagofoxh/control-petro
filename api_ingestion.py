"""
 ControlPetro - Data Ingestion API (Flask Blueprint)

Endpoints for OpenClaw / WhatsApp bot to submit operational data:
  POST /api/ingest/transactions    - fuel received / sold
  POST /api/ingest/inventory       - tank level snapshot
  POST /api/ingest/check-duplicate - duplicate detection before insert
  GET  /api/ingest/identify-station - fuzzy station lookup
  GET  /api/ingest/stations-list   - all stations summary (for OpenClaw)
  GET  /api/ingest/summary         - daily summary for a station
  POST /api/ingest/link-phone      - link WhatsApp phone to user profile

All endpoints require the OPENCLAW_SERVICE_TOKEN as Bearer token.
"""

from datetime import datetime, date, timedelta
from flask import Blueprint, request, jsonify, g
from database import db, Station, FuelTransaction, InventorySnapshot, Report, User
from auth import require_auth

ingest_bp = Blueprint("ingest", __name__, url_prefix="/api/ingest")


# ------------------------------------------------------------------ #
# Helper: auto-match WhatsApp phone to user
# ------------------------------------------------------------------ #

def resolve_user_from_phone(phone_number):
    """Try to find a user by their WhatsApp phone number.
    Returns the User object if found, None otherwise.
    """
    if not phone_number:
        return None
    # Normalize: strip spaces, ensure + prefix
    phone = phone_number.strip().replace(" ", "").replace("-", "")
    if not phone.startswith("+"):
        phone = "+" + phone

    user = User.query.filter_by(phone=phone, active=True).first()
    if user:
        # Auto-verify WhatsApp if not already
        if not user.whatsapp_verified:
            user.whatsapp_verified = True
            db.session.commit()
        return user
    return None


def get_recording_user():
    """Determine which user is recording this data.
    Priority: 1) X-On-Behalf-Of header, 2) X-WhatsApp-Phone header, 3) g.current_user
    """
    # Check X-On-Behalf-Of (set by OpenClaw when it knows the user)
    behalf_user_id = request.headers.get("X-On-Behalf-Of")
    if behalf_user_id:
        user = User.query.get(int(behalf_user_id))
        if user:
            return user

    # Check X-WhatsApp-Phone (phone number from incoming WhatsApp message)
    wa_phone = request.headers.get("X-WhatsApp-Phone")
    if wa_phone:
        user = resolve_user_from_phone(wa_phone)
        if user:
            return user

    # Fallback to authenticated user
    return getattr(g, "current_user", None)


# ------------------------------------------------------------------ #
# POST /api/ingest/transactions
# Submit one or more fuel transactions (received or sold)
# ------------------------------------------------------------------ #

@ingest_bp.route("/transactions", methods=["POST"])
@require_auth
def submit_transactions():
    """
    Body (JSON):
    {
      "station_id": 3,
      "transactions": [
        {
          "fuel_type": "magna",
          "transaction_type": "received",
          "liters": 15000,
          "price_per_liter": 18.85,
          "timestamp": "2026-03-10T08:30:00",
          "notes": "Pipa #42 proveedor Pemex"
        }, ...
      ]
    }
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "JSON body required"}), 400

    station_id = data.get("station_id")
    txns = data.get("transactions", [])

    if not station_id:
        return jsonify({"error": "station_id required"}), 400
    if not txns:
        return jsonify({"error": "transactions array required (at least 1)"}), 400

    station = Station.query.get(station_id)
    if not station:
        return jsonify({"error": f"Station {station_id} not found"}), 404

    # Resolve which user is recording
    recording_user = get_recording_user()

    created = []
    for t in txns:
        fuel_type = (t.get("fuel_type") or "").lower().strip()
        txn_type = (t.get("transaction_type") or "").lower().strip()
        liters = t.get("liters")

        if fuel_type not in ("magna", "premium", "diesel"):
            return jsonify({"error": f"Invalid fuel_type: {fuel_type}"}), 400
        if txn_type not in ("received", "sold"):
            return jsonify({"error": f"Invalid transaction_type: {txn_type}"}), 400
        if not liters or liters <= 0:
            return jsonify({"error": "liters must be positive"}), 400

        ts = datetime.utcnow()
        if t.get("timestamp"):
            try:
                ts = datetime.fromisoformat(t["timestamp"])
            except ValueError:
                pass

        txn = FuelTransaction(
            station_id=station_id,
            fuel_type=fuel_type,
            transaction_type=txn_type,
            liters=liters,
            price_per_liter=t.get("price_per_liter"),
            timestamp=ts,
            notes=t.get("notes", ""),
            recorded_by_id=recording_user.id if recording_user else None,
            source="whatsapp" if request.headers.get("X-Source") == "whatsapp" else "api",
        )
        db.session.add(txn)
        created.append({
            "fuel_type": fuel_type,
            "transaction_type": txn_type,
            "liters": liters,
            "recorded_by": recording_user.username if recording_user else None,
        })

    db.session.commit()
    return jsonify({
        "ok": True,
        "station": station.name,
        "created_count": len(created),
        "transactions": created,
    }), 201


# ------------------------------------------------------------------ #
# POST /api/ingest/inventory
# Submit a tank-level inventory snapshot
# ------------------------------------------------------------------ #

@ingest_bp.route("/inventory", methods=["POST"])
@require_auth
def submit_inventory():
    """
    Body (JSON):
    {
      "station_id": 3,
      "readings": [
        {"fuel_type": "magna", "liters_on_hand": 28500},
        {"fuel_type": "premium", "liters_on_hand": 12300},
        {"fuel_type": "diesel", "liters_on_hand": 31000}
      ],
      "snapshot_date": "2026-03-10"
    }
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "JSON body required"}), 400

    station_id = data.get("station_id")
    readings = data.get("readings", [])
    snap_date_str = data.get("snapshot_date")

    if not station_id:
        return jsonify({"error": "station_id required"}), 400

    station = Station.query.get(station_id)
    if not station:
        return jsonify({"error": f"Station {station_id} not found"}), 404

    snap_date = date.today()
    if snap_date_str:
        try:
            snap_date = date.fromisoformat(snap_date_str)
        except ValueError:
            pass

    capacities = {
        "magna": station.magna_capacity,
        "premium": station.premium_capacity,
        "diesel": station.diesel_capacity,
    }

    # Resolve which user is recording
    recording_user = get_recording_user()

    saved = []
    for r in readings:
        fuel_type = (r.get("fuel_type") or "").lower().strip()
        liters = r.get("liters_on_hand")

        if fuel_type not in capacities:
            return jsonify({"error": f"Invalid fuel_type: {fuel_type}"}), 400
        if liters is None or liters < 0:
            return jsonify({"error": f"liters_on_hand required and >= 0 for {fuel_type}"}), 400

        # Upsert: replace existing snapshot for same station/fuel/date
        existing = InventorySnapshot.query.filter_by(
            station_id=station_id, fuel_type=fuel_type, snapshot_date=snap_date
        ).first()

        if existing:
            existing.liters_on_hand = liters
            existing.capacity = capacities[fuel_type]
            existing.updated_by_id = recording_user.id if recording_user else None
            existing.updated_at = datetime.utcnow()
            saved.append({"fuel_type": fuel_type, "liters": liters, "action": "updated"})
        else:
            snap = InventorySnapshot(
                station_id=station_id,
                fuel_type=fuel_type,
                liters_on_hand=liters,
                capacity=capacities[fuel_type],
                snapshot_date=snap_date,
                recorded_by_id=recording_user.id if recording_user else None,
            )
            db.session.add(snap)
            saved.append({"fuel_type": fuel_type, "liters": liters, "action": "created"})

    db.session.commit()
    return jsonify({
        "ok": True,
        "station": station.name,
        "snapshot_date": snap_date.isoformat(),
        "readings": saved,
        "recorded_by": recording_user.username if recording_user else None,
    }), 201


# ------------------------------------------------------------------ #
# POST /api/ingest/check-duplicate
# Check if a similar transaction already exists (before submitting)
# ------------------------------------------------------------------ #

@ingest_bp.route("/check-duplicate", methods=["POST"])
@require_auth
def check_duplicate():
    """
    Body (JSON):
    {
      "station_id": 3,
      "fuel_type": "magna",
      "transaction_type": "received",
      "liters": 15000,
      "date": "2026-03-10"
    }
    Returns: { "is_duplicate": true/false, "matching_transactions": [...] }
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "JSON body required"}), 400

    station_id = data.get("station_id")
    fuel_type = (data.get("fuel_type") or "").lower().strip()
    txn_type = (data.get("transaction_type") or "").lower().strip()
    liters = data.get("liters", 0)
    check_date_str = data.get("date")

    if not station_id or not fuel_type:
        return jsonify({"error": "station_id and fuel_type required"}), 400

    check_date = date.today()
    if check_date_str:
        try:
            check_date = date.fromisoformat(check_date_str)
        except ValueError:
            pass

    # Look for transactions on the same day, same station, same fuel/type
    start = datetime.combine(check_date, datetime.min.time())
    end = datetime.combine(check_date + timedelta(days=1), datetime.min.time())

    query = FuelTransaction.query.filter(
        FuelTransaction.station_id == station_id,
        FuelTransaction.fuel_type == fuel_type,
        FuelTransaction.timestamp >= start,
        FuelTransaction.timestamp < end,
    )
    if txn_type:
        query = query.filter(FuelTransaction.transaction_type == txn_type)

    matches = query.all()

    # Check for exact or near-duplicate (within 5% of liters)
    duplicates = []
    for m in matches:
        similarity = 1 - abs(m.liters - liters) / max(m.liters, liters, 1)
        if similarity > 0.95:  # within 5%
            duplicates.append({
                "id": m.id,
                "liters": m.liters,
                "timestamp": m.timestamp.isoformat(),
                "source": m.source,
                "notes": m.notes,
                "recorded_by": m.recorded_by.username if m.recorded_by else None,
                "similarity": round(similarity * 100, 1),
            })

    return jsonify({
        "is_duplicate": len(duplicates) > 0,
        "duplicate_count": len(duplicates),
        "matching_transactions": duplicates,
        "checked": {
            "station_id": station_id,
            "fuel_type": fuel_type,
            "transaction_type": txn_type,
            "liters": liters,
            "date": check_date.isoformat(),
        },
    })


# ------------------------------------------------------------------ #
# GET /api/ingest/identify-station?q=<name or code>
# Fuzzy station lookup for OpenClaw to identify which station
# ------------------------------------------------------------------ #

@ingest_bp.route("/identify-station", methods=["GET"])
@require_auth
def identify_station():
    """Query param: q=<station name, code, or partial match>"""
    q = (request.args.get("q") or "").strip().lower()
    if not q:
        return jsonify({"error": "q parameter required"}), 400

    stations = Station.query.filter(Station.active == True).all()
    results = []
    for s in stations:
        # Check code, name, address for matches
        score = 0
        if q == s.code.lower():
            score = 100
        elif q in s.name.lower():
            score = 80
        elif q in (s.address or "").lower():
            score = 60
        elif q in s.code.lower():
            score = 70

        if score > 0:
            results.append({
                "station_id": s.id,
                "code": s.code,
                "name": s.name,
                "address": s.address,
                "city": s.city,
                "match_score": score,
            })

    results.sort(key=lambda x: x["match_score"], reverse=True)

    return jsonify({
        "query": q,
        "results": results[:5],
        "exact_match": len(results) > 0 and results[0]["match_score"] == 100,
    })


# ------------------------------------------------------------------ #
# GET /api/ingest/stations-list
# Full station list with current inventory (for OpenClaw context)
# ------------------------------------------------------------------ #

@ingest_bp.route("/stations-list", methods=["GET"])
@require_auth
def stations_list():
    """Returns all active stations with their codes, names, and latest inventory."""
    stations = Station.query.filter(Station.active == True).all()
    result = []
    for s in stations:
        # Get latest inventory for each fuel type
        inventory = {}
        for ft in ("magna", "premium", "diesel"):
            snap = InventorySnapshot.query.filter_by(
                station_id=s.id, fuel_type=ft
            ).order_by(InventorySnapshot.snapshot_date.desc()).first()
            if snap:
                inventory[ft] = {
                    "liters": snap.liters_on_hand,
                    "capacity": snap.capacity,
                    "pct": round(snap.liters_on_hand / snap.capacity * 100, 1) if snap.capacity else 0,
                    "date": snap.snapshot_date.isoformat(),
                }

        result.append({
            "station_id": s.id,
            "code": s.code,
            "name": s.name,
            "address": s.address,
            "city": s.city,
            "inventory": inventory,
        })

    return jsonify({"stations": result, "count": len(result)})


# ------------------------------------------------------------------ #
# GET /api/ingest/summary?station_id=3&date=2026-03-10
# Daily summary for a station (helps OpenClaw confirm data)
# ------------------------------------------------------------------ #

@ingest_bp.route("/summary", methods=["GET"])
@require_auth
def daily_summary():
    """Returns a summary of all transactions and inventory for a station on a date."""
    station_id = request.args.get("station_id", type=int)
    date_str = request.args.get("date")

    if not station_id:
        return jsonify({"error": "station_id required"}), 400

    station = Station.query.get(station_id)
    if not station:
        return jsonify({"error": f"Station {station_id} not found"}), 404

    summary_date = date.today()
    if date_str:
        try:
            summary_date = date.fromisoformat(date_str)
        except ValueError:
            pass

    start = datetime.combine(summary_date, datetime.min.time())
    end = datetime.combine(summary_date + timedelta(days=1), datetime.min.time())

    txns = FuelTransaction.query.filter(
        FuelTransaction.station_id == station_id,
        FuelTransaction.timestamp >= start,
        FuelTransaction.timestamp < end,
    ).all()

    # Summarize by fuel type
    fuel_summary = {}
    for t in txns:
        if t.fuel_type not in fuel_summary:
            fuel_summary[t.fuel_type] = {"received": 0, "sold": 0, "transactions": 0}
        fuel_summary[t.fuel_type][t.transaction_type] += t.liters
        fuel_summary[t.fuel_type]["transactions"] += 1

    # Get inventory snapshot
    inventory = {}
    for ft in ("magna", "premium", "diesel"):
        snap = InventorySnapshot.query.filter_by(
            station_id=station_id, fuel_type=ft, snapshot_date=summary_date
        ).first()
        if snap:
            inventory[ft] = {
                "liters_on_hand": snap.liters_on_hand,
                "capacity": snap.capacity,
                "pct": round(snap.liters_on_hand / snap.capacity * 100, 1) if snap.capacity else 0,
            }

    return jsonify({
        "station": {"id": station.id, "code": station.code, "name": station.name},
        "date": summary_date.isoformat(),
        "fuel_summary": fuel_summary,
        "inventory": inventory,
        "total_transactions": len(txns),
    })


# ------------------------------------------------------------------ #
# POST /api/ingest/link-phone
# Admin: manually link a WhatsApp phone number to a user
# ------------------------------------------------------------------ #

@ingest_bp.route("/link-phone", methods=["POST"])
@require_auth
def link_phone():
    """
    Body (JSON):
    {
      "user_id": 5,
      "phone": "+526561234567"
    }
    Links a WhatsApp phone number to a user profile for auto-tagging.
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "JSON body required"}), 400

    user_id = data.get("user_id")
    phone = data.get("phone", "").strip()

    if not user_id or not phone:
        return jsonify({"error": "user_id and phone required"}), 400

    # Normalize phone
    phone = phone.replace(" ", "").replace("-", "")
    if not phone.startswith("+"):
        phone = "+" + phone

    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": f"User {user_id} not found"}), 404

    # Check if phone is already assigned to another user
    existing = User.query.filter_by(phone=phone).first()
    if existing and existing.id != user_id:
        return jsonify({
            "error": f"Este numero ya esta asignado a {existing.name} ({existing.username})",
        }), 409

    user.phone = phone
    user.whatsapp_verified = True
    db.session.commit()

    return jsonify({
        "ok": True,
        "user_id": user.id,
        "username": user.username,
        "phone": phone,
        "message": f"Telefono vinculado a {user.name}. Los datos enviados desde este numero se etiquetaran automaticamente.",
    })
