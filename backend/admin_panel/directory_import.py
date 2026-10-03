"""Admin Directory Import — Farmers / Vendors from Excel into shop directories.

Master-data only: not date-scoped. Reuses farmers/vendors collections.
Duplicate match (within shop):
  - Farmer: case-insensitive exact name
  - Vendor: case-insensitive exact name + details
"""
from __future__ import annotations

import io
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional, Tuple

import pandas as pd

from admin_panel.auth import uid, utc_now

Kind = Literal["farmers", "vendors"]
RowStatus = Literal["blank", "invalid", "duplicate", "ready"]

MAX_IMPORT_ROWS = 5000
NAME_MAX = 120
DETAILS_MAX = 200


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and pd.isna(value):
        return ""
    s = str(value).strip()
    # Collapse internal whitespace
    s = re.sub(r"\s+", " ", s)
    return s


def normalize_key(value: str) -> str:
    return normalize_text(value).casefold()


@dataclass
class ParsedRow:
    row_number: int
    name: str
    details: str
    status: RowStatus
    message: Optional[str] = None

    def as_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {
            "row_number": self.row_number,
            "name": self.name,
            "status": self.status,
            "message": self.message,
        }
        if self.details or self.status != "blank":
            out["details"] = self.details
        return out


def build_template_xlsx(kind: Kind) -> bytes:
    buf = io.BytesIO()
    if kind == "farmers":
        df = pd.DataFrame({"Farmer Name": ["Example Farmer"]})
    else:
        df = pd.DataFrame(
            {
                "Vendor Name": ["Example Vendor"],
                "Vendor Details": ["Shop / Village"],
            }
        )
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Directory")
    return buf.getvalue()


def _read_excel_dataframe(file_bytes: bytes) -> pd.DataFrame:
    if not file_bytes:
        raise ValueError("Empty file")
    try:
        df = pd.read_excel(io.BytesIO(file_bytes), engine="openpyxl", dtype=object)
    except Exception as e:
        raise ValueError(f"Invalid Excel file (.xlsx required): {e}") from e
    if df is None or df.empty:
        # Still allow header-only — all blank
        return df if df is not None else pd.DataFrame()
    if len(df) > MAX_IMPORT_ROWS:
        raise ValueError(f"Too many rows (max {MAX_IMPORT_ROWS}). Split the file and try again.")
    return df


def parse_farmer_rows(file_bytes: bytes) -> List[ParsedRow]:
    df = _read_excel_dataframe(file_bytes)
    # Prefer first column; accept header name if present
    cols = list(df.columns)
    if not cols:
        return []
    name_col = cols[0]
    for c in cols:
        if normalize_key(str(c)) in {"farmer name", "name", "farmer"}:
            name_col = c
            break

    rows: List[ParsedRow] = []
    for i, raw in enumerate(df[name_col].tolist(), start=2):  # Excel row 1 = header
        name = normalize_text(raw)
        if not name:
            rows.append(ParsedRow(row_number=i, name="", details="", status="blank", message="Blank row"))
            continue
        if len(name) > NAME_MAX:
            rows.append(
                ParsedRow(
                    row_number=i,
                    name=name[:NAME_MAX],
                    details="",
                    status="invalid",
                    message=f"Name longer than {NAME_MAX} characters",
                )
            )
            continue
        rows.append(ParsedRow(row_number=i, name=name, details="", status="ready"))
    return rows


def parse_vendor_rows(file_bytes: bytes) -> List[ParsedRow]:
    df = _read_excel_dataframe(file_bytes)
    cols = list(df.columns)
    if not cols:
        return []
    name_col = cols[0]
    details_col = cols[1] if len(cols) > 1 else None
    for c in cols:
        ck = normalize_key(str(c))
        if ck in {"vendor name", "name", "vendor"}:
            name_col = c
        if ck in {"vendor details", "details", "shop", "village"}:
            details_col = c

    rows: List[ParsedRow] = []
    n = len(df)
    names = df[name_col].tolist() if n else []
    details_list = df[details_col].tolist() if details_col is not None and n else [None] * n
    for i in range(n):
        row_number = i + 2
        name = normalize_text(names[i] if i < len(names) else "")
        details = normalize_text(details_list[i] if i < len(details_list) else "")
        if not name and not details:
            rows.append(ParsedRow(row_number=row_number, name="", details="", status="blank", message="Blank row"))
            continue
        if not name:
            rows.append(
                ParsedRow(
                    row_number=row_number,
                    name="",
                    details=details,
                    status="invalid",
                    message="Vendor Name is required",
                )
            )
            continue
        if not details:
            rows.append(
                ParsedRow(
                    row_number=row_number,
                    name=name,
                    details="",
                    status="invalid",
                    message="Vendor Details are required",
                )
            )
            continue
        if len(name) > NAME_MAX:
            rows.append(
                ParsedRow(
                    row_number=row_number,
                    name=name[:NAME_MAX],
                    details=details[:DETAILS_MAX],
                    status="invalid",
                    message=f"Name longer than {NAME_MAX} characters",
                )
            )
            continue
        if len(details) > DETAILS_MAX:
            rows.append(
                ParsedRow(
                    row_number=row_number,
                    name=name,
                    details=details[:DETAILS_MAX],
                    status="invalid",
                    message=f"Details longer than {DETAILS_MAX} characters",
                )
            )
            continue
        rows.append(ParsedRow(row_number=row_number, name=name, details=details, status="ready"))
    return rows


async def existing_farmer_keys(db, shop_id: str) -> set[str]:
    keys: set[str] = set()
    async for d in db.farmers.find({"shop_id": shop_id}, {"_id": 0, "name": 1}):
        keys.add(normalize_key(d.get("name") or ""))
    keys.discard("")
    return keys


async def existing_vendor_keys(db, shop_id: str) -> set[str]:
    keys: set[str] = set()
    async for d in db.vendors.find({"shop_id": shop_id}, {"_id": 0, "name": 1, "details": 1}):
        keys.add(f"{normalize_key(d.get('name') or '')}|{normalize_key(d.get('details') or '')}")
    keys.discard("|")
    return keys


def mark_duplicates(kind: Kind, rows: List[ParsedRow], existing: set[str]) -> List[ParsedRow]:
    seen: set[str] = set()
    for r in rows:
        if r.status != "ready":
            continue
        if kind == "farmers":
            key = normalize_key(r.name)
        else:
            key = f"{normalize_key(r.name)}|{normalize_key(r.details)}"
        if key in existing or key in seen:
            r.status = "duplicate"
            r.message = "Already exists in directory" if key in existing else "Duplicate within file"
        else:
            seen.add(key)
    return rows


def summarize(rows: List[ParsedRow]) -> Dict[str, int]:
    summary = {
        "total_rows": len(rows),
        "blank": 0,
        "invalid": 0,
        "duplicate": 0,
        "ready": 0,
    }
    for r in rows:
        summary[r.status] = summary.get(r.status, 0) + 1
    return summary


async def preview_import(db, shop_id: str, kind: Kind, file_bytes: bytes) -> Dict[str, Any]:
    if kind == "farmers":
        rows = parse_farmer_rows(file_bytes)
        existing = await existing_farmer_keys(db, shop_id)
    else:
        rows = parse_vendor_rows(file_bytes)
        existing = await existing_vendor_keys(db, shop_id)
    mark_duplicates(kind, rows, existing)
    return {
        "shop_id": shop_id,
        "kind": kind,
        "summary": summarize(rows),
        "rows": [r.as_dict() for r in rows],
    }


async def confirm_import(
    db,
    shop_id: str,
    kind: Kind,
    rows_in: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Insert ready rows; skip duplicates/invalid. Does not touch bills/pattis."""
    if kind == "farmers":
        existing = await existing_farmer_keys(db, shop_id)
    else:
        existing = await existing_vendor_keys(db, shop_id)

    imported = 0
    skipped_duplicate = 0
    skipped_invalid = 0
    skipped_blank = 0
    errors: List[Dict[str, Any]] = []
    now = utc_now()

    # De-dupe within payload
    seen: set[str] = set()

    for idx, raw in enumerate(rows_in or [], start=1):
        name = normalize_text(raw.get("name"))
        details = normalize_text(raw.get("details"))
        if kind == "farmers":
            if not name:
                skipped_blank += 1
                continue
            if len(name) > NAME_MAX:
                skipped_invalid += 1
                errors.append({"row": idx, "message": "Invalid farmer name"})
                continue
            key = normalize_key(name)
            if key in existing or key in seen:
                skipped_duplicate += 1
                continue
            doc = {
                "id": uid(),
                "shop_id": shop_id,
                "name": name,
                "phone": None,
                "village": None,
                "created_at": now,
            }
            await db.farmers.insert_one(doc)
            existing.add(key)
            seen.add(key)
            imported += 1
        else:
            if not name and not details:
                skipped_blank += 1
                continue
            if not name or not details or len(name) > NAME_MAX or len(details) > DETAILS_MAX:
                skipped_invalid += 1
                errors.append({"row": idx, "message": "Invalid vendor name/details"})
                continue
            key = f"{normalize_key(name)}|{normalize_key(details)}"
            if key in existing or key in seen:
                skipped_duplicate += 1
                continue
            doc = {
                "id": uid(),
                "shop_id": shop_id,
                "name": name,
                "details": details,
                "phone": None,
                "created_at": now,
            }
            await db.vendors.insert_one(doc)
            existing.add(key)
            seen.add(key)
            imported += 1

    return {
        "shop_id": shop_id,
        "kind": kind,
        "imported": imported,
        "skipped_duplicate": skipped_duplicate,
        "skipped_invalid": skipped_invalid,
        "skipped_blank": skipped_blank,
        "errors": errors[:50],
    }
