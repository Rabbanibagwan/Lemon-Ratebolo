"""Admin-allocated free bags that merchants must CLAIM before balance increases.

PENDING allocations never affect usable wallet balance.
CLAIMED allocations $inc merchant_bag_wallets.free_allocated once (idempotent).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field


def _uid() -> str:
    return str(uuid.uuid4())


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


_MONTH_NAMES = (
    "",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)

# PENDING = allocated but not claimed (legacy docs may still say AVAILABLE).
ALLOC_STATUSES = ("PENDING", "AVAILABLE", "CLAIMED", "EXPIRED", "CANCELLED")
UNCLAIMED_STATUSES = ("PENDING", "AVAILABLE")


def period_label(year: int, month: int) -> str:
    if month < 1 or month > 12:
        raise ValueError("month must be 1-12")
    return f"{_MONTH_NAMES[month]} {int(year)}"


def _normalize_status(status: Optional[str]) -> str:
    st = (status or "").strip().upper()
    if st == "AVAILABLE":
        return "PENDING"
    return st


class FreeAllocationCreateIn(BaseModel):
    shop_id: str = Field(min_length=1, max_length=80)
    bags: int = Field(ge=1, le=10_000_000)
    year: int = Field(ge=2020, le=2100)
    month: int = Field(ge=1, le=12)
    reason: Optional[str] = Field(default=None, max_length=500)
    client_request_id: Optional[str] = Field(default=None, max_length=80)


class FreeAllocationBulkIn(BaseModel):
    shop_ids: List[str] = Field(min_length=1, max_length=500)
    bags: int = Field(ge=1, le=10_000_000)
    year: int = Field(ge=2020, le=2100)
    month: int = Field(ge=1, le=12)
    reason: Optional[str] = Field(default=None, max_length=500)
    client_request_id: Optional[str] = Field(default=None, max_length=80)


class FreeAllocationOut(BaseModel):
    id: str
    shop_id: str
    shop_name: Optional[str] = None
    username: Optional[str] = None
    mobile: Optional[str] = None
    bags: int
    year: int
    month: int
    period_label: str
    status: str
    reason: Optional[str] = None
    allocated_at: datetime
    claimed_at: Optional[datetime] = None
    claim_ref: Optional[str] = None
    claim_transaction_id: Optional[str] = None
    created_by_admin_id: Optional[str] = None
    created_by_admin_username: Optional[str] = None
    allocated_bags: Optional[int] = None
    claimed_bags: Optional[int] = None
    unclaimed_bags: Optional[int] = None


class FreeAllocationBulkOut(BaseModel):
    created: List[FreeAllocationOut]
    count: int
    bags_each: int
    client_request_id: Optional[str] = None


class FreeSummaryOut(BaseModel):
    shop_id: str
    allocated: int
    claimed: int
    used: int
    remaining: int
    available_to_claim: int
    unclaimed: int = 0


class NotificationOut(BaseModel):
    id: str
    shop_id: str
    kind: str
    title: str
    body: str
    action: Optional[str] = None
    allocation_id: Optional[str] = None
    bags: Optional[int] = None
    read: bool
    created_at: datetime
    read_at: Optional[datetime] = None


def _alloc_out(doc: dict, shop: Optional[dict] = None) -> FreeAllocationOut:
    bags = int(doc["bags"])
    status = _normalize_status(doc.get("status"))
    claimed_bags = bags if status == "CLAIMED" else 0
    unclaimed_bags = bags if status in UNCLAIMED_STATUSES or status == "PENDING" else 0
    if status == "PENDING":
        unclaimed_bags = bags
    return FreeAllocationOut(
        id=doc["id"],
        shop_id=doc["shop_id"],
        shop_name=(shop or {}).get("shop_name") or doc.get("shop_name"),
        username=(shop or {}).get("username") or doc.get("username"),
        mobile=(shop or {}).get("mobile") or doc.get("mobile"),
        bags=bags,
        year=int(doc["year"]),
        month=int(doc["month"]),
        period_label=doc.get("period_label") or period_label(int(doc["year"]), int(doc["month"])),
        status=status,
        reason=doc.get("reason"),
        allocated_at=doc["allocated_at"],
        claimed_at=doc.get("claimed_at"),
        claim_ref=doc.get("claim_ref"),
        claim_transaction_id=doc.get("claim_transaction_id"),
        created_by_admin_id=doc.get("created_by_admin_id"),
        created_by_admin_username=doc.get("created_by_admin_username"),
        allocated_bags=bags,
        claimed_bags=claimed_bags,
        unclaimed_bags=unclaimed_bags,
    )


async def ensure_free_bag_indexes(db) -> None:
    await db.bag_free_allocations.create_index("id", unique=True)
    await db.bag_free_allocations.create_index([("shop_id", 1), ("status", 1), ("allocated_at", -1)])
    await db.bag_free_allocations.create_index([("year", 1), ("month", 1), ("shop_id", 1)])
    await db.bag_free_allocations.create_index([("status", 1), ("allocated_at", -1)])
    await db.bag_free_allocations.create_index(
        "client_request_id",
        unique=True,
        partialFilterExpression={"client_request_id": {"$type": "string"}},
        name="uniq_free_alloc_client_request",
    )
    await db.bag_free_bulk_requests.create_index("id", unique=True)
    await db.bag_free_bulk_requests.create_index("client_request_id", unique=True)
    await db.merchant_notifications.create_index("id", unique=True)
    await db.merchant_notifications.create_index([("shop_id", 1), ("created_at", -1)])
    await db.merchant_notifications.create_index([("shop_id", 1), ("read", 1)])
    await db.bag_usage.create_index(
        [("shop_id", 1), ("allocation_id", 1), ("kind", 1)],
        unique=True,
        partialFilterExpression={"kind": "FREE_CLAIM"},
        name="uniq_free_claim_per_allocation",
    )


async def free_summary_for_shop(db, shop_id: str, *, free_used: int = 0) -> dict:
    allocated = claimed = available = 0
    cur = db.bag_free_allocations.find({"shop_id": shop_id}, {"_id": 0, "bags": 1, "status": 1})
    async for row in cur:
        bags = int(row.get("bags") or 0)
        st = _normalize_status(row.get("status"))
        if st in ("PENDING", "CLAIMED", "EXPIRED", "CANCELLED"):
            allocated += bags
        if st == "CLAIMED":
            claimed += bags
        if st == "PENDING":
            available += bags
    used = max(0, int(free_used or 0))
    remaining = max(0, claimed - used)
    return {
        "shop_id": shop_id,
        "allocated": allocated,
        "claimed": claimed,
        "used": used,
        "remaining": remaining,
        "available_to_claim": available,
        "unclaimed": available,
    }


async def _credit_claimed_bags(db, *, shop_id: str, bags: int, allocation_id: str, user_id: Optional[str]) -> str:
    """Credit wallet free_allocated + write FREE_CLAIM usage. Idempotent via unique allocation_id."""
    existing_usage = await db.bag_usage.find_one(
        {"shop_id": shop_id, "allocation_id": allocation_id, "kind": "FREE_CLAIM"},
        {"_id": 0},
    )
    if existing_usage:
        return existing_usage["id"]

    now = _utc_now()
    usage_id = _uid()
    for _ in range(8):
        w = await db.merchant_bag_wallets.find_one({"shop_id": shop_id}, {"_id": 0})
        if not w:
            # Ensure wallet exists via insert-if-missing (caller should have ensure_wallet)
            raise HTTPException(409, "Wallet not ready — retry")
        ver = int(w.get("version") or 0)
        res = await db.merchant_bag_wallets.update_one(
            {"shop_id": shop_id, "version": ver},
            {
                "$inc": {"free_allocated": int(bags), "version": 1},
                "$set": {"updated_at": now, "last_free_claim_at": now},
            },
        )
        if res.modified_count != 1:
            continue
        usage = {
            "id": usage_id,
            "shop_id": shop_id,
            "patti_id": None,
            "lot_id": None,
            "allocation_id": allocation_id,
            "bags": int(bags),
            "free_bags": int(bags),
            "purchased_bags": 0,
            "price_applied": 0.0,
            "kind": "FREE_CLAIM",
            "status": "ACTIVE",
            "at": now,
            "by_user_id": user_id,
            "by_role": "owner",
            "note": f"Claimed free bag allocation {allocation_id[:8]}",
        }
        try:
            await db.bag_usage.insert_one(usage)
        except Exception:
            # Unique index race — another request wrote the claim usage; reverse wallet credit once.
            again = await db.bag_usage.find_one(
                {"shop_id": shop_id, "allocation_id": allocation_id, "kind": "FREE_CLAIM"},
                {"_id": 0},
            )
            if again:
                await db.merchant_bag_wallets.update_one(
                    {"shop_id": shop_id},
                    {"$inc": {"free_allocated": -int(bags), "version": 1}, "$set": {"updated_at": _utc_now()}},
                )
                return again["id"]
            raise
        return usage_id
    raise HTTPException(409, "Bag balance busy — retry claim")


def register_free_bag_routes(
    api: APIRouter,
    *,
    db,
    admin_auth,
    owner_only,
    ensure_wallet,
    get_wallet_free_used,
) -> None:
    """Attach free-bag allocation / claim / notification routes onto the billing router."""

    async def _create_one_allocation(
        *,
        shop: dict,
        bags: int,
        year: int,
        month: int,
        reason: Optional[str],
        admin: dict,
        client_request_id: Optional[str] = None,
    ) -> dict:
        shop_id = shop["id"]
        await ensure_wallet(shop_id)
        if client_request_id:
            existing = await db.bag_free_allocations.find_one(
                {"client_request_id": client_request_id}, {"_id": 0},
            )
            if existing:
                return existing
        now = _utc_now()
        label = period_label(year, month)
        alloc_id = _uid()
        doc = {
            "id": alloc_id,
            "shop_id": shop_id,
            "shop_name": shop.get("shop_name"),
            "username": shop.get("username"),
            "mobile": shop.get("mobile"),
            "bags": int(bags),
            "year": int(year),
            "month": int(month),
            "period_label": label,
            "status": "PENDING",
            "reason": (reason or "").strip() or None,
            "allocated_at": now,
            "claimed_at": None,
            "claim_ref": None,
            "claim_transaction_id": None,
            "created_by_admin_id": admin.get("id"),
            "created_by_admin_username": admin.get("username"),
            "client_request_id": client_request_id,
        }
        try:
            await db.bag_free_allocations.insert_one(doc)
        except Exception:
            if client_request_id:
                again = await db.bag_free_allocations.find_one(
                    {"client_request_id": client_request_id}, {"_id": 0},
                )
                if again:
                    return again
            raise

        notif = {
            "id": _uid(),
            "shop_id": shop_id,
            "kind": "FREE_BAGS",
            "title": f"You have received {int(bags)} free bags",
            "body": f"You have received {int(bags)} free bags. Claim them now.",
            "action": "CLAIM_FREE_BAGS",
            "allocation_id": alloc_id,
            "bags": int(bags),
            "read": False,
            "created_at": now,
            "read_at": None,
        }
        await db.merchant_notifications.insert_one(notif)

        try:
            from admin_panel.audit import write_admin_audit

            await write_admin_audit(
                db,
                admin_user_id=admin.get("id"),
                admin_username=admin.get("username"),
                action="FREE_BAGS_ALLOCATE",
                resource_type="bag_free_allocation",
                resource_id=alloc_id,
                metadata={
                    "shop_id": shop_id,
                    "bags": int(bags),
                    "year": int(year),
                    "month": int(month),
                    "period_label": label,
                },
            )
        except Exception:
            pass

        doc.pop("_id", None)
        return doc

    @api.post("/admin/billing/free-allocations", response_model=FreeAllocationOut, status_code=201)
    async def admin_create_free_allocation(
        payload: FreeAllocationCreateIn,
        admin: dict = Depends(admin_auth),
    ):
        shop = await db.shops.find_one({"id": payload.shop_id}, {"_id": 0, "password_hash": 0})
        if not shop:
            raise HTTPException(404, "Merchant not found")
        req_id = (payload.client_request_id or "").strip() or None
        doc = await _create_one_allocation(
            shop=shop,
            bags=int(payload.bags),
            year=int(payload.year),
            month=int(payload.month),
            reason=payload.reason,
            admin=admin,
            client_request_id=req_id,
        )
        return _alloc_out(doc, shop)

    @api.post("/admin/billing/free-allocations/bulk", response_model=FreeAllocationBulkOut, status_code=201)
    async def admin_create_free_allocations_bulk(
        payload: FreeAllocationBulkIn,
        admin: dict = Depends(admin_auth),
    ):
        shop_ids = []
        seen = set()
        for sid in payload.shop_ids:
            s = (sid or "").strip()
            if not s or s in seen:
                continue
            seen.add(s)
            shop_ids.append(s)
        if not shop_ids:
            raise HTTPException(400, "Select at least one merchant")

        bulk_req = (payload.client_request_id or "").strip() or None
        if bulk_req:
            prior = await db.bag_free_bulk_requests.find_one({"client_request_id": bulk_req}, {"_id": 0})
            if prior and prior.get("allocation_ids"):
                docs = []
                for aid in prior["allocation_ids"]:
                    d = await db.bag_free_allocations.find_one({"id": aid}, {"_id": 0})
                    if d:
                        docs.append(_alloc_out(d))
                return FreeAllocationBulkOut(
                    created=docs,
                    count=len(docs),
                    bags_each=int(payload.bags),
                    client_request_id=bulk_req,
                )

        created: List[FreeAllocationOut] = []
        alloc_ids: List[str] = []
        for i, shop_id in enumerate(shop_ids):
            shop = await db.shops.find_one({"id": shop_id}, {"_id": 0, "password_hash": 0})
            if not shop:
                raise HTTPException(404, f"Merchant not found: {shop_id}")
            per_req = f"{bulk_req}:{shop_id}" if bulk_req else None
            doc = await _create_one_allocation(
                shop=shop,
                bags=int(payload.bags),
                year=int(payload.year),
                month=int(payload.month),
                reason=payload.reason,
                admin=admin,
                client_request_id=per_req,
            )
            created.append(_alloc_out(doc, shop))
            alloc_ids.append(doc["id"])

        if bulk_req:
            try:
                await db.bag_free_bulk_requests.insert_one(
                    {
                        "id": _uid(),
                        "client_request_id": bulk_req,
                        "allocation_ids": alloc_ids,
                        "shop_ids": shop_ids,
                        "bags": int(payload.bags),
                        "year": int(payload.year),
                        "month": int(payload.month),
                        "created_at": _utc_now(),
                        "created_by_admin_id": admin.get("id"),
                    }
                )
            except Exception:
                pass

        return FreeAllocationBulkOut(
            created=created,
            count=len(created),
            bags_each=int(payload.bags),
            client_request_id=bulk_req,
        )

    @api.get("/admin/billing/free-allocations", response_model=List[FreeAllocationOut])
    async def admin_list_free_allocations(
        admin: dict = Depends(admin_auth),
        shop_id: Optional[str] = Query(default=None),
        status: Optional[str] = Query(default=None),
        year: Optional[int] = Query(default=None, ge=2020, le=2100),
        month: Optional[int] = Query(default=None, ge=1, le=12),
        q: Optional[str] = Query(default=None),
        limit: int = Query(200, ge=1, le=1000),
    ):
        filt: Dict[str, Any] = {}
        if shop_id:
            filt["shop_id"] = shop_id
        if status:
            st = status.strip().upper()
            if st not in ALLOC_STATUSES:
                raise HTTPException(400, f"Invalid status. Use PENDING, CLAIMED, EXPIRED, or CANCELLED")
            if st in UNCLAIMED_STATUSES:
                filt["status"] = {"$in": list(UNCLAIMED_STATUSES)}
            else:
                filt["status"] = st
        if year is not None:
            filt["year"] = int(year)
        if month is not None:
            filt["month"] = int(month)
        if q and q.strip():
            term = q.strip()
            filt["$or"] = [
                {"shop_name": {"$regex": term, "$options": "i"}},
                {"username": {"$regex": term, "$options": "i"}},
                {"mobile": {"$regex": term, "$options": "i"}},
                {"shop_id": term},
            ]
        cur = db.bag_free_allocations.find(filt, {"_id": 0}).sort("allocated_at", -1).limit(limit)
        return [_alloc_out(d) async for d in cur]

    @api.get("/admin/billing/merchants/{shop_id}/free-summary", response_model=FreeSummaryOut)
    async def admin_merchant_free_summary(shop_id: str, admin: dict = Depends(admin_auth)):
        shop = await db.shops.find_one({"id": shop_id}, {"_id": 0, "id": 1})
        if not shop:
            raise HTTPException(404, "Merchant not found")
        free_used = await get_wallet_free_used(shop_id)
        return FreeSummaryOut(**(await free_summary_for_shop(db, shop_id, free_used=free_used)))

    @api.get("/admin/billing/merchant-search")
    async def admin_search_merchants_for_free_bags(
        admin: dict = Depends(admin_auth),
        q: str = Query("", max_length=80),
        limit: int = Query(50, ge=1, le=200),
    ):
        """Merchant picker for free-bag allocation — includes current usable balance."""
        term = (q or "").strip()
        filt: Dict[str, Any] = {}
        if term:
            filt["$or"] = [
                {"shop_name": {"$regex": term, "$options": "i"}},
                {"username": {"$regex": term, "$options": "i"}},
                {"owner_name": {"$regex": term, "$options": "i"}},
                {"mobile": {"$regex": term, "$options": "i"}},
                {"id": term},
            ]
        cur = (
            db.shops.find(
                filt,
                {
                    "_id": 0,
                    "password_hash": 0,
                    "id": 1,
                    "shop_name": 1,
                    "username": 1,
                    "owner_name": 1,
                    "mobile": 1,
                },
            )
            .sort("shop_name", 1)
            .limit(limit)
        )
        out = []
        async for s in cur:
            shop_id = s.get("id")
            w = await db.merchant_bag_wallets.find_one({"shop_id": shop_id}, {"_id": 0}) or {}
            free_alloc = int(w.get("free_allocated") or 0)
            free_used = int(w.get("free_used") or 0)
            purchased = int(w.get("purchased_total") or 0)
            purchased_used = int(w.get("purchased_used") or 0)
            free_rem = max(0, free_alloc - free_used)
            purchased_rem = max(0, purchased - purchased_used)
            total_available = free_rem + purchased_rem
            summary = await free_summary_for_shop(db, shop_id, free_used=free_used)
            out.append(
                {
                    "shop_id": shop_id,
                    "shop_name": s.get("shop_name"),
                    "username": s.get("username"),
                    "owner_name": s.get("owner_name"),
                    "mobile": s.get("mobile"),
                    "total_available": total_available,
                    "free_remaining": free_rem,
                    "purchased_remaining": purchased_rem,
                    "unclaimed_free_bags": summary["available_to_claim"],
                }
            )
        return out

    @api.get("/billing/free-allocations", response_model=List[FreeAllocationOut])
    async def merchant_list_free_allocations(
        user=Depends(owner_only),
        status: Optional[str] = Query(default=None),
        limit: int = Query(100, ge=1, le=500),
    ):
        filt: Dict[str, Any] = {"shop_id": user["shop_id"]}
        if status:
            st = status.strip().upper()
            if st not in ALLOC_STATUSES:
                raise HTTPException(400, "Invalid status. Use PENDING, CLAIMED, EXPIRED, or CANCELLED")
            if st in UNCLAIMED_STATUSES:
                filt["status"] = {"$in": list(UNCLAIMED_STATUSES)}
            else:
                filt["status"] = st
        cur = db.bag_free_allocations.find(filt, {"_id": 0}).sort("allocated_at", -1).limit(limit)
        return [_alloc_out(d) async for d in cur]

    @api.get("/billing/free-summary", response_model=FreeSummaryOut)
    async def merchant_free_summary(user=Depends(owner_only)):
        free_used = await get_wallet_free_used(user["shop_id"])
        return FreeSummaryOut(**(await free_summary_for_shop(db, user["shop_id"], free_used=free_used)))

    @api.post("/billing/free-allocations/{allocation_id}/claim", response_model=FreeAllocationOut)
    async def merchant_claim_free_allocation(allocation_id: str, user=Depends(owner_only)):
        shop_id = user["shop_id"]
        await ensure_wallet(shop_id)

        # Atomic claim — only one concurrent request can transition PENDING/AVAILABLE → CLAIMED.
        now = _utc_now()
        claim_ref = f"FREE-{allocation_id.replace('-', '')[:10].upper()}"
        claim_txn = _uid()
        claimed = await db.bag_free_allocations.find_one_and_update(
            {"id": allocation_id, "shop_id": shop_id, "status": {"$in": list(UNCLAIMED_STATUSES)}},
            {
                "$set": {
                    "status": "CLAIMED",
                    "claimed_at": now,
                    "claim_ref": claim_ref,
                    "claim_transaction_id": claim_txn,
                    "updated_at": now,
                }
            },
            return_document=True,
            projection={"_id": 0},
        )

        if not claimed:
            existing = await db.bag_free_allocations.find_one(
                {"id": allocation_id, "shop_id": shop_id}, {"_id": 0},
            )
            if not existing:
                # Do not leak other shops' allocation ids
                raise HTTPException(404, "Free bag allocation not found")
            st = _normalize_status(existing.get("status"))
            if st == "CLAIMED":
                # Idempotent: ensure credit/usage exist (repair if needed)
                await _credit_claimed_bags(
                    db,
                    shop_id=shop_id,
                    bags=int(existing["bags"]),
                    allocation_id=allocation_id,
                    user_id=user.get("id"),
                )
                return _alloc_out(existing)
            if st == "CANCELLED":
                raise HTTPException(400, "This free bag allocation was cancelled")
            if st == "EXPIRED":
                raise HTTPException(400, "This free bag allocation has expired")
            raise HTTPException(400, f"Cannot claim allocation in status {st}")

        await _credit_claimed_bags(
            db,
            shop_id=shop_id,
            bags=int(claimed["bags"]),
            allocation_id=allocation_id,
            user_id=user.get("id"),
        )

        # Mark related notifications read
        await db.merchant_notifications.update_many(
            {"shop_id": shop_id, "allocation_id": allocation_id, "read": False},
            {"$set": {"read": True, "read_at": now}},
        )
        return _alloc_out(claimed)

    @api.get("/billing/notifications", response_model=List[NotificationOut])
    async def merchant_list_notifications(
        user=Depends(owner_only),
        unread_only: bool = Query(False),
        limit: int = Query(50, ge=1, le=200),
    ):
        filt: Dict[str, Any] = {"shop_id": user["shop_id"]}
        if unread_only:
            filt["read"] = False
        cur = db.merchant_notifications.find(filt, {"_id": 0}).sort("created_at", -1).limit(limit)
        return [NotificationOut(**d) async for d in cur]

    @api.get("/billing/notifications/unread-count")
    async def merchant_unread_notification_count(user=Depends(owner_only)):
        n = await db.merchant_notifications.count_documents({"shop_id": user["shop_id"], "read": False})
        return {"unread": int(n)}

    @api.post("/billing/notifications/{notification_id}/read", response_model=NotificationOut)
    async def merchant_mark_notification_read(notification_id: str, user=Depends(owner_only)):
        now = _utc_now()
        doc = await db.merchant_notifications.find_one_and_update(
            {"id": notification_id, "shop_id": user["shop_id"]},
            {"$set": {"read": True, "read_at": now}},
            return_document=True,
            projection={"_id": 0},
        )
        if not doc:
            raise HTTPException(404, "Notification not found")
        return NotificationOut(**doc)
