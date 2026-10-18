"""Cash Book API unit tests (in-memory FakeColl — no live Mongo required)."""
from __future__ import annotations

from typing import List, Optional

from fastapi import FastAPI
from fastapi.testclient import TestClient


class FakeCursor:
    def __init__(self, rows: List[dict]):
        self._rows = list(rows)

    def sort(self, *a, **k):
        keys = a[0] if a else []
        if isinstance(keys, list):
            for key, direction in reversed(keys):
                self._rows.sort(key=lambda r: r.get(key) or "", reverse=direction == -1)
        return self

    async def to_list(self, n):
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


class FakeColl:
    def __init__(self, rows: Optional[List[dict]] = None, *, unique_keys: Optional[List[tuple]] = None):
        self.rows = list(rows or [])
        self.unique_keys = unique_keys or []

    async def create_index(self, *a, **k):
        return None

    def _match(self, row: dict, query: dict) -> bool:
        for k, v in query.items():
            if isinstance(v, dict):
                val = row.get(k)
                if "$lt" in v and not (val is not None and val < v["$lt"]):
                    return False
                if "$lte" in v and not (val is not None and val <= v["$lte"]):
                    return False
                if "$gt" in v and not (val is not None and val > v["$gt"]):
                    return False
                if "$gte" in v and not (val is not None and val >= v["$gte"]):
                    return False
                if "$ne" in v and val == v["$ne"]:
                    return False
                if "$in" in v and val not in v["$in"]:
                    return False
                if "$type" in v:
                    continue
                continue
            if row.get(k) != v:
                return False
        return True

    async def find_one(self, query: dict, *a, **k):
        for r in self.rows:
            if self._match(r, query):
                return dict(r)
        return None

    def find(self, query: dict, *a, **k):
        return FakeCursor([dict(r) for r in self.rows if self._match(r, query)])

    async def insert_one(self, doc: dict):
        for keys in self.unique_keys:
            vals = tuple(doc.get(k) for k in keys)
            if any(v is None for v in vals):
                continue
            for r in self.rows:
                if tuple(r.get(k) for k in keys) == vals:
                    raise Exception("duplicate key")
        self.rows.append(dict(doc))
        return None

    async def update_one(self, query: dict, update: dict, upsert: bool = False):
        for i, r in enumerate(self.rows):
            if self._match(r, query):
                row = dict(r)
                if "$set" in update:
                    row.update(update["$set"])
                self.rows[i] = row
                return type("R", (), {"modified_count": 1})()
        return type("R", (), {"modified_count": 0})()

    async def delete_one(self, query: dict):
        for i, r in enumerate(self.rows):
            if self._match(r, query):
                self.rows.pop(i)
                return type("R", (), {"deleted_count": 1})()
        return type("R", (), {"deleted_count": 0})()


class FakeDB:
    def __init__(self):
        self.cash_book_entries = FakeColl(
            unique_keys=[("shop_id", "id"), ("shop_id", "client_request_id"), ("shop_id", "local_id")]
        )


def _setup(shop_id: str = "shop-a"):
    import cash_book as cash_book_mod
    from fastapi import APIRouter, Depends, HTTPException

    db = FakeDB()
    api = APIRouter(prefix="/api")

    async def current_user():
        return {"id": "owner-1", "shop_id": shop_id, "role": "owner", "username": "owner"}

    async def owner_only(user=Depends(current_user)):
        if user["role"] != "owner":
            raise HTTPException(403, "Owner role required")
        return user

    cash_book_mod.attach_cash_book(api, db=db, current_user=current_user, owner_only=owner_only)
    app = FastAPI()
    app.include_router(api)
    return TestClient(app), db


def test_create_credit_and_debit_and_day_totals():
    client, db = _setup()
    r1 = client.post(
        "/api/cash-book/entries",
        json={"side": "CREDIT", "amount": 1000.5, "description": "Sale", "date": "2026-10-13", "client_request_id": "c1"},
    )
    assert r1.status_code == 201, r1.text
    r2 = client.post(
        "/api/cash-book/entries",
        json={"side": "DEBIT", "amount": 200, "description": "Hamali", "date": "2026-10-13", "client_request_id": "d1"},
    )
    assert r2.status_code == 201, r2.text
    day = client.get("/api/cash-book/entries", params={"date": "2026-10-13"})
    assert day.status_code == 200
    assert len(day.json()) == 2
    summary = client.get("/api/cash-book/day", params={"date": "2026-10-13"})
    assert summary.status_code == 200
    body = summary.json()
    assert body["total_credit"] == 1000.5
    assert body["total_debit"] == 200.0
    assert body["net"] == 800.5
    assert body["opening_balance"] == 0.0
    assert body["closing_balance"] == 800.5


def test_idempotent_client_request_id():
    client, _ = _setup()
    payload = {
        "side": "CREDIT",
        "amount": 50,
        "description": "Once",
        "date": "2026-10-13",
        "client_request_id": "same-req",
    }
    a = client.post("/api/cash-book/entries", json=payload)
    b = client.post("/api/cash-book/entries", json=payload)
    assert a.status_code == 201
    assert b.status_code == 201
    assert a.json()["id"] == b.json()["id"]
    listed = client.get("/api/cash-book/entries", params={"date": "2026-10-13"}).json()
    assert len(listed) == 1


def test_shop_isolation():
    client_a, db = _setup("shop-a")
    client_a.post(
        "/api/cash-book/entries",
        json={"side": "CREDIT", "amount": 10, "description": "A", "date": "2026-10-13", "client_request_id": "a1"},
    )
    # Second app with shop-b
    import cash_book as cash_book_mod
    from fastapi import APIRouter, Depends, HTTPException, FastAPI

    api = APIRouter(prefix="/api")

    async def current_user():
        return {"id": "owner-b", "shop_id": "shop-b", "role": "owner", "username": "b"}

    async def owner_only(user=Depends(current_user)):
        return user

    cash_book_mod.attach_cash_book(api, db=db, current_user=current_user, owner_only=owner_only)
    app = FastAPI()
    app.include_router(api)
    client_b = TestClient(app)
    day_b = client_b.get("/api/cash-book/day", params={"date": "2026-10-13"}).json()
    assert day_b["total_credit"] == 0
    assert day_b["credits"] == []


def test_opening_and_closing_balance_across_days():
    client, _ = _setup()
    client.post(
        "/api/cash-book/entries",
        json={"side": "CREDIT", "amount": 1000, "description": "Day1", "date": "2026-10-12", "client_request_id": "d1c"},
    )
    client.post(
        "/api/cash-book/entries",
        json={"side": "DEBIT", "amount": 300, "description": "Day1 out", "date": "2026-10-12", "client_request_id": "d1d"},
    )
    client.post(
        "/api/cash-book/entries",
        json={"side": "CREDIT", "amount": 50, "description": "Day2", "date": "2026-10-13", "client_request_id": "d2c"},
    )
    d2 = client.get("/api/cash-book/day", params={"date": "2026-10-13"}).json()
    assert d2["opening_balance"] == 700.0
    assert d2["net"] == 50.0
    assert d2["closing_balance"] == 750.0


def test_update_and_delete():
    client, db = _setup()
    created = client.post(
        "/api/cash-book/entries",
        json={"side": "CREDIT", "amount": 100, "description": "Old", "date": "2026-10-13", "client_request_id": "u1"},
    ).json()
    eid = created["id"]
    upd = client.put(f"/api/cash-book/entries/{eid}", json={"amount": 125.25, "description": "New"})
    assert upd.status_code == 200
    assert upd.json()["amount"] == 125.25
    assert upd.json()["description"] == "New"
    # Cannot touch other shop
    assert client.delete(f"/api/cash-book/entries/{eid}").status_code == 204
    assert client.get(f"/api/cash-book/entries/{eid}").status_code == 404


def test_import_local_skips_seeds_and_dedupes():
    client, _ = _setup()
    res = client.post(
        "/api/cash-book/import-local",
        json={
            "entries": [
                {"local_id": "seed-c1", "side": "CREDIT", "amount": 1, "description": "seed", "date": "2026-09-17"},
                {"local_id": "cb-real-1", "side": "CREDIT", "amount": 99, "description": "Migrated", "date": "2026-10-13"},
                {"local_id": "cb-real-1", "side": "CREDIT", "amount": 99, "description": "Migrated", "date": "2026-10-13"},
            ]
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["imported"] == 1
    assert body["skipped"] >= 2
    day = client.get("/api/cash-book/day", params={"date": "2026-10-13"}).json()
    assert day["total_credit"] == 99.0


def test_staff_forbidden():
    import cash_book as cash_book_mod
    from fastapi import APIRouter, Depends, HTTPException, FastAPI

    db = FakeDB()
    api = APIRouter(prefix="/api")

    async def current_user():
        return {"id": "staff-1", "shop_id": "shop-a", "role": "counter", "username": "s"}

    async def owner_only(user=Depends(current_user)):
        if user["role"] != "owner":
            raise HTTPException(403, "Owner role required")
        return user

    cash_book_mod.attach_cash_book(api, db=db, current_user=current_user, owner_only=owner_only)
    app = FastAPI()
    app.include_router(api)
    client = TestClient(app)
    r = client.get("/api/cash-book/day", params={"date": "2026-10-13"})
    assert r.status_code == 403
