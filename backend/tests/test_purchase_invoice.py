"""Purchase invoice: numbering, ownership, GST/HSN config, no bag-balance side effects."""
from __future__ import annotations

import copy
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import billing as billing_mod
from admin_panel.auth import ROLE_PLATFORM_ADMIN, make_admin_token, uid, utc_now
import jwt
from datetime import datetime, timedelta, timezone

JWT_SECRET = "lemon-mandi-dev-secret-change-in-prod-01234567890abcdef"


def make_token(user_id: str, shop_id: str, username: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {
            "sub": user_id,
            "shop_id": shop_id,
            "username": username,
            "role": role,
            "iat": now,
            "exp": now + timedelta(days=30),
        },
        JWT_SECRET,
        algorithm="HS256",
    )


def decode_token(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])


class _Cursor:
    def __init__(self, rows: List[dict]):
        self._rows = rows

    def sort(self, *a, **k):
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
        return row


class _AggCursor:
    def __init__(self, rows):
        self._rows = rows

    async def to_list(self, n: int):
        return self._rows[:n]


class Coll:
    def __init__(self, store: Dict[str, List[dict]], name: str):
        self._store = store
        self._name = name
        self._store.setdefault(name, [])

    def _match(self, d: dict, query: dict) -> bool:
        for k, v in query.items():
            if k == "$or":
                if not any(self._match(d, clause) for clause in v):
                    return False
                continue
            if isinstance(v, dict):
                actual = d.get(k)
                if "$exists" in v:
                    present = k in d
                    want = bool(v["$exists"])
                    if want and not present:
                        return False
                    if (not want) and present:
                        return False
                    continue
                if "$ne" in v and actual == v["$ne"]:
                    return False
                if "$in" in v and actual not in v["$in"]:
                    return False
            else:
                if d.get(k) != v:
                    return False
        return True

    def _project(self, d: dict, projection: Optional[dict]):
        out = copy.deepcopy(d)
        if not projection:
            return out
        if projection.get("_id") == 0:
            out.pop("_id", None)
        if projection.get("password_hash") == 0:
            out.pop("password_hash", None)
        return out

    async def find_one(self, query: dict, projection: Optional[dict] = None):
        for d in self._store[self._name]:
            if self._match(d, query):
                return self._project(d, projection)
        return None

    def find(self, query: dict, projection: Optional[dict] = None):
        rows = [self._project(d, projection) for d in self._store[self._name] if self._match(d, query)]
        return _Cursor(rows)

    async def insert_one(self, doc: dict):
        self._store[self._name].append(copy.deepcopy(doc))

    async def update_one(self, query: dict, update: dict, upsert: bool = False):
        for d in self._store[self._name]:
            if self._match(d, query):
                if "$set" in update:
                    d.update(update["$set"])
                if "$inc" in update:
                    for k, v in update["$inc"].items():
                        d[k] = int(d.get(k) or 0) + int(v)
                return type("R", (), {"modified_count": 1})()
        if upsert:
            doc = {}
            if "$setOnInsert" in update:
                doc.update(update["$setOnInsert"])
            if "$set" in update:
                doc.update(update["$set"])
            # merge equality fields from query (simple keys only)
            for k, v in query.items():
                if not str(k).startswith("$") and not isinstance(v, dict):
                    doc.setdefault(k, v)
            if "$inc" in update:
                for k, v in update["$inc"].items():
                    doc[k] = int(v)
            self._store[self._name].append(doc)
            return type("R", (), {"modified_count": 1})()
        return type("R", (), {"modified_count": 0})()

    async def find_one_and_update(
        self,
        query: dict,
        update: dict,
        upsert: bool = False,
        return_document: bool = True,
        projection: Optional[dict] = None,
    ):
        for d in self._store[self._name]:
            if self._match(d, query):
                if "$set" in update:
                    d.update(update["$set"])
                if "$inc" in update:
                    for k, v in update["$inc"].items():
                        d[k] = int(d.get(k) or 0) + int(v)
                return self._project(d, projection)
        if upsert:
            doc: Dict[str, Any] = {}
            if "$setOnInsert" in update:
                doc.update(update["$setOnInsert"])
            for k, v in query.items():
                if not str(k).startswith("$") and not isinstance(v, dict):
                    doc.setdefault(k, v)
            if "$set" in update:
                doc.update(update["$set"])
            if "$inc" in update:
                for k, v in update["$inc"].items():
                    doc[k] = int(doc.get(k) or 0) + int(v)
            self._store[self._name].append(doc)
            return self._project(doc, projection)
        return None

    async def create_index(self, *a, **k):
        return "ok"

    def aggregate(self, pipeline: List[dict]):
        rows = [copy.deepcopy(d) for d in self._store[self._name]]
        for stage in pipeline:
            if "$match" in stage:
                rows = [d for d in rows if self._match(d, stage["$match"])]
            elif "$group" in stage:
                g = stage["$group"]
                buckets: Dict[Any, dict] = {}
                for d in rows:
                    key = None
                    b = buckets.setdefault(key, {"_id": key})
                    for field, acc in g.items():
                        if field == "_id":
                            continue
                        if "$sum" in acc:
                            val = acc["$sum"]
                            if isinstance(val, str) and val.startswith("$"):
                                b[field] = b.get(field, 0) + float(d.get(val[1:]) or 0)
                rows = list(buckets.values())
        return _AggCursor(rows)


class FakeDB:
    def __init__(self):
        self._store: Dict[str, List[dict]] = {}

    def __getattr__(self, name: str):
        if name.startswith("_"):
            raise AttributeError(name)
        return Coll(self._store, name)


@pytest.fixture()
def client_db():
    db = FakeDB()
    app = FastAPI()
    api = APIRouter(prefix="/api")

    async def current_user(authorization: Optional[str] = Header(default=None)):
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(401, "Not authenticated")
        token = authorization.split(" ", 1)[1]
        try:
            payload = decode_token(token)
        except Exception:
            raise HTTPException(401, "Invalid token")
        if payload.get("role") != "owner":
            raise HTTPException(403, "Owner only")
        shop = await db.shops.find_one({"id": payload["shop_id"], "active": True}, {"_id": 0})
        if not shop:
            raise HTTPException(401, "Shop not found")
        return {
            "id": shop["id"],
            "shop_id": shop["id"],
            "username": shop["username"],
            "role": "owner",
            "display_name": shop.get("shop_name"),
        }

    async def owner_only(user=Depends(current_user)):
        return user

    billing_mod.attach_billing(api, db=db, current_user=current_user, owner_only=owner_only)
    app.include_router(api)
    return TestClient(app), db


def _shop(username="merchant1", shop_name="Test Mandi"):
    return {
        "id": uid(),
        "shop_name": shop_name,
        "username": username,
        "password_hash": "unused-in-jwt-tests",
        "active": True,
        "mobile": "9999999999",
        "address": "Main Road",
        "village": "Village",
        "district": "District",
        "state": "State",
        "gst_number": "29ABCDE1234F1Z5",
        "created_at": utc_now(),
    }


def test_purchase_invoice_flow(client_db):
    client, db = client_db
    shop = _shop()
    other = _shop(username="other", shop_name="Other Shop")
    db._store.setdefault("shops", []).extend([shop, other])

    admin_id = uid()
    admin_doc = {
        "id": admin_id,
        "username": "platadmin",
        "password_hash": "unused",
        "role": ROLE_PLATFORM_ADMIN,
        "active": True,
        "created_at": utc_now(),
    }
    db._store.setdefault("platform_admins", []).append(admin_doc)
    admin_tok = make_admin_token(admin_doc)

    r = client.put(
        "/api/admin/billing/settings",
        headers={"Authorization": f"Bearer {admin_tok}"},
        json={
            "price_per_bag": 1500,
            "new_merchant_free_bags": 0,
            "gst_percent": 18,
            "allow_test_payments": True,
            "billing_active": True,
            "hsn_sac_code": "998599",
            "invoice_prefix": "INV",
            "invoice_item_description": "Prepaid Mandi Bags",
            "seller_name": "Lemon Mandi",
            "seller_address": "Platform HQ",
            "seller_phone": "0800000000",
            "seller_gstin": "29LEMON1234A1Z1",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["gst_percent"] == 18

    owner = make_token(shop["id"], shop["id"], shop["username"], "owner")
    headers = {"Authorization": f"Bearer {owner}"}

    pending = client.post("/api/billing/purchases", headers=headers, json={"bags": 10})
    assert pending.status_code == 201, pending.text
    body = pending.json()
    assert body["base_amount"] == 15000.0
    assert body["gst_percent"] == 18.0
    assert body["gst_amount"] == 2700.0
    assert body["total_amount"] == 17700.0

    paid = client.post(f"/api/billing/purchases/{body['id']}/confirm-test", headers=headers)
    assert paid.status_code == 200, paid.text
    assert paid.json()["status"] == "PAID"
    assert paid.json().get("invoice_no")

    inv1 = client.get(f"/api/billing/purchases/{body['id']}/invoice", headers=headers)
    assert inv1.status_code == 200, inv1.text
    i1 = inv1.json()
    assert i1["invoice_no"].startswith("INV-")
    assert i1["subtotal"] == 15000.0
    assert i1["gst_amount"] == 2700.0
    assert i1["total_amount"] == 17700.0
    assert i1["item"]["hsn_sac_code"] == "998599"
    assert i1["bill_to"]["name"] == "Test Mandi"
    assert i1["seller"]["name"] == "Lemon Mandi"

    inv2 = client.get(f"/api/billing/purchases/{body['id']}/invoice", headers=headers)
    assert inv2.json()["invoice_no"] == i1["invoice_no"]

    p2 = client.post("/api/billing/purchases", headers=headers, json={"bags": 2})
    paid2 = client.post(f"/api/billing/purchases/{p2.json()['id']}/confirm-test", headers=headers)
    inv_b = client.get(f"/api/billing/purchases/{paid2.json()['id']}/invoice", headers=headers)
    assert inv_b.json()["invoice_no"] != i1["invoice_no"]

    other_tok = make_token(other["id"], other["id"], other["username"], "owner")
    denied = client.get(
        f"/api/billing/purchases/{body['id']}/invoice",
        headers={"Authorization": f"Bearer {other_tok}"},
    )
    assert denied.status_code == 404

    admin_inv = client.get(
        f"/api/admin/purchases/{body['id']}/invoice",
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert admin_inv.status_code == 200
    assert admin_inv.json()["invoice_no"] == i1["invoice_no"]

    # Change GST — historical invoice unchanged; new purchase uses new %
    client.put(
        "/api/admin/billing/settings",
        headers={"Authorization": f"Bearer {admin_tok}"},
        json={
            "price_per_bag": 1500,
            "new_merchant_free_bags": 0,
            "gst_percent": 5,
            "allow_test_payments": True,
            "billing_active": True,
            "hsn_sac_code": "998599",
            "invoice_prefix": "INV",
            "invoice_item_description": "Prepaid Mandi Bags",
            "seller_name": "Lemon Mandi",
            "seller_address": "Platform HQ",
            "seller_phone": "0800000000",
            "seller_gstin": "29LEMON1234A1Z1",
        },
    )
    again = client.get(f"/api/billing/purchases/{body['id']}/invoice", headers=headers)
    assert again.json()["gst_percent"] == 18.0
    assert again.json()["gst_amount"] == 2700.0

    p3 = client.post("/api/billing/purchases", headers=headers, json={"bags": 10})
    assert p3.json()["gst_percent"] == 5.0
    assert p3.json()["gst_amount"] == 750.0
    assert p3.json()["total_amount"] == 15750.0
