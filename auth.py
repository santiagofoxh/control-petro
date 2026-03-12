"""Authentication and authorization for Control Petro.

Uses JWT tokens for stateless auth. Supports:
- Web dashboard login (username + password -> JWT)
- OpenClaw service token (pre-shared bearer token for MCP/WhatsApp)
- Role-based access control (platform_admin, org_admin, group_manager, operator)
"""

import os
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta
from functools import wraps

import jwt
from flask import request, jsonify, g
from database import db, User

# ------------------------------------------------------------------ #
# Config
# ------------------------------------------------------------------ #

JWT_SECRET = os.environ.get("JWT_SECRET", secrets.token_hex(32))
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = int(os.environ.get("JWT_EXPIRY_HOURS", "24"))

# Service token for OpenClaw (set in Render env vars)
OPENCLAW_SERVICE_TOKEN = os.environ.get("OPENCLAW_SERVICE_TOKEN", "")


# ------------------------------------------------------------------ #
# Password hashing (using hashlib - no extra C dependencies)
# ------------------------------------------------------------------ #

def hash_password(password: str) -> str:
    """Hash password with PBKDF2-SHA256."""
    salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000)
    return f"{salt}${key.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    """Verify password against stored hash."""
    try:
        salt, key_hex = stored_hash.split("$")
        new_key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000)
        return hmac.compare_digest(new_key.hex(), key_hex)
    except (ValueError, AttributeError):
        return False


# ------------------------------------------------------------------ #
# JWT Token generation
# ------------------------------------------------------------------ #

def create_token(user: User) -> str:
    """Create a JWT token for a user."""
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "name": user.name,
        "role": user.role,
        "org_id": user.organization_id,
        "razon_id": user.razon_social_id,
        "approved": user.approved_by_admin,
        "iat": datetime.utcnow(),
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """Decode and validate a JWT token."""
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])


# ------------------------------------------------------------------ #
# Auth middleware
# ------------------------------------------------------------------ #

def require_auth(f):
    """Decorator: require valid JWT or service token on request."""
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Token requerido. Incluye Authorization: Bearer <token>"}), 401

        token = auth_header[7:]  # strip "Bearer "

        # Check if it's the OpenClaw service token
        if OPENCLAW_SERVICE_TOKEN and hmac.compare_digest(token, OPENCLAW_SERVICE_TOKEN):
            # Service token: full access. Check for X-On-Behalf-Of header for user context
            behalf_user_id = request.headers.get("X-On-Behalf-Of")
            if behalf_user_id:
                user = User.query.get(int(behalf_user_id))
                if user:
                    g.current_user = user
                    g.is_service = True
                    return f(*args, **kwargs)
            # No user context: service has platform_admin level access
            g.current_user = None
            g.is_service = True
            g.service_role = "platform_admin"
            return f(*args, **kwargs)

        # Regular JWT token
        try:
            payload = decode_token(token)
            user = User.query.get(int(payload["sub"]))
            if not user or not user.active:
                return jsonify({"error": "Usuario no encontrado o inactivo."}), 401
            g.current_user = user
            g.is_service = False
            return f(*args, **kwargs)
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Token expirado. Inicia sesion nuevamente."}), 401
        except jwt.InvalidTokenError:
            return jsonify({"error": "Token invalido."}), 401

    return decorated


def optional_auth(f):
    """Decorator: try JWT auth, but allow unauthenticated (demo) access.

    When no token is provided, sets g.demo_mode = True and gives
    platform_admin-level read access (all stations visible).
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")

        if not auth_header.startswith("Bearer "):
            # No auth - demo / public mode
            g.current_user = None
            g.is_service = False
            g.demo_mode = True
            g.service_role = "platform_admin"  # demo sees everything
            return f(*args, **kwargs)

        # Has a token - validate it normally
        token = auth_header[7:]

        if OPENCLAW_SERVICE_TOKEN and hmac.compare_digest(token, OPENCLAW_SERVICE_TOKEN):
            behalf_user_id = request.headers.get("X-On-Behalf-Of")
            if behalf_user_id:
                user = User.query.get(int(behalf_user_id))
                if user:
                    g.current_user = user
                    g.is_service = True
                    g.demo_mode = False
                    return f(*args, **kwargs)
            g.current_user = None
            g.is_service = True
            g.demo_mode = False
            g.service_role = "platform_admin"
            return f(*args, **kwargs)

        try:
            payload = decode_token(token)
            user = User.query.get(int(payload["sub"]))
            if not user or not user.active:
                return jsonify({"error": "Usuario no encontrado o inactivo."}), 401
            g.current_user = user
            g.is_service = False
            g.demo_mode = False
            return f(*args, **kwargs)
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Token expirado."}), 401
        except jwt.InvalidTokenError:
            return jsonify({"error": "Token invalido."}), 401

    return decorated


def require_role(*allowed_roles):
    """Decorator: require specific role(s). Must be used AFTER require_auth."""
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            if g.is_service:
                role = getattr(g, "service_role", "platform_admin")
            elif g.current_user:
                role = g.current_user.role
            else:
                return jsonify({"error": "No autorizado."}), 403

            if role not in allowed_roles:
                return jsonify({"error": "Rol '" + role + "' no tiene acceso. Roles permitidos: " + ", ".join(allowed_roles)}), 403
            return f(*args, **kwargs)
        return decorated
    return decorator


# ------------------------------------------------------------------ #
# Scope helpers - filter data by user's access level
# ------------------------------------------------------------------ #

def get_accessible_station_ids() -> list:
    """Return list of station IDs the current user can access."""
    from database import Station, RazonSocial

    # Demo mode or service token with no user: all stations
    if getattr(g, 'demo_mode', False) or (g.is_service and not g.current_user):
        return [s.id for s in Station.query.filter_by(active=True).all()]

    user = g.current_user
    if not user:
        return []

    if user.role == "platform_admin":
        return [s.id for s in Station.query.filter_by(active=True).all()]

    if user.role == "org_admin":
        # All stations in their organization
        razon_ids = [r.id for r in RazonSocial.query.filter_by(
            organization_id=user.organization_id, active=True
        ).all()]
        return [s.id for s in Station.query.filter(
            Station.razon_social_id.in_(razon_ids),
            Station.active == True
        ).all()]

    if user.role == "group_manager":
        # Stations in their Razon Social
        return [s.id for s in Station.query.filter_by(
            razon_social_id=user.razon_social_id, active=True
        ).all()]

    if user.role == "operator":
        # Only assigned stations
        return [s.id for s in user.assigned_stations if s.active]

    return []


def get_accessible_razon_ids() -> list:
    """Return list of RazonSocial IDs the current user can access."""
    from database import RazonSocial

    if g.is_service and not g.current_user:
        return [r.id for r in RazonSocial.query.filter_by(active=True).all()]

    user = g.current_user
    if not user:
        return []

    if user.role == "platform_admin":
        return [r.id for r in RazonSocial.query.filter_by(active=True).all()]

    if user.role == "org_admin":
        return [r.id for r in RazonSocial.query.filter_by(
            organization_id=user.organization_id, active=True
        ).all()]

    if user.role == "group_manager":
        return [user.razon_social_id] if user.razon_social_id else []

    if user.role == "operator":
        # Get unique razon_social_ids from assigned stations
        return list(set(
            s.razon_social_id for s in user.assigned_stations
            if s.razon_social_id and s.active
        ))

    return []
