"""Control Petro v2 - AI platform for Mexican petroleum distributors.

Now with multi-tenant auth, organization hierarchy, and OpenClaw integration.
"""

import os
import json
from datetime import datetime, date, timedelta

from flask import Flask, jsonify, request, send_from_directory, send_file, abort, g

from database import (
    db, Station, FuelTransaction, InventorySnapshot,
    Report, Prediction, Organization, RazonSocial, User,
)
from auth import (
    require_auth, optional_auth, require_role,
    hash_password, verify_password, create_token,
    get_accessible_station_ids, get_accessible_razon_ids,
)

import reports
import predictions
import sat_xml_generator
import report_fast

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, static_folder="static", template_folder="templates")

# ------------------------------------------------------------------ #
# Database configuration: PostgreSQL (Render) or SQLite (local dev)
# ------------------------------------------------------------------ #
DATABASE_URL = os.environ.get("DATABASE_URL", "")

if DATABASE_URL:
    # Render provides postgres:// but SQLAlchemy needs postgresql://
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
    app.config["SQLALCHEMY_DATABASE_URI"] = DATABASE_URL
else:
    # Fallback to SQLite for local development
    app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{os.path.join(BASE_DIR, 'controlpetro.db')}"

app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["JSON_SORT_KEYS"] = False

db.init_app(app)

# Register data-ingestion blueprint (OpenClaw / WhatsApp endpoints)
from api_ingestion import ingest_bp
app.register_blueprint(ingest_bp)


# ------------------------------------------------------------------ #
# Serve frontend - routing based on subdomain/host
# ------------------------------------------------------------------ #

# Hosts that serve the authenticated app (not the landing page)
APP_HOSTS = {"app.controlpetro.com", "control-petro.onrender.com"}


@app.route("/")
def index():
    """Serve landing page or app based on subdomain."""
    host = request.host.split(":")[0]
    if host in APP_HOSTS:
        # App domain: redirect to login if no token, otherwise serve dashboard
        return send_from_directory("static", "index.html")
    # Landing page domain (controlpetro.com, localhost, etc.)
    return send_from_directory("static", "landing.html")


@app.route("/demo")
def demo():
    return send_from_directory("static", "index.html")

@app.route("/article")
def article():
    return send_from_directory("static", "article.html")

@app.route("/info")
def info():
    return send_from_directory("static", "info.html")

@app.route("/erp-comercializadora")
def erp_comercializadora():
        return send_from_directory("static", "erp-comercializadora.html")


# ------------------------------------------------------------------ #
# SEO: robots.txt and sitemap.xml served at root
# ------------------------------------------------------------------ #

@app.route("/robots.txt")
def robots_txt():
    return send_from_directory("static", "robots.txt", mimetype="text/plain")

@app.route("/sitemap.xml")
def sitemap_xml():
    return send_from_directory("static", "sitemap.xml", mimetype="application/xml")


@app.route("/google07cd26ef5b7dc759.html")
def google_verification():
    return send_from_directory("static", "google07cd26ef5b7dc759.html")


@app.route("/login")
def login_page():
    """Serve login page for the authenticated app."""
    return send_from_directory("static", "login.html")


@app.route("/static/<path:path>")
def serve_static(path):
    return send_from_directory("static", path)


# ------------------------------------------------------------------ #
# Auth: Login, Register, Profile
# ------------------------------------------------------------------ #

@app.route("/api/auth/login", methods=["POST"])
def api_login():
    """Authenticate user with username + password and return JWT token."""
    data = request.json or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")

    if not username or not password:
        return jsonify({"error": "Usuario y contrasena requeridos."}), 400

    user = User.query.filter_by(username=username).first()
    if not user or not verify_password(password, user.password_hash):
        return jsonify({"error": "Credenciales incorrectas."}), 401

    if not user.active:
        return jsonify({"error": "Cuenta desactivada. Contacta al administrador."}), 403

    user.last_login = datetime.utcnow()
    db.session.commit()

    token = create_token(user)
    return jsonify({
        "token": token,
        "user": {
            "id": user.id,
            "username": user.username,
            "name": user.name,
            "role": user.role,
            "organization_id": user.organization_id,
            "razon_social_id": user.razon_social_id,
            "approved": user.approved_by_admin,
        },
    })


@app.route("/api/demo-config")
def api_demo_config():
    """Return the service token for dashboard use (same-origin only)."""
    token = os.environ.get("OPENCLAW_SERVICE_TOKEN", "")
    if not token:
        return jsonify({"error": "Service token not configured"}), 500
    return jsonify({"token": token})


@app.route("/api/auth/register", methods=["POST"])
def api_register():
    """Register a new operator account (pending admin approval for elevated access)."""
    data = request.json or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")
    name = data.get("name", "").strip()
    phone = data.get("phone", "").strip()
    email = data.get("email", "").strip().lower() or None

    if not username or not password or not name:
        return jsonify({"error": "Usuario, nombre y contrasena requeridos."}), 400

    if len(username) < 3:
        return jsonify({"error": "El usuario debe tener al menos 3 caracteres."}), 400

    if len(password) < 8:
        return jsonify({"error": "Contrasena debe tener al menos 8 caracteres."}), 400

    if User.query.filter_by(username=username).first():
        return jsonify({"error": "Este usuario ya esta registrado."}), 409

    if email and User.query.filter_by(email=email).first():
        return jsonify({"error": "Este email ya esta registrado."}), 409

    user = User(
        username=username,
        email=email,
        password_hash=hash_password(password),
        name=name,
        phone=phone,
        role="operator",
        approved_by_admin=False,
    )
    db.session.add(user)
    db.session.commit()

    token = create_token(user)
    return jsonify({
        "token": token,
        "user": {
            "id": user.id,
            "username": user.username,
            "name": user.name,
            "role": user.role,
            "approved": user.approved_by_admin,
        },
        "message": "Cuenta creada. Un administrador debe asignarte estaciones.",
    }), 201


@app.route("/api/auth/me")
@require_auth
def api_me():
    """Get current user profile."""
    user = g.current_user
    if not user:
        return jsonify({"role": "platform_admin", "is_service": True})

    result = {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "name": user.name,
        "phone": user.phone,
        "role": user.role,
        "organization_id": user.organization_id,
        "razon_social_id": user.razon_social_id,
        "approved": user.approved_by_admin,
        "whatsapp_verified": user.whatsapp_verified,
    }

    # Include org/group names
    if user.organization:
        result["organization_name"] = user.organization.name
    if user.razon_social:
        result["razon_social_name"] = user.razon_social.name

    # Include accessible stations
    station_ids = get_accessible_station_ids()
    result["accessible_station_count"] = len(station_ids)

    return jsonify(result)


# ------------------------------------------------------------------ #
# Admin: User Management
# ------------------------------------------------------------------ #

@app.route("/api/admin/users")
@require_auth
@require_role("platform_admin", "org_admin")
def api_list_users():
    """List users (filtered by org for org_admin)."""
    user = g.current_user
    query = User.query
    if user and user.role == "org_admin":
        query = query.filter_by(organization_id=user.organization_id)
    users = query.order_by(User.created_at.desc()).all()
    return jsonify([{
        "id": u.id,
        "username": u.username,
        "email": u.email,
        "name": u.name,
        "phone": u.phone,
        "role": u.role,
        "organization_id": u.organization_id,
        "razon_social_id": u.razon_social_id,
        "active": u.active,
        "approved": u.approved_by_admin,
        "whatsapp_verified": u.whatsapp_verified,
        "last_login": u.last_login.isoformat() if u.last_login else None,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    } for u in users])


@app.route("/api/admin/users/<int:user_id>", methods=["PATCH"])
@require_auth
@require_role("platform_admin", "org_admin")
def api_update_user(user_id):
    """Update user role, org, group assignment, approval status."""
    target = User.query.get_or_404(user_id)
    data = request.json or {}

    # org_admin can only manage users in their org
    if g.current_user and g.current_user.role == "org_admin":
        if target.organization_id != g.current_user.organization_id:
            return jsonify({"error": "No tienes acceso a este usuario."}), 403

    if "role" in data:
        allowed_roles = ["operator", "group_manager", "org_admin", "platform_admin"]
        if data["role"] not in allowed_roles:
            return jsonify({"error": f"Rol invalido. Opciones: {', '.join(allowed_roles)}"}), 400
        # Only platform_admin can create platform_admins
        if data["role"] == "platform_admin" and (not g.current_user or g.current_user.role != "platform_admin"):
            return jsonify({"error": "Solo un platform_admin puede asignar ese rol."}), 403
        target.role = data["role"]

    if "organization_id" in data:
        target.organization_id = data["organization_id"]
    if "razon_social_id" in data:
        target.razon_social_id = data["razon_social_id"]
    if "approved_by_admin" in data:
        target.approved_by_admin = data["approved_by_admin"]
    if "active" in data:
        target.active = data["active"]
    if "station_ids" in data:
        # Assign stations to operator
        stations = Station.query.filter(Station.id.in_(data["station_ids"])).all()
        target.assigned_stations = stations

    db.session.commit()
    return jsonify({"success": True, "user_id": target.id})


# ------------------------------------------------------------------ #
# Admin: Organizations & Razones Sociales
# ------------------------------------------------------------------ #

@app.route("/api/admin/organizations")
@require_auth
@require_role("platform_admin")
def api_list_organizations():
    orgs = Organization.query.order_by(Organization.name).all()
    return jsonify([{
        "id": o.id,
        "name": o.name,
        "slug": o.slug,
        "active": o.active,
        "razon_count": o.razones.count(),
        "user_count": o.users.count(),
    } for o in orgs])


@app.route("/api/admin/organizations", methods=["POST"])
@require_auth
@require_role("platform_admin")
def api_create_organization():
    data = request.json or {}
    name = data.get("name", "").strip()
    slug = data.get("slug", "").strip().lower().replace(" ", "-")
    if not name or not slug:
        return jsonify({"error": "Nombre y slug requeridos."}), 400
    if Organization.query.filter_by(slug=slug).first():
        return jsonify({"error": "Ese slug ya existe."}), 409
    org = Organization(name=name, slug=slug)
    db.session.add(org)
    db.session.commit()
    return jsonify({"success": True, "id": org.id}), 201


@app.route("/api/admin/razones-sociales")
@require_auth
@require_role("platform_admin", "org_admin")
def api_list_razones():
    user = g.current_user
    query = RazonSocial.query
    if user and user.role == "org_admin":
        query = query.filter_by(organization_id=user.organization_id)
    razones = query.order_by(RazonSocial.name).all()
    return jsonify([{
        "id": r.id,
        "organization_id": r.organization_id,
        "name": r.name,
        "rfc": r.rfc,
        "legal_name": r.legal_name,
        "active": r.active,
        "station_count": r.stations.count(),
    } for r in razones])


@app.route("/api/admin/razones-sociales", methods=["POST"])
@require_auth
@require_role("platform_admin", "org_admin")
def api_create_razon():
    data = request.json or {}
    org_id = data.get("organization_id")
    name = data.get("name", "").strip()
    rfc = data.get("rfc", "").strip().upper()
    if not name or not rfc or not org_id:
        return jsonify({"error": "organization_id, nombre y RFC requeridos."}), 400
    # org_admin can only create in their org
    if g.current_user and g.current_user.role == "org_admin":
        if org_id != g.current_user.organization_id:
            return jsonify({"error": "No puedes crear grupos en otra organizacion."}), 403
    razon = RazonSocial(
        organization_id=org_id, name=name, rfc=rfc,
        legal_name=data.get("legal_name", ""),
    )
    db.session.add(razon)
    db.session.commit()
    return jsonify({"success": True, "id": razon.id}), 201



# ------------------------------------------------------------------ #
#  API: Razones Sociales (public — for the selector dropdown)
# ------------------------------------------------------------------ #
@app.route("/api/razones-sociales")
@optional_auth
def api_razones_sociales():
    """Return list of Razones Sociales accessible to current user."""
    station_ids = get_accessible_station_ids()
    if station_ids:
        razon_ids = db.session.query(Station.razon_social_id).filter(
            Station.id.in_(station_ids), Station.razon_social_id.isnot(None)
        ).distinct().all()
        razon_ids = [r[0] for r in razon_ids]
    else:
        razon_ids = []

    razones = RazonSocial.query.filter(RazonSocial.id.in_(razon_ids)).order_by(RazonSocial.name).all()
    return jsonify([{
        "id": r.id,
        "name": r.name,
        "rfc": r.rfc,
        "station_count": Station.query.filter_by(razon_social_id=r.id, active=True).count(),
    } for r in razones])


def _apply_razon_filter(station_ids):
    """If ?razon_id= is in the request, narrow station_ids to that razon social."""
    razon_id = request.args.get("razon_id", type=int)
    if razon_id and station_ids:
        razon_station_ids = [s.id for s in Station.query.filter_by(
            razon_social_id=razon_id, active=True
        ).all()]
        return [sid for sid in station_ids if sid in razon_station_ids]
    return station_ids



@app.route("/api/razones-sociales", methods=["POST"])
@optional_auth
def api_create_razon_public():
    """Create a new Razon Social."""
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    rfc = data.get("rfc", "").strip()
    if not name:
        return jsonify({"error": "Nombre es requerido."}), 400
    org = Organization.query.first()
    if not org:
        org = Organization(name="Default", slug="default")
        db.session.add(org)
        db.session.commit()
    razon = RazonSocial(name=name, rfc=rfc or "XAXX010101000", organization_id=org.id)
    db.session.add(razon)
    db.session.commit()
    return jsonify({"success": True, "id": razon.id, "name": razon.name}), 201


@app.route("/api/razones-sociales/<int:razon_id>", methods=["PUT"])
@optional_auth
def api_update_razon_public(razon_id):
    """Update a Razon Social name/RFC."""
    razon = RazonSocial.query.get_or_404(razon_id)
    data = request.get_json() or {}
    if "name" in data and data["name"].strip():
        razon.name = data["name"].strip()
    if "rfc" in data:
        razon.rfc = data["rfc"].strip()
    db.session.commit()
    return jsonify({"success": True, "id": razon.id, "name": razon.name})


@app.route("/api/razones-sociales/<int:razon_id>", methods=["DELETE"])
@optional_auth
def api_delete_razon_public(razon_id):
    """Delete a Razon Social. Unassigns its stations first."""
    razon = RazonSocial.query.get_or_404(razon_id)
    Station.query.filter_by(razon_social_id=razon_id).update({"razon_social_id": None})
    db.session.delete(razon)
    db.session.commit()
    return jsonify({"success": True})


@app.route("/api/razones-sociales/<int:razon_id>/stations", methods=["PUT"])
@optional_auth
def api_set_razon_stations(razon_id):
    """Set which stations belong to this Razon Social."""
    RazonSocial.query.get_or_404(razon_id)
    data = request.get_json() or {}
    station_ids = data.get("station_ids", [])
    Station.query.filter_by(razon_social_id=razon_id).update({"razon_social_id": None})
    if station_ids:
        Station.query.filter(Station.id.in_(station_ids)).update(
            {"razon_social_id": razon_id}, synchronize_session="fetch")
    db.session.commit()
    return jsonify({"success": True, "station_count": Station.query.filter_by(razon_social_id=razon_id).count()})


@app.route("/api/razones-sociales/detail")
@optional_auth
def api_razones_detail():
    """Return razones with their assigned station IDs for the management UI."""
    razones = RazonSocial.query.order_by(RazonSocial.name).all()
    all_stations = Station.query.filter_by(active=True).order_by(Station.name).all()
    return jsonify({
        "razones": [{"id": r.id, "name": r.name, "rfc": r.rfc,
            "station_ids": [s.id for s in Station.query.filter_by(razon_social_id=r.id, active=True).all()],
        } for r in razones],
        "all_stations": [{"id": s.id, "code": s.code, "name": s.name, "razon_social_id": s.razon_social_id} for s in all_stations],
    })

# ------------------------------------------------------------------ #
# API: Dashboard (now scope-filtered)
# ------------------------------------------------------------------ #

@app.route("/api/dashboard")
@optional_auth
def api_dashboard():
    today = date.today()
    start = datetime.combine(today, datetime.min.time())
    end = datetime.combine(today, datetime.max.time())
    station_ids = _apply_razon_filter(get_accessible_station_ids())

    # Total liters sold today (scoped)
    sold_query = db.session.query(
        db.func.coalesce(db.func.sum(FuelTransaction.liters), 0)
    ).filter(
        FuelTransaction.transaction_type == "sold",
        FuelTransaction.timestamp.between(start, end),
    )
    if station_ids:
        sold_query = sold_query.filter(FuelTransaction.station_id.in_(station_ids))
    total_sold = sold_query.scalar()

    # Sold by fuel type
    fuel_sold = {}
    for ft in ["magna", "premium", "diesel"]:
        fq = db.session.query(
            db.func.coalesce(db.func.sum(FuelTransaction.liters), 0)
        ).filter(
            FuelTransaction.transaction_type == "sold",
            FuelTransaction.fuel_type == ft,
            FuelTransaction.timestamp.between(start, end),
        )
        if station_ids:
            fq = fq.filter(FuelTransaction.station_id.in_(station_ids))
        fuel_sold[ft] = float(fq.scalar())

    # Yesterday comparison
    ystart = datetime.combine(today - timedelta(days=1), datetime.min.time())
    yend = datetime.combine(today - timedelta(days=1), datetime.max.time())
    yq = db.session.query(
        db.func.coalesce(db.func.sum(FuelTransaction.liters), 0)
    ).filter(
        FuelTransaction.transaction_type == "sold",
        FuelTransaction.timestamp.between(ystart, yend),
    )
    if station_ids:
        yq = yq.filter(FuelTransaction.station_id.in_(station_ids))
    yesterday_sold = yq.scalar()
    change_pct = ((float(total_sold) - float(yesterday_sold)) / float(yesterday_sold) * 100) if yesterday_sold else 0

    # Station counts by alert level (scoped)
    stations = Station.query.filter(Station.id.in_(station_ids)).all() if station_ids else []
    critical_count = 0
    low_count = 0
    normal_count = 0

    for station in stations:
        worst = 100
        for ft in ["magna", "premium", "diesel"]:
            snap = InventorySnapshot.query.filter_by(
                station_id=station.id, fuel_type=ft, snapshot_date=today,
            ).first()
            cap = getattr(station, f"{ft}_capacity", 40000)
            pct = (snap.liters_on_hand / cap * 100) if (snap and cap > 0) else 50
            worst = min(worst, pct)
        if worst < 25:
            critical_count += 1
        elif worst < 40:
            low_count += 1
        else:
            normal_count += 1

    # Reports status
    today_reports = Report.query.filter_by(report_date=today).count()

    # Pending predictions
    pending_orders = Prediction.query.filter(
        Prediction.fulfilled == False,
        Prediction.recommended_date >= datetime.combine(today, datetime.min.time()),
    )
    if station_ids:
        pending_orders = pending_orders.filter(Prediction.station_id.in_(station_ids))
    pending_count = pending_orders.count()

    return jsonify({
        "total_sold_today": float(total_sold),
        "fuel_sold": fuel_sold,
        "change_pct": round(change_pct, 1),
        "active_stations": len(stations),
        "critical_stations": critical_count,
        "low_stations": low_count,
        "normal_stations": normal_count,
        "reports_today": today_reports,
        "pending_orders": pending_count,
        "date": today.isoformat(),
    })


@app.route("/api/dashboard/sales-chart")
@optional_auth
def api_sales_chart():
    days = request.args.get("days", 7, type=int)
    today = date.today()
    station_ids = _apply_razon_filter(get_accessible_station_ids())

    result = []
    for d in range(days - 1, -1, -1):
        target = today - timedelta(days=d)
        start = datetime.combine(target, datetime.min.time())
        end = datetime.combine(target, datetime.max.time())
        day_data = {"date": target.isoformat(), "label": target.strftime("%d %b")}
        for ft in ["magna", "premium", "diesel"]:
            fq = db.session.query(
                db.func.coalesce(db.func.sum(FuelTransaction.liters), 0)
            ).filter(
                FuelTransaction.transaction_type == "sold",
                FuelTransaction.fuel_type == ft,
                FuelTransaction.timestamp.between(start, end),
            )
            if station_ids:
                fq = fq.filter(FuelTransaction.station_id.in_(station_ids))
            day_data[ft] = float(fq.scalar())
        day_data["total"] = day_data["magna"] + day_data["premium"] + day_data["diesel"]
        result.append(day_data)

    return jsonify(result)


# ------------------------------------------------------------------ #
# API: Stations (scope-filtered)
# ------------------------------------------------------------------ #

@app.route("/api/stations")
@optional_auth
def api_stations():
    today = date.today()
    station_ids = _apply_razon_filter(get_accessible_station_ids())
    stations = Station.query.filter(Station.id.in_(station_ids)).order_by(Station.code).all() if station_ids else []

    result = []
    for s in stations:
        levels = {}
        worst_pct = 100
        for ft in ["magna", "premium", "diesel"]:
            snap = InventorySnapshot.query.filter_by(
                station_id=s.id, fuel_type=ft, snapshot_date=today,
            ).first()
            cap = getattr(s, f"{ft}_capacity", 40000)
            liters = snap.liters_on_hand if snap else 0
            pct = (liters / cap * 100) if cap > 0 else 0
            levels[ft] = {"liters": round(liters, 0), "capacity": cap, "pct": round(pct, 1)}
            worst_pct = min(worst_pct, pct)

        start = datetime.combine(today, datetime.min.time())
        end = datetime.combine(today, datetime.max.time())
        today_sold = db.session.query(
            db.func.coalesce(db.func.sum(FuelTransaction.liters), 0)
        ).filter(
            FuelTransaction.station_id == s.id,
            FuelTransaction.transaction_type == "sold",
            FuelTransaction.timestamp.between(start, end),
        ).scalar()

        has_report = Report.query.filter_by(report_date=today).filter(
            (Report.station_id == s.id) | (Report.station_id.is_(None))
        ).first()

        status = "normal" if worst_pct > 40 else ("low" if worst_pct > 25 else "critical")

        result.append({
            "id": s.id,
            "code": s.code,
            "name": s.name,
            "address": s.address,
            "city": s.city,
            "razon_social_id": s.razon_social_id,
            "levels": levels,
            "today_sold": float(today_sold),
            "sat_compliant": has_report is not None,
            "status": status,
        })

    return jsonify(result)


@app.route("/api/stations/<int:station_id>")
@require_auth
def api_station_detail(station_id):
    station_ids = _apply_razon_filter(get_accessible_station_ids())
    if station_id not in station_ids:
        return jsonify({"error": "No tienes acceso a esta estacion."}), 403

    station = Station.query.get_or_404(station_id)
    today = date.today()
    levels = {}
    for ft in ["magna", "premium", "diesel"]:
        snap = InventorySnapshot.query.filter_by(
            station_id=station.id, fuel_type=ft, snapshot_date=today,
        ).first()
        cap = getattr(station, f"{ft}_capacity", 40000)
        liters = snap.liters_on_hand if snap else 0
        levels[ft] = {"liters": round(liters, 0), "capacity": cap, "pct": round(liters/cap*100, 1) if cap > 0 else 0}

    return jsonify({
        "id": station.id,
        "code": station.code,
        "name": station.name,
        "address": station.address,
        "city": station.city,
        "razon_social_id": station.razon_social_id,
        "levels": levels,
        "magna_capacity": station.magna_capacity,
        "premium_capacity": station.premium_capacity,
        "diesel_capacity": station.diesel_capacity,
    })


# ------------------------------------------------------------------ #
# API: Inventory (scope-filtered)
# ------------------------------------------------------------------ #

@app.route("/api/inventory/summary")
@optional_auth
def api_inventory_summary():
    today = date.today()
    station_ids = _apply_razon_filter(get_accessible_station_ids())
    summary = {"magna": 0, "premium": 0, "diesel": 0, "total_capacity": {"magna": 0, "premium": 0, "diesel": 0}}

    stations = Station.query.filter(Station.id.in_(station_ids)).all() if station_ids else []
    for s in stations:
        for ft in ["magna", "premium", "diesel"]:
            snap = InventorySnapshot.query.filter_by(
                station_id=s.id, fuel_type=ft, snapshot_date=today,
            ).first()
            summary[ft] += snap.liters_on_hand if snap else 0
            summary["total_capacity"][ft] += getattr(s, f"{ft}_capacity", 0)

    summary["total"] = summary["magna"] + summary["premium"] + summary["diesel"]
    return jsonify(summary)


@app.route("/api/inventory/history")
@optional_auth
def api_inventory_history():
    days = request.args.get("days", 7, type=int)
    today = date.today()
    station_ids = _apply_razon_filter(get_accessible_station_ids())

    result = []
    for d in range(days - 1, -1, -1):
        target = today - timedelta(days=d)
        start = datetime.combine(target, datetime.min.time())
        end = datetime.combine(target, datetime.max.time())

        rq = db.session.query(
            db.func.coalesce(db.func.sum(FuelTransaction.liters), 0)
        ).filter(
            FuelTransaction.transaction_type == "received",
            FuelTransaction.timestamp.between(start, end),
        )
        sq = db.session.query(
            db.func.coalesce(db.func.sum(FuelTransaction.liters), 0)
        ).filter(
            FuelTransaction.transaction_type == "sold",
            FuelTransaction.timestamp.between(start, end),
        )
        ohq = db.session.query(
            db.func.coalesce(db.func.sum(InventorySnapshot.liters_on_hand), 0)
        ).filter(InventorySnapshot.snapshot_date == target)

        if station_ids:
            rq = rq.filter(FuelTransaction.station_id.in_(station_ids))
            sq = sq.filter(FuelTransaction.station_id.in_(station_ids))
            ohq = ohq.filter(InventorySnapshot.station_id.in_(station_ids))

        received = float(rq.scalar())
        sold = float(sq.scalar())
        on_hand = float(ohq.scalar())

        result.append({
            "date": target.isoformat(),
            "label": target.strftime("%d %b"),
            "received": round(received, 0),
            "sold": round(sold, 0),
            "on_hand": round(on_hand, 0),
            "net": round(received - sold, 0),
        })

    return jsonify(result)


@app.route("/api/inventory/record", methods=["POST"])
@require_auth
def api_record_transaction():
    data = request.json
    required = ["station_id", "fuel_type", "transaction_type", "liters"]
    for field in required:
        if field not in data:
            return jsonify({"error": f"Missing field: {field}"}), 400

    # Check access
    station_ids = _apply_razon_filter(get_accessible_station_ids())
    if data["station_id"] not in station_ids:
        return jsonify({"error": "No tienes acceso a esta estacion."}), 403

    station = Station.query.get(data["station_id"])
    if not station:
        return jsonify({"error": "Station not found"}), 404

    tx = FuelTransaction(
        station_id=data["station_id"],
        fuel_type=data["fuel_type"],
        transaction_type=data["transaction_type"],
        liters=float(data["liters"]),
        price_per_liter=data.get("price_per_liter"),
        timestamp=datetime.utcnow(),
        notes=data.get("notes"),
        recorded_by_id=g.current_user.id if g.current_user else None,
        source=data.get("source", "web"),
    )
    db.session.add(tx)

    today = date.today()
    snap = InventorySnapshot.query.filter_by(
        station_id=data["station_id"],
        fuel_type=data["fuel_type"],
        snapshot_date=today,
    ).first()

    if snap:
        if data["transaction_type"] == "received":
            snap.liters_on_hand += float(data["liters"])
        else:
            snap.liters_on_hand = max(0, snap.liters_on_hand - float(data["liters"]))
    else:
        cap = getattr(station, f"{data['fuel_type']}_capacity", 40000)
        liters = float(data["liters"]) if data["transaction_type"] == "received" else 0
        snap = InventorySnapshot(
            station_id=data["station_id"],
            fuel_type=data["fuel_type"],
            liters_on_hand=liters,
            capacity=cap,
            snapshot_date=today,
        )
        db.session.add(snap)

    db.session.commit()
    return jsonify({"success": True, "transaction_id": tx.id})


# ------------------------------------------------------------------ #
# API: Reports (scope-filtered)
# ------------------------------------------------------------ #

@app.route("/api/reports/generate", methods=["POST"])
@require_auth
def api_generate_report():
    data = request.json or {}
    report_type = data.get("type", "sat_volumetric")
    target_date_str = data.get("date")
    target_date = date.fromisoformat(target_date_str) if target_date_str else date.today()

    generators = {
        "sat_volumetric": reports.generate_sat_volumetric,
        "cne_weekly": reports.generate_cne_weekly,
        "inventory_close": reports.generate_inventory_close,
        "price_tariff": reports.generate_price_report,
    }

    gen = generators.get(report_type)
    if not gen:
        return jsonify({"error": f"Unknown report type: {report_type}"}), 400

    result = gen(target_date)
    return jsonify(result)


@app.route("/api/reports/history")
@optional_auth
def api_report_history():
    limit = request.args.get("limit", 50, type=int)
    return jsonify(reports.get_report_history(limit))


@app.route("/api/reports/download/<int:report_id>")
@optional_auth
def api_download_report(report_id):
    report = Report.query.get_or_404(report_id)
    if not report.file_path or not os.path.exists(report.file_path):
        abort(404)
    return send_file(report.file_path, as_attachment=True)


@app.route("/api/reports/send/<int:report_id>", methods=["POST"])
@optional_auth
def api_send_report(report_id):
    success = reports.mark_report_sent(report_id)
    if success:
        return jsonify({"success": True})
    return jsonify({"error": "Report not found"}), 404


@app.route("/api/reports/generate-all", methods=["POST"])
@require_auth
def api_generate_all_reports():
    target_date_str = (request.json or {}).get("date")
    target_date = date.fromisoformat(target_date_str) if target_date_str else date.today()

    results = {}
    for rtype, gen in [
        ("sat_volumetric", reports.generate_sat_volumetric),
        ("cne_weekly", reports.generate_cne_weekly),
        ("inventory_close", reports.generate_inventory_close),
        ("price_tariff", reports.generate_price_report),
    ]:
        try:
            results[rtype] = gen(target_date)
        except Exception as e:
            results[rtype] = {"error": str(e)}

    return jsonify(results)


# ------------------------------------------------------------------ #
# API: Predictions (scope-filtered)
# ------------------------------------------------------------------ #

@app.route("/api/predictions/recommendations")
@optional_auth
def api_recommendations():
    hours = request.args.get("hours", 72, type=int)
    try:
        recs = predictions.generate_order_recommendations(horizon_hours=hours)
        return jsonify(recs)
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        app.logger.error("recommendations error: %s\n%s", e, tb)
        return jsonify({"error": str(e), "traceback": tb}), 500


@app.route("/api/predictions/forecast")
@optional_auth
def api_forecast():
    station_id = request.args.get("station_id", type=int)
    days = request.args.get("days", 7, type=int)
    forecast = predictions.get_demand_forecast(station_id=station_id, days=days)
    return jsonify(forecast)


@app.route("/api/predictions/station/<int:station_id>/<fuel_type>")
@require_auth
def api_station_prediction(station_id, fuel_type):
    station_ids = _apply_razon_filter(get_accessible_station_ids())
    if station_id not in station_ids:
        return jsonify({"error": "No tienes acceso a esta estacion."}), 403

    demand = predictions.predict_demand(station_id, fuel_type)
    inv = predictions.get_current_inventory(station_id, fuel_type)

    if not demand:
        return jsonify({"error": "Insufficient data"}), 400

    station = Station.query.get_or_404(station_id)
    cap = getattr(station, f"{fuel_type}_capacity", 40000)
    days_left = predictions.calculate_days_until_empty(
        inv["liters"] if inv else 0, demand["avg_daily"], 0.15, cap
    ) if inv else None

    return jsonify({
        "station": {"id": station.id, "code": station.code, "name": station.name},
        "fuel_type": fuel_type,
        "current_inventory": inv,
        "demand": demand,
        "days_until_empty": round(days_left, 1) if days_left is not None else None,
    })


# ------------------------------------------------------------------ #
# API: Alerts (scope-filtered)
# ------------------------------------------------------------------ #

@app.route("/api/alerts")
@optional_auth
def api_alerts():
    today = date.today()
    station_ids = _apply_razon_filter(get_accessible_station_ids())
    alerts = []

    stations = Station.query.filter(Station.id.in_(station_ids)).all() if station_ids else []
    for station in stations:
        for ft in ["magna", "premium", "diesel"]:
            snap = InventorySnapshot.query.filter_by(
                station_id=station.id, fuel_type=ft, snapshot_date=today,
            ).first()
            cap = getattr(station, f"{ft}_capacity", 40000)
            if snap and cap > 0:
                pct = snap.liters_on_hand / cap * 100
                if pct < 25:
                    alerts.append({
                        "type": "critical",
                        "station": station.name,
                        "station_id": station.id,
                        "message": f"{ft.capitalize()} al {pct:.0f}% ({snap.liters_on_hand:.0f}L). Pedido urgente recomendado.",
                        "time": "Ahora",
                    })
                elif pct < 35:
                    alerts.append({
                        "type": "warning",
                        "station": station.name,
                        "station_id": station.id,
                        "message": f"{ft.capitalize()} por debajo del 35% ({pct:.0f}%). Pedido recomendado.",
                        "time": "Reciente",
                    })

    recent_reports = Report.query.filter_by(report_date=today).order_by(Report.created_at.desc()).limit(3).all()
    for r in recent_reports:
        type_labels = {
            "sat_volumetric": "Reporte SAT volumetrico",
            "cne_weekly": "Reporte CNE semanal",
            "inventory_close": "Inventario de cierre",
            "price_tariff": "Precios y tarifas",
        }
        alerts.append({
            "type": "info",
            "station": type_labels.get(r.report_type, r.report_type),
            "message": f"Generado exitosamente. Estado: {r.status}.",
            "time": r.created_at.strftime("%H:%M") if r.created_at else "",
        })

    order = {"critical": 0, "warning": 1, "info": 2}
    alerts.sort(key=lambda a: order.get(a["type"], 3))
    return jsonify(alerts[:15])


# ------------------------------------------------------------------ #
# API: SAT XML Generator (AI-powered)
# ------------------------------------------------------------------ #

@app.route("/api/sat-xml/extract", methods=["POST"])
@require_auth
def api_extract_from_file():
    if 'file' not in request.files:
        return jsonify({"error": "No se envio ningun archivo."}), 400
    file = request.files['file']
    if not file.filename:
        return jsonify({"error": "Archivo sin nombre."}), 400

    allowed_ext = {'pdf', 'xlsx', 'xls', 'docx', 'jpg', 'jpeg', 'png', 'webp'}
    ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else ''
    if ext not in allowed_ext:
        return jsonify({"error": f"Tipo de archivo no soportado: .{ext}. Soportados: PDF, XLSX, DOCX, JPG, PNG"}), 400

    file_bytes = file.read()
    if len(file_bytes) > 10 * 1024 * 1024:
        return jsonify({"error": "Archivo demasiado grande. Maximo 10MB."}), 400

    result = sat_xml_generator.extract_data_from_file(file_bytes, file.filename)
    if result.get("error"):
        return jsonify(result), 500 if "API error" in result.get("error", "") else 400
    return jsonify(result)


@app.route("/api/sat-xml/generate", methods=["POST"])
@require_auth
def api_generate_sat_xml():
    data = request.json or {}
    station_config = {
        "rfc": data.get("rfc", "GAZ850101ABC"),
        "rfc_proveedor": data.get("rfc_proveedor", "XAXX010101000"),
        "num_permiso": data.get("num_permiso", "PL/12345/EXP/ES/2024"),
        "modalidad_permiso": data.get("modalidad_permiso", "PL/XXXXX/EXP/ES/2024"),
        "clave_instalacion": data.get("clave_instalacion", "EDS-0001"),
        "descripcion": data.get("descripcion", "Estacion de servicio"),
        "latitud": data.get("latitud", "31.6904"),
        "longitud": data.get("longitud", "-106.4245"),
        "num_tanques": data.get("num_tanques", "3"),
        "num_dispensarios": data.get("num_dispensarios", "8"),
    }

    raw_data = data.get("raw_data", "")
    if not raw_data.strip():
        return jsonify({"error": "raw_data is required."}), 400

    report_date_str = data.get("date")
    report_date = date.fromisoformat(report_date_str) if report_date_str else date.today()
    report_format = data.get("format", "sat")
    period = data.get("period", "diario")  # "diario" or "mensual"
    output_format = data.get("output_format", "xml")  # "xml" or "json"
    report_month = data.get("report_month")  # 1-12 for monthly
    report_year = data.get("report_year")  # year for monthly

    result = sat_xml_generator.generate_sat_xml_with_ai(
        station_config, raw_data, report_date, report_format,
        period=period, output_format=output_format,
        report_month=int(report_month) if report_month else None,
        report_year=int(report_year) if report_year else None
    )
    if result.get("error"):
        return jsonify(result), 500 if "API error" in result["error"] else 400

    report = Report(
        report_type="cne_xml_volumetric" if report_format == "cne" else "sat_xml_volumetric",
        report_date=report_date,
        status="generated",
        file_path=result["zip_path"],
        created_at=datetime.utcnow(),
        details=f"XML SAT generado con IA. {result['validation'].get('product_count', 0)} productos.",
        generated_by_id=g.current_user.id if g.current_user else None,
    )
    db.session.add(report)
    db.session.commit()

    return jsonify({
        "success": True,
        "report_id": report.id,
        "filename": result.get("filename", result.get("xml_filename")),
        "xml_filename": result.get("xml_filename", result.get("filename")),
        "zip_filename": result["zip_filename"],
        "validation": result["validation"],
        "tokens_used": result.get("tokens_used"),
        "output_format": output_format,
        "period": period,
    })


@app.route("/api/sat-xml/generate-from-db", methods=["POST"])
@require_auth
def api_generate_sat_xml_from_db():
    data = request.json or {}
    report_date_str = data.get("date")
    report_date = date.fromisoformat(report_date_str) if report_date_str else date.today()

    result = sat_xml_generator.generate_demo_xml(report_date)
    if result.get("error"):
        return jsonify(result), 500 if "API error" in result.get("error", "") else 400

    report = Report(
        report_type="sat_xml_volumetric",
        report_date=report_date,
        status="generated",
        file_path=result["zip_path"],
        created_at=datetime.utcnow(),
        details=f"XML SAT desde BD. {result['validation'].get('product_count', 0)} productos.",
        generated_by_id=g.current_user.id if g.current_user else None,
    )
    db.session.add(report)
    db.session.commit()

    return jsonify({
        "success": True,
        "report_id": report.id,
        "xml_filename": result["xml_filename"],
        "zip_filename": result["zip_filename"],
        "validation": result["validation"],
        "tokens_used": result.get("tokens_used"),
    })



@app.route("/api/sat-xml/generate-monthly", methods=["POST"])
@require_auth
def api_generate_monthly_report():
    """Generate a monthly SAT/CNE report by aggregating daily data from the database."""
    data = request.json or {}
    station_id = data.get("station_id")
    if not station_id:
        return jsonify({"error": "station_id is required"}), 400

    year = data.get("year")
    month = data.get("month")
    if not year or not month:
        return jsonify({"error": "year and month are required"}), 400

    report_format = data.get("format", "sat")
    output_format = data.get("output_format", "xml")

    result = sat_xml_generator.generate_monthly_report_from_db(
        int(station_id), int(year), int(month),
        report_format=report_format, output_format=output_format
    )
    if result.get("error"):
        return jsonify(result), 500 if "API error" in result.get("error", "") else 400

    rtype = "cne" if report_format == "cne" else "sat"
    report = Report(
        report_type=f"{rtype}_{output_format}_monthly",
        report_date=date(int(year), int(month), 1),
        status="generated",
        file_path=result.get("zip_path"),
        created_at=datetime.utcnow(),
        details=f"Monthly {report_format.upper()} {output_format.upper()} report for {month}/{year}",
        generated_by_id=g.current_user.id if g.current_user else None,
    )
    db.session.add(report)
    db.session.commit()

    return jsonify({
        "success": True,
        "report_id": report.id,
        "filename": result.get("filename"),
        "zip_filename": result.get("zip_filename"),
        "validation": result.get("validation"),
        "tokens_used": result.get("tokens_used"),
    })

@app.route("/api/sat-xml/download/<int:report_id>")
@optional_auth
def api_download_sat_xml(report_id):
    report = Report.query.get_or_404(report_id)
    if not report.file_path or not os.path.exists(report.file_path):
        abort(404)
    return send_file(
        report.file_path, as_attachment=True,
        download_name=os.path.basename(report.file_path),
    )


# ------------------------------------------------------------------ #
# API: OpenClaw Webhook (receives push events)
# ------------------------------------------------------------------ #

@app.route("/api/webhook/openclaw", methods=["POST"])
@require_auth
def api_openclaw_webhook():
    """Receive commands from OpenClaw (WhatsApp bot).
    OpenClaw authenticates with its service token.
    """
    data = request.json or {}
    action = data.get("action")

    if action == "record_transaction":
        # Forward to inventory recording
        return api_record_transaction()

    if action == "get_summary":
        # Return a text-friendly summary for WhatsApp
        station_ids = _apply_razon_filter(get_accessible_station_ids())
        today = date.today()
        start = datetime.combine(today, datetime.min.time())
        end = datetime.combine(today, datetime.max.time())

        sq = db.session.query(
            db.func.coalesce(db.func.sum(FuelTransaction.liters), 0)
        ).filter(
            FuelTransaction.transaction_type == "sold",
            FuelTransaction.timestamp.between(start, end),
        )
        if station_ids:
            sq = sq.filter(FuelTransaction.station_id.in_(station_ids))
        total = float(sq.scalar())

        return jsonify({
            "text": f"Resumen del dia ({today.isoformat()}):\nLitros vendidos: {total:,.0f}\nEstaciones activas: {len(station_ids)}",
            "total_sold": total,
            "station_count": len(station_ids),
        })

    return jsonify({"error": f"Unknown action: {action}"}), 400


# ------------------------------------------------------------------ #
# API: Fast Report Generation (template-based, <5s)
# ------------------------------------------------------------------ #

@app.route("/api/reports/fast", methods=["POST"])
@optional_auth
def api_fast_report():
    """Generate SAT/CNE report using fast template engine (no AI).
    Body: {date, format: "xml"|"json", scope: "sat"|"cne"|"ambos"}
    """
    data = request.json or {}
    report_date_str = data.get("date")
    report_date = date.fromisoformat(report_date_str) if report_date_str else date.today()
    output_format = data.get("format", "xml")
    report_scope = data.get("scope", "sat")

    station_ids = _apply_razon_filter(get_accessible_station_ids())
    if not station_ids:
        return jsonify({"error": "No hay estaciones accesibles."}), 400

    import time
    t0 = time.time()
    result = report_fast.generate_fast_report(
        station_ids, report_date, output_format, report_scope
    )
    elapsed = round(time.time() - t0, 2)

    if result.get("error"):
        return jsonify(result), 400

    result["elapsed_seconds"] = elapsed
    return jsonify(result)


@app.route("/api/reports/fast/download/<int:report_id>")
@optional_auth
def api_fast_download(report_id):
    """Download a fast-generated report file."""
    report = Report.query.get_or_404(report_id)
    if not report.file_path or not os.path.exists(report.file_path):
        abort(404)
    return send_file(report.file_path, as_attachment=True,
                     download_name=os.path.basename(report.file_path))


@app.route("/api/reports/email", methods=["POST"])
@require_auth
def api_email_report():
    """Generate a report and send it via email.
    Body: {date, format, scope, email}
    """
    data = request.json or {}
    to_email = data.get("email", "").strip()
    if not to_email:
        return jsonify({"error": "Campo 'email' requerido."}), 400

    report_date_str = data.get("date")
    report_date = date.fromisoformat(report_date_str) if report_date_str else date.today()
    output_format = data.get("format", "xml")
    report_scope = data.get("scope", "sat")

    station_ids = _apply_razon_filter(get_accessible_station_ids())
    if not station_ids:
        return jsonify({"error": "No hay estaciones accesibles."}), 400

    result = report_fast.generate_fast_report(
        station_ids, report_date, output_format, report_scope
    )
    if result.get("error"):
        return jsonify(result), 400

    email_result = report_fast.send_report_email(
        to_email=to_email,
        report_filepath=result["filepath"],
        report_filename=result["filename"],
        report_date=report_date,
        station_count=result["station_count"],
    )
    if email_result.get("error"):
        return jsonify({"report": result, "email_error": email_result["error"]}), 500

    return jsonify({
        "success": True,
        "report": {
            "report_id": result["report_id"],
            "filename": result["filename"],
            "station_count": result["station_count"],
        },
        "email": email_result,
    })


# ------------------------------------------------------------------ #
# Health check (public)
# ------------------------------------------------------------------ #

@app.route("/api/health")
def api_health():
    return jsonify({"status": "ok", "version": "2.1.0", "timestamp": datetime.utcnow().isoformat()})


# ------------------------------------------------------------------ #
# Initialize
# ------------------------------------------------------------------ #

def init_db():
    with app.app_context():
        if DATABASE_URL:
            # PostgreSQL: always run create_all to ensure tables exist
            db.create_all()
            # Check if we need to seed
            if Station.query.count() == 0:
                print("Empty PostgreSQL database. Seeding demo data...")
                from seed_data import seed_database
                seed_database()
                print("Generating initial reports...")
                reports.generate_sat_volumetric()
                reports.generate_cne_weekly()
                reports.generate_inventory_close()
                reports.generate_price_report()
                print("Database initialized with demo data and reports.")
                # Also seed MG Demo
                try:
                    from seed_data import seed_mgdemo
                    seed_mgdemo()
                except Exception as e:
                    print(f"Warning: seed_mgdemo failed: {e}")
                    db.session.rollback()
            else:
                print("PostgreSQL database ready.")
            # Seed MG Demo if not yet present
            try:
                from seed_data import seed_mgdemo
                seed_mgdemo()
            except Exception as e:
                print(f"Warning: seed_mgdemo failed: {e}")
                db.session.rollback()
        else:
            # SQLite: check if db file exists
            db_path = os.path.join(BASE_DIR, "controlpetro.db")
            if not os.path.exists(db_path):
                print("Creating database...")
                db.create_all()
                from seed_data import seed_database
                seed_database()
                print("Generating initial reports...")
                reports.generate_sat_volumetric()
                reports.generate_cne_weekly()
                reports.generate_inventory_close()
                reports.generate_price_report()
                print("Database initialized with demo data and reports.")
            else:
                # Run migrations for new tables if they don't exist
                db.create_all()
                print("Database ready. New tables created if needed.")



# ============================================================
# Comercializadora API Endpoints
# ============================================================

comercializadora_orders = []
comercializadora_slots = []

def init_comercializadora_demo_data():
    """Initialize demo data for Comercializadora if empty."""
    global comercializadora_orders, comercializadora_slots
    if not comercializadora_orders:
        from datetime import datetime, timedelta
        today = datetime.now()
        comercializadora_orders = [
            {"id": 1, "client": "Gasolinera del Norte", "fuel_type": "magna", "liters": 15000, "date": (today + timedelta(days=1)).strftime("%Y-%m-%d"), "status": "confirmed", "source": "whatsapp", "priority": "high", "slot_id": 1, "notes": "Entrega matutina"},
            {"id": 2, "client": "Estacion Sur Express", "fuel_type": "premium", "liters": 8000, "date": (today + timedelta(days=1)).strftime("%Y-%m-%d"), "status": "pending", "source": "email", "priority": "medium", "slot_id": None, "notes": ""},
            {"id": 3, "client": "Pemex Juarez Centro", "fuel_type": "diesel", "liters": 20000, "date": (today + timedelta(days=2)).strftime("%Y-%m-%d"), "status": "in_transit", "source": "whatsapp", "priority": "high", "slot_id": 3, "notes": "Pipa #42"},
            {"id": 4, "client": "Gasolinera Reforma", "fuel_type": "magna", "liters": 12000, "date": (today + timedelta(days=2)).strftime("%Y-%m-%d"), "status": "pending", "source": "email", "priority": "low", "slot_id": None, "notes": ""},
            {"id": 5, "client": "Estacion Tecnologico", "fuel_type": "magna", "liters": 18000, "date": (today + timedelta(days=3)).strftime("%Y-%m-%d"), "status": "confirmed", "source": "whatsapp", "priority": "high", "slot_id": 5, "notes": "Cliente frecuente"},
            {"id": 6, "client": "Red Gasolinera Chihuahua", "fuel_type": "premium", "liters": 10000, "date": today.strftime("%Y-%m-%d"), "status": "delivered", "source": "whatsapp", "priority": "medium", "slot_id": 6, "notes": "Entregado 08:30"},
            {"id": 7, "client": "Combustibles del Valle", "fuel_type": "diesel", "liters": 25000, "date": (today + timedelta(days=4)).strftime("%Y-%m-%d"), "status": "pending", "source": "email", "priority": "high", "slot_id": None, "notes": "Importacion US"}
        ]
        comercializadora_slots = []
        for i in range(1, 11):
            day_offset = (i - 1) // 3
            slot_date = (today + timedelta(days=day_offset)).strftime("%Y-%m-%d")
            hour = 7 + ((i - 1) % 3) * 3
            terminal = ["Pemex TAR Juarez", "Pemex TAR Chihuahua", "Import Terminal El Paso", "Pemex TAR Juarez"][day_offset % 4]
            status = "available"
            if i <= 3:
                status = "reserved" if i % 2 == 0 else "occupied"
            elif i <= 6:
                status = "available" if i % 2 == 0 else "reserved"
            comercializadora_slots.append({
                "id": i,
                "terminal": terminal,
                "date": slot_date,
                "time": f"{hour:02d}:00",
                "capacity_liters": 20000,
                "status": status,
                "order_id": i if status == "occupied" else None
            })

init_comercializadora_demo_data()


@app.route("/api/comercializadora/orders", methods=["GET"])
@require_auth
def get_comercializadora_orders():
    """Get all comercializadora orders."""
    init_comercializadora_demo_data()
    status_filter = request.args.get("status")
    orders = comercializadora_orders
    if status_filter:
        orders = [o for o in orders if o["status"] == status_filter]
    return jsonify({"orders": orders, "total": len(orders)})


@app.route("/api/comercializadora/orders", methods=["POST"])
@require_auth
def create_comercializadora_order():
    """Create a new comercializadora order."""
    init_comercializadora_demo_data()
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400
    required = ["client", "fuel_type", "liters", "date"]
    missing = [f for f in required if f not in data]
    if missing:
        return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400
    new_id = max((o["id"] for o in comercializadora_orders), default=0) + 1
    order = {
        "id": new_id,
        "client": data["client"],
        "fuel_type": data["fuel_type"],
        "liters": data["liters"],
        "date": data["date"],
        "status": "pending",
        "source": data.get("source", "manual"),
        "priority": data.get("priority", "medium"),
        "slot_id": None,
        "notes": data.get("notes", "")
    }
    comercializadora_orders.append(order)
    return jsonify({"success": True, "order": order}), 201


@app.route("/api/comercializadora/slots", methods=["GET"])
@require_auth
def get_comercializadora_slots():
    """Get terminal delivery slots."""
    init_comercializadora_demo_data()
    date_filter = request.args.get("date")
    slots = comercializadora_slots
    if date_filter:
        slots = [s for s in slots if s["date"] == date_filter]
    return jsonify({"slots": slots, "total": len(slots)})


@app.route("/api/comercializadora/slots/reserve", methods=["POST"])
@require_auth
def reserve_comercializadora_slot():
    """Reserve a slot for an order."""
    init_comercializadora_demo_data()
    data = request.get_json()
    if not data or "slot_id" not in data or "order_id" not in data:
        return jsonify({"error": "slot_id and order_id required"}), 400
    slot = next((s for s in comercializadora_slots if s["id"] == data["slot_id"]), None)
    if not slot:
        return jsonify({"error": "Slot not found"}), 404
    if slot["status"] != "available":
        return jsonify({"error": "Slot not available"}), 409
    order = next((o for o in comercializadora_orders if o["id"] == data["order_id"]), None)
    if not order:
        return jsonify({"error": "Order not found"}), 404
    slot["status"] = "reserved"
    slot["order_id"] = data["order_id"]
    order["slot_id"] = data["slot_id"]
    order["status"] = "confirmed"
    return jsonify({"success": True, "slot": slot, "order": order})


@app.route("/api/comercializadora/orders/<int:order_id>", methods=["PATCH"])
@require_auth
def update_comercializadora_order(order_id):
    """Update an order status."""
    init_comercializadora_demo_data()
    data = request.get_json()
    order = next((o for o in comercializadora_orders if o["id"] == order_id), None)
    if not order:
        return jsonify({"error": "Order not found"}), 404
    for field in ["status", "notes", "priority", "slot_id"]:
        if field in data:
            order[field] = data[field]
    return jsonify({"success": True, "order": order})


init_db()

if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=False)
