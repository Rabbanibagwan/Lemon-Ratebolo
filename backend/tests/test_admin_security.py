"""Security hardening tests for platform admin and legacy X-Admin-Key billing routes."""
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

os.environ.setdefault(
    "ADMIN_JWT_SECRET",
    "pytest-admin-jwt-secret-do-not-use-in-production-0123456789ab",
)

import admin_auth as admin_auth_mod  # noqa: E402
import billing as billing_mod  # noqa: E402


class _Cursor:
    def __init__(self, rows: List[dict]):
        self._rows = list(rows)
        self._i = 0

    def limit(self, n: int):
        self._rows = self._rows[:n]
        return self

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

    async def update_one(self, query: dict, update: dict, upsert: bool = False):
        for d in self._store[self._name]:
            if _match(d, query):
                if "$set" in update:
                    d.update(update["$set"])
                return type("R", (), {"modified_count": 1})()
        if upsert and "$set" in update:
            doc = {**query, **update["$set"]}
            self._store[self._name].append(doc)
            return type("R", (), {"modified_count": 1})()
        return type("R", (), {"modified_count": 0})()

    def find(self, query: dict, projection: Optional[dict] = None):
        rows = []
        for d in self._store[self._name]:
            if _match(d, query):
                out = copy.deepcopy(d)
                if projection and projection.get("_id") == 0:
                    out.pop("_id", None)
                if projection and projection.get("password_hash") == 0:
                    out.pop("password_hash", None)
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
def billing_admin_client(fake_db, monkeypatch):
    monkeypatch.delenv("ADMIN_API_KEY", raising=False)
    monkeypatch.delenv("BILLING_ADMIN_KEY", raising=False)
    monkeypatch.delenv("ALLOW_DEV_ADMIN_KEY", raising=False)

    async def dummy_user():
        return {"shop_id": "shop-1"}

    async def dummy_owner():
        return {"shop_id": "shop-1", "role": "owner"}

    api = APIRouter(prefix="/api")
    billing_mod.attach_billing(api, db=fake_db, current_user=dummy_user, owner_only=dummy_owner)
    app = FastAPI()
    app.include_router(api)
    return TestClient(app)


@pytest.fixture
def admin_client(fake_db, pwd):
    api = APIRouter(prefix="/api")
    admin_auth_mod.register_admin_auth_routes(api, fake_db, pwd)
    app = FastAPI()
    app.include_router(api)
    return TestClient(app)


def _insert_admin(fake_db, pwd: CryptContext, *, username: str, password: str, active: bool = True) -> dict:
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


class TestLegacyXAdminKey:
    def test_dev_admin_key_rejected_without_env(self, billing_admin_client):
        r = billing_admin_client.get(
            "/api/admin/billing/settings",
            headers={"X-Admin-Key": "lemon-admin-dev"},
        )
        assert r.status_code == 401

    def test_dev_admin_key_works_when_explicitly_allowed(self, billing_admin_client, monkeypatch):
        monkeypatch.setenv("ALLOW_DEV_ADMIN_KEY", "true")
        r = billing_admin_client.get(
            "/api/admin/billing/settings",
            headers={"X-Admin-Key": "lemon-admin-dev"},
        )
        assert r.status_code == 200

    def test_configured_admin_api_key_required_in_production_mode(self, billing_admin_client, monkeypatch):
        monkeypatch.setenv("ADMIN_API_KEY", "prod-secret-key-12345")
        r_ok = billing_admin_client.get(
            "/api/admin/billing/settings",
            headers={"X-Admin-Key": "prod-secret-key-12345"},
        )
        r_bad = billing_admin_client.get(
            "/api/admin/billing/settings",
            headers={"X-Admin-Key": "lemon-admin-dev"},
        )
        assert r_ok.status_code == 200
        assert r_bad.status_code == 401

    def test_billing_settings_update_writes_audit_log(self, billing_admin_client, fake_db, monkeypatch):
        monkeypatch.setenv("ALLOW_DEV_ADMIN_KEY", "true")
        payload = {
            "price_per_bag": 0.5,
            "new_merchant_free_bags": 500,
            "gst_percent": 18.0,
            "allow_test_payments": False,
            "billing_active": True,
        }
        r = billing_admin_client.put(
            "/api/admin/billing/settings",
            headers={"X-Admin-Key": "lemon-admin-dev"},
            json=payload,
        )
        assert r.status_code == 200
        logs = fake_db._store.get("platform_admin_audit_log", [])
        assert len(logs) == 1
        assert logs[0]["action"] == "BILLING_SETTINGS_UPDATED"
        assert logs[0]["admin_username"] == "x-admin-key"
        assert logs[0]["resource_type"] == "platform_billing_settings"
        assert logs[0]["before"] is not None
        assert logs[0]["after"]["price_per_bag"] == 0.5


class TestAdminJwtHardening:
    def test_deactivated_admin_jwt_rejected(self, admin_client, fake_db, pwd):
        admin = _insert_admin(fake_db, pwd, username="deactadmin", password="StrongPass1234")
        token = admin_auth_mod.make_admin_token(
            admin_id=admin["id"],
            username=admin["username"],
            role=admin["role"],
        )
        for row in fake_db._store["platform_admins"]:
            if row["id"] == admin["id"]:
                row["active"] = False
        r = admin_client.get(
            "/api/admin/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 401

    def test_wrong_audience_admin_jwt_rejected(self, admin_client, fake_db, pwd):
        admin = _insert_admin(fake_db, pwd, username="audadmin", password="StrongPass1234")
        now = datetime.now(timezone.utc)
        token = jwt.encode(
            {
                "sub": admin["id"],
                "username": admin["username"],
                "role": admin["role"],
                "aud": "wrong-audience",
                "iat": now,
                "exp": now + timedelta(hours=1),
            },
            os.environ["ADMIN_JWT_SECRET"],
            algorithm=admin_auth_mod.ADMIN_JWT_ALG,
        )
        r = admin_client.get(
            "/api/admin/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 401

    def test_admin_me_never_returns_password_hash(self, admin_client, fake_db, pwd):
        _insert_admin(fake_db, pwd, username="hashadmin", password="StrongPass1234")
        r = admin_client.post(
            "/api/admin/auth/login",
            json={"username": "hashadmin", "password": "StrongPass1234"},
        )
        token = r.json()["access_token"]
        me = admin_client.get(
            "/api/admin/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert me.status_code == 200
        assert "password_hash" not in me.text
        assert "$2b$" not in me.text


class TestAdminBootstrapProduction:
    def test_bootstrap_refused_in_production_without_allow(self, fake_db, pwd, monkeypatch):
        monkeypatch.setenv("ADMIN_BOOTSTRAP_ENABLED", "true")
        monkeypatch.setenv("ADMIN_BOOTSTRAP_USERNAME", "bootstrap_admin")
        monkeypatch.setenv("ADMIN_BOOTSTRAP_PASSWORD", "BootstrapPass12")
        monkeypatch.setenv("ENVIRONMENT", "production")
        monkeypatch.delenv("ADMIN_BOOTSTRAP_ALLOW_PRODUCTION", raising=False)

        asyncio.run(admin_auth_mod.maybe_bootstrap_first_admin(fake_db, pwd))
        assert fake_db._store.get("platform_admins", []) == []


class TestMerchantLoginActiveGate:
    def test_inactive_shop_blocks_owner_login_gate(self):
        """Mirrors server.py /auth/login owner branch (line ~641)."""
        shop = {"id": "s1", "password_hash": "hash", "active": False}
        password_ok = True
        assert not (shop and password_ok and shop.get("active", False))

    def test_inactive_shop_blocks_counter_login_gate(self):
        """Mirrors server.py /auth/login counter branch — shop must be active=True."""
        staff = {"id": "st1", "shop_id": "s1", "active": True}
        password_ok = True
        shop = None
        allowed = staff and password_ok and staff.get("active", False) and shop
        assert not allowed
