"""Platform admin authentication foundation tests (in-process, FakeDB)."""
from __future__ import annotations

import asyncio
import copy
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import jwt
import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient
from passlib.context import CryptContext

# Must be set before admin_auth reads ADMIN_JWT_SECRET.
os.environ.setdefault(
    "ADMIN_JWT_SECRET",
    "pytest-admin-jwt-secret-do-not-use-in-production-0123456789ab",
)

import admin_auth as admin_auth_mod  # noqa: E402


class _Cursor:
    def __init__(self, rows: List[dict]):
        self._rows = rows
        self._i = 0

    def __aiter__(self):
        self._i = 0
        return self

    async def __anext__(self):
        if self._i >= len(self._rows):
            raise StopAsyncIteration
        row = self._rows[self._i]
        self._i += 1
        return copy.deepcopy(row)


class _Coll:
    def __init__(self, store: Dict[str, List[dict]], name: str):
        self._store = store
        self._name = name
        self._store.setdefault(name, [])

    async def create_index(self, *args, **kwargs):
        return None

    async def count_documents(self, query: dict):
        return sum(1 for d in self._store[self._name] if _match(d, query))

    async def insert_one(self, doc: dict):
        self._store[self._name].append(copy.deepcopy(doc))

    async def find_one(self, query: dict, projection: Optional[dict] = None):
        for d in self._store[self._name]:
            if _match(d, query):
                out = copy.deepcopy(d)
                if projection and projection.get("_id") == 0:
                    out.pop("_id", None)
                return out
        return None

    async def update_one(self, query: dict, update: dict):
        for d in self._store[self._name]:
            if _match(d, query):
                if "$set" in update:
                    d.update(update["$set"])
                return type("R", (), {"modified_count": 1})()
        return type("R", (), {"modified_count": 0})()

    def find(self, query: dict, projection: Optional[dict] = None):
        rows = []
        for d in self._store[self._name]:
            if _match(d, query):
                out = copy.deepcopy(d)
                if projection and projection.get("_id") == 0:
                    out.pop("_id", None)
                rows.append(out)
        return _Cursor(rows)


def _match(doc: dict, query: dict) -> bool:
    for k, v in query.items():
        if doc.get(k) != v:
            return False
    return True


class FakeDB:
    def __init__(self):
        self._store: Dict[str, List[dict]] = {}

    def __getattr__(self, name: str):
        return _Coll(self._store, name)


@pytest.fixture
def pwd():
    return CryptContext(schemes=["bcrypt"], deprecated="auto")


@pytest.fixture
def fake_db():
    return FakeDB()


@pytest.fixture
def admin_client(fake_db, pwd):
    api = APIRouter(prefix="/api")
    admin_auth_mod.register_admin_auth_routes(api, fake_db, pwd)
    app = FastAPI()
    app.include_router(api)
    return TestClient(app)


def _insert_admin(
    fake_db,
    pwd: CryptContext,
    *,
    username: str,
    password: str,
    active: bool = True,
) -> dict:
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "username": username.lower(),
        "password_hash": pwd.hash(password),
        "display_name": "Test Admin",
        "email": "admin@test.example",
        "role": admin_auth_mod.ROLE_PLATFORM_ADMIN,
        "active": active,
        "created_at": now,
        "updated_at": now,
        "last_login_at": None,
    }
    fake_db._store.setdefault("platform_admins", []).append(doc)
    return doc


def _assert_no_password_hash(payload: Any) -> None:
    text = str(payload)
    assert "password_hash" not in text
    assert "$2b$" not in text


class TestAdminAuthLogin:
    def test_valid_admin_login(self, admin_client, fake_db, pwd):
        _insert_admin(fake_db, pwd, username="platadmin", password="StrongPass1234")
        r = admin_client.post(
            "/api/admin/auth/login",
            json={"username": "platadmin", "password": "StrongPass1234"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["token_type"] == "bearer"
        assert data["access_token"]
        assert data["username"] == "platadmin"
        assert data["role"] == admin_auth_mod.ROLE_PLATFORM_ADMIN
        _assert_no_password_hash(data)

        claims = jwt.decode(
            data["access_token"],
            os.environ["ADMIN_JWT_SECRET"],
            algorithms=[admin_auth_mod.ADMIN_JWT_ALG],
            audience=admin_auth_mod.ADMIN_JWT_AUD,
        )
        assert claims["role"] == admin_auth_mod.ROLE_PLATFORM_ADMIN
        assert claims["sub"]

    def test_wrong_password(self, admin_client, fake_db, pwd):
        _insert_admin(fake_db, pwd, username="platadmin2", password="StrongPass1234")
        r = admin_client.post(
            "/api/admin/auth/login",
            json={"username": "platadmin2", "password": "WrongPass9999"},
        )
        assert r.status_code == 401

    def test_unknown_username(self, admin_client):
        r = admin_client.post(
            "/api/admin/auth/login",
            json={"username": "nobody_here", "password": "StrongPass1234"},
        )
        assert r.status_code == 401

    def test_inactive_admin(self, admin_client, fake_db, pwd):
        _insert_admin(
            fake_db,
            pwd,
            username="inactive_admin",
            password="StrongPass1234",
            active=False,
        )
        r = admin_client.post(
            "/api/admin/auth/login",
            json={"username": "inactive_admin", "password": "StrongPass1234"},
        )
        assert r.status_code == 403


class TestAdminAuthMe:
    def test_valid_admin_jwt(self, admin_client, fake_db, pwd):
        admin = _insert_admin(fake_db, pwd, username="meadmin", password="StrongPass1234")
        token = admin_auth_mod.make_admin_token(
            admin_id=admin["id"],
            username=admin["username"],
            role=admin["role"],
        )
        r = admin_client.get(
            "/api/admin/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["id"] == admin["id"]
        assert data["username"] == "meadmin"
        assert data["active"] is True
        _assert_no_password_hash(data)

    def test_invalid_jwt(self, admin_client):
        r = admin_client.get(
            "/api/admin/auth/me",
            headers={"Authorization": "Bearer not-a-valid-jwt"},
        )
        assert r.status_code == 401

    def test_expired_jwt(self, admin_client, fake_db, pwd):
        admin = _insert_admin(fake_db, pwd, username="expadmin", password="StrongPass1234")
        now = datetime.now(timezone.utc)
        expired = jwt.encode(
            {
                "sub": admin["id"],
                "username": admin["username"],
                "role": admin["role"],
                "aud": admin_auth_mod.ADMIN_JWT_AUD,
                "iat": now - timedelta(hours=2),
                "exp": now - timedelta(hours=1),
            },
            os.environ["ADMIN_JWT_SECRET"],
            algorithm=admin_auth_mod.ADMIN_JWT_ALG,
        )
        r = admin_client.get(
            "/api/admin/auth/me",
            headers={"Authorization": f"Bearer {expired}"},
        )
        assert r.status_code == 401

    def test_merchant_jwt_cannot_access_admin_me(self, admin_client, fake_db, pwd):
        _insert_admin(fake_db, pwd, username="meadmin2", password="StrongPass1234")
        now = datetime.now(timezone.utc)
        merchant_token = jwt.encode(
            {
                "sub": "shop-123",
                "shop_id": "shop-123",
                "username": "merchant1",
                "role": "owner",
                "iat": now,
                "exp": now + timedelta(hours=1),
            },
            "merchant-jwt-secret-not-admin",
            algorithm="HS256",
        )
        r = admin_client.get(
            "/api/admin/auth/me",
            headers={"Authorization": f"Bearer {merchant_token}"},
        )
        assert r.status_code == 401

    def test_login_response_never_includes_password_hash(self, admin_client, fake_db, pwd):
        _insert_admin(fake_db, pwd, username="hashcheck", password="StrongPass1234")
        r = admin_client.post(
            "/api/admin/auth/login",
            json={"username": "hashcheck", "password": "StrongPass1234"},
        )
        assert r.status_code == 200
        _assert_no_password_hash(r.json())
        _assert_no_password_hash(r.text)


class TestAdminAuditLog:
    def test_login_writes_audit_log(self, admin_client, fake_db, pwd):
        _insert_admin(fake_db, pwd, username="auditadmin", password="StrongPass1234")
        r = admin_client.post(
            "/api/admin/auth/login",
            json={"username": "auditadmin", "password": "StrongPass1234"},
        )
        assert r.status_code == 200
        logs = fake_db._store.get("platform_admin_audit_log", [])
        assert len(logs) == 1
        assert logs[0]["action"] == "ADMIN_LOGIN"
        assert logs[0]["admin_username"] == "auditadmin"
        assert logs[0]["resource_type"] == "platform_admin"


class TestAdminBootstrap:
    def test_bootstrap_creates_first_admin_when_enabled(self, fake_db, pwd, monkeypatch):
        monkeypatch.setenv("ADMIN_BOOTSTRAP_ENABLED", "true")
        monkeypatch.setenv("ADMIN_BOOTSTRAP_USERNAME", "bootstrap_admin")
        monkeypatch.setenv("ADMIN_BOOTSTRAP_PASSWORD", "BootstrapPass12")
        monkeypatch.setenv("ADMIN_BOOTSTRAP_DISPLAY_NAME", "Bootstrap Admin")
        monkeypatch.setenv("ADMIN_BOOTSTRAP_EMAIL", "boot@test.example")

        asyncio.run(admin_auth_mod.maybe_bootstrap_first_admin(fake_db, pwd))
        assert len(fake_db._store.get("platform_admins", [])) == 1
        doc = fake_db._store["platform_admins"][0]
        assert doc["username"] == "bootstrap_admin"
        assert doc["role"] == admin_auth_mod.ROLE_PLATFORM_ADMIN
        assert "password_hash" in doc

        asyncio.run(admin_auth_mod.maybe_bootstrap_first_admin(fake_db, pwd))
        assert len(fake_db._store["platform_admins"]) == 1

    def test_bootstrap_skipped_when_disabled(self, fake_db, pwd, monkeypatch):
        monkeypatch.delenv("ADMIN_BOOTSTRAP_ENABLED", raising=False)
        monkeypatch.setenv("ADMIN_BOOTSTRAP_USERNAME", "bootstrap_admin")
        monkeypatch.setenv("ADMIN_BOOTSTRAP_PASSWORD", "BootstrapPass12")
        asyncio.run(admin_auth_mod.maybe_bootstrap_first_admin(fake_db, pwd))
        assert fake_db._store.get("platform_admins", []) == []
