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
_DEFAULT_GST = 18.0
_DEFAULT_SERVICE_HSN = "998399"  # Other information technology services (configurable)

# Lemon Mandi product / Rbolo Info Services Pvt Ltd — GST-registered supplier.
_SUPPLIER_BRAND = "LEMON MANDI"
_SUPPLIER_LEGAL_NAME = "Rbolo Info Services Private Limited"
_SUPPLIER_ADDRESS_LINES = (
    "MUJAWAR MOHALLA BABALESHWAR NAKA IBRAHIM ROZA VIJAYPUR,",
    "BIJAPUR - 586101",
)
_SUPPLIER_GSTIN = "29AAMCR3486L1ZI"
_SUPPLIER_STATE_CODE = "29"  # Karnataka

# Common Indian state / UT codes for place-of-supply (buyer without GSTIN).
_STATE_NAME_TO_CODE = {
    "AN": "35", "ANDAMAN": "35", "ANDAMAN AND NICOBAR": "35", "ANDAMAN & NICOBAR": "35",
    "AP": "37", "ANDHRA PRADESH": "37",
    "AR": "12", "ARUNACHAL PRADESH": "12",
    "AS": "18", "ASSAM": "18",
    "BR": "10", "BIHAR": "10",
    "CH": "04", "CHANDIGARH": "04",
    "CT": "22", "CG": "22", "CHHATTISGARH": "22",
    "DN": "26", "DADRA": "26", "DADRA AND NAGAR HAVELI": "26", "DNHDD": "26",
    "DD": "26", "DAMAN": "26", "DAMAN AND DIU": "26",
    "DL": "07", "DELHI": "07", "NCT OF DELHI": "07",
    "GA": "30", "GOA": "30",
    "GJ": "24", "GUJARAT": "24",
    "HR": "06", "HARYANA": "06",
    "HP": "02", "HIMACHAL PRADESH": "02",
    "JK": "01", "JAMMU AND KASHMIR": "01", "JAMMU & KASHMIR": "01",
    "JH": "20", "JHARKHAND": "20",
    "KA": "29", "KARNATAKA": "29",
    "KL": "32", "KERALA": "32",
    "LA": "38", "LADAKH": "38",
    "LD": "31", "LAKSHADWEEP": "31",
    "MP": "23", "MADHYA PRADESH": "23",
    "MH": "27", "MAHARASHTRA": "27",
    "MN": "14", "MANIPUR": "14",
    "ML": "17", "MEGHALAYA": "17",
    "MZ": "15", "MIZORAM": "15",
    "NL": "13", "NAGALAND": "13",
    "OR": "21", "OD": "21", "ODISHA": "21", "ORISSA": "21",
    "PY": "34", "PUDUCHERRY": "34", "PONDICHERRY": "34",
    "PB": "03", "PUNJAB": "03",
    "RJ": "08", "RAJASTHAN": "08",
    "SK": "11", "SIKKIM": "11",
    "TN": "33", "TAMIL NADU": "33", "TAMILNADU": "33",
    "TS": "36", "TG": "36", "TELANGANA": "36",
    "TR": "16", "TRIPURA": "16",
    "UP": "09", "UTTAR PRADESH": "09",
    "UT": "05", "UK": "05", "UTTARAKHAND": "05", "UTTARANCHAL": "05",
    "WB": "19", "WEST BENGAL": "19",
}


def bag_invoice_seller() -> dict:
    """Canonical supplier block for Bag Balance tax invoices (brand ≠ legal entity)."""
    return {
        "brand": _SUPPLIER_BRAND,
        "name": _SUPPLIER_BRAND,
        "legal_name": _SUPPLIER_LEGAL_NAME,
        "address_lines": list(_SUPPLIER_ADDRESS_LINES),
        "gstin": _SUPPLIER_GSTIN,
    }


def _buyer_state_code(buyer_gstin: str = "", buyer_state: str = "") -> str:
    gstin = (buyer_gstin or "").strip().upper()
    if len(gstin) >= 2 and gstin[:2].isdigit():
        return gstin[:2]
    key = (buyer_state or "").strip().upper()
    if not key:
        return _SUPPLIER_STATE_CODE
    if key in _STATE_NAME_TO_CODE:
        return _STATE_NAME_TO_CODE[key]
    # Tolerate "Vijayapura(KA)" / "Karnataka, India" style values.
    for token, code in _STATE_NAME_TO_CODE.items():
        if len(token) > 2 and token in key:
            return code
    if len(key) == 2 and key in _STATE_NAME_TO_CODE:
        return _STATE_NAME_TO_CODE[key]
    return _SUPPLIER_STATE_CODE


def split_bag_gst(
    *,
    gst_percent: float,
    gst_amount: float,
    buyer_gstin: str = "",
    buyer_state: str = "",
) -> dict:
    """Split total GST into CGST+SGST (intra-state) or IGST (inter-state)."""
    pct = float(gst_percent or 0)
    amt = _round2(gst_amount)
    buyer_code = _buyer_state_code(buyer_gstin, buyer_state)
    intra = buyer_code == _SUPPLIER_STATE_CODE
    if intra:
        half_pct = _round2(pct / 2.0)
        cgst = _round2(amt / 2.0)
        sgst = _round2(amt - cgst)
        return {
            "gst_supply_type": "INTRA",
            "place_of_supply_state_code": buyer_code,
            "cgst_percent": half_pct,
            "cgst_amount": cgst,
            "sgst_percent": half_pct,
            "sgst_amount": sgst,
            "igst_percent": 0.0,
            "igst_amount": 0.0,
        }
    return {
        "gst_supply_type": "INTER",
        "place_of_supply_state_code": buyer_code,
        "cgst_percent": 0.0,
        "cgst_amount": 0.0,
        "sgst_percent": 0.0,
        "sgst_amount": 0.0,
        "igst_percent": pct,
        "igst_amount": amt,
    }


class PlatformBillingSettingsIn(BaseModel):
    price_per_bag: float = Field(ge=0, le=1000)
    new_merchant_free_bags: int = Field(ge=0, le=10_000_000)
    gst_percent: float = Field(default=18.0, ge=0, le=100)
    service_hsn_code: str = Field(default=_DEFAULT_SERVICE_HSN, min_length=4, max_length=16)
    allow_test_payments: bool = True
    billing_active: bool = True


class PlatformBillingSettingsOut(BaseModel):
    price_per_bag: float
    new_merchant_free_bags: int
    gst_percent: float
    service_hsn_code: str
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
    # Admin-allocated free bags not yet claimed by the merchant (not in usable balance).
    free_available_to_claim: int = 0


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
    invoice_number: Optional[str] = None
    payment_ref: Optional[str] = None


class BagInvoiceOut(BaseModel):
    """Tax invoice for a PAID bag purchase — built from real purchase + shop data."""
    purchase_id: str
    invoice_number: str
    invoice_date: datetime
    status: str
    billing_to: dict
    seller: dict
    service_hsn_code: str
    bags: int
    price_per_bag: float
    base_amount: float
    gst_percent: float
    gst_amount: float
    cgst_percent: float = 0.0
    cgst_amount: float = 0.0
    sgst_percent: float = 0.0
    sgst_amount: float = 0.0
    igst_percent: float = 0.0
    igst_amount: float = 0.0
    gst_supply_type: str = "INTRA"
    place_of_supply_state_code: str = _SUPPLIER_STATE_CODE
    total_amount: float
    line_description: str
    payment_ref: Optional[str] = None
    paid_at: Optional[datetime] = None
    created_at: datetime


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
        from free_bags import ensure_free_bag_indexes

        await ensure_free_bag_indexes(db)

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
                "service_hsn_code": _DEFAULT_SERVICE_HSN,
                "allow_test_payments": True,
                "billing_active": True,
                "updated_at": now,
            }
            await db.platform_billing_settings.update_one(
                {"id": "default"}, {"$setOnInsert": doc}, upsert=True,
            )
            doc = await db.platform_billing_settings.find_one({"id": "default"}, {"_id": 0}) or doc
        # Backfill configurable HSN if missing on older settings docs.
        if not (doc.get("service_hsn_code") or "").strip():
            await db.platform_billing_settings.update_one(
                {"id": "default"},
                {"$set": {"service_hsn_code": _DEFAULT_SERVICE_HSN}},
            )
            doc["service_hsn_code"] = _DEFAULT_SERVICE_HSN
        return doc

    def _invoice_number_for(purchase: dict) -> str:
        existing = (purchase.get("invoice_number") or "").strip()
        if existing:
            return existing
        paid = purchase.get("paid_at") or purchase.get("created_at") or _utc_now()
        if isinstance(paid, str):
            try:
                paid = datetime.fromisoformat(paid.replace("Z", "+00:00"))
            except Exception:
                paid = _utc_now()
        if not isinstance(paid, datetime):
            paid = _utc_now()
        if paid.tzinfo is None:
            paid = paid.replace(tzinfo=timezone.utc)
        short = str(purchase.get("id") or _uid()).replace("-", "")[:8].upper()
        return f"INV-{paid.strftime('%Y%m%d')}-{short}"

    async def _build_bag_invoice(purchase: dict, shop: dict, settings: dict) -> dict:
        inv_no = _invoice_number_for(purchase)
        # Persist invoice_number once for PAID purchases so admin/merchant share the same number.
        if purchase.get("status") == "PAID" and not (purchase.get("invoice_number") or "").strip():
            await db.bag_purchases.update_one(
                {"id": purchase["id"]},
                {"$set": {"invoice_number": inv_no}},
            )
            purchase["invoice_number"] = inv_no

        addr_parts = [
            shop.get("address"),
            shop.get("village"),
            shop.get("taluk"),
            shop.get("district"),
            shop.get("state"),
        ]
        address = ", ".join(str(p).strip() for p in addr_parts if p and str(p).strip())
        billing_to = {
            "shop_id": shop.get("id") or purchase.get("shop_id"),
            "shop_name": shop.get("shop_name") or "",
            "owner_name": shop.get("owner_name") or "",
            "username": shop.get("username") or "",
            "mobile": shop.get("mobile") or "",
            "email": shop.get("email") or "",
            "address": address,
            "gst_number": shop.get("gst_number") or "",
            "pan_number": shop.get("pan_number") or "",
        }
        seller = bag_invoice_seller()
        bags = int(purchase.get("bags") or 0)
        price = float(purchase.get("price_per_bag") or 0)
        base = float(purchase.get("base_amount") if purchase.get("base_amount") is not None else _round2(bags * price))
        gst_pct = float(purchase.get("gst_percent") if purchase.get("gst_percent") is not None else float(settings.get("gst_percent") or _DEFAULT_GST))
        gst_amt = float(purchase.get("gst_amount") if purchase.get("gst_amount") is not None else _round2(base * gst_pct / 100.0))
        total = float(purchase.get("total_amount") if purchase.get("total_amount") is not None else _round2(base + gst_amt))
        gst_parts = split_bag_gst(
            gst_percent=gst_pct,
            gst_amount=gst_amt,
            buyer_gstin=str(billing_to.get("gst_number") or ""),
            buyer_state=str(shop.get("state") or ""),
        )
        hsn = (settings.get("service_hsn_code") or _DEFAULT_SERVICE_HSN).strip() or _DEFAULT_SERVICE_HSN
        inv_date = purchase.get("paid_at") or purchase.get("created_at") or _utc_now()
        return {
            "purchase_id": purchase["id"],
            "invoice_number": inv_no,
            "invoice_date": inv_date,
            "status": purchase.get("status") or "",
            "billing_to": billing_to,
            "seller": seller,
            "service_hsn_code": hsn,
            "bags": bags,
            "price_per_bag": price,
            "base_amount": base,
            "gst_percent": gst_pct,
            "gst_amount": gst_amt,
            **gst_parts,
            "total_amount": total,
            "line_description": f"Prepaid bag balance — {bags} bags",
            "payment_ref": purchase.get("payment_ref"),
            "paid_at": purchase.get("paid_at"),
            "created_at": purchase.get("created_at") or inv_date,
        }

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
        return PlatformBillingSettingsOut(
            price_per_bag=float(s.get("price_per_bag") or 0),
            new_merchant_free_bags=int(s.get("new_merchant_free_bags") or 0),
            gst_percent=float(s.get("gst_percent") if s.get("gst_percent") is not None else _DEFAULT_GST),
            service_hsn_code=(s.get("service_hsn_code") or _DEFAULT_SERVICE_HSN).strip() or _DEFAULT_SERVICE_HSN,
            allow_test_payments=bool(s.get("allow_test_payments", True)),
            billing_active=bool(s.get("billing_active", True)),
            updated_at=s.get("updated_at"),
        )

    @api.put("/admin/billing/settings", response_model=PlatformBillingSettingsOut)
    async def admin_put_billing_settings(
        payload: PlatformBillingSettingsIn,
        admin: dict = Depends(admin_auth),
    ):
        now = _utc_now()
        hsn = (payload.service_hsn_code or _DEFAULT_SERVICE_HSN).strip() or _DEFAULT_SERVICE_HSN
        await db.platform_billing_settings.update_one(
            {"id": "default"},
            {"$set": {
                "price_per_bag": float(payload.price_per_bag),
                "new_merchant_free_bags": int(payload.new_merchant_free_bags),
                "gst_percent": float(payload.gst_percent),
                "service_hsn_code": hsn,
                "allow_test_payments": bool(payload.allow_test_payments),
                "billing_active": bool(payload.billing_active),
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
                    "service_hsn_code": hsn,
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
        view = await _wallet_view(w, float(settings.get("price_per_bag") or 0))
        try:
            # PENDING = new status; AVAILABLE kept for legacy allocations.
            unclaimed_q = {"shop_id": user["shop_id"], "status": {"$in": ["PENDING", "AVAILABLE"]}}
            bags_to_claim = 0
            cur = db.bag_free_allocations.find(unclaimed_q, {"_id": 0, "bags": 1})
            async for row in cur:
                bags_to_claim += int(row.get("bags") or 0)
            view["free_available_to_claim"] = bags_to_claim
        except Exception:
            view["free_available_to_claim"] = 0
        return WalletOut(**view)

    @api.get("/billing/price")
    async def get_current_price(user=Depends(current_user)):
        s = await get_platform_settings()
        return {
            "price_per_bag": float(s.get("price_per_bag") or 0),
            "gst_percent": float(s.get("gst_percent") if s.get("gst_percent") is not None else _DEFAULT_GST),
            "service_hsn_code": (s.get("service_hsn_code") or _DEFAULT_SERVICE_HSN).strip() or _DEFAULT_SERVICE_HSN,
            "new_merchant_free_bags": int(s.get("new_merchant_free_bags") or 0),
        }

    @api.post("/billing/purchases", response_model=PurchaseOut, status_code=201)
    async def create_purchase(payload: PurchaseCreateIn, user=Depends(owner_only)):
        settings = await get_platform_settings()
        price = float(settings.get("price_per_bag") or 0)
        gst_pct = float(settings.get("gst_percent") if settings.get("gst_percent") is not None else _DEFAULT_GST)
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
            "invoice_number": None,
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
            return PurchaseOut(**{**purchase, "invoice_number": purchase.get("invoice_number") or _invoice_number_for(purchase)})
        if purchase.get("status") != "PENDING":
            raise HTTPException(400, f"Cannot confirm purchase in status {purchase.get('status')}")

        now = _utc_now()
        inv_no = _invoice_number_for({**purchase, "paid_at": now})
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
                    "invoice_number": inv_no,
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
        out = []
        async for d in cur:
            if d.get("status") == "PAID" and not (d.get("invoice_number") or "").strip():
                d["invoice_number"] = _invoice_number_for(d)
            out.append(PurchaseOut(**d))
        return out

    @api.get("/billing/purchases/{purchase_id}/invoice", response_model=BagInvoiceOut)
    async def get_purchase_invoice(purchase_id: str, user=Depends(owner_only)):
        purchase = await db.bag_purchases.find_one(
            {"id": purchase_id, "shop_id": user["shop_id"]}, {"_id": 0},
        )
        if not purchase:
            raise HTTPException(404, "Purchase not found")
        if purchase.get("status") != "PAID":
            raise HTTPException(400, "Invoice is available only for paid purchases")
        shop = await db.shops.find_one({"id": user["shop_id"]}, {"_id": 0, "password_hash": 0})
        if not shop:
            raise HTTPException(404, "Shop not found")
        settings = await get_platform_settings()
        return BagInvoiceOut(**(await _build_bag_invoice(purchase, shop, settings)))

    @api.get("/billing/usage")
    async def list_usage(user=Depends(owner_only), limit: int = Query(200, ge=1, le=1000)):
        cur = db.bag_usage.find(
            {"shop_id": user["shop_id"]}, {"_id": 0},
        ).sort("at", -1).limit(limit)
        return [d async for d in cur]

    async def _get_wallet_free_used(shop_id: str) -> int:
        settings = await get_platform_settings()
        w = await ensure_wallet(shop_id)
        view = await _wallet_view(w, float(settings.get("price_per_bag") or 0), sync_counters=False)
        return int(view.get("free_used") or 0)

    from free_bags import register_free_bag_routes

    register_free_bag_routes(
        api,
        db=db,
        admin_auth=admin_auth,
        owner_only=owner_only,
        ensure_wallet=ensure_wallet,
        get_wallet_free_used=_get_wallet_free_used,
    )
