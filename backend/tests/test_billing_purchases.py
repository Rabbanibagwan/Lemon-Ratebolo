"""Merchant bag purchase endpoints — disabled when allow_test_payments is false."""
from __future__ import annotations

import copy
from typing import Dict, List, Optional

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

import billing as billing_mod


class _Cursor:
    def __init__(self, rows: List[dict]):
        self._rows = list(rows)
        self._i = 0

    def sort(self, *args, **kwargs):
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
                if "$inc" in update:
                    for k, v in update["$inc"].items():
                        d[k] = int(d.get(k) or 0) + int(v)
                return type("R", (), {"modified_count": 1})()
        if upsert and "$setOnInsert" in update:
            doc = {**query, **update["$setOnInsert"]}
            self._store[self._name].append(doc)
            return type("R", (), {"modified_count": 1})()
        if upsert and "$set" in update:
            doc = {**query, **update["$set"]}
            self._store[self._name].append(doc)
            return type("R", (), {"modified_count": 1})()
        return type("R", (), {"modified_count": 0})()

    async def find_one_and_update(self, query: dict, update: dict, return_document=False, projection=None):
        for d in self._store[self._name]:
            if _match(d, query):
                if "$set" in update:
                    d.update(update["$set"])
                out = copy.deepcopy(d)
                if projection and projection.get("_id") == 0:
                    out.pop("_id", None)
                return out
        return None

    def find(self, query: dict, projection: Optional[dict] = None):
        rows = []
        for d in self._store[self._name]:
            if _match(d, query):
                out = copy.deepcopy(d)
                if projection and projection.get("_id") == 0:
                    out.pop("_id", None)
                rows.append(out)
        return _Cursor(rows)

    def aggregate(self, pipeline: list):
        return _Cursor([])


def _match(doc: dict, query: dict) -> bool:
    for k, v in query.items():
        if isinstance(v, dict) and "$ne" in v:
            if doc.get(k) == v["$ne"]:
                return False
            continue
        if doc.get(k) != v:
            return False
    return True


class FakeDB:
    def __init__(self):
        self._store: Dict[str, List[dict]] = {}

    def __getattr__(self, name: str):
        return _Coll(self._store, name)


@pytest.fixture
def billing_client(fake_db):
    async def dummy_user():
        return {"shop_id": "shop-1", "id": "owner-1", "role": "owner"}

    async def dummy_owner():
        return {"shop_id": "shop-1", "id": "owner-1", "role": "owner"}

    api = APIRouter(prefix="/api")
    billing_mod.attach_billing(api, db=fake_db, current_user=dummy_user, owner_only=dummy_owner)
    app = FastAPI()
    app.include_router(api)
    return TestClient(app)


@pytest.fixture
def fake_db():
    return FakeDB()


def _seed_settings(fake_db, *, allow_test_payments: bool):
    fake_db._store["platform_billing_settings"] = [{
        "id": "default",
        "price_per_bag": 0.25,
        "new_merchant_free_bags": 1000,
        "gst_percent": 0.0,
        "allow_test_payments": allow_test_payments,
        "billing_active": True,
    }]


class TestBagPurchasesDisabled:
    def test_create_purchase_rejected_when_test_payments_disabled(self, billing_client, fake_db):
        _seed_settings(fake_db, allow_test_payments=False)
        r = billing_client.post("/api/billing/purchases", json={"bags": 100})
        assert r.status_code == 403
        assert "disabled" in r.json()["detail"].lower()
        assert fake_db._store.get("bag_purchases", []) == []

    def test_confirm_test_rejected_when_test_payments_disabled(self, billing_client, fake_db):
        _seed_settings(fake_db, allow_test_payments=False)
        fake_db._store["bag_purchases"] = [{
            "id": "purchase-1",
            "shop_id": "shop-1",
            "bags": 100,
            "price_per_bag": 0.25,
            "base_amount": 25.0,
            "gst_percent": 0.0,
            "gst_amount": 0.0,
            "total_amount": 25.0,
            "status": "PENDING",
        }]
        r = billing_client.post("/api/billing/purchases/purchase-1/confirm-test", json={})
        assert r.status_code == 403
        assert fake_db._store["bag_purchases"][0]["status"] == "PENDING"


class TestBagPurchasesEnabled:
    def test_create_purchase_allowed_when_test_payments_enabled(self, billing_client, fake_db):
        _seed_settings(fake_db, allow_test_payments=True)
        r = billing_client.post("/api/billing/purchases", json={"bags": 50})
        assert r.status_code == 201
        body = r.json()
        assert body["status"] == "PENDING"
        assert body["bags"] == 50
        assert len(fake_db._store["bag_purchases"]) == 1
