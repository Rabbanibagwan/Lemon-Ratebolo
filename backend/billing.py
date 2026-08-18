"""Merchant prepaid bag billing — separate from Farmer Patti / Vendor Bill math.

Only Merchant (owner) activity consumes bags. Staff never consumes.
Admin settings live in platform_billing_settings (not hard-coded in the app).
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field


def _uid() -> str:
    return str(uuid.uuid4())


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _round2(n: float) -> float:
    return round(float(n) + 1e-9, 2)


_DEFAULT_PRICE = 0.25
_DEFAULT_FREE = 1000
_DEFAULT_GST = 0.0


class PlatformBillingSettingsIn(BaseModel):
    price_per_bag: float = Field(ge=0, le=1000)
    new_merchant_free_bags: int = Field(ge=0, le=10_000_000)
    gst_percent: float = Field(default=0, ge=0, le=100)
    allow_test_payments: bool = True
    billing_active: bool = True


class PlatformBillingSettingsOut(BaseModel):
    price_per_bag: float
    new_merchant_free_bags: int
    gst_percent: float
    allow_test_payments: bool
    billing_active: bool
    updated_at: Optional[datetime] = None


class WalletOut(BaseModel):
    shop_id: str
    free_allocated: int
    free_used: int
    free_remaining: int
    purchased_bags: int
    purchased_used: int
    purchased_remaining: int
    total_available: int
    price_per_bag: float
    low_balance: bool


class PurchaseCreateIn(BaseModel):
    bags: int = Field(ge=1, le=10_000_000)


class PurchaseOut(BaseModel):
    id: str
    bags: int
    price_per_bag: float
    base_amount: float
    gst_percent: float
    gst_amount: float
    total_amount: float
    status: str
    created_at: datetime
    paid_at: Optional[datetime] = None


def attach_billing(api: APIRouter, *, db, current_user, owner_only) -> None:
    """Register billing routes and bind helpers onto this module for server hooks."""

    async def ensure_indexes() -> None:
        await db.platform_billing_settings.create_index("id", unique=True)
        await db.merchant_bag_wallets.create_index("shop_id", unique=True)
        await db.bag_purchases.create_index([("shop_id", 1), ("created_at", -1)])
        await db.bag_purchases.create_index("id", unique=True)
        await db.bag_usage.create_index([("shop_id", 1), ("at", -1)])
        await db.bag_usage.create_index([("shop_id", 1), ("patti_id", 1), ("status", 1)])
        await db.bag_usage.create_index("id", unique=True)

    def _admin_key() -> str:
        return (os.environ.get("ADMIN_API_KEY") or os.environ.get("BILLING_ADMIN_KEY") or "lemon-admin-dev").strip()

    async def admin_auth(x_admin_key: Optional[str] = Header(default=None, alias="X-Admin-Key")) -> None:
        if not x_admin_key or x_admin_key.strip() != _admin_key():
            raise HTTPException(401, "Invalid admin key")

    async def get_platform_settings() -> dict:
        doc = await db.platform_billing_settings.find_one({"id": "default"}, {"_id": 0})
        if not doc:
            now = _utc_now()
            doc = {
                "id": "default",
                "price_per_bag": _DEFAULT_PRICE,
                "new_merchant_free_bags": _DEFAULT_FREE,
                "gst_percent": _DEFAULT_GST,
                "allow_test_payments": True,
                "billing_active": True,
                "updated_at": now,
            }
            await db.platform_billing_settings.update_one(
                {"id": "default"}, {"$setOnInsert": doc}, upsert=True,
            )
            doc = await db.platform_billing_settings.find_one({"id": "default"}, {"_id": 0}) or doc
        return doc

    def _wallet_view(w: dict, price: float) -> dict:
        free_alloc = int(w.get("free_allocated") or 0)
        free_used = int(w.get("free_used") or 0)
        purchased = int(w.get("purchased_total") or 0)
        purchased_used = int(w.get("purchased_used") or 0)
        free_rem = max(0, free_alloc - free_used)
        purchased_rem = max(0, purchased - purchased_used)
        return {
            "shop_id": w["shop_id"],
            "free_allocated": free_alloc,
            "free_used": free_used,
            "free_remaining": free_rem,
            "purchased_bags": purchased,
            "purchased_used": purchased_used,
            "purchased_remaining": purchased_rem,
            "total_available": free_rem + purchased_rem,
            "price_per_bag": float(price),
            "low_balance": (free_rem + purchased_rem) <= 50,
        }

    async def ensure_wallet(shop_id: str) -> dict:
        existing = await db.merchant_bag_wallets.find_one({"shop_id": shop_id}, {"_id": 0})
        if existing:
            return existing
        settings = await get_platform_settings()
        free = int(settings.get("new_merchant_free_bags") or 0)
        now = _utc_now()
        doc = {
            "id": _uid(),
            "shop_id": shop_id,
            "free_allocated": free,
            "free_used": 0,
            "purchased_total": 0,
            "purchased_used": 0,
            "version": 0,
            "free_granted_at": now,
            "created_at": now,
            "updated_at": now,
        }
        try:
            await db.merchant_bag_wallets.insert_one(doc)
        except Exception:
            existing = await db.merchant_bag_wallets.find_one({"shop_id": shop_id}, {"_id": 0})
            if existing:
                return existing
            raise
        doc.pop("_id", None)
        return doc

    def _insufficient() -> HTTPException:
        return HTTPException(
            status_code=402,
            detail={
                "code": "INSUFFICIENT_BAG_BALANCE",
                "message": "Insufficient bag balance. Please purchase additional bags to continue.",
            },
        )

    async def consume_bags_for_patti(
        *,
        user: dict,
        shop_id: str,
        patti_id: str,
        lot_id: Optional[str],
        bags: int,
    ) -> Optional[dict]:
        if user.get("role") != "owner":
            return None
        bags = int(bags or 0)
        if bags <= 0:
            return None
        prior = await db.bag_usage.find_one(
            {
                "shop_id": shop_id,
                "patti_id": patti_id,
                "status": "ACTIVE",
                "kind": {"$in": ["CONSUME", "ADJUST"]},
            },
            {"_id": 0},
        )
        if prior:
            return None

        settings = await get_platform_settings()
        price = float(settings.get("price_per_bag") or 0)

        for _ in range(8):
            w = await ensure_wallet(shop_id)
            free_rem = max(0, int(w["free_allocated"]) - int(w["free_used"]))
            purchased_rem = max(0, int(w["purchased_total"]) - int(w["purchased_used"]))
            if free_rem + purchased_rem < bags:
                raise _insufficient()
            free_take = min(free_rem, bags)
            paid_take = bags - free_take
            ver = int(w.get("version") or 0)
            res = await db.merchant_bag_wallets.update_one(
                {
                    "shop_id": shop_id,
                    "version": ver,
                    "free_used": int(w["free_used"]),
                    "purchased_used": int(w["purchased_used"]),
                },
                {
                    "$inc": {"free_used": free_take, "purchased_used": paid_take, "version": 1},
                    "$set": {"updated_at": _utc_now()},
                },
            )
            if res.modified_count != 1:
                continue
            usage = {
                "id": _uid(),
                "shop_id": shop_id,
                "patti_id": patti_id,
                "lot_id": lot_id,
                "bags": bags,
                "free_bags": free_take,
                "purchased_bags": paid_take,
                "price_applied": price,
                "kind": "CONSUME",
                "status": "ACTIVE",
                "at": _utc_now(),
                "by_user_id": user.get("id"),
                "by_role": user.get("role"),
            }
            await db.bag_usage.insert_one(usage)
            usage.pop("_id", None)
            return usage
        raise HTTPException(409, "Bag balance busy — retry")

    async def adjust_bags_for_patti_edit(
        *,
        user: dict,
        shop_id: str,
        patti_id: str,
        lot_id: Optional[str],
        old_bags: int,
        new_bags: int,
    ) -> None:
        if user.get("role") != "owner":
            return
        old_bags = int(old_bags or 0)
        new_bags = int(new_bags or 0)
        delta = new_bags - old_bags
        if delta == 0:
            return
        if delta > 0:
            settings = await get_platform_settings()
            price = float(settings.get("price_per_bag") or 0)
            for _ in range(8):
                w = await ensure_wallet(shop_id)
                free_rem = max(0, int(w["free_allocated"]) - int(w["free_used"]))
                purchased_rem = max(0, int(w["purchased_total"]) - int(w["purchased_used"]))
                if free_rem + purchased_rem < delta:
                    raise _insufficient()
                free_take = min(free_rem, delta)
                paid_take = delta - free_take
                ver = int(w.get("version") or 0)
                res = await db.merchant_bag_wallets.update_one(
                    {
                        "shop_id": shop_id,
                        "version": ver,
                        "free_used": int(w["free_used"]),
                        "purchased_used": int(w["purchased_used"]),
                    },
                    {
                        "$inc": {"free_used": free_take, "purchased_used": paid_take, "version": 1},
                        "$set": {"updated_at": _utc_now()},
                    },
                )
                if res.modified_count != 1:
                    continue
                await db.bag_usage.insert_one({
                    "id": _uid(),
                    "shop_id": shop_id,
                    "patti_id": patti_id,
                    "lot_id": lot_id,
                    "bags": delta,
                    "free_bags": free_take,
                    "purchased_bags": paid_take,
                    "price_applied": price,
                    "kind": "ADJUST",
                    "status": "ACTIVE",
                    "at": _utc_now(),
                    "by_user_id": user.get("id"),
                    "by_role": user.get("role"),
                    "note": f"edit {old_bags}->{new_bags}",
                })
                return
            raise HTTPException(409, "Bag balance busy — retry")
        await _restore_bags(
            shop_id=shop_id, patti_id=patti_id, lot_id=lot_id,
            bags=-delta, user=user, kind="ADJUST_RETURN",
        )

    async def reverse_bags_for_patti(
        *,
        user: dict,
        shop_id: str,
        patti_id: str,
        lot_id: Optional[str] = None,
    ) -> None:
        await _restore_all_active_for_patti(shop_id=shop_id, patti_id=patti_id, lot_id=lot_id, user=user)

    async def _restore_all_active_for_patti(
        *, shop_id: str, patti_id: str, lot_id: Optional[str], user: dict,
    ) -> None:
        rows = [
            r async for r in db.bag_usage.find(
                {"shop_id": shop_id, "patti_id": patti_id, "status": "ACTIVE", "kind": {"$ne": "REVERSAL"}},
                {"_id": 0},
            )
        ]
        if not rows:
            return
        # Net usage: CONSUME/ADJUST increase; ADJUST_RETURN decreases (edit bag reduction).
        free_back = 0
        paid_back = 0
        bags_back = 0
        for r in rows:
            kind = r.get("kind") or ""
            fb = int(r.get("free_bags") or 0)
            pb = int(r.get("purchased_bags") or 0)
            bb = int(r.get("bags") or 0)
            if kind in ("CONSUME", "ADJUST"):
                free_back += fb
                paid_back += pb
                bags_back += bb
            elif kind in ("ADJUST_RETURN",):
                free_back -= fb
                paid_back -= pb
                bags_back -= bb
        free_back = max(0, free_back)
        paid_back = max(0, paid_back)
        bags_back = max(0, bags_back)
        if bags_back <= 0 and free_back <= 0 and paid_back <= 0:
            await db.bag_usage.update_many(
                {"id": {"$in": [r["id"] for r in rows]}, "shop_id": shop_id},
                {"$set": {"status": "REVERSED", "reversed_at": _utc_now()}},
            )
            return
        for _ in range(8):
            w = await ensure_wallet(shop_id)
            ver = int(w.get("version") or 0)
            free_dec = min(free_back, int(w["free_used"]))
            paid_dec = min(paid_back, int(w["purchased_used"]))
            res = await db.merchant_bag_wallets.update_one(
                {"shop_id": shop_id, "version": ver},
                {
                    "$inc": {"free_used": -free_dec, "purchased_used": -paid_dec, "version": 1},
                    "$set": {"updated_at": _utc_now()},
                },
            )
            if res.modified_count != 1:
                continue
            ids = [r["id"] for r in rows]
            await db.bag_usage.update_many(
                {"id": {"$in": ids}, "shop_id": shop_id},
                {"$set": {"status": "REVERSED", "reversed_at": _utc_now()}},
            )
            await db.bag_usage.insert_one({
                "id": _uid(),
                "shop_id": shop_id,
                "patti_id": patti_id,
                "lot_id": lot_id,
                "bags": bags_back,
                "free_bags": free_dec,
                "purchased_bags": paid_dec,
                "price_applied": 0,
                "kind": "REVERSAL",
                "status": "ACTIVE",
                "at": _utc_now(),
                "by_user_id": user.get("id"),
                "by_role": user.get("role"),
                "reverses": ids,
            })
            return
        raise HTTPException(409, "Bag balance busy — retry")

    async def _restore_bags(
        *, shop_id: str, patti_id: str, lot_id: Optional[str], bags: int, user: dict, kind: str,
    ) -> None:
        bags = int(bags or 0)
        if bags <= 0:
            return
        for _ in range(8):
            w = await ensure_wallet(shop_id)
            paid_dec = min(bags, int(w["purchased_used"]))
            free_dec = min(bags - paid_dec, int(w["free_used"]))
            ver = int(w.get("version") or 0)
            res = await db.merchant_bag_wallets.update_one(
                {"shop_id": shop_id, "version": ver},
                {
                    "$inc": {"free_used": -free_dec, "purchased_used": -paid_dec, "version": 1},
                    "$set": {"updated_at": _utc_now()},
                },
            )
            if res.modified_count != 1:
                continue
            await db.bag_usage.insert_one({
                "id": _uid(),
                "shop_id": shop_id,
                "patti_id": patti_id,
                "lot_id": lot_id,
                "bags": bags,
                "free_bags": free_dec,
                "purchased_bags": paid_dec,
                "price_applied": 0,
                "kind": kind,
                "status": "ACTIVE",
                "at": _utc_now(),
                "by_user_id": user.get("id"),
                "by_role": user.get("role"),
            })
            return
        raise HTTPException(409, "Bag balance busy — retry")

    async def assert_can_consume(user: dict, shop_id: str, bags: int) -> None:
        if user.get("role") != "owner":
            return
        bags = int(bags or 0)
        if bags <= 0:
            return
        w = await ensure_wallet(shop_id)
        free_rem = max(0, int(w["free_allocated"]) - int(w["free_used"]))
        purchased_rem = max(0, int(w["purchased_total"]) - int(w["purchased_used"]))
        if free_rem + purchased_rem < bags:
            raise _insufficient()

    # Bind for server.py imports after attach
    globals()["ensure_indexes"] = ensure_indexes
    globals()["ensure_wallet"] = ensure_wallet
    globals()["consume_bags_for_patti"] = consume_bags_for_patti
    globals()["adjust_bags_for_patti_edit"] = adjust_bags_for_patti_edit
    globals()["reverse_bags_for_patti"] = reverse_bags_for_patti
    globals()["assert_can_consume"] = assert_can_consume
    globals()["get_platform_settings"] = get_platform_settings

    @api.get("/admin/billing/settings", response_model=PlatformBillingSettingsOut)
    async def admin_get_billing_settings(_: None = Depends(admin_auth)):
        s = await get_platform_settings()
        return PlatformBillingSettingsOut(
            price_per_bag=float(s.get("price_per_bag") or 0),
            new_merchant_free_bags=int(s.get("new_merchant_free_bags") or 0),
            gst_percent=float(s.get("gst_percent") or 0),
            allow_test_payments=bool(s.get("allow_test_payments", True)),
            billing_active=bool(s.get("billing_active", True)),
            updated_at=s.get("updated_at"),
        )

    @api.put("/admin/billing/settings", response_model=PlatformBillingSettingsOut)
    async def admin_put_billing_settings(payload: PlatformBillingSettingsIn, _: None = Depends(admin_auth)):
        now = _utc_now()
        await db.platform_billing_settings.update_one(
            {"id": "default"},
            {"$set": {
                "price_per_bag": float(payload.price_per_bag),
                "new_merchant_free_bags": int(payload.new_merchant_free_bags),
                "gst_percent": float(payload.gst_percent),
                "allow_test_payments": bool(payload.allow_test_payments),
                "billing_active": bool(payload.billing_active),
                "updated_at": now,
            }},
            upsert=True,
        )
        return await admin_get_billing_settings()

    @api.get("/admin/billing/merchants")
    async def admin_list_merchants(_: None = Depends(admin_auth), limit: int = Query(200, ge=1, le=2000)):
        settings = await get_platform_settings()
        price = float(settings.get("price_per_bag") or 0)
        out = []
        async for shop in db.shops.find({}, {"_id": 0, "password_hash": 0}).limit(limit):
            w = await ensure_wallet(shop["id"])
            view = _wallet_view(w, price)
            purchases = await db.bag_purchases.aggregate([
                {"$match": {"shop_id": shop["id"], "status": "PAID"}},
                {"$group": {"_id": None, "total": {"$sum": "$total_amount"}, "bags": {"$sum": "$bags"}}},
            ]).to_list(1)
            out.append({
                "shop_id": shop["id"],
                "shop_name": shop.get("shop_name"),
                "username": shop.get("username"),
                **view,
                "total_amount_purchased": _round2((purchases[0]["total"] if purchases else 0) or 0),
                "total_bags_purchased": int((purchases[0]["bags"] if purchases else 0) or 0),
            })
        return out

    @api.get("/billing/wallet", response_model=WalletOut)
    async def get_wallet(user=Depends(owner_only)):
        settings = await get_platform_settings()
        w = await ensure_wallet(user["shop_id"])
        return WalletOut(**_wallet_view(w, float(settings.get("price_per_bag") or 0)))

    @api.get("/billing/price")
    async def get_current_price(user=Depends(current_user)):
        s = await get_platform_settings()
        return {
            "price_per_bag": float(s.get("price_per_bag") or 0),
            "gst_percent": float(s.get("gst_percent") or 0),
            "new_merchant_free_bags": int(s.get("new_merchant_free_bags") or 0),
        }

    @api.post("/billing/purchases", response_model=PurchaseOut, status_code=201)
    async def create_purchase(payload: PurchaseCreateIn, user=Depends(owner_only)):
        settings = await get_platform_settings()
        price = float(settings.get("price_per_bag") or 0)
        gst_pct = float(settings.get("gst_percent") or 0)
        bags = int(payload.bags)
        base = _round2(bags * price)
        gst = _round2(base * gst_pct / 100.0)
        total = _round2(base + gst)
        now = _utc_now()
        doc = {
            "id": _uid(),
            "shop_id": user["shop_id"],
            "bags": bags,
            "price_per_bag": price,
            "base_amount": base,
            "gst_percent": gst_pct,
            "gst_amount": gst,
            "total_amount": total,
            "status": "PENDING",
            "created_at": now,
            "paid_at": None,
            "payment_ref": None,
        }
        await db.bag_purchases.insert_one(doc)
        doc.pop("_id", None)
        return PurchaseOut(**doc)

    @api.post("/billing/purchases/{purchase_id}/confirm-test", response_model=PurchaseOut)
    async def confirm_test_purchase(purchase_id: str, user=Depends(owner_only)):
        settings = await get_platform_settings()
        if not settings.get("allow_test_payments", True):
            raise HTTPException(403, "Test payments disabled — use live payment gateway")
        purchase = await db.bag_purchases.find_one(
            {"id": purchase_id, "shop_id": user["shop_id"]}, {"_id": 0},
        )
        if not purchase:
            raise HTTPException(404, "Purchase not found")
        if purchase.get("status") == "PAID":
            return PurchaseOut(**purchase)
        if purchase.get("status") != "PENDING":
            raise HTTPException(400, f"Cannot confirm purchase in status {purchase.get('status')}")

        now = _utc_now()
        for _ in range(8):
            w = await ensure_wallet(user["shop_id"])
            ver = int(w.get("version") or 0)
            res = await db.merchant_bag_wallets.update_one(
                {"shop_id": user["shop_id"], "version": ver},
                {
                    "$inc": {"purchased_total": int(purchase["bags"]), "version": 1},
                    "$set": {"updated_at": now},
                },
            )
            if res.modified_count != 1:
                continue
            d = await db.bag_purchases.find_one_and_update(
                {"id": purchase_id, "shop_id": user["shop_id"], "status": "PENDING"},
                {"$set": {
                    "status": "PAID",
                    "paid_at": now,
                    "payment_ref": f"TEST-{purchase_id[:8]}",
                    "payment_provider": "TEST",
                }},
                return_document=True,
                projection={"_id": 0},
            )
            if not d:
                await db.merchant_bag_wallets.update_one(
                    {"shop_id": user["shop_id"]},
                    {"$inc": {"purchased_total": -int(purchase["bags"]), "version": 1}},
                )
                paid = await db.bag_purchases.find_one({"id": purchase_id}, {"_id": 0})
                return PurchaseOut(**paid)
            return PurchaseOut(**d)
        raise HTTPException(409, "Could not confirm purchase — retry")

    @api.get("/billing/purchases", response_model=List[PurchaseOut])
    async def list_purchases(user=Depends(owner_only), limit: int = Query(100, ge=1, le=500)):
        cur = db.bag_purchases.find(
            {"shop_id": user["shop_id"]}, {"_id": 0},
        ).sort("created_at", -1).limit(limit)
        return [PurchaseOut(**d) async for d in cur]

    @api.get("/billing/usage")
    async def list_usage(user=Depends(owner_only), limit: int = Query(200, ge=1, le=1000)):
        cur = db.bag_usage.find(
            {"shop_id": user["shop_id"]}, {"_id": 0},
        ).sort("at", -1).limit(limit)
        return [d async for d in cur]
