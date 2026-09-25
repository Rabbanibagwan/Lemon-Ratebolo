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
# Default GST % for NEW platform billing settings only (configurable in Admin → Settings).
_DEFAULT_GST = 18.0
_DEFAULT_HSN_SAC = "998599"
_DEFAULT_INVOICE_PREFIX = "INV"
_DEFAULT_INVOICE_ITEM = "Prepaid Mandi Bags"
_DEFAULT_SELLER_NAME = "Lemon Mandi"


class PlatformBillingSettingsIn(BaseModel):
    price_per_bag: float = Field(ge=0, le=100_000)
    new_merchant_free_bags: int = Field(ge=0, le=10_000_000)
    gst_percent: float = Field(default=_DEFAULT_GST, ge=0, le=100)
    allow_test_payments: bool = True
    billing_active: bool = True
    # Purchase invoice configuration (platform → merchant bag sales). Not hard-coded in app UI.
    hsn_sac_code: str = Field(default=_DEFAULT_HSN_SAC, max_length=32)
    invoice_prefix: str = Field(default=_DEFAULT_INVOICE_PREFIX, max_length=24)
    invoice_item_description: str = Field(default=_DEFAULT_INVOICE_ITEM, max_length=200)
    seller_name: str = Field(default=_DEFAULT_SELLER_NAME, max_length=200)
    seller_address: str = Field(default="", max_length=500)
    seller_phone: str = Field(default="", max_length=40)
    seller_gstin: str = Field(default="", max_length=32)


class PlatformBillingSettingsOut(BaseModel):
    price_per_bag: float
    new_merchant_free_bags: int
    gst_percent: float
    allow_test_payments: bool
    billing_active: bool
    hsn_sac_code: str = _DEFAULT_HSN_SAC
    invoice_prefix: str = _DEFAULT_INVOICE_PREFIX
    invoice_item_description: str = _DEFAULT_INVOICE_ITEM
    seller_name: str = _DEFAULT_SELLER_NAME
    seller_address: str = ""
    seller_phone: str = ""
    seller_gstin: str = ""
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
    invoice_no: Optional[str] = None


class InvoicePartyOut(BaseModel):
    name: str
    address: str = ""
    phone: str = ""
    gstin: str = ""


class PurchaseInvoiceItemOut(BaseModel):
    description: str
    hsn_sac_code: str
    bags: int
    price_per_bag: float
    amount: float


class PurchaseInvoiceOut(BaseModel):
    """Purchase invoice linked 1:1 to a bag_purchases row (no duplicate purchase)."""
    purchase_id: str
    shop_id: str
    invoice_no: str
    invoice_date: datetime
    status: str
    seller: InvoicePartyOut
    bill_to: InvoicePartyOut
    item: PurchaseInvoiceItemOut
    subtotal: float
    gst_percent: float
    gst_amount: float
    total_amount: float
    bags: int
    price_per_bag: float
    paid_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


def attach_billing(api: APIRouter, *, db, current_user, owner_only) -> None:
    """Register billing routes and bind helpers onto this module for server hooks."""

    async def ensure_indexes() -> None:
        await db.platform_billing_settings.create_index("id", unique=True)
        await db.merchant_bag_wallets.create_index("shop_id", unique=True)
        await db.bag_purchases.create_index([("shop_id", 1), ("created_at", -1)])
        await db.bag_purchases.create_index("id", unique=True)
        # Sparse unique: only PAID invoices that have been numbered.
        await db.bag_purchases.create_index(
            "invoice_no", unique=True, sparse=True, name="bag_purchases_invoice_no_unique",
        )
        await db.bag_usage.create_index([("shop_id", 1), ("at", -1)])
        await db.bag_usage.create_index([("shop_id", 1), ("patti_id", 1), ("status", 1)])
        await db.bag_usage.create_index("id", unique=True)

    def _admin_key() -> str:
        return (os.environ.get("ADMIN_API_KEY") or os.environ.get("BILLING_ADMIN_KEY") or "lemon-admin-dev").strip()

    async def admin_auth(
        authorization: Optional[str] = Header(default=None),
        x_admin_key: Optional[str] = Header(default=None, alias="X-Admin-Key"),
    ) -> dict:
        """Dual auth during migration: Admin JWT Bearer OR legacy X-Admin-Key."""
        from admin_panel.auth import require_platform_admin

        token = None
        if authorization and authorization.lower().startswith("bearer "):
            token = authorization.split(" ", 1)[1].strip()
        return await require_platform_admin(db, token=token, x_admin_key=x_admin_key)

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
                "hsn_sac_code": _DEFAULT_HSN_SAC,
                "invoice_prefix": _DEFAULT_INVOICE_PREFIX,
                "invoice_item_description": _DEFAULT_INVOICE_ITEM,
                "seller_name": _DEFAULT_SELLER_NAME,
                "seller_address": "",
                "seller_phone": "",
                "seller_gstin": "",
                "updated_at": now,
            }
            await db.platform_billing_settings.update_one(
                {"id": "default"}, {"$setOnInsert": doc}, upsert=True,
            )
            doc = await db.platform_billing_settings.find_one({"id": "default"}, {"_id": 0}) or doc
        # Fill missing invoice config keys without overwriting an existing gst_percent.
        patch = {}
        if "hsn_sac_code" not in doc:
            patch["hsn_sac_code"] = _DEFAULT_HSN_SAC
        if "invoice_prefix" not in doc:
            patch["invoice_prefix"] = _DEFAULT_INVOICE_PREFIX
        if "invoice_item_description" not in doc:
            patch["invoice_item_description"] = _DEFAULT_INVOICE_ITEM
        if "seller_name" not in doc:
            patch["seller_name"] = _DEFAULT_SELLER_NAME
        for k in ("seller_address", "seller_phone", "seller_gstin"):
            if k not in doc:
                patch[k] = ""
        if patch:
            await db.platform_billing_settings.update_one({"id": "default"}, {"$set": patch})
            doc.update(patch)
        return doc

    def _settings_out(s: dict) -> PlatformBillingSettingsOut:
        return PlatformBillingSettingsOut(
            price_per_bag=float(s.get("price_per_bag") or 0),
            new_merchant_free_bags=int(s.get("new_merchant_free_bags") or 0),
            gst_percent=float(s.get("gst_percent") if s.get("gst_percent") is not None else _DEFAULT_GST),
            allow_test_payments=bool(s.get("allow_test_payments", True)),
            billing_active=bool(s.get("billing_active", True)),
            hsn_sac_code=str(s.get("hsn_sac_code") or _DEFAULT_HSN_SAC),
            invoice_prefix=str(s.get("invoice_prefix") or _DEFAULT_INVOICE_PREFIX),
            invoice_item_description=str(s.get("invoice_item_description") or _DEFAULT_INVOICE_ITEM),
            seller_name=str(s.get("seller_name") or _DEFAULT_SELLER_NAME),
            seller_address=str(s.get("seller_address") or ""),
            seller_phone=str(s.get("seller_phone") or ""),
            seller_gstin=str(s.get("seller_gstin") or ""),
            updated_at=s.get("updated_at"),
        )

    def _shop_address(shop: dict) -> str:
        return ", ".join(
            str(x).strip()
            for x in [
                shop.get("address"),
                shop.get("village"),
                shop.get("taluk"),
                shop.get("district"),
                shop.get("state"),
            ]
            if x and str(x).strip()
        )

    def _invoice_year(purchase: dict) -> int:
        dt = purchase.get("paid_at") or purchase.get("created_at") or _utc_now()
        if isinstance(dt, str):
            try:
                dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
            except Exception:
                dt = _utc_now()
        if getattr(dt, "tzinfo", None) is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.astimezone(timezone.utc).year)

    async def _allocate_invoice_no(purchase: dict, settings: dict) -> str:
        year = _invoice_year(purchase)
        prefix = (str(settings.get("invoice_prefix") or _DEFAULT_INVOICE_PREFIX).strip() or _DEFAULT_INVOICE_PREFIX)
        # Sanitize prefix for display codes.
        prefix = "".join(ch for ch in prefix.upper() if ch.isalnum() or ch in ("-", "_"))[:24] or _DEFAULT_INVOICE_PREFIX
        c = await db.counters.find_one_and_update(
            {"id": f"purchase_invoice_{year}"},
            {
                "$inc": {"seq": 1},
                "$setOnInsert": {
                    "id": f"purchase_invoice_{year}",
                    "kind": "purchase_invoice",
                    "year": year,
                },
            },
            upsert=True,
            return_document=True,
        )
        seq = int(c.get("seq") or 1)
        return f"{prefix}-{year}-{seq:06d}"

    async def _ensure_purchase_invoice_fields(purchase: dict) -> dict:
        """Idempotently attach invoice_no + snapshotted invoice fields to a PAID purchase."""
        if purchase.get("invoice_no"):
            return purchase
        if (purchase.get("status") or "") != "PAID":
            raise HTTPException(400, "Invoice is available only for paid purchases")

        settings = await get_platform_settings()
        invoice_no = await _allocate_invoice_no(purchase, settings)
        now = _utc_now()
        snap = {
            "invoice_no": invoice_no,
            "invoice_issued_at": now,
            "invoice_hsn_sac_code": str(settings.get("hsn_sac_code") or _DEFAULT_HSN_SAC).strip() or _DEFAULT_HSN_SAC,
            "invoice_item_description": (
                str(settings.get("invoice_item_description") or _DEFAULT_INVOICE_ITEM).strip()
                or _DEFAULT_INVOICE_ITEM
            ),
            "invoice_seller_name": str(settings.get("seller_name") or _DEFAULT_SELLER_NAME).strip() or _DEFAULT_SELLER_NAME,
            "invoice_seller_address": str(settings.get("seller_address") or "").strip(),
            "invoice_seller_phone": str(settings.get("seller_phone") or "").strip(),
            "invoice_seller_gstin": str(settings.get("seller_gstin") or "").strip(),
        }
        # Only win the race if invoice_no is still unset.
        updated = await db.bag_purchases.find_one_and_update(
            {
                "id": purchase["id"],
                "shop_id": purchase["shop_id"],
                "status": "PAID",
                "$or": [
                    {"invoice_no": {"$exists": False}},
                    {"invoice_no": None},
                    {"invoice_no": ""},
                ],
            },
            {"$set": snap},
            return_document=True,
            projection={"_id": 0},
        )
        if updated and updated.get("invoice_no"):
            return updated
        # Another request assigned the number — return authoritative row.
        again = await db.bag_purchases.find_one({"id": purchase["id"]}, {"_id": 0})
        if again and again.get("invoice_no"):
            return again
        raise HTTPException(409, "Could not issue invoice number — retry")

    async def _build_purchase_invoice(purchase: dict) -> PurchaseInvoiceOut:
        purchase = await _ensure_purchase_invoice_fields(purchase)
        shop = await db.shops.find_one(
            {"id": purchase["shop_id"]},
            {"_id": 0, "password_hash": 0},
        ) or {}
        invoice_date = purchase.get("invoice_issued_at") or purchase.get("paid_at") or purchase.get("created_at") or _utc_now()
        hsn = str(purchase.get("invoice_hsn_sac_code") or _DEFAULT_HSN_SAC)
        desc = str(purchase.get("invoice_item_description") or _DEFAULT_INVOICE_ITEM)
        return PurchaseInvoiceOut(
            purchase_id=purchase["id"],
            shop_id=purchase["shop_id"],
            invoice_no=str(purchase["invoice_no"]),
            invoice_date=invoice_date,
            status=str(purchase.get("status") or ""),
            seller=InvoicePartyOut(
                name=str(purchase.get("invoice_seller_name") or _DEFAULT_SELLER_NAME),
                address=str(purchase.get("invoice_seller_address") or ""),
                phone=str(purchase.get("invoice_seller_phone") or ""),
                gstin=str(purchase.get("invoice_seller_gstin") or ""),
            ),
            bill_to=InvoicePartyOut(
                name=str(shop.get("shop_name") or shop.get("username") or "Merchant"),
                address=_shop_address(shop),
                phone=str(shop.get("mobile") or ""),
                gstin=str(shop.get("gst_number") or ""),
            ),
            item=PurchaseInvoiceItemOut(
                description=desc,
                hsn_sac_code=hsn,
                bags=int(purchase.get("bags") or 0),
                price_per_bag=float(purchase.get("price_per_bag") or 0),
                amount=float(purchase.get("base_amount") or 0),
            ),
            subtotal=float(purchase.get("base_amount") or 0),
            gst_percent=float(purchase.get("gst_percent") or 0),
            gst_amount=float(purchase.get("gst_amount") or 0),
            total_amount=float(purchase.get("total_amount") or 0),
            bags=int(purchase.get("bags") or 0),
            price_per_bag=float(purchase.get("price_per_bag") or 0),
            paid_at=purchase.get("paid_at"),
            created_at=purchase.get("created_at"),
        )

    async def _active_patti_bags_used(shop_id: str) -> int:
        """Authoritative used bags = sum(total_bags) on non-deleted Pattis for this shop."""
        rows = await db.pattis.aggregate(
            [
                {"$match": {"shop_id": shop_id, "deleted": {"$ne": True}}},
                {"$group": {"_id": None, "bags": {"$sum": {"$ifNull": ["$total_bags", 0]}}}},
            ]
        ).to_list(1)
        return max(0, int((rows[0]["bags"] if rows else 0) or 0))

    def _split_used(free_alloc: int, purchased: int, used: int) -> tuple[int, int]:
        """Allocate used bags to free pool first, then purchased (same order as consume)."""
        used = max(0, int(used or 0))
        free_used = min(used, max(0, free_alloc))
        purchased_used = min(max(0, used - free_used), max(0, purchased))
        return free_used, purchased_used

    def _wallet_view_from_parts(
        *,
        shop_id: str,
        free_alloc: int,
        purchased: int,
        used: int,
        price: float,
    ) -> dict:
        free_used, purchased_used = _split_used(free_alloc, purchased, used)
        free_rem = max(0, free_alloc - free_used)
        purchased_rem = max(0, purchased - purchased_used)
        total_available = free_rem + purchased_rem  # == max(0, free_alloc + purchased - used) when used <= pool
        return {
            "shop_id": shop_id,
            "free_allocated": free_alloc,
            "free_used": free_used,
            "free_remaining": free_rem,
            "purchased_bags": purchased,
            "purchased_used": purchased_used,
            "purchased_remaining": purchased_rem,
            "total_available": total_available,
            "price_per_bag": float(price),
            "low_balance": total_available <= 50,
        }

    async def _wallet_view(w: dict, price: float, *, sync_counters: bool = True) -> dict:
        """
        Remaining = (free_allocated + purchased_total) - used.
        Used is authoritative from active (non-deleted) Patti bag totals — not drifted wallet counters.
        """
        shop_id = w["shop_id"]
        free_alloc = int(w.get("free_allocated") or 0)
        purchased = int(w.get("purchased_total") or 0)
        used = await _active_patti_bags_used(shop_id)
        view = _wallet_view_from_parts(
            shop_id=shop_id,
            free_alloc=free_alloc,
            purchased=purchased,
            used=used,
            price=price,
        )
        if sync_counters:
            if int(w.get("free_used") or 0) != view["free_used"] or int(w.get("purchased_used") or 0) != view["purchased_used"]:
                await db.merchant_bag_wallets.update_one(
                    {"shop_id": shop_id},
                    {
                        "$set": {
                            "free_used": view["free_used"],
                            "purchased_used": view["purchased_used"],
                            "updated_at": _utc_now(),
                        }
                    },
                )
        return view

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
        # Always charge the shop wallet (owner or staff). Skipping staff was under-counting used bags.
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
            # Authoritative remaining before this consume: pool minus other active pattis
            # (this patti may already be inserted — exclude it from the used sum for the check).
            used_all = await _active_patti_bags_used(shop_id)
            free_alloc = int(w["free_allocated"])
            purchased = int(w["purchased_total"])
            pool = free_alloc + purchased
            # If this patti is already in the sum, used_all includes bags; require pool >= used_all.
            # If not yet in the sum, require pool - used_all >= bags.
            patti = await db.pattis.find_one(
                {"id": patti_id, "shop_id": shop_id, "deleted": {"$ne": True}},
                {"_id": 0, "total_bags": 1},
            )
            if patti:
                if used_all > pool:
                    raise _insufficient()
            else:
                if pool - used_all < bags:
                    raise _insufficient()
            # Keep incremental counters in sync with authoritative used after this charge.
            used_after = used_all if patti else (used_all + bags)
            free_used, purchased_used = _split_used(free_alloc, purchased, used_after)
            prev_free, prev_purchased = _split_used(
                free_alloc, purchased, used_after - bags,
            )
            free_take = max(0, free_used - prev_free)
            paid_take = max(0, purchased_used - prev_purchased)
            ver = int(w.get("version") or 0)
            res = await db.merchant_bag_wallets.update_one(
                {
                    "shop_id": shop_id,
                    "version": ver,
                },
                {
                    "$set": {
                        "free_used": free_used,
                        "purchased_used": purchased_used,
                        "updated_at": _utc_now(),
                    },
                    "$inc": {"version": 1},
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
        # Always adjust shop wallet for bag edits (owner or staff).
        old_bags = int(old_bags or 0)
        new_bags = int(new_bags or 0)
        delta = new_bags - old_bags
        if delta == 0:
            return
        if delta < 0:
            await _restore_bags(
                shop_id=shop_id, patti_id=patti_id, lot_id=lot_id,
                bags=-delta, user=user, kind="ADJUST_RETURN",
            )
            return

        settings = await get_platform_settings()
        price = float(settings.get("price_per_bag") or 0)
        for _ in range(8):
            w = await ensure_wallet(shop_id)
            free_alloc = int(w["free_allocated"])
            purchased = int(w["purchased_total"])
            pool = free_alloc + purchased
            used_all = await _active_patti_bags_used(shop_id)
            # Prefer authoritative post-edit used; if patti not updated yet, add delta.
            used_after = used_all if used_all >= new_bags else (used_all + delta)
            if used_after > pool:
                raise _insufficient()
            free_used, purchased_used = _split_used(free_alloc, purchased, used_after)
            prev_free, prev_purchased = _split_used(free_alloc, purchased, used_after - delta)
            free_take = max(0, free_used - prev_free)
            paid_take = max(0, purchased_used - prev_purchased)
            ver = int(w.get("version") or 0)
            res = await db.merchant_bag_wallets.update_one(
                {"shop_id": shop_id, "version": ver},
                {
                    "$set": {
                        "free_used": free_used,
                        "purchased_used": purchased_used,
                        "updated_at": _utc_now(),
                    },
                    "$inc": {"version": 1},
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
            free_alloc = int(w["free_allocated"])
            purchased = int(w["purchased_total"])
            # After edit/delete, authoritative used is active patti bag sum.
            used_after = await _active_patti_bags_used(shop_id)
            free_used, purchased_used = _split_used(free_alloc, purchased, used_after)
            prev_free = int(w.get("free_used") or 0)
            prev_purchased = int(w.get("purchased_used") or 0)
            free_dec = max(0, prev_free - free_used)
            paid_dec = max(0, prev_purchased - purchased_used)
            ver = int(w.get("version") or 0)
            res = await db.merchant_bag_wallets.update_one(
                {"shop_id": shop_id, "version": ver},
                {
                    "$set": {
                        "free_used": free_used,
                        "purchased_used": purchased_used,
                        "updated_at": _utc_now(),
                    },
                    "$inc": {"version": 1},
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
        bags = int(bags or 0)
        if bags <= 0:
            return
        w = await ensure_wallet(shop_id)
        free_alloc = int(w.get("free_allocated") or 0)
        purchased = int(w.get("purchased_total") or 0)
        used = await _active_patti_bags_used(shop_id)
        remaining = max(0, free_alloc + purchased - used)
        if remaining < bags:
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
    async def admin_get_billing_settings(admin: dict = Depends(admin_auth)):
        s = await get_platform_settings()
        return _settings_out(s)

    @api.put("/admin/billing/settings", response_model=PlatformBillingSettingsOut)
    async def admin_put_billing_settings(
        payload: PlatformBillingSettingsIn,
        admin: dict = Depends(admin_auth),
    ):
        now = _utc_now()
        await db.platform_billing_settings.update_one(
            {"id": "default"},
            {"$set": {
                "price_per_bag": float(payload.price_per_bag),
                "new_merchant_free_bags": int(payload.new_merchant_free_bags),
                "gst_percent": float(payload.gst_percent),
                "allow_test_payments": bool(payload.allow_test_payments),
                "billing_active": bool(payload.billing_active),
                "hsn_sac_code": (payload.hsn_sac_code or _DEFAULT_HSN_SAC).strip() or _DEFAULT_HSN_SAC,
                "invoice_prefix": (payload.invoice_prefix or _DEFAULT_INVOICE_PREFIX).strip() or _DEFAULT_INVOICE_PREFIX,
                "invoice_item_description": (
                    (payload.invoice_item_description or _DEFAULT_INVOICE_ITEM).strip() or _DEFAULT_INVOICE_ITEM
                ),
                "seller_name": (payload.seller_name or _DEFAULT_SELLER_NAME).strip() or _DEFAULT_SELLER_NAME,
                "seller_address": (payload.seller_address or "").strip(),
                "seller_phone": (payload.seller_phone or "").strip(),
                "seller_gstin": (payload.seller_gstin or "").strip(),
                "updated_at": now,
            }},
            upsert=True,
        )
        try:
            from admin_panel.audit import write_admin_audit

            await write_admin_audit(
                db,
                admin_user_id=admin.get("id"),
                admin_username=admin.get("username"),
                action="BILLING_SETTINGS_UPDATE",
                resource_type="platform_billing_settings",
                resource_id="default",
                metadata={
                    "price_per_bag": float(payload.price_per_bag),
                    "new_merchant_free_bags": int(payload.new_merchant_free_bags),
                    "gst_percent": float(payload.gst_percent),
                    "hsn_sac_code": (payload.hsn_sac_code or "").strip(),
                    "invoice_prefix": (payload.invoice_prefix or "").strip(),
                },
            )
        except Exception:
            pass
        return await admin_get_billing_settings(admin)

    @api.get("/admin/billing/merchants")
    async def admin_list_merchants(
        admin: dict = Depends(admin_auth),
        limit: int = Query(200, ge=1, le=2000),
        page: int = Query(1, ge=1),
        page_size: Optional[int] = Query(default=None, ge=1, le=200),
    ):
        settings = await get_platform_settings()
        price = float(settings.get("price_per_bag") or 0)
        # Prefer page/page_size when provided; keep legacy limit for scripts.
        if page_size is not None:
            skip = (page - 1) * page_size
            take = page_size
        else:
            skip = 0
            take = limit
        out = []
        cursor = db.shops.find({}, {"_id": 0, "password_hash": 0}).skip(skip).limit(take)
        async for shop in cursor:
            w = await ensure_wallet(shop["id"])
            view = await _wallet_view(w, price)
            purchases = await db.bag_purchases.aggregate([
                {"$match": {"shop_id": shop["id"], "status": "PAID"}},
                {"$group": {"_id": None, "total": {"$sum": "$total_amount"}, "bags": {"$sum": "$bags"}}},
            ]).to_list(1)
            out.append({
                "shop_id": shop["id"],
                "shop_name": shop.get("shop_name"),
                "username": shop.get("username"),
                **view,
                "active_patti_bags_used": view["free_used"] + view["purchased_used"],
                "total_amount_purchased": _round2((purchases[0]["total"] if purchases else 0) or 0),
                "total_bags_purchased": int((purchases[0]["bags"] if purchases else 0) or 0),
            })
        return out

    @api.get("/billing/wallet", response_model=WalletOut)
    async def get_wallet(user=Depends(owner_only)):
        settings = await get_platform_settings()
        w = await ensure_wallet(user["shop_id"])
        return WalletOut(**(await _wallet_view(w, float(settings.get("price_per_bag") or 0))))

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
            try:
                purchase = await _ensure_purchase_invoice_fields(purchase)
            except Exception:
                pass
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
            # Issue stable invoice number once when purchase becomes PAID.
            try:
                d = await _ensure_purchase_invoice_fields(d)
            except Exception:
                # Wallet already credited — invoice can be issued lazily on GET.
                pass
            return PurchaseOut(**d)
        raise HTTPException(409, "Could not confirm purchase — retry")

    @api.get("/billing/purchases", response_model=List[PurchaseOut])
    async def list_purchases(user=Depends(owner_only), limit: int = Query(100, ge=1, le=500)):
        cur = db.bag_purchases.find(
            {"shop_id": user["shop_id"]}, {"_id": 0},
        ).sort("created_at", -1).limit(limit)
        return [PurchaseOut(**d) async for d in cur]

    @api.get("/billing/purchases/{purchase_id}/invoice", response_model=PurchaseInvoiceOut)
    async def get_purchase_invoice(purchase_id: str, user=Depends(owner_only)):
        """Merchant invoice for one of THEIR bag purchases only (shop ownership enforced)."""
        purchase = await db.bag_purchases.find_one(
            {"id": purchase_id, "shop_id": user["shop_id"]}, {"_id": 0},
        )
        if not purchase:
            raise HTTPException(404, "Purchase not found")
        return await _build_purchase_invoice(purchase)

    @api.get("/admin/purchases/{purchase_id}/invoice", response_model=PurchaseInvoiceOut)
    async def admin_get_purchase_invoice(purchase_id: str, admin: dict = Depends(admin_auth)):
        purchase = await db.bag_purchases.find_one({"id": purchase_id}, {"_id": 0})
        if not purchase:
            raise HTTPException(404, "Purchase not found")
        return await _build_purchase_invoice(purchase)

    @api.get("/billing/usage")
    async def list_usage(user=Depends(owner_only), limit: int = Query(200, ge=1, le=1000)):
        cur = db.bag_usage.find(
            {"shop_id": user["shop_id"]}, {"_id": 0},
        ).sort("at", -1).limit(limit)
        return [d async for d in cur]
