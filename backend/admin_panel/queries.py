"""Shared aggregations matching merchant mobile dashboard business logic."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from admin_panel.dates import ist_range_utc_window


def _round2(v: float) -> float:
    return round(float(v) + 1e-9, 2)


def business_date_match(date_from: str, date_to: str) -> Dict[str, Any]:
    if date_from == date_to:
        return {"date": date_from}
    return {"date": {"$gte": date_from, "$lte": date_to}}


async def sum_patti_bags_and_count(
    db,
    *,
    date_from: str,
    date_to: str,
    shop_id: Optional[str] = None,
) -> Dict[str, int]:
    """Same logic as merchant GET /dashboard for today_pattis / today_bags."""
    match: Dict[str, Any] = {
        "deleted": {"$ne": True},
        **business_date_match(date_from, date_to),
    }
    if shop_id:
        match["shop_id"] = shop_id
    rows = await db.pattis.aggregate(
        [
            {"$match": match},
            {
                "$group": {
                    "_id": None,
                    "patti_count": {"$sum": 1},
                    "bag_count": {"$sum": {"$ifNull": ["$total_bags", 0]}},
                    "farmer_ids": {"$addToSet": "$farmer_id"},
                }
            },
        ]
    ).to_list(1)
    if not rows:
        return {"farmer_pattis": 0, "farmer_bags": 0, "farmers_with_patti": 0}
    r = rows[0]
    return {
        "farmer_pattis": int(r.get("patti_count") or 0),
        "farmer_bags": int(r.get("bag_count") or 0),
        "farmers_with_patti": len(r.get("farmer_ids") or []),
    }


async def count_vendor_bills(
    db,
    *,
    date_from: str,
    date_to: str,
    shop_id: Optional[str] = None,
) -> int:
    match: Dict[str, Any] = {
        "deleted": {"$ne": True},
        **business_date_match(date_from, date_to),
    }
    if shop_id:
        match["shop_id"] = shop_id
    return int(await db.vendor_bills.count_documents(match))


async def sum_purchased_bags(
    db,
    *,
    date_from: str,
    date_to: str,
    shop_id: Optional[str] = None,
) -> int:
    """PAID bag_purchases in IST window on paid_at, fallback created_at.

    A purchase counts once: prefer paid_at if present, else created_at.
    Uses $ifNull so we do not double-count.
    """
    start, end = ist_range_utc_window(date_from, date_to)
    match: Dict[str, Any] = {"status": "PAID"}
    if shop_id:
        match["shop_id"] = shop_id

    pipeline = [
        {"$match": match},
        {
            "$addFields": {
                "_event_at": {"$ifNull": ["$paid_at", "$created_at"]},
            }
        },
        {"$match": {"_event_at": {"$gte": start, "$lt": end}}},
        {
            "$group": {
                "_id": None,
                "bags": {"$sum": {"$ifNull": ["$bags", 0]}},
            }
        },
    ]
    rows = await db.bag_purchases.aggregate(pipeline).to_list(1)
    return int((rows[0]["bags"] if rows else 0) or 0)


async def count_vendors_with_bills(
    db,
    *,
    date_from: str,
    date_to: str,
    shop_id: Optional[str] = None,
) -> int:
    match: Dict[str, Any] = {
        "deleted": {"$ne": True},
        **business_date_match(date_from, date_to),
    }
    if shop_id:
        match["shop_id"] = shop_id
    ids = await db.vendor_bills.distinct("vendor_id", match)
    return len(ids)


async def directory_counts(db, *, shop_id: Optional[str] = None) -> Dict[str, int]:
    f_q: Dict[str, Any] = {}
    v_q: Dict[str, Any] = {}
    if shop_id:
        f_q["shop_id"] = shop_id
        v_q["shop_id"] = shop_id
    return {
        "farmers_directory": int(await db.farmers.count_documents(f_q)),
        "vendors_directory": int(await db.vendors.count_documents(v_q)),
    }


async def merchant_counts(db) -> Dict[str, int]:
    return {
        "merchants_total": int(await db.shops.count_documents({})),
        "merchants_active": int(await db.shops.count_documents({"active": True})),
    }


async def build_dashboard(
    db,
    *,
    date_from: str,
    date_to: str,
    shop_id: Optional[str] = None,
) -> Dict[str, Any]:
    patti = await sum_patti_bags_and_count(db, date_from=date_from, date_to=date_to, shop_id=shop_id)
    bills = await count_vendor_bills(db, date_from=date_from, date_to=date_to, shop_id=shop_id)
    purchased = await sum_purchased_bags(db, date_from=date_from, date_to=date_to, shop_id=shop_id)
    vendors_active = await count_vendors_with_bills(
        db, date_from=date_from, date_to=date_to, shop_id=shop_id
    )
    directory = await directory_counts(db, shop_id=shop_id)
    merchants = await merchant_counts(db) if not shop_id else {
        "merchants_total": 1 if await db.shops.find_one({"id": shop_id}) else 0,
        "merchants_active": 1
        if await db.shops.find_one({"id": shop_id, "active": True})
        else 0,
    }
    return {
        "business_timezone": "Asia/Kolkata",
        "from": date_from,
        "to": date_to,
        "date": date_from if date_from == date_to else None,
        "shop_id": shop_id,
        **merchants,
        **directory,
        "farmers_with_patti": patti["farmers_with_patti"],
        "farmer_bags": patti["farmer_bags"],
        "farmer_pattis": patti["farmer_pattis"],
        "vendors_with_bills": vendors_active,
        "vendor_bills": bills,
        "purchased_bags": purchased,
        "definitions": {
            "farmers_directory": "Count of farmers collection documents (not date-scoped)",
            "farmers_with_patti": "Distinct farmer_id on non-deleted pattis in date range",
            "farmer_bags": "sum(pattis.total_bags) where deleted!=true and date in range",
            "farmer_pattis": "count(pattis) where deleted!=true and date in range",
            "vendors_directory": "Count of vendors collection documents (not date-scoped)",
            "vendors_with_bills": "Distinct vendor_id on non-deleted vendor_bills in date range",
            "vendor_bills": "count(vendor_bills) where deleted!=true and date in range",
            "purchased_bags": (
                "sum(bag_purchases.bags) status=PAID where "
                "$ifNull(paid_at, created_at) falls in IST day window"
            ),
        },
    }


async def merchant_day_activity_rows(
    db,
    *,
    date_from: str,
    date_to: str,
    limit: int = 100,
    offset: int = 0,
) -> Tuple[List[dict], int]:
    """Per-shop activity for the date range (patti bags/counts + bills)."""
    match = {"deleted": {"$ne": True}, **business_date_match(date_from, date_to)}
    patti_rows = await db.pattis.aggregate(
        [
            {"$match": match},
            {
                "$group": {
                    "_id": "$shop_id",
                    "farmer_pattis": {"$sum": 1},
                    "farmer_bags": {"$sum": {"$ifNull": ["$total_bags", 0]}},
                }
            },
        ]
    ).to_list(10_000)
    bill_rows = await db.vendor_bills.aggregate(
        [
            {"$match": match},
            {"$group": {"_id": "$shop_id", "vendor_bills": {"$sum": 1}}},
        ]
    ).to_list(10_000)

    by_shop: Dict[str, dict] = {}
    for r in patti_rows:
        sid = r["_id"]
        by_shop.setdefault(sid, {"shop_id": sid, "farmer_pattis": 0, "farmer_bags": 0, "vendor_bills": 0, "purchased_bags": 0})
        by_shop[sid]["farmer_pattis"] = int(r["farmer_pattis"])
        by_shop[sid]["farmer_bags"] = int(r["farmer_bags"])
    for r in bill_rows:
        sid = r["_id"]
        by_shop.setdefault(sid, {"shop_id": sid, "farmer_pattis": 0, "farmer_bags": 0, "vendor_bills": 0, "purchased_bags": 0})
        by_shop[sid]["vendor_bills"] = int(r["vendor_bills"])

    # Purchased bags per shop (IST window) — one aggregation then group
    start, end = ist_range_utc_window(date_from, date_to)
    purch_rows = await db.bag_purchases.aggregate(
        [
            {"$match": {"status": "PAID"}},
            {"$addFields": {"_event_at": {"$ifNull": ["$paid_at", "$created_at"]}}},
            {"$match": {"_event_at": {"$gte": start, "$lt": end}}},
            {"$group": {"_id": "$shop_id", "purchased_bags": {"$sum": {"$ifNull": ["$bags", 0]}}}},
        ]
    ).to_list(10_000)
    for r in purch_rows:
        sid = r["_id"]
        by_shop.setdefault(sid, {"shop_id": sid, "farmer_pattis": 0, "farmer_bags": 0, "vendor_bills": 0, "purchased_bags": 0})
        by_shop[sid]["purchased_bags"] = int(r["purchased_bags"])

    shop_ids = list(by_shop.keys())
    shops = {}
    if shop_ids:
        async for s in db.shops.find({"id": {"$in": shop_ids}}, {"_id": 0, "id": 1, "shop_name": 1, "username": 1, "active": 1}):
            shops[s["id"]] = s

    rows = []
    for sid, row in by_shop.items():
        s = shops.get(sid) or {}
        rows.append({
            **row,
            "shop_name": s.get("shop_name") or sid,
            "username": s.get("username"),
            "active": s.get("active"),
        })
    rows.sort(key=lambda x: (-x["farmer_bags"], x["shop_name"] or ""))
    total = len(rows)
    return rows[offset : offset + limit], total
