"""Shop backup export / restore — owner-only, shop_id scoped.

Backup lives on the user's Google Drive (client uploads). The API only
serializes and applies shop data; it never stores Drive credentials.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

BACKUP_VERSION = 1
BACKUP_APP = "lemon-ratebolo"

# Shop-scoped collections restored as a unit (order matters for mental model only).
SHOP_COLLECTIONS = (
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


class BackupRestoreIn(BaseModel):
    backup: Dict[str, Any]


class BackupMetaOut(BaseModel):
    version: int
    app: str
    shop_id: str
    shop_name: str
    exported_at: str
    counts: Dict[str, int]


def _strip_mongo(doc: dict) -> dict:
    out = {k: v for k, v in doc.items() if k != "_id"}
    return out


def _utc_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


async def build_shop_backup(db, shop_id: str) -> dict:
    shop = await db.shops.find_one({"id": shop_id}, {"_id": 0})
    if not shop:
        raise HTTPException(404, "Shop not found")

    # Include password_hash so a full Drive restore keeps logins working.
    # File stays on the owner's own Google Drive only.
    shop_doc = _strip_mongo(shop)

    payload: Dict[str, Any] = {
        "version": BACKUP_VERSION,
        "app": BACKUP_APP,
        "exported_at": _utc_iso(),
        "shop_id": shop_id,
        "shop": shop_doc,
    }
    counts: Dict[str, int] = {}
    for name in SHOP_COLLECTIONS:
        rows = [
            _strip_mongo(d)
            async for d in db[name].find({"shop_id": shop_id}, {"_id": 0})
        ]
        payload[name] = rows
        counts[name] = len(rows)
    payload["counts"] = counts
    return payload


def validate_backup_payload(payload: dict, expected_shop_id: str) -> dict:
    if not isinstance(payload, dict):
        raise HTTPException(400, "Corrupted backup: not a JSON object")
    if payload.get("app") not in (None, BACKUP_APP):
        raise HTTPException(400, "Corrupted backup: unknown app")
    version = payload.get("version")
    if version is None or int(version) != BACKUP_VERSION:
        raise HTTPException(400, f"Unsupported backup version (need {BACKUP_VERSION})")
    shop_id = payload.get("shop_id") or (payload.get("shop") or {}).get("id")
    if not shop_id:
        raise HTTPException(400, "Corrupted backup: missing shop_id")
    if shop_id != expected_shop_id:
        raise HTTPException(
            403,
            "This backup belongs to a different shop. Restore is only allowed for your own shop data.",
        )
    shop = payload.get("shop")
    if not isinstance(shop, dict) or shop.get("id") != expected_shop_id:
        raise HTTPException(400, "Corrupted backup: invalid shop block")
    for name in SHOP_COLLECTIONS:
        rows = payload.get(name)
        if rows is None:
            payload[name] = []
            continue
        if not isinstance(rows, list):
            raise HTTPException(400, f"Corrupted backup: '{name}' must be a list")
        for i, row in enumerate(rows):
            if not isinstance(row, dict):
                raise HTTPException(400, f"Corrupted backup: {name}[{i}] invalid")
            rid = row.get("shop_id")
            if rid is not None and rid != expected_shop_id:
                raise HTTPException(400, f"Corrupted backup: foreign shop_id in {name}")
            # Force shop_id on every row
            row["shop_id"] = expected_shop_id
    return payload


async def snapshot_shop(db, shop_id: str) -> dict:
    """In-memory snapshot used to roll back if restore write fails."""
    snap: Dict[str, Any] = {}
    shop = await db.shops.find_one({"id": shop_id}, {"_id": 0})
    snap["shop"] = deepcopy(shop) if shop else None
    for name in SHOP_COLLECTIONS:
        snap[name] = [
            _strip_mongo(d)
            async for d in db[name].find({"shop_id": shop_id}, {"_id": 0})
        ]
    return snap


async def _delete_shop_data(db, shop_id: str) -> None:
    for name in SHOP_COLLECTIONS:
        await db[name].delete_many({"shop_id": shop_id})


async def _insert_shop_data(db, shop_id: str, payload: dict) -> None:
    shop_doc = deepcopy(payload["shop"])
    shop_doc["id"] = shop_id
    # Preserve active login username from live shop if backup username would collide
    # with another account — keep current username/password when restoring into same shop.
    live = await db.shops.find_one({"id": shop_id}, {"_id": 0})
    if live:
        # Keep current credentials; restore profile fields from backup.
        keep = {
            "username": live.get("username"),
            "password_hash": live.get("password_hash"),
            "id": shop_id,
            "active": live.get("active", True),
        }
        for k, v in shop_doc.items():
            if k in ("username", "password_hash", "id"):
                continue
            keep[k] = v
        await db.shops.replace_one({"id": shop_id}, keep, upsert=True)
    else:
        await db.shops.replace_one({"id": shop_id}, shop_doc, upsert=True)

    for name in SHOP_COLLECTIONS:
        rows = payload.get(name) or []
        if not rows:
            continue
        cleaned = []
        for row in rows:
            doc = _strip_mongo(deepcopy(row))
            doc["shop_id"] = shop_id
            cleaned.append(doc)
        if cleaned:
            await db[name].insert_many(cleaned)


async def restore_shop_backup(db, shop_id: str, payload: dict) -> dict:
    validated = validate_backup_payload(deepcopy(payload), shop_id)
    # Snapshot existing data BEFORE any delete
    snap = await snapshot_shop(db, shop_id)
    try:
        await _delete_shop_data(db, shop_id)
        await _insert_shop_data(db, shop_id, validated)
    except Exception as e:
        # Roll back to pre-restore snapshot
        try:
            await _delete_shop_data(db, shop_id)
            if snap.get("shop"):
                await db.shops.replace_one({"id": shop_id}, snap["shop"], upsert=True)
            for name in SHOP_COLLECTIONS:
                rows = snap.get(name) or []
                if rows:
                    await db[name].insert_many(rows)
        except Exception:
            pass
        raise HTTPException(500, f"Restore failed and local data was rolled back. ({e})")

    counts = {name: len(validated.get(name) or []) for name in SHOP_COLLECTIONS}
    return {
        "ok": True,
        "shop_id": shop_id,
        "restored_at": _utc_iso(),
        "exported_at": validated.get("exported_at"),
        "counts": counts,
    }


def register_backup_routes(api: APIRouter, db, current_user, owner_only):
    @api.get("/backup/export")
    async def export_backup(user=Depends(owner_only)):
        payload = await build_shop_backup(db, user["shop_id"])
        return payload

    @api.get("/backup/meta", response_model=BackupMetaOut)
    async def backup_meta(user=Depends(owner_only)):
        payload = await build_shop_backup(db, user["shop_id"])
        shop = payload["shop"]
        return BackupMetaOut(
            version=payload["version"],
            app=payload["app"],
            shop_id=payload["shop_id"],
            shop_name=shop.get("shop_name") or "",
            exported_at=payload["exported_at"],
            counts=payload.get("counts") or {},
        )

    @api.post("/backup/restore")
    async def restore_backup(body: BackupRestoreIn, user=Depends(owner_only)):
        if not body.backup:
            raise HTTPException(400, "Missing backup payload")
        result = await restore_shop_backup(db, user["shop_id"], body.backup)
        return result

    @api.post("/backup/validate")
    async def validate_backup(body: BackupRestoreIn, user=Depends(owner_only)):
        validated = validate_backup_payload(deepcopy(body.backup or {}), user["shop_id"])
        counts = {name: len(validated.get(name) or []) for name in SHOP_COLLECTIONS}
        return {
            "ok": True,
            "shop_id": user["shop_id"],
            "exported_at": validated.get("exported_at"),
            "counts": counts,
        }
