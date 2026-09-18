"""Account deletion — unit + route tests (FakeDB / TestClient, no live Mongo required)."""
from __future__ import annotations

import asyncio
import copy
from typing import Dict, List, Optional

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from account_deletion import (
    CONFIRM_PHRASE,
    DRIVE_NOTICE,
    DeleteAccountBody,
    delete_merchant_account,
    register_delete_account_routes,
)
from backup import SHOP_COLLECTIONS


# ---------- Fake Mongo (minimal) ----------
class _Cursor:
    def __init__(self, rows: List[dict]):
        self._rows = rows

    def sort(self, *a, **k):
        return self

    def limit(self, n: int):
        self._rows = self._rows[:n]
        return self

    async def to_list(self, n: int):
        return self._rows[:n]

    def __aiter__(self):
        self._i = 0
        return self

    async def __anext__(self):
        if self._i >= len(self._rows):
            raise StopAsyncIteration
        row = self._rows[self._i]
        self._i += 1
        return row


class _Coll:
    def __init__(self, store: Dict[str, List[dict]], name: str):
        self._store = store
        self._name = name
        self._store.setdefault(name, [])
        self.fail_delete_many = False
        self.fail_delete_one = False

    async def find_one(self, query: dict, projection: Optional[dict] = None):
        for d in self._store[self._name]:
            if all(d.get(k) == v for k, v in query.items()):
                out = copy.deepcopy(d)
                if projection and projection.get("_id") == 0:
                    out.pop("_id", None)
                if projection and projection.get("password_hash") == 0:
                    out.pop("password_hash", None)
                return out
        return None

    def find(self, query: dict, projection: Optional[dict] = None):
        rows = []
        for d in self._store[self._name]:
            if all(d.get(k) == v for k, v in query.items()):
                out = copy.deepcopy(d)
                if projection and projection.get("_id") == 0:
                    out.pop("_id", None)
                rows.append(out)
        return _Cursor(rows)

    async def delete_many(self, query: dict):
        if self.fail_delete_many:
            raise RuntimeError("simulated delete_many failure")
        before = len(self._store[self._name])
        self._store[self._name] = [
            d
            for d in self._store[self._name]
            if not all(d.get(k) == v for k, v in query.items())
        ]

        class R:
            deleted_count = before - len(self._store[self._name])

        return R()

    async def delete_one(self, query: dict):
        if self.fail_delete_one:
            raise RuntimeError("simulated delete_one failure")
        for i, d in enumerate(self._store[self._name]):
            if all(d.get(k) == v for k, v in query.items()):
                self._store[self._name].pop(i)

                class R:
                    deleted_count = 1

                return R()

        class R:
            deleted_count = 0

        return R()

    async def insert_one(self, doc: dict):
        self._store[self._name].append(copy.deepcopy(doc))

    async def count_documents(self, query: dict):
        return sum(
            1
            for d in self._store[self._name]
            if all(d.get(k) == v for k, v in query.items())
        )


class FakeDB:
    def __init__(self):
        self._store: Dict[str, List[dict]] = {}
        self._colls: Dict[str, _Coll] = {}

    def _coll(self, name: str) -> _Coll:
        if name not in self._colls:
            self._colls[name] = _Coll(self._store, name)
        return self._colls[name]

    def __getattr__(self, name: str):
        if name.startswith("_"):
            raise AttributeError(name)
        return self._coll(name)

    def __getitem__(self, name: str):
        return self._coll(name)


def _run(coro):
    return asyncio.run(coro)


def _seed_shop(db: FakeDB, shop_id: str, *, other_shop: str = "other_shop") -> None:
    db._store.setdefault("shops", []).append(
        {
            "id": shop_id,
            "shop_name": "Delete Me Mandi",
            "username": f"owner_{shop_id[:8]}",
            "password_hash": "hash",
            "active": True,
        }
    )
    db._store.setdefault("shops", []).append(
        {
            "id": other_shop,
            "shop_name": "Keep Me Mandi",
            "username": "keep_owner",
            "password_hash": "hash",
            "active": True,
        }
    )
    db._store.setdefault("platform_billing_settings", []).append(
        {"id": "default", "price_per_bag": 0.25, "new_merchant_free_bags": 1000}
    )
    for name in SHOP_COLLECTIONS:
        db._store.setdefault(name, []).append({"id": f"{name}-a", "shop_id": shop_id, "x": 1})
        db._store[name].append({"id": f"{name}-b", "shop_id": other_shop, "x": 2})


# ---------- Unit: delete_merchant_account ----------
class TestDeleteMerchantAccountUnit:
    def test_owner_shop_data_and_login_deleted(self):
        db = FakeDB()
        sid = "shop_del_1"
        _seed_shop(db, sid)
        out = _run(delete_merchant_account(db, sid))
        assert out.deleted is True
        assert out.shop_id == sid
        assert out.drive_backups_deleted is False
        assert "Google Drive" in out.message
        assert set(out.deleted_collections) == set(SHOP_COLLECTIONS)
        assert _run(db.shops.find_one({"id": sid})) is None
        for name in SHOP_COLLECTIONS:
            assert _run(db[name].count_documents({"shop_id": sid})) == 0

    def test_other_shop_data_preserved(self):
        db = FakeDB()
        sid = "shop_del_2"
        other = "other_shop"
        _seed_shop(db, sid, other_shop=other)
        _run(delete_merchant_account(db, sid))
        assert _run(db.shops.find_one({"id": other})) is not None
        for name in SHOP_COLLECTIONS:
            assert _run(db[name].count_documents({"shop_id": other})) == 1

    def test_platform_billing_not_deleted(self):
        db = FakeDB()
        sid = "shop_del_3"
        _seed_shop(db, sid)
        _run(delete_merchant_account(db, sid))
        plat = _run(db.platform_billing_settings.find_one({"id": "default"}))
        assert plat is not None
        assert plat["price_per_bag"] == 0.25

    def test_patti_audit_log_deleted_with_shop(self):
        """Shop-scoped audit is operational data — deleted with the account."""
        db = FakeDB()
        sid = "shop_del_4"
        _seed_shop(db, sid)
        assert _run(db.patti_audit_log.count_documents({"shop_id": sid})) == 1
        _run(delete_merchant_account(db, sid))
        assert _run(db.patti_audit_log.count_documents({"shop_id": sid})) == 0
        # Other shop audit retained
        assert _run(db.patti_audit_log.count_documents({"shop_id": "other_shop"})) == 1

    def test_drive_backups_never_reported_deleted(self):
        db = FakeDB()
        sid = "shop_del_5"
        _seed_shop(db, sid)
        out = _run(delete_merchant_account(db, sid))
        assert out.drive_backups_deleted is False
        assert DRIVE_NOTICE in out.message or "Google Drive" in out.message

    def test_missing_shop_404(self):
        db = FakeDB()
        with pytest.raises(HTTPException) as ei:
            _run(delete_merchant_account(db, "missing"))
        assert ei.value.status_code == 404

    def test_collection_failure_keeps_shop_login(self):
        db = FakeDB()
        sid = "shop_del_fail"
        _seed_shop(db, sid)
        # Fail on a mid-list collection
        mid = SHOP_COLLECTIONS[len(SHOP_COLLECTIONS) // 2]
        db[mid].fail_delete_many = True
        with pytest.raises(HTTPException) as ei:
            _run(delete_merchant_account(db, sid))
        assert ei.value.status_code == 500
        # Login document must still exist (shops not deleted before scoped wipe completes)
        assert _run(db.shops.find_one({"id": sid})) is not None

    def test_shop_delete_failure_after_wipe(self):
        db = FakeDB()
        sid = "shop_del_shopfail"
        _seed_shop(db, sid)
        db.shops.fail_delete_one = True
        with pytest.raises(HTTPException) as ei:
            _run(delete_merchant_account(db, sid))
        assert ei.value.status_code == 500
        for name in SHOP_COLLECTIONS:
            assert _run(db[name].count_documents({"shop_id": sid})) == 0


# ---------- Route / auth behavior via TestClient ----------
def _app_for(db: FakeDB, *, role: str = "owner", shop_id: str = "shop_route"):
    api_router = __import__("fastapi").APIRouter(prefix="/api")

    async def owner_only():
        if role != "owner":
            raise HTTPException(403, "Owner role required")
        return {
            "id": shop_id if role == "owner" else "staff1",
            "shop_id": shop_id,
            "shop_name": "Route Shop",
            "username": "owner_u",
            "role": role,
            "display_name": "Route Shop",
        }

    register_delete_account_routes(api_router, db, owner_only)
    app = FastAPI()
    app.include_router(api_router)
    return TestClient(app)


class TestDeleteAccountRoutes:
    def test_owner_can_delete(self):
        db = FakeDB()
        sid = "shop_route_ok"
        _seed_shop(db, sid)
        client = _app_for(db, role="owner", shop_id=sid)
        r = client.post("/api/auth/delete-account", json={"confirm": CONFIRM_PHRASE})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["deleted"] is True
        assert body["drive_backups_deleted"] is False
        assert body["shop_id"] == sid
        assert _run(db.shops.find_one({"id": sid})) is None

    def test_staff_forbidden(self):
        db = FakeDB()
        sid = "shop_route_staff"
        _seed_shop(db, sid)
        client = _app_for(db, role="counter", shop_id=sid)
        r = client.post("/api/auth/delete-account", json={"confirm": CONFIRM_PHRASE})
        assert r.status_code == 403
        assert _run(db.shops.find_one({"id": sid})) is not None

    def test_unauthenticated_rejected(self):
        """No owner_only override → missing auth dependency fails closed when wired via server.
        Here we simulate missing user by a dependency that raises 401.
        """
        db = FakeDB()
        sid = "shop_route_unauth"
        _seed_shop(db, sid)

        from fastapi import APIRouter

        api_router = APIRouter(prefix="/api")

        async def no_auth():
            raise HTTPException(401, "Not authenticated")

        register_delete_account_routes(api_router, db, no_auth)
        app = FastAPI()
        app.include_router(api_router)
        client = TestClient(app)
        r = client.post("/api/auth/delete-account", json={"confirm": CONFIRM_PHRASE})
        assert r.status_code == 401
        assert _run(db.shops.find_one({"id": sid})) is not None

    def test_client_cannot_target_another_shop(self):
        """Even if a malicious body tried to pass shop_id, only token shop is deleted."""
        db = FakeDB()
        sid = "shop_mine"
        other = "shop_theirs"
        _seed_shop(db, sid, other_shop=other)
        client = _app_for(db, role="owner", shop_id=sid)
        r = client.post(
            "/api/auth/delete-account",
            json={"confirm": CONFIRM_PHRASE, "shop_id": other},
        )
        assert r.status_code == 200, r.text
        assert _run(db.shops.find_one({"id": sid})) is None
        assert _run(db.shops.find_one({"id": other})) is not None
        for name in SHOP_COLLECTIONS:
            assert _run(db[name].count_documents({"shop_id": other})) == 1

    def test_bad_confirm_phrase(self):
        db = FakeDB()
        sid = "shop_bad_confirm"
        _seed_shop(db, sid)
        client = _app_for(db, role="owner", shop_id=sid)
        r = client.post("/api/auth/delete-account", json={"confirm": "please"})
        assert r.status_code == 400
        assert _run(db.shops.find_one({"id": sid})) is not None

    def test_duplicate_delete_returns_404(self):
        db = FakeDB()
        sid = "shop_dup"
        _seed_shop(db, sid)
        client = _app_for(db, role="owner", shop_id=sid)
        assert client.post("/api/auth/delete-account", json={"confirm": CONFIRM_PHRASE}).status_code == 200
        r2 = client.post("/api/auth/delete-account", json={"confirm": CONFIRM_PHRASE})
        assert r2.status_code == 404

    def test_delete_account_body_rejects_empty(self):
        with pytest.raises(Exception):
            DeleteAccountBody(confirm="")

    def test_auth_confirm_constant(self):
        assert CONFIRM_PHRASE == "DELETE"
