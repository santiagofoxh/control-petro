"""Secure credential management for Pemex portal access.

Encrypts/decrypts usernames and passwords using Fernet symmetric encryption.
The encryption key must be set via PEMEX_ENCRYPTION_KEY environment variable.
"""

import os
import base64
from datetime import datetime
from cryptography.fernet import Fernet, InvalidToken


def _get_fernet():
    """Get Fernet cipher from environment key."""
    key = os.environ.get("PEMEX_ENCRYPTION_KEY")
    if not key:
        # In development, generate a deterministic key (NOT for production)
        if os.environ.get("FLASK_ENV") == "development" or not os.environ.get("DATABASE_URL"):
            key = base64.urlsafe_b64encode(b"controlpetro-dev-key-32b!" + b"\0" * 7).decode()
        else:
            raise RuntimeError(
                "PEMEX_ENCRYPTION_KEY environment variable is required. "
                "Generate one with: python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
            )
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt(plaintext: str) -> str:
    """Encrypt a string and return base64-encoded ciphertext."""
    f = _get_fernet()
    return f.encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt(ciphertext: str) -> str:
    """Decrypt a base64-encoded ciphertext string."""
    f = _get_fernet()
    try:
        return f.decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        raise ValueError("Failed to decrypt credential. Key may have changed.")


def store_credential(db_session, razon_social_id, username, password, label=None, portal_url=None):
    """Create or update a PemexCredential with encrypted values.

    Returns the PemexCredential instance.
    """
    from database import PemexCredential

    # Check for existing credential for this razon_social
    existing = PemexCredential.query.filter_by(
        razon_social_id=razon_social_id, is_active=True
    ).first()

    username_enc = encrypt(username)
    password_enc = encrypt(password)

    if existing:
        existing.username_enc = username_enc
        existing.password_enc = password_enc
        existing.label = label or existing.label
        existing.portal_url = portal_url or existing.portal_url
        existing.updated_at = datetime.utcnow()
        existing.consecutive_failures = 0
        existing.last_error = None
        db_session.commit()
        return existing
    else:
        cred = PemexCredential(
            razon_social_id=razon_social_id,
            username_enc=username_enc,
            password_enc=password_enc,
            label=label or f"Pemex credential #{razon_social_id}",
            portal_url=portal_url or "https://www.comercialrefinacion.pemex.com/portal/",
        )
        db_session.add(cred)
        db_session.commit()
        return cred


def get_credentials(credential_id):
    """Retrieve and decrypt credentials for a PemexCredential.

    Returns (username, password) tuple. Never logs these values.
    """
    from database import PemexCredential

    cred = PemexCredential.query.get(credential_id)
    if not cred:
        raise ValueError(f"Credential {credential_id} not found")
    if not cred.is_active:
        raise ValueError(f"Credential {credential_id} is deactivated")

    username = decrypt(cred.username_enc)
    password = decrypt(cred.password_enc)
    return username, password


def get_active_credentials():
    """Get all active PemexCredential records (without decrypting).

    Returns list of PemexCredential objects.
    """
    from database import PemexCredential

    return PemexCredential.query.filter_by(is_active=True).order_by(
        PemexCredential.consecutive_failures.asc(),
        PemexCredential.last_login_at.asc(),
    ).all()


def record_login_success(db_session, credential_id):
    """Record a successful login attempt."""
    from database import PemexCredential

    cred = PemexCredential.query.get(credential_id)
    if cred:
        cred.last_login_at = datetime.utcnow()
        cred.last_login_ok = True
        cred.consecutive_failures = 0
        cred.last_error = None
        db_session.commit()


def record_login_failure(db_session, credential_id, error_message):
    """Record a failed login attempt. Deactivates after 5 consecutive failures."""
    from database import PemexCredential

    cred = PemexCredential.query.get(credential_id)
    if cred:
        cred.last_login_at = datetime.utcnow()
        cred.last_login_ok = False
        cred.consecutive_failures = (cred.consecutive_failures or 0) + 1
        cred.last_error = error_message[:500]

        # Circuit breaker: deactivate after 5 consecutive failures
        if cred.consecutive_failures >= 5:
            cred.is_active = False
            cred.last_error = f"DEACTIVATED after {cred.consecutive_failures} failures. Last: {error_message[:400]}"

        db_session.commit()


def generate_encryption_key():
    """Generate a new Fernet encryption key. Print to stdout for env setup."""
    return Fernet.generate_key().decode()


if __name__ == "__main__":
    print("New PEMEX_ENCRYPTION_KEY:")
    print(generate_encryption_key())
