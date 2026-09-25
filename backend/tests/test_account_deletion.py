"""Merchant account deletion — shop-scoped purge + auth guards."""
from __future__ import annotations

import asyncio
import copy
from typing import Dict, List, Optional

import pytest
from fastapi import APIRouter, Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient
from passlib.context import CryptContext
from pydantic import BaseModel, Field

from backup import SHOP_COLLECTIONS, delete_merchant_account


class _Cursor:
    def __init__(self, rows: List[dict]):
        self._rows = list(rows)
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

    async def find_one(self, query: dict, projection: Optional[dict] = None):
        for d in self._store[self._name]:
            if all(d.get(k) == v for k, v in query.items()):
                out = copy.deepcopy(d)
                if projection and projection.get("_id") == 0:
                    out.pop("_id", None)
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
        before = len(self._store[self._name])
        self._store[self._name] = [
            d for d in self._store[self._name] if not all(d.get(k) == v for k, v in query.items())
        ]

        class R:
            deleted_count = before - len(self._store[self._name])

        return R()

    async def delete_one(self, query: dict):
        before = len(self._store[self._name])
        self._store[self._name] = [
            d for d in self._store[self._name] if not all(d.get(k) == v for k, v in query.items())
        ]

        class R:
            deleted_count = 1 if before > len(self._store[self._name]) else 0

        return R()

    async def insert_one(self, doc: dict):
        self._store[self._name].append(copy.deepcopy(doc))


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


@pytest.fixture
def pwd():
    return CryptContext(schemes=["bcrypt"], deprecated="auto")


@pytest.fixture
def fake_db():
    return FakeDB()


def _seed_shop(fake_db: FakeDB, pwd: CryptContext, *, shop_id: str, password: str = "secret12") -> dict:
    shop = {
        "id": shop_id,
        "shop_name": "Test Mandi",
        "username": f"owner-{shop_id}",
        "password_hash": pwd.hash(password),
        "active": True,
    }
    _run(fake_db.shops.insert_one(shop))
    for name in SHOP_COLLECTIONS:
        _run(
            fake_db.__getattr__(name).insert_one(
                {"shop_id": shop_id, "id": f"{name}-1", "sample": True}
            )
        )
    # Leave one row for a different shop to ensure scoping.
    _run(fake_db.pattis.insert_one({"shop_id": "other-shop", "id": "p-other"}))
    return shop


async def _collect(cursor):
    out = []
    async for row in cursor:
        out.append(row)
    return out


def test_delete_merchant_account_removes_shop_and_scoped_data(fake_db, pwd):
    shop_id = "shop-del-1"
    _seed_shop(fake_db, pwd, shop_id=shop_id)

    _run(delete_merchant_account(fake_db, shop_id))

    assert _run(fake_db.shops.find_one({"id": shop_id})) is None
    for name in SHOP_COLLECTIONS:
        remaining = _run(_collect(fake_db.__getattr__(name).find({"shop_id": shop_id})))
        assert remaining == [], f"{name} still has rows for deleted shop"
    other = _run(fake_db.pattis.find_one({"shop_id": "other-shop"}))
    assert other is not None


class DeleteAccountBody(BaseModel):
    password: str = Field(min_length=1, max_length=72)


def _register_delete_route(api: APIRouter, db, pwd: CryptContext, owner_only, counter_user):
    """Mirrors server.py /auth/delete-account."""

    @api.post("/auth/delete-account")
    async def delete_account(body: DeleteAccountBody, user=Depends(owner_only)):
        shop_id = user["shop_id"]
        if user.get("id") != shop_id:
            raise HTTPException(403, "Only the shop owner can delete this account")
        shop = await db.shops.find_one({"id": shop_id})
        if not shop:
            raise HTTPException(404, "Shop not found")
        if not pwd.verify(body.password, shop["password_hash"]):
            raise HTTPException(401, "Incorrect password")
        await delete_merchant_account(db, shop_id)
        return {"ok": True}

    @api.get("/auth/delete-account/counter-probe")
    async def counter_probe(user=Depends(counter_user)):
        return {"role": user["role"]}


@pytest.fixture
def delete_client(fake_db, pwd):
    async def owner_user():
        return {"id": "shop-a", "shop_id": "shop-a", "role": "owner", "username": "owner-a"}

    async def counter_user():
        return {"id": "staff-1", "shop_id": "shop-a", "role": "counter", "username": "counter1"}

    async def owner_only(user=Depends(owner_user)):
        if user["role"] != "owner":
            raise HTTPException(403, "Owner role required")
        return user

    api = APIRouter(prefix="/api")
    _register_delete_route(api, fake_db, pwd, owner_only, counter_user)
    app = FastAPI()
    app.include_router(api)
    return TestClient(app)


def test_delete_account_endpoint_owner_success(delete_client, fake_db, pwd):
    _seed_shop(fake_db, pwd, shop_id="shop-a", password="mypassword")

    res = delete_client.post("/api/auth/delete-account", json={"password": "mypassword"})
    assert res.status_code == 200
    assert res.json()["ok"] is True
    assert _run(fake_db.shops.find_one({"id": "shop-a"})) is None


def test_delete_account_wrong_password(delete_client, fake_db, pwd):
    _seed_shop(fake_db, pwd, shop_id="shop-a", password="mypassword")

    res = delete_client.post("/api/auth/delete-account", json={"password": "wrongpass"})
    assert res.status_code == 401
    assert _run(fake_db.shops.find_one({"id": "shop-a"})) is not None


def test_delete_account_counter_forbidden(fake_db, pwd):
    async def counter_user():
        return {"id": "staff-1", "shop_id": "shop-a", "role": "counter"}

    async def owner_only(user=Depends(counter_user)):
        if user["role"] != "owner":
            raise HTTPException(403, "Owner role required")
        raise AssertionError("should not reach handler")

    api = APIRouter(prefix="/api")
    _register_delete_route(api, fake_db, pwd, owner_only, counter_user)
    app = FastAPI()
    app.include_router(api)
    client = TestClient(app)

    _seed_shop(fake_db, pwd, shop_id="shop-a")
    res = client.post("/api/auth/delete-account", json={"password": "secret12"})
    assert res.status_code == 403
