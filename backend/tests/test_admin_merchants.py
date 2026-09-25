"""Platform admin merchant management API tests (in-process, FakeDB)."""
from __future__ import annotations

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
import admin_merchants as admin_merchants_mod  # noqa: E402


class _Cursor:
    def __init__(self, rows: List[dict]):
        self._rows = list(rows)

    def sort(self, key: str, direction: int = -1):
        reverse = direction < 0
        self._rows.sort(key=lambda r: r.get(key) or datetime.min.replace(tzinfo=timezone.utc), reverse=reverse)
        return self

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
                if projection and projection.get("password_hash") == 0:
                    out.pop("password_hash", None)
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
def admin_api_client(fake_db, pwd):
    api = APIRouter(prefix="/api")
    admin_auth_mod.register_admin_auth_routes(api, fake_db, pwd)
    admin_merchants_mod.register_admin_merchant_routes(api, fake_db, admin_auth_mod.admin_only)
    app = FastAPI()
    app.include_router(api)
    return TestClient(app)


def _insert_admin(fake_db, pwd, username="platadmin", password="StrongPass1234"):
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "username": username,
        "password_hash": pwd.hash(password),
        "display_name": "Platform Admin",
        "email": "admin@test.example",
        "role": admin_auth_mod.ROLE_PLATFORM_ADMIN,
        "active": True,
        "created_at": now,
        "updated_at": now,
        "last_login_at": None,
    }
    fake_db._store.setdefault("platform_admins", []).append(doc)
    return doc


def _admin_headers(admin):
    token = admin_auth_mod.make_admin_token(
        admin_id=admin["id"],
        username=admin["username"],
        role=admin["role"],
    )
    return {"Authorization": f"Bearer {token}"}


def _insert_shop(
    fake_db,
    *,
    shop_id: str,
    shop_name: str,
    username: str,
    active: bool = True,
    created_at: Optional[datetime] = None,
    owner_name: str = "Owner",
):
    now = created_at or datetime.now(timezone.utc)
    fake_db._store.setdefault("shops", []).append(
        {
            "id": shop_id,
            "shop_name": shop_name,
            "username": username,
            "password_hash": "$2b$12$fakehashshouldneverappear",
            "active": active,
            "created_at": now,
            "updated_at": now,
            "owner_name": owner_name,
            "email": f"{username}@shop.example",
            "mobile": "9999999999",
        }
    )


def _insert_wallet(fake_db, shop_id: str, *, free_allocated=1000, purchased_total=500):
    fake_db._store.setdefault("merchant_bag_wallets", []).append(
        {
            "id": str(uuid.uuid4()),
            "shop_id": shop_id,
            "free_allocated": free_allocated,
            "free_used": 0,
            "purchased_total": purchased_total,
            "purchased_used": 0,
            "version": 0,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        }
    )


def _insert_staff(fake_db, shop_id: str, count: int = 2):
    for i in range(count):
        fake_db._store.setdefault("staff", []).append(
            {
                "id": str(uuid.uuid4()),
                "shop_id": shop_id,
                "username": f"staff{i}_{shop_id[:6]}",
                "name": f"Staff {i}",
                "active": True,
            }
        )


def _assert_no_password_hash(payload: Any) -> None:
    text = str(payload)
    assert "password_hash" not in text
    assert "$2b$12$fakehashshouldneverappear" not in text


class TestAdminMerchantAuth:
    def test_unauthenticated_rejected(self, admin_api_client, fake_db):
        _insert_shop(fake_db, shop_id="s1", shop_name="Alpha Mandi", username="alpha")
        r = admin_api_client.get("/api/admin/merchants")
        assert r.status_code == 401

    def test_merchant_jwt_rejected(self, admin_api_client, fake_db):
        _insert_shop(fake_db, shop_id="s1", shop_name="Alpha Mandi", username="alpha")
        now = datetime.now(timezone.utc)
        merchant_token = jwt.encode(
            {
                "sub": "s1",
                "shop_id": "s1",
                "username": "alpha",
                "role": "owner",
                "iat": now,
                "exp": now + timedelta(hours=1),
            },
            "merchant-jwt-secret-not-admin",
            algorithm="HS256",
        )
        r = admin_api_client.get(
            "/api/admin/merchants",
            headers={"Authorization": f"Bearer {merchant_token}"},
        )
        assert r.status_code == 401


class TestAdminMerchantList:
    def test_list_search_and_pagination(self, admin_api_client, fake_db, pwd):
        admin = _insert_admin(fake_db, pwd)
        t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
        t1 = datetime(2026, 2, 1, tzinfo=timezone.utc)
        _insert_shop(fake_db, shop_id="s-alpha", shop_name="Alpha Lemon Mandi", username="alpha", created_at=t0)
        _insert_shop(fake_db, shop_id="s-beta", shop_name="Beta Traders", username="beta", created_at=t1)
        _insert_wallet(fake_db, "s-alpha")

        headers = _admin_headers(admin)
        r = admin_api_client.get("/api/admin/merchants?q=alpha&page=1&limit=1", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert data["total"] == 1
        assert data["page"] == 1
        assert data["limit"] == 1
        assert len(data["items"]) == 1
        assert data["items"][0]["shop_id"] == "s-alpha"
        assert data["items"][0]["wallet"]["total_available"] == 1500
        _assert_no_password_hash(data)

    def test_list_active_filter(self, admin_api_client, fake_db, pwd):
        admin = _insert_admin(fake_db, pwd)
        _insert_shop(fake_db, shop_id="s1", shop_name="Active Shop", username="active1", active=True)
        _insert_shop(fake_db, shop_id="s2", shop_name="Suspended Shop", username="suspended1", active=False)

        headers = _admin_headers(admin)
        r = admin_api_client.get("/api/admin/merchants?active=false", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert data["total"] == 1
        assert data["items"][0]["shop_id"] == "s2"
        assert data["items"][0]["active"] is False


class TestAdminMerchantDetail:
    def test_detail_includes_wallet_staff_and_history(self, admin_api_client, fake_db, pwd):
        admin = _insert_admin(fake_db, pwd)
        shop_id = "shop-detail-1"
        _insert_shop(fake_db, shop_id=shop_id, shop_name="Detail Shop", username="detailshop")
        _insert_wallet(fake_db, shop_id)
        _insert_staff(fake_db, shop_id, count=2)
        fake_db._store.setdefault("bag_purchases", []).append(
            {
                "id": "p1",
                "shop_id": shop_id,
                "bags": 100,
                "total_amount": 25.0,
                "status": "PAID",
                "created_at": datetime.now(timezone.utc),
            }
        )
        fake_db._store.setdefault("bag_usage", []).append(
            {
                "id": "u1",
                "shop_id": shop_id,
                "bags": 5,
                "kind": "CONSUME",
                "at": datetime.now(timezone.utc),
            }
        )

        r = admin_api_client.get(
            f"/api/admin/merchants/{shop_id}",
            headers=_admin_headers(admin),
        )
        assert r.status_code == 200
        data = r.json()
        assert data["shop_id"] == shop_id
        assert data["staff_count"] == 2
        assert data["wallet"]["total_available"] == 1500
        assert len(data["recent_purchases"]) == 1
        assert len(data["recent_usage"]) == 1
        assert data["profile"]["shop_name"] == "Detail Shop"
        _assert_no_password_hash(data)

    def test_detail_not_found(self, admin_api_client, fake_db, pwd):
        admin = _insert_admin(fake_db, pwd)
        r = admin_api_client.get(
            "/api/admin/merchants/missing-shop",
            headers=_admin_headers(admin),
        )
        assert r.status_code == 404


class TestAdminMerchantPatch:
    def test_suspend_and_activate_with_audit(self, admin_api_client, fake_db, pwd):
        admin = _insert_admin(fake_db, pwd)
        shop_id = "shop-patch-1"
        _insert_shop(fake_db, shop_id=shop_id, shop_name="Patch Shop", username="patchshop", active=True)

        headers = _admin_headers(admin)
        r = admin_api_client.patch(
            f"/api/admin/merchants/{shop_id}",
            headers=headers,
            json={"active": False},
        )
        assert r.status_code == 200
        assert r.json()["active"] is False

        shop = fake_db._store["shops"][0]
        assert shop["active"] is False

        logs = fake_db._store.get("platform_admin_audit_log", [])
        assert len(logs) == 1
        assert logs[0]["action"] == "MERCHANT_ACTIVE_UPDATED"
        assert logs[0]["before"] == {"active": True}
        assert logs[0]["after"] == {"active": False}
        assert logs[0]["shop_id"] == shop_id
        _assert_no_password_hash(r.json())

        r2 = admin_api_client.patch(
            f"/api/admin/merchants/{shop_id}",
            headers=headers,
            json={"active": True},
        )
        assert r2.status_code == 200
        assert r2.json()["active"] is True
        assert len(fake_db._store.get("platform_admin_audit_log", [])) == 2

    def test_patch_not_found(self, admin_api_client, fake_db, pwd):
        admin = _insert_admin(fake_db, pwd)
        r = admin_api_client.patch(
            "/api/admin/merchants/missing-shop",
            headers=_admin_headers(admin),
            json={"active": False},
        )
        assert r.status_code == 404


class TestAdminMerchantWalletApis:
    def test_wallet_purchases_usage_with_admin_jwt(self, admin_api_client, fake_db, pwd):
        admin = _insert_admin(fake_db, pwd)
        shop_id = "shop-wallet-1"
        _insert_shop(fake_db, shop_id=shop_id, shop_name="Wallet Shop", username="walletshop")
        _insert_wallet(fake_db, shop_id, free_allocated=800, purchased_total=200)
        now = datetime.now(timezone.utc)
        for i in range(3):
            fake_db._store.setdefault("bag_purchases", []).append(
                {
                    "id": f"p{i}",
                    "shop_id": shop_id,
                    "bags": 100 + i,
                    "total_amount": 25.0 + i,
                    "status": "PAID",
                    "created_at": now - timedelta(days=i),
                }
            )
            fake_db._store.setdefault("bag_usage", []).append(
                {
                    "id": f"u{i}",
                    "shop_id": shop_id,
                    "bags": 10 + i,
                    "kind": "CONSUME",
                    "at": now - timedelta(hours=i),
                }
            )

        headers = _admin_headers(admin)
        wallet_before = len(fake_db._store.get("merchant_bag_wallets", []))

        wr = admin_api_client.get(f"/api/admin/merchants/{shop_id}/wallet", headers=headers)
        assert wr.status_code == 200
        wallet = wr.json()
        assert wallet["shop_id"] == shop_id
        assert wallet["wallet"]["total_available"] == 1000
        _assert_no_password_hash(wallet)

        pr = admin_api_client.get(
            f"/api/admin/merchants/{shop_id}/purchases?page=1&limit=2",
            headers=headers,
        )
        assert pr.status_code == 200
        purchases = pr.json()
        assert purchases["total"] == 3
        assert purchases["page"] == 1
        assert purchases["limit"] == 2
        assert len(purchases["items"]) == 2
        _assert_no_password_hash(purchases)

        ur = admin_api_client.get(
            f"/api/admin/merchants/{shop_id}/usage?page=1&limit=2",
            headers=headers,
        )
        assert ur.status_code == 200
        usage = ur.json()
        assert usage["total"] == 3
        assert len(usage["items"]) == 2
        _assert_no_password_hash(usage)

        assert len(fake_db._store.get("merchant_bag_wallets", [])) == wallet_before

    def test_wallet_endpoints_require_admin_jwt(self, admin_api_client, fake_db):
        shop_id = "shop-wallet-2"
        _insert_shop(fake_db, shop_id=shop_id, shop_name="Auth Shop", username="authshop")

        for path in ("/wallet", "/purchases", "/usage"):
            assert admin_api_client.get(f"/api/admin/merchants/{shop_id}{path}").status_code == 401

        now = datetime.now(timezone.utc)
        merchant_token = jwt.encode(
            {
                "sub": shop_id,
                "shop_id": shop_id,
                "username": "authshop",
                "role": "owner",
                "iat": now,
                "exp": now + timedelta(hours=1),
            },
            "merchant-jwt-secret-not-admin",
            algorithm="HS256",
        )
        headers = {"Authorization": f"Bearer {merchant_token}"}
        for path in ("/wallet", "/purchases", "/usage"):
            assert (
                admin_api_client.get(
                    f"/api/admin/merchants/{shop_id}{path}",
                    headers=headers,
                ).status_code
                == 401
            )

    def test_wallet_endpoints_not_found(self, admin_api_client, fake_db, pwd):
        admin = _insert_admin(fake_db, pwd)
        headers = _admin_headers(admin)
        for path in ("/wallet", "/purchases", "/usage"):
            r = admin_api_client.get("/api/admin/merchants/missing-shop" + path, headers=headers)
            assert r.status_code == 404

    def test_wallet_readonly_when_no_wallet_doc(self, admin_api_client, fake_db, pwd):
        admin = _insert_admin(fake_db, pwd)
        shop_id = "shop-no-wallet"
        _insert_shop(fake_db, shop_id=shop_id, shop_name="No Wallet Shop", username="nowallet")
        headers = _admin_headers(admin)

        r = admin_api_client.get(f"/api/admin/merchants/{shop_id}/wallet", headers=headers)
        assert r.status_code == 200
        assert r.json()["wallet"]["total_available"] == 0
        assert fake_db._store.get("merchant_bag_wallets", []) == []
