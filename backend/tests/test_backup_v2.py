"""Stage 1 backup foundation: v2 schema, expanded collections, rollback reporting.

Unit tests use an in-memory FakeDB (no live Mongo / pytest-asyncio required).
Optional API smoke runs when the local backend answers on BASE_URL.
"""
from __future__ import annotations

import asyncio
import copy
import uuid
from typing import Any, Dict, List, Optional

import pytest
from fastapi import HTTPException

from backup import (
    BACKUP_APP,
    BACKUP_VERSION,
    SHOP_COLLECTIONS,
    V2_COLLECTIONS,
    build_shop_backup,
    restore_shop_backup,
    validate_backup_payload,
)
import backup as backup_mod


# ---------------------------------------------------------------------------
# Minimal async Mongo stand-in
# ---------------------------------------------------------------------------


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
            d
            for d in self._store[self._name]
            if not all(d.get(k) == v for k, v in query.items())
        ]

        class R:
            deleted_count = before - len(self._store[self._name])

        return R()

    async def insert_one(self, doc: dict):
        self._store[self._name].append(copy.deepcopy(doc))

    async def insert_many(self, docs: List[dict]):
        for d in docs:
            self._store[self._name].append(copy.deepcopy(d))

    async def replace_one(self, query: dict, doc: dict, upsert: bool = False):
        for i, d in enumerate(self._store[self._name]):
            if all(d.get(k) == v for k, v in query.items()):
                self._store[self._name][i] = copy.deepcopy(doc)

                class R:
                    matched_count = 1
                    modified_count = 1
                    upserted_id = None

                return R()
        if upsert:
            self._store[self._name].append(copy.deepcopy(doc))

            class R:
                matched_count = 0
                modified_count = 0
                upserted_id = "x"

            return R()

        class R:
            matched_count = 0
            modified_count = 0
            upserted_id = None

        return R()


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


def _empty_v2_payload(shop_id: str, **extra) -> dict:
    shop = {
        "id": shop_id,
        "shop_name": "Backup Shop",
        "username": "backup_user",
        "password_hash": "hash_from_backup",
        "active": False,
    }
    payload: Dict[str, Any] = {
        "version": BACKUP_VERSION,
        "app": BACKUP_APP,
        "kind": "drive_backup",
        "label": "",
        "exported_at": "2026-08-25T00:00:00Z",
        "created_by": {
            "user_id": shop_id,
            "username": "owner",
            "display_name": "Owner",
            "role": "owner",
        },
        "shop_id": shop_id,
        "shop": shop,
        "counts": {},
    }
    for name in SHOP_COLLECTIONS:
        payload[name] = []
        payload["counts"][name] = 0
    payload.update(extra)
    return payload


def _legacy_v1_payload(shop_id: str) -> dict:
    core = (
        "settings",
        "staff",
        "farmers",
        "vendors",
        "auction_days",
        "lots",
        "pattis",
        "vendor_bills",
        "vendor_payments",
        "account_ledger",
        "counters",
    )
    payload: Dict[str, Any] = {
        "version": 1,
        "app": BACKUP_APP,
        "exported_at": "2026-01-01T00:00:00Z",
        "shop_id": shop_id,
        "shop": {
            "id": shop_id,
            "shop_name": "Legacy",
            "username": "legacy",
            "password_hash": "legacy_hash",
            "active": True,
        },
        "counts": {},
    }
    for name in core:
        payload[name] = []
        payload["counts"][name] = 0
    return payload


class TestValidateBackup:
    def test_v2_payload_ok(self):
        sid = "shop-v2"
        out = validate_backup_payload(copy.deepcopy(_empty_v2_payload(sid)), sid)
        assert out["version"] == 2
        for name in V2_COLLECTIONS:
            assert isinstance(out[name], list)

    def test_v1_still_validates(self):
        sid = "shop-v1"
        out = validate_backup_payload(copy.deepcopy(_legacy_v1_payload(sid)), sid)
        assert out["version"] == 1
        for name in V2_COLLECTIONS:
            assert out[name] == []

    def test_v1_missing_new_collections_become_empty(self):
        sid = "shop-v1b"
        p = _legacy_v1_payload(sid)
        for name in V2_COLLECTIONS:
            assert name not in p
        out = validate_backup_payload(copy.deepcopy(p), sid)
        for name in V2_COLLECTIONS:
            assert out[name] == []

    def test_wrong_shop_id_rejected(self):
        p = _empty_v2_payload("shop-a")
        with pytest.raises(HTTPException) as ei:
            validate_backup_payload(copy.deepcopy(p), "shop-b")
        assert ei.value.status_code == 403

    def test_cross_shop_row_rejected(self):
        sid = "shop-a"
        p = _empty_v2_payload(sid)
        p["farmers"] = [{"id": "f1", "shop_id": "other-shop", "name": "X"}]
        with pytest.raises(HTTPException) as ei:
            validate_backup_payload(copy.deepcopy(p), sid)
        assert ei.value.status_code == 400
        assert "foreign shop_id" in str(ei.value.detail)

    def test_unsupported_version_rejected(self):
        sid = "shop-x"
        p = _empty_v2_payload(sid)
        p["version"] = 99
        with pytest.raises(HTTPException) as ei:
            validate_backup_payload(copy.deepcopy(p), sid)
        assert ei.value.status_code == 400

    def test_v2_non_list_collection_rejected(self):
        sid = "shop-x"
        p = _empty_v2_payload(sid)
        p["bag_usage"] = {"bad": True}
        with pytest.raises(HTTPException) as ei:
            validate_backup_payload(copy.deepcopy(p), sid)
        assert ei.value.status_code == 400


def test_v2_export_contains_all_collections_and_excludes_platform():
    async def _inner():
        db = FakeDB()
        sid = "export-shop"
        await db.shops.insert_one(
            {
                "id": sid,
                "shop_name": "E",
                "username": "u",
                "password_hash": "h",
                "active": True,
            }
        )
        await db.platform_billing_settings.insert_one({"id": "default", "price_per_bag": 1})
        await db.patti_audit_log.insert_one({"id": "a1", "shop_id": sid, "action": "EDIT"})
        await db.merchant_bag_wallets.insert_one(
            {"id": "w1", "shop_id": sid, "free_allocated": 10}
        )
        await db.bag_purchases.insert_one(
            {"id": "p1", "shop_id": sid, "bags": 5, "status": "PAID"}
        )
        await db.bag_usage.insert_one(
            {"id": "u1", "shop_id": sid, "bags": 2, "status": "ACTIVE"}
        )

        payload = await build_shop_backup(
            db, sid, kind="drive_backup", label="t", created_by={"username": "u"}
        )
        assert payload["version"] == 2
        assert payload["app"] == BACKUP_APP
        assert payload["kind"] == "drive_backup"
        assert "label" in payload
        assert "exported_at" in payload
        assert "created_by" in payload
        assert payload["shop_id"] == sid
        assert "counts" in payload
        for name in SHOP_COLLECTIONS:
            assert name in payload
            assert isinstance(payload[name], list)
            assert payload["counts"][name] == len(payload[name])
        assert "platform_billing_settings" not in payload
        assert len(payload["patti_audit_log"]) == 1
        assert len(payload["merchant_bag_wallets"]) == 1
        assert len(payload["bag_purchases"]) == 1
        assert len(payload["bag_usage"]) == 1

    _run(_inner())


def test_bag_and_audit_round_trip_and_credentials_preserved():
    async def _inner():
        db = FakeDB()
        sid = "rt-shop"
        await db.shops.insert_one(
            {
                "id": sid,
                "shop_name": "Live",
                "username": "live_u",
                "password_hash": "live_h",
                "active": True,
            }
        )
        await db.farmers.insert_one({"id": "old", "shop_id": sid, "name": "OLD"})

        payload = _empty_v2_payload(sid)
        payload["shop"]["shop_name"] = "FromBackup"
        payload["shop"]["username"] = "backup_u"
        payload["shop"]["password_hash"] = "backup_h"
        payload["shop"]["active"] = False
        payload["patti_audit_log"] = [
            {"id": "aud1", "shop_id": sid, "action": "SOFT_DELETE"}
        ]
        payload["merchant_bag_wallets"] = [
            {
                "id": "w1",
                "shop_id": sid,
                "free_allocated": 100,
                "free_used": 3,
                "purchased_total": 50,
                "purchased_used": 1,
            }
        ]
        payload["bag_purchases"] = [
            {"id": "bp1", "shop_id": sid, "bags": 50, "status": "PAID"}
        ]
        payload["bag_usage"] = [
            {"id": "bu1", "shop_id": sid, "bags": 3, "kind": "CONSUME", "status": "ACTIVE"}
        ]
        for name in V2_COLLECTIONS:
            payload["counts"][name] = len(payload[name])

        result = await restore_shop_backup(db, sid, payload)
        assert result["ok"] is True

        farmers = [d async for d in db.farmers.find({"shop_id": sid})]
        assert farmers == []

        audit = [d async for d in db.patti_audit_log.find({"shop_id": sid})]
        assert len(audit) == 1 and audit[0]["id"] == "aud1"

        wallets = [d async for d in db.merchant_bag_wallets.find({"shop_id": sid})]
        assert len(wallets) == 1 and wallets[0]["free_allocated"] == 100

        purchases = [d async for d in db.bag_purchases.find({"shop_id": sid})]
        assert len(purchases) == 1 and purchases[0]["bags"] == 50

        usage = [d async for d in db.bag_usage.find({"shop_id": sid})]
        assert len(usage) == 1 and usage[0]["kind"] == "CONSUME"

        live = await db.shops.find_one({"id": sid})
        assert live["username"] == "live_u"
        assert live["password_hash"] == "live_h"
        assert live["active"] is True
        assert live["shop_name"] == "FromBackup"

    _run(_inner())


def test_v1_restore_empty_new_collections():
    async def _inner():
        db = FakeDB()
        sid = "v1-shop"
        await db.shops.insert_one(
            {
                "id": sid,
                "shop_name": "Live",
                "username": "u",
                "password_hash": "h",
                "active": True,
            }
        )
        await db.patti_audit_log.insert_one({"id": "x", "shop_id": sid})
        await db.merchant_bag_wallets.insert_one({"id": "w", "shop_id": sid})

        await restore_shop_backup(db, sid, _legacy_v1_payload(sid))

        assert [d async for d in db.patti_audit_log.find({"shop_id": sid})] == []
        assert [d async for d in db.merchant_bag_wallets.find({"shop_id": sid})] == []
        assert [d async for d in db.bag_purchases.find({"shop_id": sid})] == []
        assert [d async for d in db.bag_usage.find({"shop_id": sid})] == []

    _run(_inner())


def test_restore_failure_triggers_rollback():
    async def _inner():
        db = FakeDB()
        sid = "rb-shop"
        await db.shops.insert_one(
            {
                "id": sid,
                "shop_name": "Live",
                "username": "u",
                "password_hash": "h",
                "active": True,
            }
        )
        await db.farmers.insert_one({"id": "keep-me", "shop_id": sid, "name": "Keep"})

        payload = _empty_v2_payload(sid)
        payload["farmers"] = [{"id": "new", "shop_id": sid, "name": "New"}]

        calls = {"n": 0}
        real_insert = db.farmers.insert_many

        async def boom_once(docs):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("simulated insert failure")
            return await real_insert(docs)

        db.farmers.insert_many = boom_once  # type: ignore
        with pytest.raises(HTTPException) as ei:
            await restore_shop_backup(db, sid, payload)
        assert ei.value.status_code == 500
        assert "rolled back" in str(ei.value.detail).lower()
        assert "CRITICAL" not in str(ei.value.detail)

        farmers = [d async for d in db.farmers.find({"shop_id": sid})]
        assert len(farmers) == 1
        assert farmers[0]["id"] == "keep-me"

    _run(_inner())


def test_rollback_failure_reported_clearly():
    async def _inner():
        db = FakeDB()
        sid = "crit-shop"
        await db.shops.insert_one(
            {
                "id": sid,
                "shop_name": "Live",
                "username": "u",
                "password_hash": "h",
                "active": True,
            }
        )

        payload = _empty_v2_payload(sid)
        deletes = {"n": 0}
        orig_delete = backup_mod._delete_shop_data
        orig_insert = backup_mod._insert_shop_data

        async def counted_delete(db_, shop_id):
            deletes["n"] += 1
            if deletes["n"] == 1:
                return await orig_delete(db_, shop_id)
            raise RuntimeError("rollback delete failed")

        async def fail_insert(db_, shop_id, payload_):
            raise RuntimeError("insert failed")

        backup_mod._delete_shop_data = counted_delete
        backup_mod._insert_shop_data = fail_insert
        try:
            with pytest.raises(HTTPException) as ei:
                await restore_shop_backup(db, sid, payload)
            assert ei.value.status_code == 500
            detail = str(ei.value.detail)
            assert "CRITICAL" in detail
            assert "rollback" in detail.lower()
        finally:
            backup_mod._delete_shop_data = orig_delete
            backup_mod._insert_shop_data = orig_insert

    _run(_inner())


def test_api_export_v2_and_cross_shop_if_server():
    import os
    from pathlib import Path

    import requests

    url = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL") or ""
    if not url:
        env = Path(__file__).resolve().parents[2] / "frontend" / ".env"
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    url = line.split("=", 1)[1].strip().strip('"')
                    break
    url = (url or "http://127.0.0.1:8001").rstrip("/")

    try:
        r = requests.get(f"{url}/api/", timeout=3)
        if r.status_code != 200:
            pytest.skip("backend not available")
    except Exception:
        pytest.skip("backend not available")

    u = f"bk_{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{url}/api/auth/signup",
        json={"shop_name": "Backup Test", "username": u, "password": "passBackup1"},
        timeout=30,
    )
    assert r.status_code == 201, r.text
    token = r.json()["access_token"]
    H = {"Authorization": f"Bearer {token}"}

    r = requests.get(f"{url}/api/backup/export", headers=H, timeout=60)
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["version"] == 2
    assert p["app"] == BACKUP_APP
    assert "kind" in p and "created_by" in p and "counts" in p
    for name in SHOP_COLLECTIONS:
        assert name in p
    assert "platform_billing_settings" not in p

    other = copy.deepcopy(p)
    other["shop_id"] = "not-my-shop"
    other["shop"] = {**other["shop"], "id": "not-my-shop"}
    r = requests.post(
        f"{url}/api/backup/validate", headers=H, json={"backup": other}, timeout=30
    )
    assert r.status_code == 403, r.text
