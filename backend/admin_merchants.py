"""Platform admin merchant management — cross-shop read/update for external admin panel."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from admin_auth import write_admin_audit_log

SENSITIVE_SHOP_KEYS = frozenset({"password_hash"})

SHOP_PROFILE_KEYS = (
    "shop_name",
    "owner_name",
    "mobile",
    "alt_mobile",
    "email",
    "address",
    "village",
    "taluk",
    "district",
    "state",
    "gst_number",
    "pan_number",
    "bank_name",
    "bank_account_holder",
    "bank_account_number",
    "bank_ifsc",
    "bank_branch",
    "upi_id",
)


class WalletSummaryOut(BaseModel):
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


class MerchantListItemOut(BaseModel):
    shop_id: str
    shop_name: Optional[str] = None
    username: Optional[str] = None
    active: bool
    created_at: Optional[datetime] = None
    owner_name: Optional[str] = None
    email: Optional[str] = None
    mobile: Optional[str] = None
    wallet: Optional[WalletSummaryOut] = None


class MerchantListOut(BaseModel):
    items: List[MerchantListItemOut]
    total: int
    page: int
    limit: int


class MerchantActivePatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    active: bool


class MerchantDetailOut(BaseModel):
    shop_id: str
    username: Optional[str] = None
    active: bool
    created_at: Optional[datetime] = None
    profile: Dict[str, Any]
    wallet: Optional[WalletSummaryOut] = None
    staff_count: int = 0
    recent_purchases: List[Dict[str, Any]] = Field(default_factory=list)
    recent_usage: List[Dict[str, Any]] = Field(default_factory=list)


class MerchantWalletOut(BaseModel):
    shop_id: str
    wallet: WalletSummaryOut


class PaginatedRecordsOut(BaseModel):
    shop_id: str
    items: List[Dict[str, Any]]
    total: int
    page: int
    limit: int


def _shop_search_text(shop: dict) -> str:
    parts = [
        shop.get("shop_name"),
        shop.get("username"),
        shop.get("owner_name"),
        shop.get("email"),
        shop.get("mobile"),
    ]
    return " ".join(str(p) for p in parts if p).lower()


def shop_public_dict(shop: dict, *, include_large_media: bool = False) -> dict:
    """Return merchant fields safe for admin API — never includes password_hash."""
    out: Dict[str, Any] = {
        "shop_id": shop["id"],
        "username": shop.get("username"),
        "active": bool(shop.get("active", True)),
        "created_at": shop.get("created_at"),
    }
    for key in SHOP_PROFILE_KEYS:
        if key in shop:
            out[key] = shop.get(key)
    if include_large_media:
        for key in ("logo_base64", "upi_qr_base64"):
            if key in shop:
                out[key] = shop.get(key)
    for key in SENSITIVE_SHOP_KEYS:
        out.pop(key, None)
    return out


def _split_used(free_alloc: int, purchased: int, used: int) -> tuple[int, int]:
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
    total_available = free_rem + purchased_rem
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


async def _active_patti_bags_used(db, shop_id: str) -> int:
    total = 0
    async for patti in db.pattis.find({"shop_id": shop_id}, {"_id": 0, "total_bags": 1, "deleted": 1}):
        if patti.get("deleted"):
            continue
        total += int(patti.get("total_bags") or 0)
    return max(0, total)


async def _get_platform_price(db) -> float:
    try:
        import billing as billing_mod

        if getattr(billing_mod, "get_platform_settings", None):
            settings = await billing_mod.get_platform_settings()
            return float(settings.get("price_per_bag") or 0)
    except Exception:
        pass
    doc = await db.platform_billing_settings.find_one({"id": "default"}, {"_id": 0})
    return float((doc or {}).get("price_per_bag") or 0)


async def _wallet_summary(db, shop_id: str) -> Optional[dict]:
    wallet = await db.merchant_bag_wallets.find_one({"shop_id": shop_id}, {"_id": 0})
    if not wallet:
        return None
    price = await _get_platform_price(db)
    used = await _active_patti_bags_used(db, shop_id)
    return _wallet_view_from_parts(
        shop_id=shop_id,
        free_alloc=int(wallet.get("free_allocated") or 0),
        purchased=int(wallet.get("purchased_total") or 0),
        used=used,
        price=price,
    )


async def _wallet_summary_readonly(db, shop_id: str) -> dict:
    """Read-only wallet view — never creates or mutates wallet documents."""
    summary = await _wallet_summary(db, shop_id)
    if summary:
        return summary
    price = await _get_platform_price(db)
    used = await _active_patti_bags_used(db, shop_id)
    return _wallet_view_from_parts(
        shop_id=shop_id,
        free_alloc=0,
        purchased=0,
        used=used,
        price=price,
    )


async def _require_shop(db, shop_id: str) -> dict:
    shop = await db.shops.find_one({"id": shop_id}, {"_id": 0, "password_hash": 0})
    if not shop:
        raise HTTPException(404, "Merchant not found")
    return shop


def _paginate_rows(rows: List[dict], page: int, limit: int) -> tuple[List[dict], int]:
    total = len(rows)
    start = (page - 1) * limit
    return rows[start : start + limit], total


async def _sorted_shop_rows(db, collection: str, shop_id: str, sort_key: str) -> List[dict]:
    rows: List[dict] = []
    cursor = getattr(db, collection).find({"shop_id": shop_id}, {"_id": 0})
    if hasattr(cursor, "sort"):
        cursor = cursor.sort(sort_key, -1)
    async for row in cursor:
        rows.append(row)
    rows.sort(key=lambda r: r.get(sort_key) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return rows


async def _load_shops(db, *, active: Optional[bool] = None) -> List[dict]:
    query: dict = {}
    if active is not None:
        query["active"] = active
    shops: List[dict] = []
    async for shop in db.shops.find(query, {"_id": 0, "password_hash": 0}):
        shops.append(shop)
    return shops


def _filter_shops_by_query(shops: List[dict], q: Optional[str]) -> List[dict]:
    if not q or not q.strip():
        return shops
    needle = q.strip().lower()
    return [s for s in shops if needle in _shop_search_text(s)]


def _sort_shops_newest(shops: List[dict]) -> List[dict]:
    return sorted(shops, key=lambda s: s.get("created_at") or datetime.min.replace(tzinfo=timezone.utc), reverse=True)


async def _merchant_detail(db, shop_id: str) -> MerchantDetailOut:
    shop = await db.shops.find_one({"id": shop_id}, {"_id": 0, "password_hash": 0})
    if not shop:
        raise HTTPException(404, "Merchant not found")

    pub = shop_public_dict(shop, include_large_media=True)
    wallet_raw = await _wallet_summary(db, shop_id)
    wallet = WalletSummaryOut(**wallet_raw) if wallet_raw else None
    staff_count = await db.staff.count_documents({"shop_id": shop_id, "active": True})
    purchases = await _recent_purchases(db, shop_id, limit=10)
    usage = await _recent_usage(db, shop_id, limit=20)

    profile = {k: v for k, v in pub.items() if k not in ("shop_id", "username", "active", "created_at")}
    return MerchantDetailOut(
        shop_id=shop_id,
        username=pub.get("username"),
        active=pub["active"],
        created_at=pub.get("created_at"),
        profile=profile,
        wallet=wallet,
        staff_count=int(staff_count or 0),
        recent_purchases=purchases,
        recent_usage=usage,
    )


async def _recent_purchases(db, shop_id: str, limit: int = 10) -> List[dict]:
    rows = await _sorted_shop_rows(db, "bag_purchases", shop_id, "created_at")
    return rows[:limit]


async def _recent_usage(db, shop_id: str, limit: int = 20) -> List[dict]:
    rows = await _sorted_shop_rows(db, "bag_usage", shop_id, "at")
    return rows[:limit]


async def _paginated_purchases(db, shop_id: str, page: int, limit: int) -> PaginatedRecordsOut:
    rows = await _sorted_shop_rows(db, "bag_purchases", shop_id, "created_at")
    page_rows, total = _paginate_rows(rows, page, limit)
    return PaginatedRecordsOut(
        shop_id=shop_id,
        items=page_rows,
        total=total,
        page=page,
        limit=limit,
    )


async def _paginated_usage(db, shop_id: str, page: int, limit: int) -> PaginatedRecordsOut:
    rows = await _sorted_shop_rows(db, "bag_usage", shop_id, "at")
    page_rows, total = _paginate_rows(rows, page, limit)
    return PaginatedRecordsOut(
        shop_id=shop_id,
        items=page_rows,
        total=total,
        page=page,
        limit=limit,
    )


def register_admin_merchant_routes(
    api: APIRouter,
    db,
    admin_only: Callable,
) -> None:
    """Register /api/admin/merchants routes (requires admin JWT via admin_only)."""

    @api.get("/admin/merchants", response_model=MerchantListOut)
    async def list_merchants(
        admin=Depends(admin_only),
        q: Optional[str] = Query(default=None, max_length=120),
        active: Optional[bool] = Query(default=None),
        page: int = Query(default=1, ge=1),
        limit: int = Query(default=50, ge=1, le=200),
    ):
        del admin
        shops = await _load_shops(db, active=active)
        shops = _filter_shops_by_query(shops, q)
        shops = _sort_shops_newest(shops)
        total = len(shops)
        start = (page - 1) * limit
        page_rows = shops[start : start + limit]

        items: List[MerchantListItemOut] = []
        for shop in page_rows:
            pub = shop_public_dict(shop)
            wallet_raw = await _wallet_summary(db, shop["id"])
            wallet = WalletSummaryOut(**wallet_raw) if wallet_raw else None
            items.append(
                MerchantListItemOut(
                    shop_id=pub["shop_id"],
                    shop_name=pub.get("shop_name"),
                    username=pub.get("username"),
                    active=pub["active"],
                    created_at=pub.get("created_at"),
                    owner_name=pub.get("owner_name"),
                    email=pub.get("email"),
                    mobile=pub.get("mobile"),
                    wallet=wallet,
                )
            )
        return MerchantListOut(items=items, total=total, page=page, limit=limit)

    @api.get("/admin/merchants/{shop_id}", response_model=MerchantDetailOut)
    async def get_merchant(shop_id: str, admin=Depends(admin_only)):
        del admin
        return await _merchant_detail(db, shop_id)

    @api.patch("/admin/merchants/{shop_id}", response_model=MerchantDetailOut)
    async def patch_merchant(
        shop_id: str,
        body: MerchantActivePatchIn,
        request: Request,
        admin=Depends(admin_only),
    ):
        shop = await db.shops.find_one({"id": shop_id}, {"_id": 0})
        if not shop:
            raise HTTPException(404, "Merchant not found")

        before_active = bool(shop.get("active", True))
        if before_active == body.active:
            return await _merchant_detail(db, shop_id)

        now = datetime.now(timezone.utc)
        await db.shops.update_one(
            {"id": shop_id},
            {"$set": {"active": body.active, "updated_at": now}},
        )

        await write_admin_audit_log(
            db,
            admin_id=admin["id"],
            admin_username=admin["username"],
            action="MERCHANT_ACTIVE_UPDATED",
            resource_type="shop",
            resource_id=shop_id,
            shop_id=shop_id,
            before={"active": before_active},
            after={"active": body.active},
            ip=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )

        return await _merchant_detail(db, shop_id)

    @api.get("/admin/merchants/{shop_id}/wallet", response_model=MerchantWalletOut)
    async def get_merchant_wallet(shop_id: str, admin=Depends(admin_only)):
        del admin
        await _require_shop(db, shop_id)
        wallet_raw = await _wallet_summary_readonly(db, shop_id)
        return MerchantWalletOut(shop_id=shop_id, wallet=WalletSummaryOut(**wallet_raw))

    @api.get("/admin/merchants/{shop_id}/purchases", response_model=PaginatedRecordsOut)
    async def list_merchant_purchases(
        shop_id: str,
        admin=Depends(admin_only),
        page: int = Query(default=1, ge=1),
        limit: int = Query(default=50, ge=1, le=500),
    ):
        del admin
        await _require_shop(db, shop_id)
        return await _paginated_purchases(db, shop_id, page, limit)

    @api.get("/admin/merchants/{shop_id}/usage", response_model=PaginatedRecordsOut)
    async def list_merchant_usage(
        shop_id: str,
        admin=Depends(admin_only),
        page: int = Query(default=1, ge=1),
        limit: int = Query(default=100, ge=1, le=1000),
    ):
        del admin
        await _require_shop(db, shop_id)
        return await _paginated_usage(db, shop_id, page, limit)
