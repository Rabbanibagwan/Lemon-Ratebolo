"""Platform admin HTTP routes."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials

from admin_panel.auth import admin_bearer, require_platform_admin
from admin_panel.dates import ist_range_utc_window, resolve_date_range
from admin_panel import queries
from admin_panel.schemas import (
    ActivityListOut,
    ActivityRow,
    AuditLogItem,
    AuditLogOut,
    DashboardOut,
    MerchantDetailOut,
    MerchantListItem,
    MerchantListOut,
    PattiListItem,
    PattiListOut,
    PurchaseListItem,
    PurchaseListOut,
    ReportMerchantDailyOut,
    ReportMerchantDailyRow,
    VendorBillListItem,
    VendorBillListOut,
)


def _page_args(page: int, page_size: int) -> tuple[int, int, int]:
    page = max(1, page)
    page_size = max(1, min(200, page_size))
    offset = (page - 1) * page_size
    return page, page_size, offset


async def _shop_name_map(db, shop_ids: List[str]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if not shop_ids:
        return out
    async for s in db.shops.find({"id": {"$in": list(set(shop_ids))}}, {"_id": 0, "id": 1, "shop_name": 1}):
        out[s["id"]] = s.get("shop_name") or s["id"]
    return out


def register_admin_routes(api: APIRouter, db) -> None:
    async def admin_dep(
        creds: Optional[HTTPAuthorizationCredentials] = Depends(admin_bearer),
        x_admin_key: Optional[str] = Header(default=None, alias="X-Admin-Key"),
    ):
        token = creds.credentials if creds else None
        return await require_platform_admin(db, token=token, x_admin_key=x_admin_key)

    # ----- Dashboard -----
    @api.get("/admin/dashboard", response_model=DashboardOut)
    async def admin_dashboard(
        admin=Depends(admin_dep),
        date: Optional[str] = None,
        date_from: Optional[str] = Query(default=None, alias="from"),
        date_to: Optional[str] = Query(default=None, alias="to"),
        shop_id: Optional[str] = None,
    ):
        d_from, d_to = resolve_date_range(date, date_from, date_to)
        if shop_id:
            shop = await db.shops.find_one({"id": shop_id}, {"_id": 0, "id": 1})
            if not shop:
                raise HTTPException(404, "Merchant not found")
        data = await queries.build_dashboard(db, date_from=d_from, date_to=d_to, shop_id=shop_id)
        return DashboardOut.model_validate(data)

    @api.get("/admin/operations/summary", response_model=ActivityListOut)
    async def operations_summary(
        admin=Depends(admin_dep),
        date: Optional[str] = None,
        date_from: Optional[str] = Query(default=None, alias="from"),
        date_to: Optional[str] = Query(default=None, alias="to"),
        page: int = Query(1, ge=1),
        page_size: int = Query(50, ge=1, le=200),
    ):
        d_from, d_to = resolve_date_range(date, date_from, date_to)
        page, page_size, offset = _page_args(page, page_size)
        rows, total = await queries.merchant_day_activity_rows(
            db, date_from=d_from, date_to=d_to, limit=page_size, offset=offset
        )
        return ActivityListOut.model_validate(
            {
                "items": [ActivityRow(**r).model_dump() for r in rows],
                "page": page,
                "page_size": page_size,
                "total_count": total,
                "from": d_from,
                "to": d_to,
            }
        )

    # ----- Merchants -----
    @api.get("/admin/merchants", response_model=MerchantListOut)
    async def list_merchants(
        admin=Depends(admin_dep),
        q: Optional[str] = None,
        page: int = Query(1, ge=1),
        page_size: int = Query(50, ge=1, le=200),
        date: Optional[str] = None,
        date_from: Optional[str] = Query(default=None, alias="from"),
        date_to: Optional[str] = Query(default=None, alias="to"),
        active: Optional[bool] = None,
    ):
        page, page_size, offset = _page_args(page, page_size)
        match: Dict[str, Any] = {}
        if active is not None:
            match["active"] = active
        if q and q.strip():
            s = re.escape(q.strip())
            match["$or"] = [
                {"shop_name": {"$regex": s, "$options": "i"}},
                {"username": {"$regex": s, "$options": "i"}},
                {"owner_name": {"$regex": s, "$options": "i"}},
            ]
        total = int(await db.shops.count_documents(match))
        cur = (
            db.shops.find(match, {"_id": 0, "password_hash": 0})
            .sort("shop_name", 1)
            .skip(offset)
            .limit(page_size)
        )
        items: List[MerchantListItem] = []
        day_metrics = None
        if date or date_from or date_to:
            d_from, d_to = resolve_date_range(date, date_from, date_to)
            day_metrics = True
        async for shop in cur:
            row = MerchantListItem(
                shop_id=shop["id"],
                shop_name=shop.get("shop_name"),
                username=shop.get("username"),
                active=shop.get("active"),
                owner_name=shop.get("owner_name"),
                mobile=shop.get("mobile"),
                village=shop.get("village"),
                district=shop.get("district"),
                state=shop.get("state"),
                created_at=shop.get("created_at"),
            )
            if day_metrics:
                dash = await queries.build_dashboard(
                    db, date_from=d_from, date_to=d_to, shop_id=shop["id"]
                )
                row.farmer_pattis = dash["farmer_pattis"]
                row.farmer_bags = dash["farmer_bags"]
                row.vendor_bills = dash["vendor_bills"]
                row.purchased_bags = dash["purchased_bags"]
            items.append(row)
        return MerchantListOut(items=items, page=page, page_size=page_size, total_count=total)

    @api.get("/admin/merchants/{shop_id}", response_model=MerchantDetailOut)
    async def merchant_detail(
        shop_id: str,
        admin=Depends(admin_dep),
        date: Optional[str] = None,
        date_from: Optional[str] = Query(default=None, alias="from"),
        date_to: Optional[str] = Query(default=None, alias="to"),
    ):
        shop = await db.shops.find_one({"id": shop_id}, {"_id": 0, "password_hash": 0})
        if not shop:
            raise HTTPException(404, "Merchant not found")
        d_from, d_to = resolve_date_range(date, date_from, date_to)
        dash = await queries.build_dashboard(db, date_from=d_from, date_to=d_to, shop_id=shop_id)
        return MerchantDetailOut(
            shop_id=shop["id"],
            shop_name=shop.get("shop_name"),
            username=shop.get("username"),
            active=shop.get("active"),
            owner_name=shop.get("owner_name"),
            mobile=shop.get("mobile"),
            alt_mobile=shop.get("alt_mobile"),
            email=shop.get("email"),
            address=shop.get("address"),
            village=shop.get("village"),
            taluk=shop.get("taluk"),
            district=shop.get("district"),
            state=shop.get("state"),
            gst_number=shop.get("gst_number"),
            created_at=shop.get("created_at"),
            dashboard=DashboardOut.model_validate(dash),
        )

    # ----- Pattis -----
    @api.get("/admin/pattis", response_model=PattiListOut)
    async def list_pattis(
        admin=Depends(admin_dep),
        date: Optional[str] = None,
        date_from: Optional[str] = Query(default=None, alias="from"),
        date_to: Optional[str] = Query(default=None, alias="to"),
        shop_id: Optional[str] = None,
        q: Optional[str] = None,
        include_deleted: bool = False,
        page: int = Query(1, ge=1),
        page_size: int = Query(50, ge=1, le=200),
    ):
        d_from, d_to = resolve_date_range(date, date_from, date_to)
        page, page_size, offset = _page_args(page, page_size)
        match: Dict[str, Any] = {**queries.business_date_match(d_from, d_to)}
        if not include_deleted:
            match["deleted"] = {"$ne": True}
        if shop_id:
            match["shop_id"] = shop_id
        if q and q.strip():
            s = q.strip()
            or_clauses: List[dict] = [
                {"farmer_name": {"$regex": re.escape(s), "$options": "i"}},
            ]
            digits = "".join(ch for ch in s if ch.isdigit())
            if digits:
                try:
                    or_clauses.append({"patti_no": int(digits)})
                except ValueError:
                    pass
            match["$or"] = or_clauses
        total = int(await db.pattis.count_documents(match))
        cur = (
            db.pattis.find(match, {"_id": 0})
            .sort([("date", -1), ("patti_no", -1)])
            .skip(offset)
            .limit(page_size)
        )
        docs = [d async for d in cur]
        names = await _shop_name_map(db, [d.get("shop_id") for d in docs if d.get("shop_id")])
        items = [
            PattiListItem(
                id=d["id"],
                shop_id=d["shop_id"],
                shop_name=names.get(d["shop_id"]),
                date=d.get("date") or "",
                patti_no=int(d.get("patti_no") or 0),
                farmer_id=d.get("farmer_id") or "",
                farmer_name=d.get("farmer_name") or "",
                total_bags=int(d.get("total_bags") or 0),
                gross_total=float(d.get("gross_total") or 0),
                net_payable=float(d.get("net_payable") or 0),
                status=d.get("status") or "",
                deleted=bool(d.get("deleted")),
            )
            for d in docs
        ]
        return PattiListOut(items=items, page=page, page_size=page_size, total_count=total)

    @api.get("/admin/pattis/{patti_id}")
    async def get_patti(patti_id: str, admin=Depends(admin_dep)):
        d = await db.pattis.find_one({"id": patti_id}, {"_id": 0})
        if not d:
            raise HTTPException(404, "Patti not found")
        # Strip nothing critical; omit huge nested noise if needed later
        return d

    # ----- Vendor bills -----
    @api.get("/admin/vendor-bills", response_model=VendorBillListOut)
    async def list_vendor_bills(
        admin=Depends(admin_dep),
        date: Optional[str] = None,
        date_from: Optional[str] = Query(default=None, alias="from"),
        date_to: Optional[str] = Query(default=None, alias="to"),
        shop_id: Optional[str] = None,
        vendor_id: Optional[str] = None,
        q: Optional[str] = None,
        include_deleted: bool = False,
        page: int = Query(1, ge=1),
        page_size: int = Query(50, ge=1, le=200),
    ):
        d_from, d_to = resolve_date_range(date, date_from, date_to)
        page, page_size, offset = _page_args(page, page_size)
        match: Dict[str, Any] = {**queries.business_date_match(d_from, d_to)}
        if not include_deleted:
            match["deleted"] = {"$ne": True}
        if shop_id:
            match["shop_id"] = shop_id
        if vendor_id:
            match["vendor_id"] = vendor_id
        if q and q.strip():
            s = re.escape(q.strip())
            match["$or"] = [
                {"bill_code": {"$regex": s, "$options": "i"}},
                {"vendor_name": {"$regex": s, "$options": "i"}},
            ]
        total = int(await db.vendor_bills.count_documents(match))
        cur = (
            db.vendor_bills.find(match, {"_id": 0})
            .sort([("date", -1), ("bill_no", -1)])
            .skip(offset)
            .limit(page_size)
        )
        docs = [d async for d in cur]
        names = await _shop_name_map(db, [d.get("shop_id") for d in docs if d.get("shop_id")])
        items = [
            VendorBillListItem(
                id=d["id"],
                shop_id=d["shop_id"],
                shop_name=names.get(d["shop_id"]),
                date=d.get("date") or "",
                bill_no=int(d.get("bill_no") or 0),
                bill_code=d.get("bill_code") or "",
                vendor_id=d.get("vendor_id") or "",
                vendor_name=d.get("vendor_name") or "",
                total_bags=int(d.get("total_bags") or 0),
                grand_total=float(d.get("grand_total") or 0),
                status=d.get("status") or "",
                deleted=bool(d.get("deleted")),
            )
            for d in docs
        ]
        return VendorBillListOut(items=items, page=page, page_size=page_size, total_count=total)

    @api.get("/admin/vendor-bills/{bill_id}")
    async def get_vendor_bill(bill_id: str, admin=Depends(admin_dep)):
        d = await db.vendor_bills.find_one({"id": bill_id}, {"_id": 0})
        if not d:
            raise HTTPException(404, "Vendor bill not found")
        return d

    # ----- Purchases -----
    @api.get("/admin/purchases", response_model=PurchaseListOut)
    async def list_purchases(
        admin=Depends(admin_dep),
        date: Optional[str] = None,
        date_from: Optional[str] = Query(default=None, alias="from"),
        date_to: Optional[str] = Query(default=None, alias="to"),
        shop_id: Optional[str] = None,
        status: Optional[str] = Query(default="PAID"),
        page: int = Query(1, ge=1),
        page_size: int = Query(50, ge=1, le=200),
    ):
        d_from, d_to = resolve_date_range(date, date_from, date_to)
        page, page_size, offset = _page_args(page, page_size)
        start, end = ist_range_utc_window(d_from, d_to)
        match: Dict[str, Any] = {}
        if status:
            match["status"] = status
        if shop_id:
            match["shop_id"] = shop_id

        pipeline: List[dict] = [
            {"$match": match},
            {"$addFields": {"_event_at": {"$ifNull": ["$paid_at", "$created_at"]}}},
            {"$match": {"_event_at": {"$gte": start, "$lt": end}}},
            {"$sort": {"_event_at": -1}},
            {
                "$facet": {
                    "items": [{"$skip": offset}, {"$limit": page_size}],
                    "total": [{"$count": "n"}],
                }
            },
        ]
        facet = await db.bag_purchases.aggregate(pipeline).to_list(1)
        facet = facet[0] if facet else {"items": [], "total": []}
        docs = facet.get("items") or []
        total = int((facet.get("total") or [{"n": 0}])[0].get("n") or 0)
        names = await _shop_name_map(db, [d.get("shop_id") for d in docs if d.get("shop_id")])
        items = []
        for d in docs:
            d.pop("_id", None)
            items.append(
                PurchaseListItem(
                    id=d["id"],
                    shop_id=d["shop_id"],
                    shop_name=names.get(d["shop_id"]),
                    bags=int(d.get("bags") or 0),
                    price_per_bag=float(d.get("price_per_bag") or 0),
                    base_amount=float(d.get("base_amount") or 0),
                    gst_percent=float(d.get("gst_percent") or 0),
                    gst_amount=float(d.get("gst_amount") or 0),
                    total_amount=float(d.get("total_amount") or 0),
                    status=d.get("status") or "",
                    invoice_no=d.get("invoice_no") or None,
                    created_at=d.get("created_at"),
                    paid_at=d.get("paid_at"),
                    event_at=d.get("_event_at"),
                )
            )
        return PurchaseListOut(items=items, page=page, page_size=page_size, total_count=total)

    @api.get("/admin/purchases/{purchase_id}")
    async def get_purchase(purchase_id: str, admin=Depends(admin_dep)):
        d = await db.bag_purchases.find_one({"id": purchase_id}, {"_id": 0})
        if not d:
            raise HTTPException(404, "Purchase not found")
        return d

    # ----- Reports -----
    @api.get("/admin/reports/merchant-wise", response_model=ReportMerchantDailyOut)
    async def report_merchant_wise(
        admin=Depends(admin_dep),
        date: Optional[str] = None,
        date_from: Optional[str] = Query(default=None, alias="from"),
        date_to: Optional[str] = Query(default=None, alias="to"),
    ):
        d_from, d_to = resolve_date_range(date, date_from, date_to)
        rows, _ = await queries.merchant_day_activity_rows(
            db, date_from=d_from, date_to=d_to, limit=10_000, offset=0
        )
        return ReportMerchantDailyOut.model_validate(
            {
                "from": d_from,
                "to": d_to,
                "items": [ReportMerchantDailyRow(**r).model_dump() for r in rows],
            }
        )

    @api.get("/admin/reports/daily", response_model=DashboardOut)
    async def report_daily(
        admin=Depends(admin_dep),
        date: Optional[str] = None,
        date_from: Optional[str] = Query(default=None, alias="from"),
        date_to: Optional[str] = Query(default=None, alias="to"),
        shop_id: Optional[str] = None,
    ):
        d_from, d_to = resolve_date_range(date, date_from, date_to)
        data = await queries.build_dashboard(db, date_from=d_from, date_to=d_to, shop_id=shop_id)
        return DashboardOut.model_validate(data)

    @api.get("/admin/reports/patti-register", response_model=PattiListOut)
    async def report_patti_register(
        admin=Depends(admin_dep),
        date: Optional[str] = None,
        date_from: Optional[str] = Query(default=None, alias="from"),
        date_to: Optional[str] = Query(default=None, alias="to"),
        shop_id: Optional[str] = None,
        page: int = Query(1, ge=1),
        page_size: int = Query(100, ge=1, le=200),
    ):
        return await list_pattis(
            admin=admin,
            date=date,
            date_from=date_from,
            date_to=date_to,
            shop_id=shop_id,
            page=page,
            page_size=page_size,
        )

    # ----- Audit -----
    @api.get("/admin/audit-log", response_model=AuditLogOut)
    async def audit_log(
        admin=Depends(admin_dep),
        page: int = Query(1, ge=1),
        page_size: int = Query(50, ge=1, le=200),
    ):
        page, page_size, offset = _page_args(page, page_size)
        total = int(await db.platform_admin_audit_log.count_documents({}))
        cur = (
            db.platform_admin_audit_log.find({}, {"_id": 0})
            .sort("created_at", -1)
            .skip(offset)
            .limit(page_size)
        )
        items = [AuditLogItem(**d) async for d in cur]
        return AuditLogOut(items=items, page=page, page_size=page_size, total_count=total)

    # Log settings reads are optional; PUT is in billing dual-auth path.
    @api.get("/admin/health")
    async def admin_health(admin=Depends(admin_dep)):
        return {"ok": True, "admin": admin.get("username"), "auth_via": admin.get("_auth_via")}
