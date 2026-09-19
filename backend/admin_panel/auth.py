"""Platform admin authentication (separate from merchant JWT)."""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext
from pydantic import BaseModel, Field

from admin_panel.audit import write_admin_audit

logger = logging.getLogger(__name__)

pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

# HTTP Bearer (not OAuth2 password flow): Swagger Authorize accepts a pasted
# access_token from POST /api/admin/auth/login JSON — it must NOT POST
# application/x-www-form-urlencoded to the JSON login endpoint (that yields 422).
admin_bearer = HTTPBearer(
    auto_error=False,
    scheme_name="PlatformAdminBearer",
    description=(
        "Paste the access_token returned by POST /api/admin/auth/login "
        "(JSON body: {\"username\", \"password\"})."
    ),
)

ADMIN_JWT_ALG = "HS256"
ADMIN_JWT_TTL_HOURS = int(os.environ.get("PLATFORM_ADMIN_JWT_TTL_HOURS", "12"))
ROLE_PLATFORM_ADMIN = "platform_admin"


def _admin_jwt_secret() -> str:
    return (
        os.environ.get("PLATFORM_ADMIN_JWT_SECRET")
        or os.environ.get("ADMIN_JWT_SECRET")
        or "platform-admin-dev-secret-change-me"
    ).strip()


def _legacy_admin_key() -> str:
    return (os.environ.get("ADMIN_API_KEY") or os.environ.get("BILLING_ADMIN_KEY") or "lemon-admin-dev").strip()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def uid() -> str:
    return str(uuid.uuid4())


class AdminLoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=128)


class AdminOut(BaseModel):
    id: str
    username: str
    display_name: str
    role: str
    active: bool


class AdminTokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    admin: AdminOut


def make_admin_token(admin: dict) -> str:
    now = utc_now()
    payload = {
        "typ": "platform_admin",
        "sub": admin["id"],
        "username": admin["username"],
        "role": admin.get("role") or ROLE_PLATFORM_ADMIN,
        "iat": now,
        "exp": now + timedelta(hours=ADMIN_JWT_TTL_HOURS),
    }
    return jwt.encode(payload, _admin_jwt_secret(), algorithm=ADMIN_JWT_ALG)


async def ensure_admin_indexes(db) -> None:
    await db.platform_admins.create_index("username", unique=True)
    await db.platform_admins.create_index("id", unique=True)
    await db.platform_admin_audit_log.create_index([("created_at", -1)])
    await db.platform_admin_audit_log.create_index([("admin_user_id", 1), ("created_at", -1)])


async def bootstrap_admin_if_needed(db) -> None:
    """Create first admin from env if collection is empty. Never hard-codes passwords in source."""
    count = await db.platform_admins.count_documents({})
    if count > 0:
        return
    username = (os.environ.get("PLATFORM_ADMIN_BOOTSTRAP_USERNAME") or "").strip().lower()
    password = os.environ.get("PLATFORM_ADMIN_BOOTSTRAP_PASSWORD") or ""
    if not username or not password:
        logger.warning(
            "No platform_admins and bootstrap env not set "
            "(PLATFORM_ADMIN_BOOTSTRAP_USERNAME / PLATFORM_ADMIN_BOOTSTRAP_PASSWORD)."
        )
        return
    if len(password) < 8:
        logger.error("PLATFORM_ADMIN_BOOTSTRAP_PASSWORD too short; skipping bootstrap.")
        return
    now = utc_now()
    doc = {
        "id": uid(),
        "username": username,
        "password_hash": pwd.hash(password),
        "display_name": username,
        "role": ROLE_PLATFORM_ADMIN,
        "active": True,
        "created_at": now,
        "updated_at": now,
        "last_login_at": None,
    }
    try:
        await db.platform_admins.insert_one(doc)
        logger.info("Bootstrapped platform admin username=%s", username)
    except Exception:
        logger.exception("Failed to bootstrap platform admin")


async def _load_admin(db, admin_id: str) -> Optional[dict]:
    return await db.platform_admins.find_one(
        {"id": admin_id, "active": True},
        {"_id": 0, "password_hash": 0},
    )


async def require_platform_admin(
    db,
    token: Optional[str] = None,
    x_admin_key: Optional[str] = None,
) -> dict:
    """Accept Admin JWT (preferred) or legacy X-Admin-Key during migration."""
    if token:
        try:
            claims = jwt.decode(token, _admin_jwt_secret(), algorithms=[ADMIN_JWT_ALG])
        except jwt.PyJWTError:
            raise HTTPException(401, "Invalid or expired admin token")
        if claims.get("typ") != "platform_admin":
            raise HTTPException(401, "Invalid admin token type")
        admin_id = claims.get("sub")
        if not admin_id:
            raise HTTPException(401, "Invalid admin token")
        admin = await _load_admin(db, admin_id)
        if not admin:
            raise HTTPException(401, "Admin account not found or inactive")
        admin["_auth_via"] = "jwt"
        return admin

    if x_admin_key and x_admin_key.strip() == _legacy_admin_key():
        return {
            "id": "legacy-admin-key",
            "username": "legacy_x_admin_key",
            "display_name": "Legacy Admin Key",
            "role": ROLE_PLATFORM_ADMIN,
            "active": True,
            "_auth_via": "x_admin_key",
        }

    raise HTTPException(401, "Admin authentication required")


def register_auth_routes(api: APIRouter, db) -> None:
    async def admin_dep(
        creds: Optional[HTTPAuthorizationCredentials] = Depends(admin_bearer),
        x_admin_key: Optional[str] = Header(default=None, alias="X-Admin-Key"),
    ):
        token = creds.credentials if creds else None
        return await require_platform_admin(db, token=token, x_admin_key=x_admin_key)

    @api.post("/admin/auth/login", response_model=AdminTokenOut)
    async def admin_login(body: AdminLoginIn):
        username = body.username.lower().strip()
        admin = await db.platform_admins.find_one({"username": username})
        if not admin or not admin.get("active"):
            await write_admin_audit(
                db,
                admin_user_id=None,
                admin_username=username,
                action="LOGIN_FAILED",
                resource_type="auth",
                metadata={"reason": "not_found_or_inactive"},
            )
            raise HTTPException(401, "Incorrect username or password")
        if not pwd.verify(body.password, admin.get("password_hash") or ""):
            await write_admin_audit(
                db,
                admin_user_id=admin.get("id"),
                admin_username=username,
                action="LOGIN_FAILED",
                resource_type="auth",
                metadata={"reason": "bad_password"},
            )
            raise HTTPException(401, "Incorrect username or password")
        now = utc_now()
        await db.platform_admins.update_one(
            {"id": admin["id"]},
            {"$set": {"last_login_at": now, "updated_at": now}},
        )
        out_admin = AdminOut(
            id=admin["id"],
            username=admin["username"],
            display_name=admin.get("display_name") or admin["username"],
            role=admin.get("role") or ROLE_PLATFORM_ADMIN,
            active=bool(admin.get("active", True)),
        )
        token = make_admin_token(admin)
        await write_admin_audit(
            db,
            admin_user_id=admin["id"],
            admin_username=admin["username"],
            action="LOGIN_SUCCESS",
            resource_type="auth",
            metadata={"via": "password"},
        )
        return AdminTokenOut(access_token=token, admin=out_admin)

    @api.post("/admin/auth/logout")
    async def admin_logout(admin=Depends(admin_dep)):
        await write_admin_audit(
            db,
            admin_user_id=admin.get("id"),
            admin_username=admin.get("username"),
            action="LOGOUT",
            resource_type="auth",
            metadata={"via": admin.get("_auth_via")},
        )
        return {"ok": True}

    @api.get("/admin/auth/me", response_model=AdminOut)
    async def admin_me(admin=Depends(admin_dep)):
        return AdminOut(
            id=admin["id"],
            username=admin["username"],
            display_name=admin.get("display_name") or admin["username"],
            role=admin.get("role") or ROLE_PLATFORM_ADMIN,
            active=bool(admin.get("active", True)),
        )