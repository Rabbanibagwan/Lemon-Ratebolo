"""Platform admin authentication — separate from merchant owner/counter JWT.

First admin (development / one-time bootstrap):
  Set ALL of these env vars when the platform_admins collection is empty:
    ADMIN_BOOTSTRAP_ENABLED=true
    ADMIN_BOOTSTRAP_USERNAME=your_admin_username
    ADMIN_BOOTSTRAP_PASSWORD=your_strong_password   (min 12 chars)
    ADMIN_BOOTSTRAP_DISPLAY_NAME=Platform Admin     (optional)
    ADMIN_BOOTSTRAP_EMAIL=admin@example.com         (optional)

  On startup the server creates the first admin once, then ignores bootstrap env on
  subsequent runs. Never enable bootstrap in production unless intentionally seeding
  a fresh deployment.

Required env:
  ADMIN_JWT_SECRET — dedicated signing secret for admin JWTs (never reuse JWT_SECRET).
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Dict, Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordBearer
from passlib.context import CryptContext
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

ADMIN_JWT_ALG = "HS256"
ADMIN_JWT_AUD = "lemon-ratebolo-admin"
ADMIN_JWT_TTL_MINUTES = 60 * 8
ROLE_PLATFORM_ADMIN = "platform_admin"

admin_bearer = OAuth2PasswordBearer(tokenUrl="/api/admin/auth/login", auto_error=True)


def _uid() -> str:
    return str(uuid.uuid4())


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _admin_jwt_secret() -> str:
    secret = (os.environ.get("ADMIN_JWT_SECRET") or "").strip()
    if not secret:
        raise RuntimeError(
            "ADMIN_JWT_SECRET environment variable is required for platform admin auth"
        )
    return secret


def is_production_environment() -> bool:
    """Best-effort production detection for security defaults."""
    env = (os.environ.get("ENVIRONMENT") or os.environ.get("ENV") or "").strip().lower()
    if env in ("production", "prod"):
        return True
    render = (os.environ.get("RENDER") or "").strip().lower()
    return render in ("true", "1", "yes")


class AdminLoginIn(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=6, max_length=72)


class AdminTokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    id: str
    username: str
    display_name: str
    email: Optional[str] = None
    role: str


class AdminMeOut(BaseModel):
    id: str
    username: str
    display_name: str
    email: Optional[str] = None
    role: str
    active: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    last_login_at: Optional[datetime] = None


def admin_public_dict(doc: dict) -> dict:
    """Return admin fields safe for API responses — never includes password_hash."""
    return {
        "id": doc["id"],
        "username": doc["username"],
        "display_name": doc.get("display_name") or doc["username"],
        "email": doc.get("email"),
        "role": doc.get("role") or ROLE_PLATFORM_ADMIN,
        "active": bool(doc.get("active", True)),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
        "last_login_at": doc.get("last_login_at"),
    }


def make_admin_token(*, admin_id: str, username: str, role: str) -> str:
    now = _utc_now()
    payload = {
        "sub": admin_id,
        "username": username,
        "role": role,
        "aud": ADMIN_JWT_AUD,
        "iat": now,
        "exp": now + timedelta(minutes=ADMIN_JWT_TTL_MINUTES),
    }
    return jwt.encode(payload, _admin_jwt_secret(), algorithm=ADMIN_JWT_ALG)


async def ensure_indexes(db) -> None:
    await db.platform_admins.create_index("username", unique=True)
    await db.platform_admins.create_index("id", unique=True)
    await db.platform_admin_audit_log.create_index("id", unique=True)
    await db.platform_admin_audit_log.create_index([("at", -1)])
    await db.platform_admin_audit_log.create_index([("admin_id", 1), ("at", -1)])
    await db.platform_admin_audit_log.create_index([("shop_id", 1), ("at", -1)])


async def write_admin_audit_log(
    db,
    *,
    admin_id: str,
    admin_username: str,
    action: str,
    resource_type: str,
    resource_id: Optional[str] = None,
    shop_id: Optional[str] = None,
    before: Optional[dict] = None,
    after: Optional[dict] = None,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> None:
    await db.platform_admin_audit_log.insert_one(
        {
            "id": _uid(),
            "admin_id": admin_id,
            "admin_username": admin_username,
            "action": action,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "shop_id": shop_id,
            "before": before,
            "after": after,
            "ip": ip,
            "user_agent": user_agent,
            "at": _utc_now(),
        }
    )


async def maybe_bootstrap_first_admin(db, pwd: CryptContext) -> None:
    """Create the first platform admin when explicitly enabled and collection is empty."""
    enabled = (os.environ.get("ADMIN_BOOTSTRAP_ENABLED") or "").strip().lower()
    if enabled not in ("1", "true", "yes"):
        return

    if is_production_environment():
        allow_prod = (os.environ.get("ADMIN_BOOTSTRAP_ALLOW_PRODUCTION") or "").strip().lower()
        if allow_prod not in ("1", "true", "yes"):
            logger.error(
                "ADMIN_BOOTSTRAP_ENABLED refused in production — set "
                "ADMIN_BOOTSTRAP_ALLOW_PRODUCTION=true only for intentional one-time seeding"
            )
            return

    count = await db.platform_admins.count_documents({})
    if count > 0:
        return

    username = (os.environ.get("ADMIN_BOOTSTRAP_USERNAME") or "").strip().lower()
    password = os.environ.get("ADMIN_BOOTSTRAP_PASSWORD") or ""
    if not username or len(password) < 12:
        logger.warning(
            "ADMIN_BOOTSTRAP_ENABLED is set but ADMIN_BOOTSTRAP_USERNAME / "
            "ADMIN_BOOTSTRAP_PASSWORD (min 12 chars) are missing — skipping bootstrap"
        )
        return

    display_name = (os.environ.get("ADMIN_BOOTSTRAP_DISPLAY_NAME") or username).strip()
    email = (os.environ.get("ADMIN_BOOTSTRAP_EMAIL") or "").strip() or None
    now = _utc_now()
    doc = {
        "id": _uid(),
        "username": username,
        "password_hash": pwd.hash(password),
        "display_name": display_name,
        "email": email,
        "role": ROLE_PLATFORM_ADMIN,
        "active": True,
        "created_at": now,
        "updated_at": now,
        "last_login_at": None,
    }
    await db.platform_admins.insert_one(doc)
    logger.info("Bootstrapped first platform admin username=%s (one-time)", username)


def register_admin_auth_routes(api: APIRouter, db, pwd: CryptContext) -> None:
    """Register platform admin auth routes on the shared /api router."""

    async def admin_only(token: Annotated[str, Depends(admin_bearer)]) -> dict:
        err = HTTPException(
            401,
            "Invalid or expired admin token",
            headers={"WWW-Authenticate": "Bearer"},
        )
        try:
            claims = jwt.decode(
                token,
                _admin_jwt_secret(),
                algorithms=[ADMIN_JWT_ALG],
                audience=ADMIN_JWT_AUD,
            )
        except jwt.PyJWTError:
            raise err
        if claims.get("role") != ROLE_PLATFORM_ADMIN:
            raise err
        admin_id = claims.get("sub")
        if not admin_id:
            raise err
        admin = await db.platform_admins.find_one(
            {"id": admin_id, "active": True},
            {"_id": 0, "password_hash": 0},
        )
        if not admin:
            raise err
        return admin_public_dict(admin)

    # Expose for future /api/admin/* routes in later steps.
    globals()["admin_only"] = admin_only

    @api.post("/admin/auth/login", response_model=AdminTokenOut)
    async def admin_login(body: AdminLoginIn, request: Request):
        username = body.username.lower().strip()
        admin_row = await db.platform_admins.find_one({"username": username}, {"_id": 0})
        if not admin_row or not pwd.verify(body.password, admin_row["password_hash"]):
            raise HTTPException(401, "Invalid username or password")
        if not admin_row.get("active", True):
            raise HTTPException(403, "Admin account is inactive")

        now = _utc_now()
        await db.platform_admins.update_one(
            {"id": admin_row["id"]},
            {"$set": {"last_login_at": now, "updated_at": now}},
        )
        admin = admin_public_dict({**admin_row, "last_login_at": now, "updated_at": now})

        client_host = request.client.host if request.client else None
        await write_admin_audit_log(
            db,
            admin_id=admin["id"],
            admin_username=admin["username"],
            action="ADMIN_LOGIN",
            resource_type="platform_admin",
            resource_id=admin["id"],
            ip=client_host,
            user_agent=request.headers.get("user-agent"),
            after={"username": admin["username"], "role": admin.get("role")},
        )

        token = make_admin_token(
            admin_id=admin["id"],
            username=admin["username"],
            role=admin.get("role") or ROLE_PLATFORM_ADMIN,
        )
        pub = admin_public_dict(admin)
        return AdminTokenOut(access_token=token, **pub)

    @api.get("/admin/auth/me", response_model=AdminMeOut)
    async def admin_me(admin=Depends(admin_only)):
        return AdminMeOut(**admin)
