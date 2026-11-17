"""Shop Cash Book — credit/debit cash entries persisted in MongoDB.

Owner-only. Isolated by shop_id. Uses the shared Motor `db` from server.py.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field


def _uid() -> str:
    return str(uuid.uuid4())


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _round2(v: float) -> float:
    return round(float(v) + 1e-9, 2)


_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _require_iso_date(value: str, *, field: str = "date") -> str:
    d = (value or "").strip()
    if not _DATE_RE.match(d):
        raise HTTPException(400, f"{field} must be YYYY-MM-DD")
    y, m, day = int(d[0:4]), int(d[5:7]), int(d[8:10])
    if m < 1 or m > 12 or day < 1 or day > 31:
        raise HTTPException(400, f"{field} is not a valid calendar date")
    return d


def _money_amount(value: Any) -> float:
    try:
        n = float(value)
    except (TypeError, ValueError):
        raise HTTPException(400, "Amount must be a number") from None
    if not (n > 0):
        raise HTTPException(400, "Amount must be greater than zero")
    # Cap pathological values; Lemon Mandi cash entries are day-book scale.
    if n > 1e12:
        raise HTTPException(400, "Amount is too large")
    return _round2(n)


class CashBookEntryIn(BaseModel):
    side: str = Field(min_length=4, max_length=6)
    amount: float = Field(gt=0)
    description: str = Field(min_length=1, max_length=500)
    date: str = Field(min_length=10, max_length=10)
    client_request_id: Optional[str] = Field(default=None, max_length=80)


class CashBookEntryUpdateIn(BaseModel):
    amount: float = Field(gt=0)
    description: str = Field(min_length=1, max_length=500)


class CashBookEntryOut(BaseModel):
    id: str
    shop_id: str
    side: str
    amount: float
    description: str
    date: str
    created_at: datetime
    updated_at: datetime
    created_by: Optional[str] = None
    client_request_id: Optional[str] = None
    local_id: Optional[str] = None


class CashBookDayOut(BaseModel):
    date: str
    credits: List[CashBookEntryOut]
    debits: List[CashBookEntryOut]
    total_credit: float
    total_debit: float
    net: float
    opening_balance: float
    closing_balance: float


class CashBookImportItemIn(BaseModel):
    local_id: str = Field(min_length=1, max_length=80)
    side: str = Field(min_length=4, max_length=6)
    amount: float = Field(gt=0)
    description: str = Field(min_length=1, max_length=500)
    date: str = Field(min_length=10, max_length=10)


class CashBookImportIn(BaseModel):
    entries: List[CashBookImportItemIn] = Field(min_length=1, max_length=2000)


class CashBookImportOut(BaseModel):
    imported: int
    skipped: int
    entries: List[CashBookEntryOut]


def _normalize_side(side: str) -> str:
    s = (side or "").strip().upper()
    if s not in ("CREDIT", "DEBIT"):
        raise HTTPException(400, "side must be CREDIT or DEBIT")
    return s


def _public(doc: dict) -> dict:
    out = dict(doc)
    out.pop("_id", None)
    return out


def _entry_out(doc: dict) -> CashBookEntryOut:
    return CashBookEntryOut(**_public(doc))


async def ensure_cash_book_indexes(db) -> None:
    await db.cash_book_entries.create_index([("shop_id", 1), ("date", 1), ("created_at", 1)])
    await db.cash_book_entries.create_index([("shop_id", 1), ("id", 1)], unique=True)
    await db.cash_book_entries.create_index(
        [("shop_id", 1), ("client_request_id", 1)],
        unique=True,
        partialFilterExpression={"client_request_id": {"$type": "string"}},
        name="uniq_cash_book_client_request",
    )
    await db.cash_book_entries.create_index(
        [("shop_id", 1), ("local_id", 1)],
        unique=True,
        partialFilterExpression={"local_id": {"$type": "string"}},
        name="uniq_cash_book_local_id",
    )


async def _net_before_date(db, shop_id: str, date: str) -> float:
    """Opening balance = cumulative CREDIT − DEBIT for all entries strictly before `date`."""
    credit = 0.0
    debit = 0.0
    async for row in db.cash_book_entries.find(
        {"shop_id": shop_id, "date": {"$lt": date}},
        {"_id": 0, "side": 1, "amount": 1},
    ):
        amt = float(row.get("amount") or 0)
        if row.get("side") == "DEBIT":
            debit += amt
        else:
            credit += amt
    return _round2(credit - debit)


async def _day_payload(db, shop_id: str, date: str) -> CashBookDayOut:
    rows = [
        _public(r)
        async for r in db.cash_book_entries.find(
            {"shop_id": shop_id, "date": date},
            {"_id": 0},
        ).sort([("created_at", 1), ("id", 1)])
    ]
    credits = [_entry_out(r) for r in rows if r.get("side") == "CREDIT"]
    debits = [_entry_out(r) for r in rows if r.get("side") == "DEBIT"]
    total_credit = _round2(sum(c.amount for c in credits))
    total_debit = _round2(sum(d.amount for d in debits))
    net = _round2(total_credit - total_debit)
    opening = await _net_before_date(db, shop_id, date)
    closing = _round2(opening + net)
    return CashBookDayOut(
        date=date,
        credits=credits,
        debits=debits,
        total_credit=total_credit,
        total_debit=total_debit,
        net=net,
        opening_balance=opening,
        closing_balance=closing,
    )


def attach_cash_book(api: APIRouter, *, db, current_user, owner_only) -> None:
    """Register Cash Book routes on the shared /api router (owner-only)."""

    @api.get("/cash-book/day", response_model=CashBookDayOut)
    async def cash_book_day(
        date: str = Query(..., min_length=10, max_length=10),
        user=Depends(owner_only),
    ):
        d = _require_iso_date(date)
        return await _day_payload(db, user["shop_id"], d)

    @api.get("/cash-book/entries", response_model=List[CashBookEntryOut])
    async def cash_book_entries(
        date: Optional[str] = Query(default=None),
        date_from: Optional[str] = Query(default=None),
        date_to: Optional[str] = Query(default=None),
        user=Depends(owner_only),
    ):
        match: Dict[str, Any] = {"shop_id": user["shop_id"]}
        if date:
            match["date"] = _require_iso_date(date)
        else:
            if date_from:
                df = _require_iso_date(date_from, field="date_from")
                match.setdefault("date", {})
                if isinstance(match["date"], dict):
                    match["date"]["$gte"] = df
            if date_to:
                dt = _require_iso_date(date_to, field="date_to")
                match.setdefault("date", {})
                if isinstance(match["date"], dict):
                    match["date"]["$lte"] = dt
            if "date" in match and match["date"] == {}:
                del match["date"]
        rows = [
            _entry_out(_public(r))
            async for r in db.cash_book_entries.find(match, {"_id": 0}).sort(
                [("date", 1), ("created_at", 1), ("id", 1)]
            )
        ]
        return rows

    @api.get("/cash-book/entries/{entry_id}", response_model=CashBookEntryOut)
    async def cash_book_get_entry(entry_id: str, user=Depends(owner_only)):
        doc = await db.cash_book_entries.find_one(
            {"id": entry_id, "shop_id": user["shop_id"]},
            {"_id": 0},
        )
        if not doc:
            raise HTTPException(404, "Cash Book entry not found")
        return _entry_out(doc)

    @api.post("/cash-book/entries", response_model=CashBookEntryOut, status_code=201)
    async def cash_book_create(body: CashBookEntryIn, user=Depends(owner_only)):
        side = _normalize_side(body.side)
        amount = _money_amount(body.amount)
        description = (body.description or "").strip()
        if not description:
            raise HTTPException(400, "Description is required")
        date = _require_iso_date(body.date)
        req_id = (body.client_request_id or "").strip() or None
        shop_id = user["shop_id"]

        if req_id:
            prior = await db.cash_book_entries.find_one(
                {"shop_id": shop_id, "client_request_id": req_id},
                {"_id": 0},
            )
            if prior:
                return _entry_out(prior)

        now = _utc_now()
        doc = {
            "id": _uid(),
            "shop_id": shop_id,
            "side": side,
            "amount": amount,
            "description": description,
            "date": date,
            "created_at": now,
            "updated_at": now,
            "created_by": user.get("id"),
            "client_request_id": req_id,
        }
        try:
            await db.cash_book_entries.insert_one(doc)
        except Exception as e:
            # Race on client_request_id unique index — return the winner.
            if req_id:
                prior = await db.cash_book_entries.find_one(
                    {"shop_id": shop_id, "client_request_id": req_id},
                    {"_id": 0},
                )
                if prior:
                    return _entry_out(prior)
            raise HTTPException(409, "Could not create Cash Book entry — retry") from e
        return _entry_out(_public(doc))

    @api.put("/cash-book/entries/{entry_id}", response_model=CashBookEntryOut)
    async def cash_book_update(entry_id: str, body: CashBookEntryUpdateIn, user=Depends(owner_only)):
        amount = _money_amount(body.amount)
        description = (body.description or "").strip()
        if not description:
            raise HTTPException(400, "Description is required")
        existing = await db.cash_book_entries.find_one(
            {"id": entry_id, "shop_id": user["shop_id"]},
            {"_id": 0},
        )
        if not existing:
            raise HTTPException(404, "Cash Book entry not found")
        now = _utc_now()
        await db.cash_book_entries.update_one(
            {"id": entry_id, "shop_id": user["shop_id"]},
            {"$set": {"amount": amount, "description": description, "updated_at": now}},
        )
        existing["amount"] = amount
        existing["description"] = description
        existing["updated_at"] = now
        return _entry_out(existing)

    @api.delete("/cash-book/entries/{entry_id}", status_code=204)
    async def cash_book_delete(entry_id: str, user=Depends(owner_only)):
        r = await db.cash_book_entries.delete_one({"id": entry_id, "shop_id": user["shop_id"]})
        if getattr(r, "deleted_count", 0) == 0:
            raise HTTPException(404, "Cash Book entry not found")
        return None

    @api.post("/cash-book/import-local", response_model=CashBookImportOut)
    async def cash_book_import_local(body: CashBookImportIn, user=Depends(owner_only)):
        """Idempotent import of device-local Cash Book rows (skips seed-* sample ids)."""
        shop_id = user["shop_id"]
        imported = 0
        skipped = 0
        out: List[CashBookEntryOut] = []
        now = _utc_now()
        for item in body.entries:
            local_id = (item.local_id or "").strip()
            if not local_id or local_id.startswith("seed-"):
                skipped += 1
                continue
            prior = await db.cash_book_entries.find_one(
                {"shop_id": shop_id, "local_id": local_id},
                {"_id": 0},
            )
            if prior:
                skipped += 1
                out.append(_entry_out(prior))
                continue
            try:
                side = _normalize_side(item.side)
                amount = _money_amount(item.amount)
                description = (item.description or "").strip()
                date = _require_iso_date(item.date)
            except HTTPException:
                skipped += 1
                continue
            if not description:
                skipped += 1
                continue
            doc = {
                "id": _uid(),
                "shop_id": shop_id,
                "side": side,
                "amount": amount,
                "description": description,
                "date": date,
                "created_at": now,
                "updated_at": now,
                "created_by": user.get("id"),
                "local_id": local_id,
                "client_request_id": f"local-import:{local_id}",
            }
            try:
                await db.cash_book_entries.insert_one(doc)
                imported += 1
                out.append(_entry_out(_public(doc)))
            except Exception:
                again = await db.cash_book_entries.find_one(
                    {"shop_id": shop_id, "local_id": local_id},
                    {"_id": 0},
                )
                if again:
                    skipped += 1
                    out.append(_entry_out(again))
                else:
                    skipped += 1
        return CashBookImportOut(imported=imported, skipped=skipped, entries=out)

    # Expose for lifespan
    globals()["ensure_cash_book_indexes"] = ensure_cash_book_indexes
