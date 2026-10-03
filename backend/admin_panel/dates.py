"""IST business-date helpers for platform admin APIs.

Merchant mobile may still use UTC `_today_str()` for its own defaults.
Admin Panel MUST use these helpers exclusively for "today" and purchase windows.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from fastapi import HTTPException

_IST = timezone(timedelta(hours=5, minutes=30))
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def ist_today_str(when: Optional[datetime] = None) -> str:
    """Asia/Kolkata calendar date as YYYY-MM-DD."""
    d = when or utc_now()
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(_IST).strftime("%Y-%m-%d")


def parse_business_date(value: str, *, field: str = "date") -> str:
    if not value or not _DATE_RE.fullmatch(value.strip()):
        raise HTTPException(422, f"Invalid {field} format. Expected YYYY-MM-DD.")
    return value.strip()


def resolve_date_range(
    date: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> Tuple[str, str]:
    """Return inclusive (from, to) business dates.

    - If `date` is set, from=to=date.
    - Else if from/to set, use them (default missing side to the other or IST today).
    - Else both = IST today.
    """
    if date:
        d = parse_business_date(date, field="date")
        return d, d
    if date_from or date_to:
        if date_from and date_to:
            a = parse_business_date(date_from, field="from")
            b = parse_business_date(date_to, field="to")
        elif date_from:
            a = b = parse_business_date(date_from, field="from")
        else:
            a = b = parse_business_date(date_to or "", field="to")
        if a > b:
            raise HTTPException(422, "'from' must be <= 'to'")
        return a, b
    today = ist_today_str()
    return today, today


def ist_day_utc_window(business_date: str) -> Tuple[datetime, datetime]:
    """Half-open [start, end) UTC datetimes covering one IST calendar day.

    Used for bag_purchases.paid_at / created_at filtering.
    """
    d = parse_business_date(business_date)
    y, m, day = map(int, d.split("-"))
    start_ist = datetime(y, m, day, 0, 0, 0, tzinfo=_IST)
    end_ist = start_ist + timedelta(days=1)
    return start_ist.astimezone(timezone.utc), end_ist.astimezone(timezone.utc)


def ist_range_utc_window(date_from: str, date_to: str) -> Tuple[datetime, datetime]:
    start, _ = ist_day_utc_window(date_from)
    _, end = ist_day_utc_window(date_to)
    return start, end
