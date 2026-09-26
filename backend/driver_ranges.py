"""Auction-day driver lot-range helpers (single source of truth).

Drivers are assigned as serial ranges on an auction day (not a separate
driver account system). Lot numbers like \"35/2\" match on the first integer.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Sequence, Tuple


def lot_first_num(lot_no: str) -> Optional[int]:
    """Extract the first integer before '/' in a lot number like '35/2'."""
    if not lot_no:
        return None
    m = re.match(r"^\s*(\d+)", str(lot_no).strip())
    if not m:
        return None
    try:
        return int(m.group(1))
    except ValueError:
        return None


def pick_driver(
    drivers: Sequence[Dict[str, Any]],
    lot_no: str,
) -> Tuple[Optional[str], Optional[str], Optional[float]]:
    """Return (name, place, bhada_per_bag) for the range covering lot_no's serial."""
    n = lot_first_num(lot_no)
    if n is None:
        return None, None, None
    for d in drivers:
        try:
            lo = int(d["range_from"])
            hi = int(d["range_to"])
        except (KeyError, TypeError, ValueError):
            continue
        if lo <= n <= hi:
            place = d.get("place")
            bhada = d.get("bhada_per_bag")
            try:
                bhada_f = float(bhada) if bhada is not None else None
            except (TypeError, ValueError):
                bhada_f = None
            return d.get("name"), place, bhada_f
    return None, None, None


def validate_driver_ranges(drivers: Sequence[Any]) -> Optional[str]:
    """Validate start<=end and non-overlapping ranges. Returns error message or None.

    Accepts dicts or objects with range_from / range_to / name attributes.
    """
    if not drivers:
        return None

    normalized: List[Tuple[int, int, str]] = []
    for d in drivers:
        if isinstance(d, dict):
            name = str(d.get("name") or "").strip() or "driver"
            try:
                lo = int(d["range_from"])
                hi = int(d["range_to"])
            except (KeyError, TypeError, ValueError):
                return f"Driver {name}: invalid serial range"
        else:
            name = str(getattr(d, "name", "") or "").strip() or "driver"
            try:
                lo = int(getattr(d, "range_from"))
                hi = int(getattr(d, "range_to"))
            except (TypeError, ValueError):
                return f"Driver {name}: invalid serial range"
        if lo < 1 or hi < 1:
            return f"Driver {name}: serial numbers must be >= 1"
        if lo > hi:
            return f"Driver {name}: range_from > range_to"
        normalized.append((lo, hi, name))

    sorted_d = sorted(normalized, key=lambda x: x[0])
    for i in range(1, len(sorted_d)):
        prev_lo, prev_hi, prev_name = sorted_d[i - 1]
        lo, hi, name = sorted_d[i]
        if lo <= prev_hi:
            return (
                f"Driver ranges overlap: {prev_name} ({prev_lo}-{prev_hi}) "
                f"and {name} ({lo}-{hi})"
            )
    return None
