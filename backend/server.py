"""Lemon Mandi Billing — v2.

Adds Auction Day workflow (drivers + action book with multi-vendor lots),
QR-token based Patti receiver update, and staff/counter accounts.
"""
import os
import re
import uuid
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Annotated, List, Optional
from pathlib import Path

import certifi
import jwt
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, Depends, HTTPException, status, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from pydantic import BaseModel, Field


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ.get("JWT_SECRET", "lemon-mandi-dev-secret-change-in-prod-01234567890abcdef")
JWT_ALG = "HS256"
JWT_TTL_MINUTES = 60 * 24 * 30


def _mongo_client_kwargs(url: str) -> dict:
    """Atlas/SRV-safe Motor options. Credentials stay in MONGO_URL only."""
    kwargs: dict = {
        "serverSelectionTimeoutMS": 30000,
        "connectTimeoutMS": 20000,
        "socketTimeoutMS": 20000,
    }
    lower = (url or "").lower()
    # mongodb+srv and Atlas hosts require TLS; pin CA bundle for Render/OpenSSL.
    if (
        lower.startswith("mongodb+srv://")
        or "mongodb.net" in lower
        or "tls=true" in lower
        or "ssl=true" in lower
    ):
        kwargs["tls"] = True
        kwargs["tlsCAFile"] = certifi.where()
    return kwargs


client = AsyncIOMotorClient(MONGO_URL, **_mongo_client_kwargs(MONGO_URL))
db = client[DB_NAME]

pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
DUMMY_HASH = pwd.hash("dummy-password-never-used")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail fast with a clear error if Atlas/local Mongo is unreachable.
    try:
        await client.admin.command("ping")
        logger.info("Startup: MongoDB ping ok.")
    except Exception as e:  # noqa: BLE001
        logger.error("Startup: MongoDB connection failed: %s", e)
        raise RuntimeError(
            "MongoDB connection failed. Check MONGO_URL, Atlas network access, and TLS."
        ) from e

    # Startup: ensure indexes
    await db.shops.create_index("username", unique=True)
    await db.shops.create_index("id", unique=True)
    await db.staff.create_index("username", unique=True)
    await db.staff.create_index([("shop_id", 1), ("name", 1)])
    await db.farmers.create_index([("shop_id", 1), ("name", 1)])
    await db.vendors.create_index([("shop_id", 1), ("name", 1)])
    await db.auction_days.create_index([("shop_id", 1), ("date", 1)], unique=True)
    await db.lots.create_index([("shop_id", 1), ("auction_day_id", 1), ("created_at", 1)])
    await db.lots.create_index([("shop_id", 1), ("date", 1)])
    # Migration: drop old (unique) index on (shop_id, auction_day_id, farmer_id) if it still exists.
    try:
        idx_info = await db.pattis.index_information()
        for name, info in idx_info.items():
            keys = info.get("key", [])
            if (
                [k[0] for k in keys] == ["shop_id", "auction_day_id", "farmer_id"]
                and info.get("unique")
            ):
                await db.pattis.drop_index(name)
                logger.info(f"Startup: dropped legacy unique index {name}")
    except Exception as _e:  # noqa: BLE001
        logger.warning(f"Startup: index migration skipped: {_e}")
    await db.pattis.create_index(
        [("shop_id", 1), ("auction_day_id", 1), ("lot_id", 1)],
        unique=True,
        partialFilterExpression={"lot_id": {"$type": "string"}},
        name="uniq_patti_per_lot",
    )
    await db.pattis.create_index([("shop_id", 1), ("auction_day_id", 1), ("farmer_id", 1)])
    # Migration: remove legacy pattis that have no lot_id (they were grouped-by-farmer).
    # These will be re-generated on next lot save under the new 1-Patti-per-Lot rule.
    try:
        purge = await db.pattis.delete_many({"lot_id": {"$in": [None]}})
        if purge.deleted_count:
            logger.info(f"Startup: purged {purge.deleted_count} legacy pattis without lot_id")
        purge2 = await db.pattis.delete_many({"lot_id": {"$exists": False}})
        if purge2.deleted_count:
            logger.info(f"Startup: purged {purge2.deleted_count} legacy pattis (no lot_id field)")
    except Exception as _e:  # noqa: BLE001
        logger.warning(f"Startup: legacy patti purge skipped: {_e}")
    await db.pattis.create_index([("shop_id", 1), ("qr_token", 1)])
    await db.pattis.create_index([("shop_id", 1), ("date", -1), ("patti_no", -1)])
    await db.settings.create_index("shop_id", unique=True)
    await db.vendor_bills.create_index([("shop_id", 1), ("vendor_id", 1), ("date", -1)])
    await db.vendor_bills.create_index([("shop_id", 1), ("bill_no", -1)])
    await db.vendor_payments.create_index([("shop_id", 1), ("vendor_id", 1), ("date", -1)])
    logger.info("Startup: indexes ensured.")
    yield
    # Shutdown
    client.close()


app = FastAPI(title="Lemon Mandi Billing API v2", lifespan=lifespan)
api = APIRouter(prefix="/api")
oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=True)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


# ---------- utils ----------
def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def uid() -> str:
    return str(uuid.uuid4())


def _round2(v: float) -> float:
    return round(v + 1e-9, 2)


def _today_str() -> str:
    return utc_now().strftime("%Y-%m-%d")


def _lot_first_num(lot_no: str) -> Optional[int]:
    """Extract the first integer before '/' in a lot number like '35/2'. Returns None if not parseable."""
    if not lot_no:
        return None
    m = re.match(r"^\s*(\d+)", lot_no.strip())
    if not m:
        return None
    try:
        return int(m.group(1))
    except ValueError:
        return None


def _parse_lot_no_str(s: str) -> tuple[Optional[int], Optional[int]]:
    """Parse a legacy '1/5' → (serial=1, total_bags=5). '3' → (3, None). Returns (serial, total_bags)."""
    if not s:
        return None, None
    m = re.match(r"^\s*(\d+)\s*[/\\\-]\s*(\d+)\s*$", s)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.match(r"^\s*(\d+)", s)
    return (int(m.group(1)) if m else None), None


def _resolve_lot_fields(
    lot_serial_no: Optional[int],
    total_bags: Optional[int],
    lot_no: Optional[str],
    sales_bags_sum: int,
) -> tuple[int, int, str]:
    """Return (serial, total_bags, display_lot_no).
    Priority: explicit serial+total_bags → parse legacy lot_no → derive total from sales.
    """
    serial = lot_serial_no
    total = total_bags
    if serial is None or total is None:
        ps, pt = _parse_lot_no_str(lot_no or "")
        if serial is None:
            serial = ps
        if total is None:
            total = pt
    if total is None and sales_bags_sum > 0:
        total = sales_bags_sum
    if serial is None:
        raise HTTPException(422, "lot_serial_no is required (or legacy 'lot_no' like '1/5').")
    if total is None or total < 1:
        raise HTTPException(422, "total_bags is required and must be >= 1.")
    return serial, total, f"{serial}/{total}"


# ---------- Models ----------
class SignupBody(BaseModel):
    shop_name: str = Field(min_length=2, max_length=120)
    username: str = Field(min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(min_length=6, max_length=72)


class LoginBody(BaseModel):
    username: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    shop_id: str
    shop_name: str
    username: str
    role: str  # 'owner' | 'counter'
    display_name: str


class MeOut(BaseModel):
    id: str
    shop_id: str
    shop_name: str
    username: str
    role: str
    display_name: str


class ShopProfile(BaseModel):
    shop_name: str = Field(min_length=1, max_length=120)
    owner_name: Optional[str] = Field(default=None, max_length=120)
    mobile: Optional[str] = Field(default=None, max_length=20)
    alt_mobile: Optional[str] = Field(default=None, max_length=20)
    email: Optional[str] = Field(default=None, max_length=200)
    address: Optional[str] = Field(default=None, max_length=500)
    village: Optional[str] = Field(default=None, max_length=120)
    taluk: Optional[str] = Field(default=None, max_length=120)
    district: Optional[str] = Field(default=None, max_length=120)
    state: Optional[str] = Field(default=None, max_length=120)
    gst_number: Optional[str] = Field(default=None, max_length=40)
    pan_number: Optional[str] = Field(default=None, max_length=20)
    logo_base64: Optional[str] = Field(default=None, max_length=500_000)  # small logo, base64 png
    # Bank
    bank_name: Optional[str] = Field(default=None, max_length=120)
    bank_account_holder: Optional[str] = Field(default=None, max_length=120)
    bank_account_number: Optional[str] = Field(default=None, max_length=40)
    bank_ifsc: Optional[str] = Field(default=None, max_length=20)
    bank_branch: Optional[str] = Field(default=None, max_length=120)
    upi_id: Optional[str] = Field(default=None, max_length=120)
    upi_qr_base64: Optional[str] = Field(default=None, max_length=500_000)


class ShopProfileOut(ShopProfile):
    id: str
    username: str


class Settings(BaseModel):
    # Farmer Patti defaults (independent of vendor billing)
    payment_factor: float = Field(default=0.90, gt=0, le=1)
    hamali_per_bag: float = Field(default=10.0, ge=0)
    stationery_flat: float = Field(default=5.0, ge=0)  # flat charge per Patti (bill), NOT per bag
    default_bhada_per_bag: float = Field(default=0.0, ge=0)
    detailed_print_format: bool = Field(default=False)  # if true, print formulas next to deductions
    thermal_paper_width_mm: int = Field(default=80, ge=40, le=120)  # 58 / 80 / 100 mm typically
    # Vendor billing defaults (never affect Farmer Patti)
    vendor_factor: float = Field(default=1.06, gt=0)  # e.g. 1.06 / 1.07 / 1.08 — independent of payment_factor
    vendor_margin_per_bag: float = Field(default=30.0, ge=0)
    commission_per_bag: float = Field(default=10.0, ge=0)
    vendor_hamali_default: float = Field(default=0.0, ge=0)
    patti_prefix: str = Field(default="FP", max_length=10)
    vendor_bill_prefix: str = Field(default="VB", max_length=10)
    # Optional Gemini API key for Action Diary photo OCR (owner can set in Settings)
    ocr_gemini_api_key: Optional[str] = Field(default=None, max_length=200)


class FarmerIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: Optional[str] = Field(default=None, max_length=20)
    village: Optional[str] = Field(default=None, max_length=120)


class FarmerOut(FarmerIn):
    id: str
    created_at: datetime


class VendorIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    details: str = Field(min_length=1, max_length=200)  # mandatory — distinguishes similar names
    phone: Optional[str] = Field(default=None, max_length=20)


class VendorOut(BaseModel):
    id: str
    name: str
    details: Optional[str] = None  # may be empty on legacy records; create/update require it
    phone: Optional[str] = None
    created_at: datetime


class StaffIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    username: str = Field(min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: Optional[str] = Field(default=None, max_length=72)


class StaffOut(BaseModel):
    id: str
    name: str
    username: str
    role: str
    active: bool
    created_at: datetime


class DriverRange(BaseModel):
    range_from: int = Field(ge=1)
    range_to: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=120)
    place: Optional[str] = Field(default=None, max_length=120)
    bhada_per_bag: float = Field(ge=0)


class AuctionDayIn(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    drivers: List[DriverRange] = Field(default_factory=list)


class AuctionDayOut(BaseModel):
    id: str
    date: str
    drivers: List[DriverRange]
    lot_count: int = 0
    farmer_count: int = 0
    bag_count: int = 0


class SaleIn(BaseModel):
    vendor_id: str
    bags: int = Field(ge=1)
    rate_per_bag: float = Field(ge=0)


class SaleOut(BaseModel):
    vendor_id: str
    vendor_name: str
    bags: int
    rate_per_bag: float
    gross: float


class LotIn(BaseModel):
    auction_day_id: str
    # Primary lot identifiers (new business semantics):
    lot_serial_no: Optional[int] = Field(default=None, ge=1, le=999999)  # e.g. 1 in "1/5"
    total_bags: Optional[int] = Field(default=None, ge=1, le=99999)     # e.g. 5 in "1/5" (announced auction quantity)
    # Legacy accepted: full "1/5" string — parsed on server if serial/total not provided.
    lot_no: Optional[str] = Field(default=None, min_length=1, max_length=30)
    farmer_id: str
    # Bhada: user enters the TOTAL (circled) amount for the lot. Optional per-bag fallback.
    bhada_total: Optional[float] = Field(default=None, ge=0)   # PRIMARY: total bhada for the lot (circled amount)
    bhada_per_bag: Optional[float] = Field(default=None, ge=0) # legacy/back-compat; used if bhada_total not provided
    sales: List[SaleIn] = Field(default_factory=list)


class LotOut(BaseModel):
    id: str
    auction_day_id: str
    date: str
    lot_serial_no: int
    total_bags: int
    lot_no: str        # derived display: f"{lot_serial_no}/{total_bags}"
    first_num: Optional[int]
    farmer_id: str
    farmer_name: str
    driver_name: Optional[str]
    driver_place: Optional[str]
    bhada_per_bag: float   # kept for downstream compat & driver-linked display
    bhada_total: float     # PRIMARY: total bhada charged for this lot
    sales: List[SaleOut]
    sold_bags: int    # sum of sales.bags
    gross_total: float
    created_at: datetime
    # Populated after auto-patti generation when the lot has sales.
    patti_id: Optional[str] = None
    patti_no: Optional[int] = None


class PattiLotOut(BaseModel):
    lot_serial_no: int
    total_bags: int    # announced qty for the lot
    lot_no: str        # derived display
    bhada_per_bag: float
    bhada_total: float
    sales: List[SaleOut]
    sold_bags: int    # sum of sales.bags for this lot
    gross: float
    farmer_amount: float


class PattiOut(BaseModel):
    id: str
    patti_no: int
    qr_token: str
    date: str
    auction_day_id: str
    lot_id: Optional[str] = None  # single-lot rule: 1 Patti = 1 Lot
    farmer_id: str
    farmer_name: str
    driver_name: Optional[str]
    driver_place: Optional[str]
    lots: List[PattiLotOut]
    total_bags: int
    gross_total: float
    farmer_gross: float
    hamali_per_bag: float
    stationery_flat: float
    payment_factor: float
    hamali_total: float
    stationery_total: float
    bhada_total: float
    deductions_total: float
    net_payable: float
    receiver_name: str
    receiver_updated_at: Optional[datetime]
    receiver_updated_by: Optional[str]
    status: str  # 'pending' | 'received'
    created_at: datetime
    printed: bool = False
    printed_at: Optional[datetime] = None
    print_count: int = 0


class ReceiverBody(BaseModel):
    receiver_name: str = Field(min_length=1, max_length=120)


class PattiEditSaleIn(BaseModel):
    vendor_id: str
    bags: int = Field(ge=1)
    rate_per_bag: float = Field(ge=0)


class PattiEditLotIn(BaseModel):
    # New primary fields (either provide serial+total OR legacy lot_no)
    lot_serial_no: Optional[int] = Field(default=None, ge=1, le=999999)
    total_bags: Optional[int] = Field(default=None, ge=1, le=99999)
    lot_no: Optional[str] = Field(default=None, min_length=1, max_length=30)  # legacy fallback
    bhada_per_bag: float = Field(default=0, ge=0)             # per-bag derived from bhada_total (legacy)
    bhada_total: Optional[float] = Field(default=None, ge=0)  # PRIMARY: total bhada (circled amount)
    sales: List[PattiEditSaleIn] = Field(min_length=1)


class PattiEditIn(BaseModel):
    farmer_id: str
    lots: List[PattiEditLotIn] = Field(min_length=1)
    hamali_per_bag: float = Field(ge=0)
    stationery_flat: float = Field(ge=0)
    payment_factor: float = Field(gt=0, le=1)
    receiver_name: Optional[str] = Field(default=None, max_length=120)


class DeletePattiBody(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)


class AuditEntry(BaseModel):
    at: datetime
    by: str
    role: str
    action: str  # 'edit' | 'delete' | 'restore' | 'receiver' | 'create'
    changes: Optional[dict] = None


# ---------- Auth helpers ----------
def make_token(user_id: str, shop_id: str, username: str, role: str) -> str:
    now = utc_now()
    return jwt.encode(
        {
            "sub": user_id,
            "shop_id": shop_id,
            "username": username,
            "role": role,
            "iat": now,
            "exp": now + timedelta(minutes=JWT_TTL_MINUTES),
        },
        JWT_SECRET,
        algorithm=JWT_ALG,
    )


async def current_user(token: Annotated[str, Depends(oauth2)]) -> dict:
    err = HTTPException(401, "Invalid or expired token", headers={"WWW-Authenticate": "Bearer"})
    try:
        claims = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.PyJWTError:
        raise err
    user_id = claims.get("sub")
    role = claims.get("role")
    shop_id = claims.get("shop_id")
    if not user_id or not role or not shop_id:
        raise err
    if role == "owner":
        shop = await db.shops.find_one({"id": user_id, "active": True}, {"_id": 0, "password_hash": 0})
        if not shop:
            raise err
        return {
            "id": shop["id"], "shop_id": shop["id"], "shop_name": shop["shop_name"],
            "username": shop["username"], "role": "owner", "display_name": shop["shop_name"],
        }
    if role == "counter":
        staff = await db.staff.find_one({"id": user_id, "shop_id": shop_id, "active": True}, {"_id": 0, "password_hash": 0})
        if not staff:
            raise err
        shop = await db.shops.find_one({"id": shop_id, "active": True}, {"_id": 0, "password_hash": 0})
        if not shop:
            raise err
        return {
            "id": staff["id"], "shop_id": shop_id, "shop_name": shop["shop_name"],
            "username": staff["username"], "role": "counter", "display_name": staff["name"],
        }
    raise err


async def owner_only(user=Depends(current_user)) -> dict:
    if user["role"] != "owner":
        raise HTTPException(403, "Owner role required")
    return user


# ---------- Auth routes ----------
@api.get("/")
async def root():
    return {"service": "Lemon Mandi Billing", "ok": True, "version": 2}


@api.post("/auth/signup", response_model=TokenOut, status_code=201)
async def signup(body: SignupBody):
    username = body.username.lower().strip()
    if await db.shops.find_one({"username": username}):
        raise HTTPException(409, "Username already exists")
    if await db.staff.find_one({"username": username}):
        raise HTTPException(409, "Username already exists")
    shop_id = uid()
    now = utc_now()
    await db.shops.insert_one({
        "id": shop_id, "shop_name": body.shop_name.strip(), "username": username,
        "password_hash": pwd.hash(body.password), "active": True, "created_at": now,
    })
    await db.settings.insert_one({
        "shop_id": shop_id, "payment_factor": 0.90, "hamali_per_bag": 10.0,
        "stationery_flat": 5.0, "default_bhada_per_bag": 0.0,
        "vendor_factor": 1.06, "vendor_margin_per_bag": 30.0, "commission_per_bag": 10.0,
        "vendor_hamali_default": 0.0, "updated_at": now,
    })
    return TokenOut(
        access_token=make_token(shop_id, shop_id, username, "owner"),
        shop_id=shop_id, shop_name=body.shop_name.strip(), username=username,
        role="owner", display_name=body.shop_name.strip(),
    )


@api.post("/auth/login", response_model=TokenOut)
async def login(body: LoginBody):
    username = body.username.lower().strip()
    shop = await db.shops.find_one({"username": username})
    if shop and pwd.verify(body.password, shop["password_hash"]) and shop.get("active", False):
        return TokenOut(
            access_token=make_token(shop["id"], shop["id"], shop["username"], "owner"),
            shop_id=shop["id"], shop_name=shop["shop_name"], username=shop["username"],
            role="owner", display_name=shop["shop_name"],
        )
    staff = await db.staff.find_one({"username": username})
    stored = staff["password_hash"] if staff else DUMMY_HASH
    ok = pwd.verify(body.password, stored)
    if staff and ok and staff.get("active", False):
        shop = await db.shops.find_one({"id": staff["shop_id"], "active": True})
        if shop:
            return TokenOut(
                access_token=make_token(staff["id"], staff["shop_id"], staff["username"], "counter"),
                shop_id=staff["shop_id"], shop_name=shop["shop_name"], username=staff["username"],
                role="counter", display_name=staff["name"],
            )
    raise HTTPException(401, "Incorrect username or password")


@api.get("/auth/me", response_model=MeOut)
async def me(user=Depends(current_user)):
    return MeOut(**user)


class VendorBillLineIn(BaseModel):
    """A snapshot of one lot's sale-portion sold to this vendor."""
    lot_id: Optional[str] = None  # for traceability, not required
    lot_no: str = Field(min_length=1, max_length=30)
    farmer_name: str = Field(min_length=1, max_length=120)
    bags: int = Field(ge=1)
    auction_rate: float = Field(ge=0)  # original auction rate per bag
    # Optional override — when set (e.g. merchant edits bill price), skips formula for this line
    vendor_rate: Optional[float] = Field(default=None, ge=0)


class VendorBillIn(BaseModel):
    vendor_id: str
    date: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    lines: List[VendorBillLineIn] = Field(min_length=1)
    vendor_factor: float = Field(default=1.06, gt=0)  # snapshotted; independent of farmer payment_factor
    margin_per_bag: float = Field(ge=0)
    commission_per_bag: float = Field(ge=0)
    hamali: float = Field(ge=0)  # per-bill absolute amount entered by biller
    cess: float = Field(default=0.0, ge=0)
    notes: Optional[str] = Field(default=None, max_length=500)


class VendorBillLineOut(BaseModel):
    lot_id: Optional[str]
    lot_no: str
    farmer_name: str
    bags: int
    auction_rate: float
    vendor_rate: float  # auction_rate * vendor_factor + margin_per_bag
    amount: float


class VendorBillOut(BaseModel):
    id: str
    bill_no: int
    bill_code: str  # e.g. "VB-0001"
    vendor_id: str
    vendor_name: str
    vendor_details: Optional[str] = None  # Snapshot of vendor.details at bill time
    date: str
    lines: List[VendorBillLineOut]
    total_bags: int
    goods_total: float
    vendor_factor: float = 1.06
    margin_per_bag: float
    commission_per_bag: float
    commission_total: float
    hamali: float
    cess: float
    grand_total: float
    paid: float
    balance: float
    status: str  # 'unpaid' | 'partial' | 'paid' | 'deleted'
    notes: Optional[str]
    created_at: datetime
    updated_at: Optional[datetime] = None


class VendorPaymentAllocIn(BaseModel):
    bill_id: str
    amount: float = Field(ge=0)


class VendorPaymentIn(BaseModel):
    vendor_id: str
    date: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    amount: float = Field(gt=0)
    mode: str = Field(default="cash", max_length=30)
    remarks: Optional[str] = Field(default=None, max_length=500)
    allocations: List[VendorPaymentAllocIn] = Field(default_factory=list)


class VendorPaymentOut(BaseModel):
    id: str
    vendor_id: str
    vendor_name: str
    date: str
    amount: float
    mode: str
    remarks: Optional[str]
    allocations: List[VendorPaymentAllocIn]
    created_at: datetime


class VendorDashboardOut(BaseModel):
    vendor_id: str
    vendor_name: str
    phone: Optional[str]
    total_bills: int
    total_bags: int
    total_purchase: float
    total_paid: float
    outstanding: float


class DeleteBody(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)


# ---------- Merchant profile (owner only edit; all authed users can read) ----------
def _shop_profile_dict(shop: dict) -> dict:
    fields = list(ShopProfile.model_fields.keys())
    return {k: shop.get(k) for k in fields}


@api.get("/shop/profile", response_model=ShopProfileOut)
async def get_shop_profile(user=Depends(current_user)):
    shop = await db.shops.find_one({"id": user["shop_id"]}, {"_id": 0, "password_hash": 0})
    if not shop:
        raise HTTPException(404, "Shop not found")
    return ShopProfileOut(id=shop["id"], username=shop["username"], **_shop_profile_dict(shop))


@api.put("/shop/profile", response_model=ShopProfileOut)
async def update_shop_profile(body: ShopProfile, user=Depends(owner_only)):
    shop = await db.shops.find_one_and_update(
        {"id": user["shop_id"]},
        {"$set": {**body.model_dump(), "updated_at": utc_now()}},
        return_document=True, projection={"_id": 0, "password_hash": 0},
    )
    if not shop:
        raise HTTPException(404, "Shop not found")
    return ShopProfileOut(id=shop["id"], username=shop["username"], **_shop_profile_dict(shop))


# ---------- Settings ----------
@api.get("/settings", response_model=Settings)
async def read_settings(user=Depends(current_user)):
    doc = await db.settings.find_one({"shop_id": user["shop_id"]}, {"_id": 0})
    if not doc:
        return Settings()
    # Backward-compat: migrate legacy `stationery_per_bag` -> `stationery_flat`
    if "stationery_flat" not in doc and "stationery_per_bag" in doc:
        doc["stationery_flat"] = float(doc.get("stationery_per_bag") or 5.0)
    return Settings(**{k: v for k, v in doc.items() if k in Settings.model_fields})


@api.put("/settings", response_model=Settings)
async def update_settings(body: Settings, user=Depends(owner_only)):
    await db.settings.update_one(
        {"shop_id": user["shop_id"]},
        {"$set": {**body.model_dump(), "updated_at": utc_now()}},
        upsert=True,
    )
    return body


# ---------- Farmers ----------
@api.get("/farmers", response_model=List[FarmerOut])
async def list_farmers(user=Depends(current_user), q: Optional[str] = None):
    query = {"shop_id": user["shop_id"]}
    if q:
        query["name"] = {"$regex": q, "$options": "i"}
    cur = db.farmers.find(query, {"_id": 0, "shop_id": 0}).sort("name", 1).limit(1000)
    return [FarmerOut(**d) async for d in cur]


@api.post("/farmers", response_model=FarmerOut, status_code=201)
async def add_farmer(body: FarmerIn, user=Depends(current_user)):
    doc = {"id": uid(), "shop_id": user["shop_id"], "name": body.name.strip(),
           "phone": body.phone, "village": body.village, "created_at": utc_now()}
    await db.farmers.insert_one(doc)
    doc.pop("shop_id"); doc.pop("_id", None)
    return FarmerOut(**doc)


@api.put("/farmers/{farmer_id}", response_model=FarmerOut)
async def update_farmer(farmer_id: str, body: FarmerIn, user=Depends(current_user)):
    d = await db.farmers.find_one_and_update(
        {"id": farmer_id, "shop_id": user["shop_id"]},
        {"$set": body.model_dump()}, return_document=True,
        projection={"_id": 0, "shop_id": 0},
    )
    if not d:
        raise HTTPException(404, "Farmer not found")
    return FarmerOut(**d)


@api.delete("/farmers/{farmer_id}", status_code=204)
async def delete_farmer(farmer_id: str, user=Depends(current_user)):
    r = await db.farmers.delete_one({"id": farmer_id, "shop_id": user["shop_id"]})
    if r.deleted_count == 0:
        raise HTTPException(404, "Farmer not found")


# ---------- Vendors ----------
@api.get("/vendors", response_model=List[VendorOut])
async def list_vendors(user=Depends(current_user), q: Optional[str] = None):
    query = {"shop_id": user["shop_id"]}
    if q:
        query["name"] = {"$regex": q, "$options": "i"}
    cur = db.vendors.find(query, {"_id": 0, "shop_id": 0}).sort("name", 1).limit(1000)
    return [VendorOut(**d) async for d in cur]


@api.post("/vendors", response_model=VendorOut, status_code=201)
async def add_vendor(body: VendorIn, user=Depends(current_user)):
    doc = {"id": uid(), "shop_id": user["shop_id"], "name": body.name.strip(),
           "details": (body.details or "").strip() or None,
           "phone": body.phone, "created_at": utc_now()}
    await db.vendors.insert_one(doc)
    doc.pop("shop_id"); doc.pop("_id", None)
    return VendorOut(**doc)


@api.put("/vendors/{vendor_id}", response_model=VendorOut)
async def update_vendor(vendor_id: str, body: VendorIn, user=Depends(current_user)):
    d = await db.vendors.find_one_and_update(
        {"id": vendor_id, "shop_id": user["shop_id"]},
        {"$set": body.model_dump()}, return_document=True,
        projection={"_id": 0, "shop_id": 0},
    )
    if not d:
        raise HTTPException(404, "Vendor not found")
    return VendorOut(**d)


@api.delete("/vendors/{vendor_id}", status_code=204)
async def delete_vendor(vendor_id: str, user=Depends(current_user)):
    r = await db.vendors.delete_one({"id": vendor_id, "shop_id": user["shop_id"]})
    if r.deleted_count == 0:
        raise HTTPException(404, "Vendor not found")


# ---------- Staff (owner only) ----------
@api.get("/staff", response_model=List[StaffOut])
async def list_staff(user=Depends(owner_only)):
    cur = db.staff.find({"shop_id": user["shop_id"]}, {"_id": 0, "password_hash": 0, "shop_id": 0}).sort("name", 1)
    return [StaffOut(**d) async for d in cur]


@api.post("/staff", response_model=StaffOut, status_code=201)
async def add_staff(body: StaffIn, user=Depends(owner_only)):
    if not body.password:
        raise HTTPException(400, "Password required for new staff")
    username = body.username.lower().strip()
    if await db.shops.find_one({"username": username}) or await db.staff.find_one({"username": username}):
        raise HTTPException(409, "Username already exists")
    doc = {
        "id": uid(), "shop_id": user["shop_id"], "name": body.name.strip(),
        "username": username, "password_hash": pwd.hash(body.password),
        "role": "counter", "active": True, "created_at": utc_now(),
    }
    await db.staff.insert_one(doc)
    return StaffOut(id=doc["id"], name=doc["name"], username=doc["username"],
                    role=doc["role"], active=doc["active"], created_at=doc["created_at"])


@api.put("/staff/{staff_id}", response_model=StaffOut)
async def update_staff(staff_id: str, body: StaffIn, user=Depends(owner_only)):
    update: dict = {"name": body.name.strip()}
    if body.password:
        update["password_hash"] = pwd.hash(body.password)
    # username change: must remain unique
    username = body.username.lower().strip()
    existing = await db.staff.find_one({"username": username, "shop_id": user["shop_id"]})
    if existing and existing["id"] != staff_id:
        raise HTTPException(409, "Username already exists")
    if await db.shops.find_one({"username": username, "id": {"$ne": user["shop_id"]}}):
        raise HTTPException(409, "Username already exists")
    update["username"] = username
    d = await db.staff.find_one_and_update(
        {"id": staff_id, "shop_id": user["shop_id"]},
        {"$set": update}, return_document=True,
        projection={"_id": 0, "password_hash": 0, "shop_id": 0},
    )
    if not d:
        raise HTTPException(404, "Staff not found")
    return StaffOut(**d)


@api.delete("/staff/{staff_id}", status_code=204)
async def delete_staff(staff_id: str, user=Depends(owner_only)):
    r = await db.staff.delete_one({"id": staff_id, "shop_id": user["shop_id"]})
    if r.deleted_count == 0:
        raise HTTPException(404, "Staff not found")


# ---------- Auction Day ----------
async def _get_or_create_day(shop_id: str, date: str) -> dict:
    doc = await db.auction_days.find_one({"shop_id": shop_id, "date": date}, {"_id": 0})
    if doc:
        return doc
    doc = {"id": uid(), "shop_id": shop_id, "date": date, "drivers": [], "created_at": utc_now()}
    await db.auction_days.insert_one(doc)
    return doc


async def _day_stats(day: dict) -> dict:
    pipeline = [
        {"$match": {"shop_id": day["shop_id"], "auction_day_id": day["id"]}},
        {"$group": {
            "_id": None,
            "lot_count": {"$sum": 1},
            "bag_count": {"$sum": "$total_bags"},
            "farmer_ids": {"$addToSet": "$farmer_id"},
        }},
    ]
    agg = await db.lots.aggregate(pipeline).to_list(1)
    if not agg:
        return {"lot_count": 0, "bag_count": 0, "farmer_count": 0}
    row = agg[0]
    return {
        "lot_count": int(row["lot_count"]),
        "bag_count": int(row["bag_count"]),
        "farmer_count": len(row["farmer_ids"]),
    }


def _pick_driver(drivers: List[dict], lot_no: str) -> tuple[Optional[str], Optional[str], Optional[float]]:
    n = _lot_first_num(lot_no)
    if n is None:
        return None, None, None
    for d in drivers:
        if d["range_from"] <= n <= d["range_to"]:
            return d["name"], d.get("place"), float(d["bhada_per_bag"])
    return None, None, None


@api.get("/auction-days/today", response_model=AuctionDayOut)
async def today_day(user=Depends(current_user), date: Optional[str] = None):
    d = date or _today_str()
    day = await _get_or_create_day(user["shop_id"], d)
    stats = await _day_stats(day)
    return AuctionDayOut(id=day["id"], date=day["date"],
                        drivers=[DriverRange(**x) for x in day.get("drivers", [])], **stats)


@api.put("/auction-days/{day_id}", response_model=AuctionDayOut)
async def update_day(day_id: str, body: AuctionDayIn, user=Depends(owner_only)):
    # validate ranges + non-overlap
    for d in body.drivers:
        if d.range_from > d.range_to:
            raise HTTPException(400, f"Driver {d.name}: range_from > range_to")
    sorted_d = sorted(body.drivers, key=lambda x: x.range_from)
    for i in range(1, len(sorted_d)):
        if sorted_d[i].range_from <= sorted_d[i - 1].range_to:
            raise HTTPException(
                400,
                f"Driver ranges overlap: {sorted_d[i - 1].name} ({sorted_d[i - 1].range_from}-{sorted_d[i - 1].range_to}) and {sorted_d[i].name} ({sorted_d[i].range_from}-{sorted_d[i].range_to})",
            )
    day = await db.auction_days.find_one_and_update(
        {"id": day_id, "shop_id": user["shop_id"]},
        {"$set": {"drivers": [d.model_dump() for d in body.drivers], "date": body.date, "updated_at": utc_now()}},
        return_document=True, projection={"_id": 0},
    )
    if not day:
        raise HTTPException(404, "Auction day not found")
    # re-assign drivers on existing lots for this day (best effort; keep manual bhada overrides untouched)
    async for lot in db.lots.find({"auction_day_id": day_id, "shop_id": user["shop_id"]}, {"_id": 0}):
        drv_name, drv_place, drv_bhada = _pick_driver(day["drivers"], lot["lot_no"])
        upd = {"driver_name": drv_name, "driver_place": drv_place}
        # if bhada wasn't manually overridden (marker), refresh it too
        if lot.get("bhada_manual") is not True and drv_bhada is not None:
            upd["bhada_per_bag"] = drv_bhada
        await db.lots.update_one({"id": lot["id"]}, {"$set": upd})

    stats = await _day_stats(day)
    return AuctionDayOut(id=day["id"], date=day["date"],
                        drivers=[DriverRange(**x) for x in day.get("drivers", [])], **stats)


# ---------- Lots (Action Book) ----------
def _sale_gross(sale: dict) -> float:
    return _round2(sale["bags"] * sale["rate_per_bag"])


async def _hydrate_lot(shop_id: str, lot: dict, patti_id: Optional[str] = None, patti_no: Optional[int] = None) -> LotOut:
    sold_bags = sum(s["bags"] for s in lot.get("sales", []))
    gross_total = _round2(sum(s["bags"] * s["rate_per_bag"] for s in lot.get("sales", [])))
    sales_out = [SaleOut(**s, gross=_sale_gross(s)) for s in lot.get("sales", [])]
    # Backward-compat: legacy lots may lack lot_serial_no / total_bags. Derive from lot_no.
    serial = lot.get("lot_serial_no")
    total = lot.get("total_bags")
    if serial is None or total is None:
        ps, pt = _parse_lot_no_str(lot.get("lot_no") or "")
        if serial is None:
            serial = ps if ps is not None else (lot.get("first_num") or 0)
        if total is None:
            total = pt if pt is not None else sold_bags
    lot_no_display = lot.get("lot_no") or f"{serial}/{total}"
    bhada_per_bag = float(lot.get("bhada_per_bag", 0))
    bhada_total = lot.get("bhada_total")
    if bhada_total is None:
        bhada_total = round(bhada_per_bag * int(total or 0), 2)
    # Fill in patti_id/no if not passed
    if patti_id is None:
        existing_patti = await db.pattis.find_one(
            {"shop_id": shop_id, "lot_id": lot["id"]}, {"_id": 0, "id": 1, "patti_no": 1},
        )
        if existing_patti:
            patti_id = existing_patti.get("id")
            patti_no = existing_patti.get("patti_no")
    return LotOut(
        id=lot["id"], auction_day_id=lot["auction_day_id"], date=lot["date"],
        lot_serial_no=int(serial or 0), total_bags=int(total or 0),
        lot_no=lot_no_display, first_num=lot.get("first_num"),
        farmer_id=lot["farmer_id"], farmer_name=lot["farmer_name"],
        driver_name=lot.get("driver_name"), driver_place=lot.get("driver_place"),
        bhada_per_bag=bhada_per_bag, bhada_total=float(bhada_total),
        sales=sales_out,
        sold_bags=sold_bags, gross_total=gross_total, created_at=lot["created_at"],
        patti_id=patti_id, patti_no=patti_no,
    )


@api.get("/lots", response_model=List[LotOut])
async def list_lots(user=Depends(current_user), auction_day_id: Optional[str] = None, date: Optional[str] = None):
    query: dict = {"shop_id": user["shop_id"]}
    if auction_day_id:
        query["auction_day_id"] = auction_day_id
    elif date:
        query["date"] = date
    else:
        query["date"] = _today_str()
    cur = db.lots.find(query, {"_id": 0}).sort("created_at", 1)
    return [await _hydrate_lot(user["shop_id"], d) async for d in cur]


@api.post("/lots", response_model=LotOut, status_code=201)
async def create_lot(body: LotIn, user=Depends(current_user)):
    day = await db.auction_days.find_one({"id": body.auction_day_id, "shop_id": user["shop_id"]}, {"_id": 0})
    if not day:
        raise HTTPException(400, "Auction day not found")
    farmer = await db.farmers.find_one({"id": body.farmer_id, "shop_id": user["shop_id"]}, {"_id": 0})
    if not farmer:
        raise HTTPException(400, "Farmer not found")

    sales_sum = sum(int(s.bags) for s in body.sales)
    serial, total_bags, lot_no_display = _resolve_lot_fields(
        body.lot_serial_no, body.total_bags, body.lot_no, sales_sum,
    )
    # Business rule: if sales exist, sum(sales.bags) must equal total_bags
    if sales_sum > 0 and sales_sum != total_bags:
        if sales_sum < total_bags:
            msg = f"Auction incomplete – {total_bags - sales_sum} bag(s) still pending for Lot {serial}."
        else:
            msg = f"Invalid quantity – sold quantity exceeds the total bags in Lot {serial}."
        raise HTTPException(
            422,
            {"code": "bags_mismatch", "message": msg,
             "total_bags": total_bags, "sold_bags": sales_sum, "lot_serial_no": serial},
        )

    # Duplicate lot check: by lot_serial_no on the same auction day
    dup = await db.lots.find_one(
        {"shop_id": user["shop_id"], "auction_day_id": body.auction_day_id, "lot_serial_no": serial},
        {"_id": 0, "id": 1, "farmer_id": 1, "farmer_name": 1},
    )
    if dup:
        raise HTTPException(
            409,
            {
                "code": "duplicate_lot",
                "message": f"Lot serial #{serial} already exists today",
                "existing_lot_id": dup["id"],
                "existing_farmer_name": dup["farmer_name"],
            },
        )

    drv_name, drv_place, drv_bhada = _pick_driver(day.get("drivers", []), lot_no_display)
    # Bhada resolution: prefer explicit bhada_total (circled amount) → derive per-bag.
    # Fallback: legacy bhada_per_bag input. Fallback: driver.bhada_per_bag × total_bags.
    if body.bhada_total is not None:
        bhada_total_val = float(body.bhada_total)
        bhada_per_bag_val = round(bhada_total_val / total_bags, 6) if total_bags > 0 else 0.0
        bhada_manual = True
    elif body.bhada_per_bag is not None:
        bhada_per_bag_val = float(body.bhada_per_bag)
        bhada_total_val = round(bhada_per_bag_val * total_bags, 2)
        bhada_manual = True
    else:
        bhada_per_bag_val = float(drv_bhada or 0.0)
        bhada_total_val = round(bhada_per_bag_val * total_bags, 2)
        bhada_manual = False

    sales_docs: List[dict] = []
    for s in body.sales:
        vendor = await db.vendors.find_one({"id": s.vendor_id, "shop_id": user["shop_id"]}, {"_id": 0})
        if not vendor:
            raise HTTPException(400, f"Vendor {s.vendor_id} not found")
        sales_docs.append({
            "vendor_id": vendor["id"], "vendor_name": vendor["name"],
            "bags": int(s.bags), "rate_per_bag": float(s.rate_per_bag),
        })

    doc = {
        "id": uid(), "shop_id": user["shop_id"],
        "auction_day_id": day["id"], "date": day["date"],
        "lot_serial_no": serial, "total_bags": total_bags,
        "lot_no": lot_no_display,       # kept for legacy consumers/searches
        "first_num": serial,
        "farmer_id": farmer["id"], "farmer_name": farmer["name"],
        "driver_name": drv_name, "driver_place": drv_place,
        "bhada_per_bag": bhada_per_bag_val,
        "bhada_total": bhada_total_val,
        "bhada_manual": bhada_manual,
        "sales": sales_docs,
        "created_at": utc_now(),
    }
    await db.lots.insert_one(doc)
    # Auto-generate the 1-Patti-per-Lot patti now that the lot exists.
    patti_id: Optional[str] = None
    patti_no: Optional[int] = None
    if sales_docs:
        patti_doc = await _generate_patti_for_lot(user["shop_id"], day, doc)
        patti_id = patti_doc.get("id")
        patti_no = patti_doc.get("patti_no")
    return await _hydrate_lot(user["shop_id"], doc, patti_id=patti_id, patti_no=patti_no)


@api.put("/lots/{lot_id}", response_model=LotOut)
async def update_lot(lot_id: str, body: LotIn, user=Depends(owner_only)):
    day = await db.auction_days.find_one({"id": body.auction_day_id, "shop_id": user["shop_id"]}, {"_id": 0})
    if not day:
        raise HTTPException(400, "Auction day not found")
    farmer = await db.farmers.find_one({"id": body.farmer_id, "shop_id": user["shop_id"]}, {"_id": 0})
    if not farmer:
        raise HTTPException(400, "Farmer not found")

    sales_sum = sum(int(s.bags) for s in body.sales)
    serial, total_bags, lot_no_display = _resolve_lot_fields(
        body.lot_serial_no, body.total_bags, body.lot_no, sales_sum,
    )
    if sales_sum > 0 and sales_sum != total_bags:
        raise HTTPException(
            422,
            {"code": "bags_mismatch",
             "message": f"Total bags declared ({total_bags}) doesn't match sum of vendor bags ({sales_sum})."},
        )

    # Duplicate check by lot_serial_no on the same auction day
    dup = await db.lots.find_one(
        {
            "shop_id": user["shop_id"],
            "auction_day_id": body.auction_day_id,
            "lot_serial_no": serial,
            "id": {"$ne": lot_id},
        },
        {"_id": 0, "id": 1, "farmer_name": 1},
    )
    if dup:
        raise HTTPException(
            409,
            {
                "code": "duplicate_lot",
                "message": f"Lot serial #{serial} already exists today",
                "existing_lot_id": dup["id"],
                "existing_farmer_name": dup["farmer_name"],
            },
        )
    drv_name, drv_place, drv_bhada = _pick_driver(day.get("drivers", []), lot_no_display)
    if body.bhada_total is not None:
        bhada_total_val = float(body.bhada_total)
        bhada_per_bag_val = round(bhada_total_val / total_bags, 6) if total_bags > 0 else 0.0
        bhada_manual = True
    elif body.bhada_per_bag is not None:
        bhada_per_bag_val = float(body.bhada_per_bag)
        bhada_total_val = round(bhada_per_bag_val * total_bags, 2)
        bhada_manual = True
    else:
        bhada_per_bag_val = float(drv_bhada or 0.0)
        bhada_total_val = round(bhada_per_bag_val * total_bags, 2)
        bhada_manual = False

    sales_docs: List[dict] = []
    for s in body.sales:
        vendor = await db.vendors.find_one({"id": s.vendor_id, "shop_id": user["shop_id"]}, {"_id": 0})
        if not vendor:
            raise HTTPException(400, f"Vendor {s.vendor_id} not found")
        sales_docs.append({
            "vendor_id": vendor["id"], "vendor_name": vendor["name"],
            "bags": int(s.bags), "rate_per_bag": float(s.rate_per_bag),
        })

    update = {
        "auction_day_id": day["id"], "date": day["date"],
        "lot_serial_no": serial, "total_bags": total_bags,
        "lot_no": lot_no_display,
        "first_num": serial,
        "farmer_id": farmer["id"], "farmer_name": farmer["name"],
        "driver_name": drv_name, "driver_place": drv_place,
        "bhada_per_bag": bhada_per_bag_val,
        "bhada_total": bhada_total_val,
        "bhada_manual": bhada_manual,
        "sales": sales_docs,
    }
    d = await db.lots.find_one_and_update(
        {"id": lot_id, "shop_id": user["shop_id"]},
        {"$set": update}, return_document=True, projection={"_id": 0},
    )
    if not d:
        raise HTTPException(404, "Lot not found")
    # Refresh the patti for this lot.
    patti_id: Optional[str] = None
    patti_no: Optional[int] = None
    if d.get("sales"):
        patti_doc = await _generate_patti_for_lot(user["shop_id"], day, d)
        patti_id = patti_doc.get("id")
        patti_no = patti_doc.get("patti_no")
    else:
        # If sales removed on edit, delete any orphan patti.
        await db.pattis.delete_many({"shop_id": user["shop_id"], "lot_id": lot_id})
    return await _hydrate_lot(user["shop_id"], d, patti_id=patti_id, patti_no=patti_no)


@api.delete("/lots/{lot_id}", status_code=204)
async def delete_lot(lot_id: str, user=Depends(current_user)):
    r = await db.lots.delete_one({"id": lot_id, "shop_id": user["shop_id"]})
    if r.deleted_count == 0:
        raise HTTPException(404, "Lot not found")
    # Cascade: remove the 1-per-lot Patti as well.
    await db.pattis.delete_many({"shop_id": user["shop_id"], "lot_id": lot_id})


# ---------- Pattis ----------
async def _next_patti_no(shop_id: str) -> int:
    c = await db.counters.find_one_and_update(
        {"shop_id": shop_id, "kind": "patti"},
        {"$inc": {"seq": 1}}, upsert=True, return_document=True,
    )
    return int(c["seq"])


async def _generate_patti_for_lot(user_shop: str, day: dict, lot: dict) -> dict:
    """Compute and upsert one Patti for a single lot. Business rule: 1 Patti = 1 Lot."""
    settings_doc = await db.settings.find_one({"shop_id": user_shop}, {"_id": 0}) or {}
    factor = float(settings_doc.get("payment_factor", 0.90))
    hamali_per_bag = float(settings_doc.get("hamali_per_bag", 10.0))
    stationery_flat = float(settings_doc.get("stationery_flat", settings_doc.get("stationery_per_bag", 5.0)))

    farmer_id = lot["farmer_id"]
    farmer_name = lot["farmer_name"]
    driver_name = lot.get("driver_name")
    driver_place = lot.get("driver_place")

    lot_bags = sum(s["bags"] for s in lot.get("sales", []))
    lot_gross = sum(s["bags"] * s["rate_per_bag"] for s in lot.get("sales", []))
    farmer_amt = lot_gross * factor
    stored_total = lot.get("bhada_total")
    lot_bhada = float(stored_total) if stored_total is not None else lot_bags * float(lot.get("bhada_per_bag", 0))

    lot_serial = lot.get("lot_serial_no")
    lot_total = lot.get("total_bags")
    if lot_serial is None or lot_total is None:
        ps, pt = _parse_lot_no_str(lot.get("lot_no") or "")
        lot_serial = lot_serial or ps or lot.get("first_num") or 0
        lot_total = lot_total or pt or lot_bags
    lot_no_display = lot.get("lot_no") or f"{lot_serial}/{lot_total}"

    lots_out = [{
        "lot_serial_no": int(lot_serial or 0),
        "total_bags": int(lot_total or lot_bags),
        "lot_no": lot_no_display,
        "bhada_per_bag": float(lot.get("bhada_per_bag", 0)),
        "bhada_total": _round2(lot_bhada),
        "sales": [{**s, "gross": _sale_gross(s)} for s in lot.get("sales", [])],
        "sold_bags": lot_bags,
        "gross": _round2(lot_gross),
        "farmer_amount": _round2(farmer_amt),
    }]

    total_bags = lot_bags
    gross_total = lot_gross
    farmer_gross = farmer_amt
    bhada_total = lot_bhada
    hamali_total = total_bags * hamali_per_bag
    stationery_total = stationery_flat  # flat charge per Patti
    deductions_total = hamali_total + stationery_total + bhada_total
    net_payable = farmer_gross - deductions_total

    existing = await db.pattis.find_one(
        {"shop_id": user_shop, "auction_day_id": day["id"], "lot_id": lot["id"]},
        {"_id": 0},
    )
    if existing:
        patti_no = existing["patti_no"]
        qr_token = existing["qr_token"]
        status_ = existing.get("status", "pending")
        receiver_name = existing.get("receiver_name") or (driver_name or farmer_name)
        receiver_updated_at = existing.get("receiver_updated_at")
        receiver_updated_by = existing.get("receiver_updated_by")
        created_at = existing.get("created_at", utc_now())
    else:
        patti_no = await _next_patti_no(user_shop)
        qr_token = uid()
        status_ = "pending"
        receiver_name = driver_name or farmer_name
        receiver_updated_at = None
        receiver_updated_by = None
        created_at = utc_now()

    doc = {
        "id": existing["id"] if existing else uid(),
        "shop_id": user_shop,
        "patti_no": patti_no, "qr_token": qr_token,
        "date": day["date"], "auction_day_id": day["id"],
        "lot_id": lot["id"],
        "farmer_id": farmer_id, "farmer_name": farmer_name,
        "driver_name": driver_name, "driver_place": driver_place,
        "lots": lots_out,
        "total_bags": total_bags,
        "gross_total": _round2(gross_total),
        "farmer_gross": _round2(farmer_gross),
        "hamali_per_bag": hamali_per_bag,
        "stationery_flat": stationery_flat,
        "payment_factor": factor,
        "hamali_total": _round2(hamali_total),
        "stationery_total": _round2(stationery_total),
        "bhada_total": _round2(bhada_total),
        "deductions_total": _round2(deductions_total),
        "net_payable": _round2(net_payable),
        "receiver_name": receiver_name,
        "receiver_updated_at": receiver_updated_at,
        "receiver_updated_by": receiver_updated_by,
        "status": status_,
        "created_at": created_at,
        "updated_at": utc_now(),
        # Preserve print history across re-generate (idempotent refresh).
        "printed": bool(existing.get("printed")) if existing else False,
        "printed_at": existing.get("printed_at") if existing else None,
        "print_count": int(existing.get("print_count") or 0) if existing else 0,
    }
    await db.pattis.update_one(
        {"shop_id": user_shop, "auction_day_id": day["id"], "lot_id": lot["id"]},
        {"$set": doc}, upsert=True,
    )
    return doc


@api.post("/auction-days/{day_id}/generate-pattis", response_model=List[PattiOut])
async def generate_pattis(day_id: str, user=Depends(current_user)):
    day = await db.auction_days.find_one({"id": day_id, "shop_id": user["shop_id"]}, {"_id": 0})
    if not day:
        raise HTTPException(404, "Auction day not found")
    # One Patti per Lot. Iterate all lots (with vendor sales) for the day.
    active_lot_ids: set[str] = set()
    out: List[dict] = []
    async for lot in db.lots.find(
        {"shop_id": user["shop_id"], "auction_day_id": day_id},
        {"_id": 0},
    ).sort("created_at", 1):
        if not lot.get("sales"):
            continue  # skip lots that have no vendor sales yet
        active_lot_ids.add(lot["id"])
        d = await _generate_patti_for_lot(user["shop_id"], day, lot)
        d.pop("shop_id", None)
        out.append(d)

    # Cleanup: remove pattis for lots that no longer exist (or lost their sales).
    async for p in db.pattis.find(
        {"shop_id": user["shop_id"], "auction_day_id": day_id},
        {"_id": 0, "id": 1, "lot_id": 1, "farmer_id": 1},
    ):
        if p.get("lot_id") and p["lot_id"] not in active_lot_ids:
            await db.pattis.delete_one({"id": p["id"], "shop_id": user["shop_id"]})
    return [PattiOut(**_patti_read_compat(d)) for d in sorted(out, key=lambda x: x["patti_no"])]


def _patti_read_compat(d: dict) -> dict:
    """Backward-compat: legacy pattis stored `stationery_per_bag` (per-bag); PattiOut now uses `stationery_flat`.
    Also backfills lot_serial_no / total_bags / sold_bags on each nested lot from legacy `lot_no` string.
    """
    if "stationery_flat" not in d:
        # If legacy has stationery_total, use that as the flat value; else fallback to per-bag×bags or 5.
        if d.get("stationery_total") is not None:
            d["stationery_flat"] = float(d.get("stationery_total") or 0)
        elif "stationery_per_bag" in d:
            d["stationery_flat"] = float(d.get("stationery_per_bag") or 5.0)
        else:
            d["stationery_flat"] = 5.0
    # Backfill lot fields
    for lot in d.get("lots", []) or []:
        sold = lot.get("sold_bags")
        if sold is None:
            # legacy: total_bags in the doc was actually the sold sum
            sold = sum(int(s.get("bags", 0)) for s in lot.get("sales", []))
            lot["sold_bags"] = sold
        if lot.get("lot_serial_no") is None or lot.get("total_bags") is None or "lot_no" not in lot:
            ps, pt = _parse_lot_no_str(lot.get("lot_no") or "")
            if lot.get("lot_serial_no") is None:
                lot["lot_serial_no"] = ps if ps is not None else 0
            if lot.get("total_bags") is None:
                lot["total_bags"] = pt if pt is not None else sold
            if "lot_no" not in lot or not lot["lot_no"]:
                lot["lot_no"] = f"{lot['lot_serial_no']}/{lot['total_bags']}"
        if "bhada_total" not in lot or lot["bhada_total"] is None:
            lot["bhada_total"] = round(float(lot.get("bhada_per_bag", 0)) * int(lot.get("total_bags", 0)), 2)
    # Print status defaults for legacy documents
    if "printed" not in d:
        d["printed"] = False
    if "print_count" not in d or d["print_count"] is None:
        d["print_count"] = 0
    if "printed_at" not in d:
        d["printed_at"] = None
    return d


@api.get("/pattis", response_model=List[PattiOut])
async def list_pattis(user=Depends(current_user), date: Optional[str] = None, limit: int = 500,
                      include_deleted: bool = False):
    query: dict = {"shop_id": user["shop_id"]}
    if not include_deleted:
        query["deleted"] = {"$ne": True}
    if date:
        # Strict YYYY-MM-DD validation to avoid silent no-match on typos.
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            raise HTTPException(422, "Invalid date format. Expected YYYY-MM-DD.")
        query["date"] = date
    cur = db.pattis.find(query, {"_id": 0, "shop_id": 0}).sort([("date", -1), ("patti_no", -1)]).limit(limit)
    return [PattiOut(**_patti_read_compat(d)) async for d in cur]


@api.get("/pattis/{patti_id}", response_model=PattiOut)
async def get_patti(patti_id: str, user=Depends(current_user)):
    d = await db.pattis.find_one({"id": patti_id, "shop_id": user["shop_id"]}, {"_id": 0, "shop_id": 0})
    if not d:
        raise HTTPException(404, "Patti not found")
    return PattiOut(**_patti_read_compat(d))


@api.get("/pattis/{patti_id}/audit", response_model=List[AuditEntry])
async def get_patti_audit(patti_id: str, user=Depends(owner_only)):
    d = await db.pattis.find_one(
        {"id": patti_id, "shop_id": user["shop_id"]},
        {"_id": 0, "audit_log": 1, "receiver_history": 1},
    )
    if not d:
        raise HTTPException(404, "Patti not found")
    log = list(d.get("audit_log", []))
    for r in d.get("receiver_history", []):
        log.append({"at": r["at"], "by": r["by"], "role": r.get("role", "-"),
                    "action": "receiver", "changes": {"receiver_name": r["name"]}})
    log.sort(key=lambda x: x["at"])
    return [AuditEntry(**x) for x in log]


def _hydrate_edit_lots(sales_lookup: dict, lots_in: List[PattiEditLotIn], factor: float) -> tuple[List[dict], int, float, float, float]:
    """Return (lots_out, total_bags, gross_total, farmer_gross, bhada_total)."""
    lots_out: List[dict] = []
    total_bags = 0
    gross_total = 0.0
    farmer_gross = 0.0
    bhada_total = 0.0
    for lot in lots_in:
        lot_bags = 0
        lot_gross = 0.0
        sales: List[dict] = []
        for s in lot.sales:
            v = sales_lookup.get(s.vendor_id)
            if not v:
                raise HTTPException(400, f"Vendor {s.vendor_id} not found")
            g = s.bags * s.rate_per_bag
            lot_bags += s.bags
            lot_gross += g
            sales.append({
                "vendor_id": v["id"], "vendor_name": v["name"],
                "bags": int(s.bags), "rate_per_bag": float(s.rate_per_bag),
                "gross": _round2(g),
            })
        farmer_amt = lot_gross * factor
        # Resolve serial + total_bags for edit input (supports legacy or new)
        lot_serial, lot_total, lot_no_disp = _resolve_lot_fields(
            lot.lot_serial_no, lot.total_bags, lot.lot_no, lot_bags,
        )
        # Validate that sum(sales.bags) equals declared total_bags (business rule)
        if lot_bags != lot_total:
            raise HTTPException(
                422,
                {"code": "bags_mismatch",
                 "message": f"Lot {lot_serial}: declared {lot_total} bags but vendors sum to {lot_bags}."},
            )
        # Bhada: prefer explicit bhada_total (circled) → derive per-bag; else legacy per-bag.
        if lot.bhada_total is not None:
            lot_bhada = float(lot.bhada_total)
            lot_bhada_per_bag = round(lot_bhada / lot_total, 6) if lot_total > 0 else 0.0
        else:
            lot_bhada_per_bag = float(lot.bhada_per_bag or 0)
            lot_bhada = lot_bhada_per_bag * lot_total
        lots_out.append({
            "lot_serial_no": lot_serial,
            "total_bags": lot_total,
            "lot_no": lot_no_disp,
            "bhada_per_bag": lot_bhada_per_bag,
            "bhada_total": _round2(lot_bhada),
            "sales": sales,
            "sold_bags": lot_bags,
            "gross": _round2(lot_gross),
            "farmer_amount": _round2(farmer_amt),
        })
        total_bags += lot_bags
        gross_total += lot_gross
        farmer_gross += farmer_amt
        bhada_total += lot_bhada
    return lots_out, total_bags, _round2(gross_total), _round2(farmer_gross), _round2(bhada_total)


@api.put("/pattis/{patti_id}", response_model=PattiOut)
async def edit_patti(patti_id: str, body: PattiEditIn, user=Depends(current_user)):
    existing = await db.pattis.find_one({"id": patti_id, "shop_id": user["shop_id"]}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Patti not found")
    if existing.get("deleted"):
        raise HTTPException(400, "Cannot edit a deleted Patti — restore it first")

    farmer = await db.farmers.find_one({"id": body.farmer_id, "shop_id": user["shop_id"]}, {"_id": 0})
    if not farmer:
        raise HTTPException(400, "Farmer not found")

    vendor_ids = list({s.vendor_id for lot in body.lots for s in lot.sales})
    sales_lookup: dict = {}
    async for v in db.vendors.find({"id": {"$in": vendor_ids}, "shop_id": user["shop_id"]}, {"_id": 0}):
        sales_lookup[v["id"]] = v
    if len(sales_lookup) != len(vendor_ids):
        raise HTTPException(400, "One or more vendors not found")

    lots_out, total_bags, gross_total, farmer_gross, bhada_total = _hydrate_edit_lots(
        sales_lookup, body.lots, body.payment_factor
    )
    hamali_total = total_bags * body.hamali_per_bag
    stationery_total = body.stationery_flat  # flat charge per Patti
    deductions_total = hamali_total + stationery_total + bhada_total
    net_payable = farmer_gross - deductions_total

    # Snapshot the old totals to store in the audit log.
    audit_change = {
        "before": {
            "farmer_name": existing.get("farmer_name"),
            "total_bags": existing.get("total_bags"),
            "gross_total": existing.get("gross_total"),
            "farmer_gross": existing.get("farmer_gross"),
            "hamali_per_bag": existing.get("hamali_per_bag"),
            "stationery_flat": existing.get("stationery_flat", existing.get("stationery_per_bag")),
            "payment_factor": existing.get("payment_factor"),
            "bhada_total": existing.get("bhada_total"),
            "deductions_total": existing.get("deductions_total"),
            "net_payable": existing.get("net_payable"),
            "lot_count": len(existing.get("lots", [])),
        },
        "after": {
            "farmer_name": farmer["name"],
            "total_bags": total_bags,
            "gross_total": gross_total,
            "farmer_gross": farmer_gross,
            "hamali_per_bag": body.hamali_per_bag,
            "stationery_flat": body.stationery_flat,
            "payment_factor": body.payment_factor,
            "bhada_total": bhada_total,
            "deductions_total": _round2(deductions_total),
            "net_payable": _round2(net_payable),
            "lot_count": len(body.lots),
        },
    }

    update = {
        "farmer_id": farmer["id"], "farmer_name": farmer["name"],
        "lots": lots_out,
        "total_bags": total_bags, "gross_total": gross_total, "farmer_gross": farmer_gross,
        "hamali_per_bag": body.hamali_per_bag, "stationery_flat": body.stationery_flat,
        "payment_factor": body.payment_factor,
        "hamali_total": _round2(hamali_total), "stationery_total": _round2(stationery_total),
        "bhada_total": bhada_total, "deductions_total": _round2(deductions_total),
        "net_payable": _round2(net_payable),
        "updated_at": utc_now(),
    }
    if body.receiver_name is not None and body.receiver_name.strip():
        update["receiver_name"] = body.receiver_name.strip()

    d = await db.pattis.find_one_and_update(
        {"id": patti_id, "shop_id": user["shop_id"]},
        {
            "$set": update,
            "$push": {"audit_log": {
                "at": utc_now(), "by": user["display_name"], "role": user["role"],
                "action": "edit", "changes": audit_change,
            }},
        },
        return_document=True, projection={"_id": 0, "shop_id": 0},
    )
    return PattiOut(**_patti_read_compat(d))


@api.delete("/pattis/{patti_id}", response_model=PattiOut)
async def delete_patti(patti_id: str, body: DeletePattiBody, user=Depends(current_user)):
    now = utc_now()
    d = await db.pattis.find_one_and_update(
        {"id": patti_id, "shop_id": user["shop_id"], "deleted": {"$ne": True}},
        {
            "$set": {
                "deleted": True, "deleted_at": now, "deleted_by": user["display_name"],
                "deleted_reason": (body.reason or "").strip() or None,
                "status": "deleted",
            },
            "$push": {"audit_log": {
                "at": now, "by": user["display_name"], "role": user["role"],
                "action": "delete", "changes": {"reason": body.reason},
            }},
        },
        return_document=True, projection={"_id": 0, "shop_id": 0},
    )
    if not d:
        raise HTTPException(404, "Patti not found or already deleted")
    # PattiOut requires status in ('pending','received') — we allow 'deleted' too but the pydantic
    # PattiOut has status: str, so it's fine.
    return PattiOut(**_patti_read_compat(d))


@api.post("/pattis/{patti_id}/restore", response_model=PattiOut)
async def restore_patti(patti_id: str, user=Depends(owner_only)):
    d = await db.pattis.find_one_and_update(
        {"id": patti_id, "shop_id": user["shop_id"], "deleted": True},
        {
            "$set": {"deleted": False, "status": "pending"},
            "$unset": {"deleted_at": "", "deleted_by": "", "deleted_reason": ""},
            "$push": {"audit_log": {
                "at": utc_now(), "by": user["display_name"], "role": user["role"],
                "action": "restore", "changes": None,
            }},
        },
        return_document=True, projection={"_id": 0, "shop_id": 0},
    )
    if not d:
        raise HTTPException(404, "Deleted patti not found")
    return PattiOut(**_patti_read_compat(d))


@api.get("/pattis/by-qr/{qr_token}", response_model=PattiOut)
async def get_by_qr(qr_token: str, user=Depends(current_user)):
    d = await db.pattis.find_one({"qr_token": qr_token, "shop_id": user["shop_id"]}, {"_id": 0, "shop_id": 0})
    if not d:
        raise HTTPException(404, "Patti not found for this QR")
    return PattiOut(**_patti_read_compat(d))


@api.put("/pattis/{patti_id}/receiver", response_model=PattiOut)
async def update_receiver(patti_id: str, body: ReceiverBody, user=Depends(current_user)):
    now = utc_now()
    d = await db.pattis.find_one_and_update(
        {"id": patti_id, "shop_id": user["shop_id"]},
        {
            "$set": {
                "receiver_name": body.receiver_name.strip(),
                "receiver_updated_at": now,
                "receiver_updated_by": user["display_name"],
                "status": "received",
            },
            "$push": {
                "receiver_history": {
                    "name": body.receiver_name.strip(),
                    "at": now, "by": user["display_name"], "role": user["role"],
                },
            },
        },
        return_document=True, projection={"_id": 0, "shop_id": 0},
    )
    if not d:
        raise HTTPException(404, "Patti not found")
    return PattiOut(**_patti_read_compat(d))


@api.post("/pattis/{patti_id}/mark-printed", response_model=PattiOut)
async def mark_patti_printed(patti_id: str, user=Depends(current_user)):
    """Mark a Patti as successfully printed. Safe to call again on reprint."""
    now = utc_now()
    existing = await db.pattis.find_one({"id": patti_id, "shop_id": user["shop_id"]}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Patti not found")
    if existing.get("deleted"):
        raise HTTPException(400, "Cannot mark a deleted Patti as printed")

    d = await db.pattis.find_one_and_update(
        {"id": patti_id, "shop_id": user["shop_id"]},
        {
            "$set": {
                "printed": True,
                "printed_at": now,
            },
            "$inc": {"print_count": 1},
            "$push": {"audit_log": {
                "at": now, "by": user["display_name"], "role": user["role"],
                "action": "print", "changes": {
                    "reprint": bool(existing.get("printed")),
                    "print_count_before": int(existing.get("print_count") or 0),
                },
            }},
        },
        return_document=True, projection={"_id": 0, "shop_id": 0},
    )
    if not d:
        raise HTTPException(404, "Patti not found")
    return PattiOut(**_patti_read_compat(d))


# ---------- Dashboard & Reports ----------
class DashboardOut(BaseModel):
    today_pattis: int
    today_bags: int
    today_farmer_payout: float
    today_gross: float
    today_lots: int
    today_pending: int
    total_farmers: int
    total_vendors: int


@api.get("/dashboard", response_model=DashboardOut)
async def dashboard(user=Depends(current_user), date: Optional[str] = None):
    day = date or _today_str()
    pipeline = [
        {"$match": {"shop_id": user["shop_id"], "date": day, "deleted": {"$ne": True}}},
        {"$group": {
            "_id": None,
            "pattis": {"$sum": 1},
            "bags": {"$sum": "$total_bags"},
            "payout": {"$sum": "$net_payable"},
            "gross": {"$sum": "$gross_total"},
            "pending": {"$sum": {"$cond": [{"$eq": ["$status", "pending"]}, 1, 0]}},
        }},
    ]
    agg = await db.pattis.aggregate(pipeline).to_list(1)
    row = agg[0] if agg else {"pattis": 0, "bags": 0, "payout": 0.0, "gross": 0.0, "pending": 0}
    lots_today = await db.lots.count_documents({"shop_id": user["shop_id"], "date": day})
    total_farmers = await db.farmers.count_documents({"shop_id": user["shop_id"]})
    total_vendors = await db.vendors.count_documents({"shop_id": user["shop_id"]})
    return DashboardOut(
        today_pattis=int(row["pattis"]), today_bags=int(row["bags"]),
        today_farmer_payout=_round2(float(row["payout"])),
        today_gross=_round2(float(row["gross"])),
        today_lots=int(lots_today),
        today_pending=int(row["pending"]),
        total_farmers=total_farmers, total_vendors=total_vendors,
    )


class ReportRow(BaseModel):
    key: str
    label: str
    pattis: int
    bags: int
    gross: float
    net: float


@api.get("/reports/by-farmer", response_model=List[ReportRow])
async def report_by_farmer(user=Depends(current_user)):
    pipeline = [
        {"$match": {"shop_id": user["shop_id"]}},
        {"$group": {
            "_id": {"fid": "$farmer_id", "name": "$farmer_name"},
            "pattis": {"$sum": 1},
            "bags": {"$sum": "$total_bags"},
            "gross": {"$sum": "$gross_total"},
            "net": {"$sum": "$net_payable"},
        }},
        {"$sort": {"net": -1}},
    ]
    out = []
    async for r in db.pattis.aggregate(pipeline):
        out.append(ReportRow(key=r["_id"]["fid"], label=r["_id"]["name"],
                             pattis=r["pattis"], bags=r["bags"],
                             gross=_round2(r["gross"]), net=_round2(r["net"])))
    return out


@api.get("/reports/by-vendor", response_model=List[ReportRow])
async def report_by_vendor(user=Depends(current_user)):
    pipeline = [
        {"$match": {"shop_id": user["shop_id"]}},
        {"$unwind": "$lots"},
        {"$unwind": "$lots.sales"},
        {"$group": {
            "_id": {"vid": "$lots.sales.vendor_id", "name": "$lots.sales.vendor_name"},
            "pattis": {"$addToSet": "$id"},
            "bags": {"$sum": "$lots.sales.bags"},
            "gross": {"$sum": "$lots.sales.gross"},
        }},
        {"$project": {"vid": "$_id.vid", "name": "$_id.name",
                      "pattis": {"$size": "$pattis"}, "bags": 1, "gross": 1}},
        {"$sort": {"gross": -1}},
    ]
    out = []
    async for r in db.pattis.aggregate(pipeline):
        out.append(ReportRow(key=r["_id"]["vid"], label=r["_id"]["name"],
                             pattis=r["pattis"], bags=r["bags"],
                             gross=_round2(r["gross"]), net=_round2(r["gross"])))
    return out


class LotReportRow(BaseModel):
    lot_no: str
    bags: int
    gross: float
    farmer_name: str
    driver_name: Optional[str]
    date: str
    patti_no: Optional[int]


@api.get("/reports/by-lot", response_model=List[LotReportRow])
async def report_by_lot(user=Depends(current_user), limit: int = 500):
    # from lots collection (source of truth)
    out: List[LotReportRow] = []
    async for lot in db.lots.find({"shop_id": user["shop_id"]}, {"_id": 0}).sort("created_at", -1).limit(limit):
        bags = sum(s["bags"] for s in lot["sales"])
        gross = _round2(sum(s["bags"] * s["rate_per_bag"] for s in lot["sales"]))
        patti = await db.pattis.find_one(
            {"shop_id": user["shop_id"], "lot_id": lot["id"]},
            {"_id": 0, "patti_no": 1},
        )
        if not patti:
            # Legacy fallback (pattis without lot_id — grouped-by-farmer)
            patti = await db.pattis.find_one(
                {"shop_id": user["shop_id"], "auction_day_id": lot["auction_day_id"], "farmer_id": lot["farmer_id"]},
                {"_id": 0, "patti_no": 1},
            )
        out.append(LotReportRow(
            lot_no=lot["lot_no"], bags=bags, gross=gross,
            farmer_name=lot["farmer_name"], driver_name=lot.get("driver_name"),
            date=lot["date"], patti_no=(patti or {}).get("patti_no"),
        ))
    return out


class DriverSettlementRow(BaseModel):
    patti_id: str
    patti_no: int
    farmer_name: str
    lot_nos: List[str]
    bags: int
    net_payable: float
    receiver_name: str
    taken_by: str  # 'Driver' | 'Farmer'


class DriverSettlementOut(BaseModel):
    driver_name: str
    place: Optional[str]
    date: str
    total_bags: int
    total_pattis: int
    pattis_to_driver: int
    pattis_to_farmer: int
    driver_payable_total: float
    rows: List[DriverSettlementRow]


@api.get("/reports/driver-settlement", response_model=List[DriverSettlementOut])
async def driver_settlement(user=Depends(current_user), date: Optional[str] = None):
    d = date or _today_str()
    day = await db.auction_days.find_one({"shop_id": user["shop_id"], "date": d}, {"_id": 0})
    if not day:
        return []
    drivers = day.get("drivers", [])
    if not drivers:
        return []
    # Fetch pattis for the day (not deleted)
    pattis = []
    async for p in db.pattis.find(
        {"shop_id": user["shop_id"], "auction_day_id": day["id"], "deleted": {"$ne": True}},
        {"_id": 0, "shop_id": 0},
    ):
        pattis.append(p)

    out: List[DriverSettlementOut] = []
    for drv in drivers:
        rows: List[DriverSettlementRow] = []
        total_bags = 0
        payable = 0.0
        to_driver = 0
        to_farmer = 0
        for p in pattis:
            if (p.get("driver_name") or "") != drv["name"]:
                continue
            receiver = (p.get("receiver_name") or "").strip()
            is_driver_taken = receiver.lower() == drv["name"].lower()
            taken_by = "Driver" if is_driver_taken else "Farmer"
            total_bags += int(p["total_bags"])
            if is_driver_taken:
                payable += float(p["net_payable"])
                to_driver += 1
            else:
                to_farmer += 1
            rows.append(DriverSettlementRow(
                patti_id=p["id"], patti_no=int(p["patti_no"]),
                farmer_name=p["farmer_name"],
                lot_nos=[lot["lot_no"] for lot in p.get("lots", [])],
                bags=int(p["total_bags"]), net_payable=float(p["net_payable"]),
                receiver_name=receiver, taken_by=taken_by,
            ))
        rows.sort(key=lambda r: r.patti_no)
        out.append(DriverSettlementOut(
            driver_name=drv["name"], place=drv.get("place"), date=d,
            total_bags=total_bags, total_pattis=len(rows),
            pattis_to_driver=to_driver, pattis_to_farmer=to_farmer,
            driver_payable_total=_round2(payable), rows=rows,
        ))
    return out


# ---------- Vendor Bills ----------
async def _next_bill_no(shop_id: str) -> int:
    c = await db.counters.find_one_and_update(
        {"shop_id": shop_id, "kind": "vendor_bill"},
        {"$inc": {"seq": 1}}, upsert=True, return_document=True,
    )
    return int(c["seq"])


def _compute_bill(body: VendorBillIn) -> tuple[List[dict], int, float, float, float]:
    """Vendor rate = auction_rate * vendor_factor + margin_per_bag (never touches Farmer Patti).
    Per-line vendor_rate override (edit price) is allowed and does not change auction_rate."""
    lines: List[dict] = []
    bags = 0
    goods = 0.0
    factor = float(body.vendor_factor)
    for L in body.lines:
        if L.vendor_rate is not None:
            vendor_rate = float(L.vendor_rate)
        else:
            vendor_rate = L.auction_rate * factor + body.margin_per_bag
        amount = L.bags * vendor_rate
        lines.append({
            "lot_id": L.lot_id, "lot_no": L.lot_no.strip(),
            "farmer_name": L.farmer_name.strip(), "bags": int(L.bags),
            "auction_rate": float(L.auction_rate),
            "vendor_rate": _round2(vendor_rate),
            "amount": _round2(amount),
        })
        bags += int(L.bags)
        goods += amount
    commission = bags * body.commission_per_bag
    return lines, bags, _round2(goods), _round2(commission), _round2(goods + commission)


async def _bill_to_out(shop_id: str, doc: dict) -> VendorBillOut:
    settings_doc = await db.settings.find_one({"shop_id": shop_id}, {"_id": 0}) or {}
    prefix = settings_doc.get("vendor_bill_prefix", "VB")
    vendor_details = doc.get("vendor_details")
    if vendor_details is None:
        # Fallback to current vendor.details for legacy bills that didn't snapshot.
        v = await db.vendors.find_one({"id": doc["vendor_id"], "shop_id": shop_id}, {"_id": 0, "details": 1})
        vendor_details = (v or {}).get("details")
    return VendorBillOut(
        id=doc["id"], bill_no=doc["bill_no"],
        bill_code=f"{prefix}-{int(doc['bill_no']):04d}",
        vendor_id=doc["vendor_id"], vendor_name=doc["vendor_name"],
        vendor_details=vendor_details,
        date=doc["date"],
        lines=[VendorBillLineOut(**L) for L in doc.get("lines", [])],
        total_bags=int(doc["total_bags"]), goods_total=float(doc["goods_total"]),
        vendor_factor=float(doc.get("vendor_factor", 1.0)),  # legacy bills without factor → 1.0
        margin_per_bag=float(doc["margin_per_bag"]),
        commission_per_bag=float(doc["commission_per_bag"]),
        commission_total=float(doc["commission_total"]),
        hamali=float(doc.get("hamali", 0)), cess=float(doc.get("cess", 0)),
        grand_total=float(doc["grand_total"]),
        paid=float(doc.get("paid", 0)),
        balance=float(doc["grand_total"] - doc.get("paid", 0)),
        status=doc.get("status", "unpaid"),
        notes=doc.get("notes"),
        created_at=doc["created_at"], updated_at=doc.get("updated_at"),
    )


def _bill_status(grand_total: float, paid: float) -> str:
    if paid <= 0: return "unpaid"
    if paid >= grand_total - 1e-6: return "paid"
    return "partial"


@api.post("/vendor-bills", response_model=VendorBillOut, status_code=201)
async def create_vendor_bill(body: VendorBillIn, user=Depends(current_user)):
    vendor = await db.vendors.find_one({"id": body.vendor_id, "shop_id": user["shop_id"]}, {"_id": 0})
    if not vendor:
        raise HTTPException(400, "Vendor not found")
    lines, bags, goods, commission, _partial = _compute_bill(body)
    grand = _round2(goods + commission + body.hamali + body.cess)
    bill_no = await _next_bill_no(user["shop_id"])
    doc = {
        "id": uid(), "shop_id": user["shop_id"],
        "bill_no": bill_no,
        "vendor_id": vendor["id"], "vendor_name": vendor["name"],
        "vendor_details": vendor.get("details"),
        "date": body.date or _today_str(),
        "lines": lines,
        "total_bags": bags,
        "goods_total": goods,
        "vendor_factor": float(body.vendor_factor),
        "margin_per_bag": float(body.margin_per_bag),
        "commission_per_bag": float(body.commission_per_bag),
        "commission_total": commission,
        "hamali": float(body.hamali),
        "cess": float(body.cess),
        "grand_total": grand,
        "paid": 0.0,
        "status": "unpaid",
        "notes": body.notes,
        "deleted": False,
        "created_at": utc_now(),
        "audit_log": [{"at": utc_now(), "by": user["display_name"], "role": user["role"], "action": "create"}],
    }
    await db.vendor_bills.insert_one(doc)
    return await _bill_to_out(user["shop_id"], doc)


@api.get("/vendor-bills", response_model=List[VendorBillOut])
async def list_vendor_bills(user=Depends(current_user), vendor_id: Optional[str] = None,
                            date: Optional[str] = None, status_: Optional[str] = Query(default=None, alias="status"),
                            q: Optional[str] = None,
                            include_deleted: bool = False, limit: int = 300):
    query: dict = {"shop_id": user["shop_id"]}
    if not include_deleted:
        query["deleted"] = {"$ne": True}
    if vendor_id: query["vendor_id"] = vendor_id
    if date: query["date"] = date
    if status_: query["status"] = status_
    if q and q.strip():
        s = q.strip()
        # Match bill code digits, vendor name/details, farmer, lot, or date substring
        or_clauses: List[dict] = [
            {"vendor_name": {"$regex": s, "$options": "i"}},
            {"vendor_details": {"$regex": s, "$options": "i"}},
            {"date": {"$regex": s, "$options": "i"}},
            {"lines.farmer_name": {"$regex": s, "$options": "i"}},
            {"lines.lot_no": {"$regex": s, "$options": "i"}},
        ]
        digits = "".join(ch for ch in s if ch.isdigit())
        if digits:
            try:
                or_clauses.append({"bill_no": int(digits)})
            except ValueError:
                pass
        query["$or"] = or_clauses
    cur = db.vendor_bills.find(query, {"_id": 0}).sort([("date", -1), ("bill_no", -1)]).limit(limit)
    return [await _bill_to_out(user["shop_id"], d) async for d in cur]


@api.get("/vendor-bills/{bill_id}", response_model=VendorBillOut)
async def get_vendor_bill(bill_id: str, user=Depends(current_user)):
    d = await db.vendor_bills.find_one({"id": bill_id, "shop_id": user["shop_id"]}, {"_id": 0})
    if not d: raise HTTPException(404, "Vendor bill not found")
    return await _bill_to_out(user["shop_id"], d)


@api.put("/vendor-bills/{bill_id}", response_model=VendorBillOut)
async def update_vendor_bill(bill_id: str, body: VendorBillIn, user=Depends(current_user)):
    existing = await db.vendor_bills.find_one({"id": bill_id, "shop_id": user["shop_id"]}, {"_id": 0})
    if not existing: raise HTTPException(404, "Vendor bill not found")
    if existing.get("deleted"): raise HTTPException(400, "Cannot edit a deleted bill")

    lines, bags, goods, commission, _ = _compute_bill(body)
    grand = _round2(goods + commission + body.hamali + body.cess)
    paid = float(existing.get("paid", 0))
    # Refresh vendor_details snapshot from current vendor doc
    vendor = await db.vendors.find_one({"id": existing["vendor_id"], "shop_id": user["shop_id"]}, {"_id": 0, "details": 1})
    upd = {
        "date": body.date or existing["date"],
        "lines": lines, "total_bags": bags,
        "goods_total": goods,
        "vendor_factor": float(body.vendor_factor),
        "margin_per_bag": float(body.margin_per_bag),
        "commission_per_bag": float(body.commission_per_bag),
        "commission_total": commission,
        "hamali": float(body.hamali), "cess": float(body.cess),
        "grand_total": grand,
        "status": _bill_status(grand, paid),
        "notes": body.notes,
        "vendor_details": (vendor or {}).get("details"),
        "updated_at": utc_now(),
    }
    before = {k: existing.get(k) for k in ("total_bags", "goods_total", "vendor_factor", "margin_per_bag",
                                           "commission_per_bag", "commission_total",
                                           "hamali", "cess", "grand_total")}
    after = {k: upd[k] for k in ("total_bags", "goods_total", "vendor_factor", "margin_per_bag",
                                  "commission_per_bag", "commission_total",
                                  "hamali", "cess", "grand_total")}
    d = await db.vendor_bills.find_one_and_update(
        {"id": bill_id, "shop_id": user["shop_id"]},
        {"$set": upd, "$push": {"audit_log": {
            "at": utc_now(), "by": user["display_name"], "role": user["role"],
            "action": "edit", "changes": {"before": before, "after": after},
        }}},
        return_document=True, projection={"_id": 0},
    )
    return await _bill_to_out(user["shop_id"], d)


@api.delete("/vendor-bills/{bill_id}", response_model=VendorBillOut)
async def delete_vendor_bill(bill_id: str, body: DeleteBody, user=Depends(owner_only)):
    now = utc_now()
    d = await db.vendor_bills.find_one_and_update(
        {"id": bill_id, "shop_id": user["shop_id"], "deleted": {"$ne": True}},
        {"$set": {"deleted": True, "deleted_at": now, "deleted_by": user["display_name"],
                  "deleted_reason": (body.reason or "").strip() or None, "status": "deleted"},
         "$push": {"audit_log": {"at": now, "by": user["display_name"], "role": user["role"],
                                  "action": "delete", "changes": {"reason": body.reason}}}},
        return_document=True, projection={"_id": 0},
    )
    if not d: raise HTTPException(404, "Vendor bill not found or already deleted")
    return await _bill_to_out(user["shop_id"], d)


# ---------- Vendor Payments ----------
@api.post("/vendor-payments", response_model=VendorPaymentOut, status_code=201)
async def receive_payment(body: VendorPaymentIn, user=Depends(owner_only)):
    vendor = await db.vendors.find_one({"id": body.vendor_id, "shop_id": user["shop_id"]}, {"_id": 0})
    if not vendor:
        raise HTTPException(400, "Vendor not found")

    # Validate allocations sum <= amount + tolerance; and bills exist and belong to vendor
    alloc_total = sum(a.amount for a in body.allocations)
    if alloc_total - body.amount > 0.01:
        raise HTTPException(400, "Allocations exceed payment amount")
    for a in body.allocations:
        if a.amount <= 0:
            continue
        bill = await db.vendor_bills.find_one(
            {"id": a.bill_id, "shop_id": user["shop_id"], "vendor_id": body.vendor_id, "deleted": {"$ne": True}},
            {"_id": 0},
        )
        if not bill:
            raise HTTPException(400, f"Bill {a.bill_id} not found for this vendor")
        new_paid = float(bill.get("paid", 0)) + a.amount
        if new_paid - float(bill["grand_total"]) > 0.01:
            raise HTTPException(400, f"Allocation to bill {bill['bill_no']} exceeds its balance")

    doc = {
        "id": uid(), "shop_id": user["shop_id"],
        "vendor_id": vendor["id"], "vendor_name": vendor["name"],
        "date": body.date or _today_str(),
        "amount": float(body.amount), "mode": body.mode.strip(), "remarks": body.remarks,
        "allocations": [a.model_dump() for a in body.allocations if a.amount > 0],
        "created_at": utc_now(),
        "created_by": user["display_name"],
    }
    await db.vendor_payments.insert_one(doc)
    # Apply allocations to bills
    for a in body.allocations:
        if a.amount <= 0: continue
        bill = await db.vendor_bills.find_one({"id": a.bill_id, "shop_id": user["shop_id"]}, {"_id": 0})
        if not bill: continue
        new_paid = float(bill.get("paid", 0)) + a.amount
        new_status = _bill_status(float(bill["grand_total"]), new_paid)
        await db.vendor_bills.update_one(
            {"id": a.bill_id, "shop_id": user["shop_id"]},
            {"$set": {"paid": _round2(new_paid), "status": new_status, "updated_at": utc_now()},
             "$push": {"audit_log": {"at": utc_now(), "by": user["display_name"], "role": user["role"],
                                      "action": "payment", "changes": {"amount": a.amount,
                                                                        "payment_id": doc["id"]}}}},
        )
    return VendorPaymentOut(**{k: doc[k] for k in [
        "id", "vendor_id", "vendor_name", "date", "amount", "mode", "remarks", "allocations", "created_at"
    ]})


@api.get("/vendor-payments", response_model=List[VendorPaymentOut])
async def list_payments(user=Depends(current_user), vendor_id: Optional[str] = None, limit: int = 200):
    query: dict = {"shop_id": user["shop_id"]}
    if vendor_id: query["vendor_id"] = vendor_id
    cur = db.vendor_payments.find(query, {"_id": 0, "shop_id": 0}).sort([("date", -1), ("created_at", -1)]).limit(limit)
    return [VendorPaymentOut(**{k: v for k, v in d.items() if k in VendorPaymentOut.model_fields}) async for d in cur]


@api.get("/vendors/{vendor_id}/dashboard", response_model=VendorDashboardOut)
async def vendor_dashboard(vendor_id: str, user=Depends(current_user)):
    vendor = await db.vendors.find_one({"id": vendor_id, "shop_id": user["shop_id"]}, {"_id": 0})
    if not vendor:
        raise HTTPException(404, "Vendor not found")
    pipeline = [
        {"$match": {"shop_id": user["shop_id"], "vendor_id": vendor_id, "deleted": {"$ne": True}}},
        {"$group": {"_id": None,
                    "bills": {"$sum": 1},
                    "bags": {"$sum": "$total_bags"},
                    "purchase": {"$sum": "$grand_total"},
                    "paid": {"$sum": "$paid"}}},
    ]
    agg = await db.vendor_bills.aggregate(pipeline).to_list(1)
    row = agg[0] if agg else {"bills": 0, "bags": 0, "purchase": 0.0, "paid": 0.0}
    outstanding = _round2(float(row["purchase"]) - float(row["paid"]))
    return VendorDashboardOut(
        vendor_id=vendor_id, vendor_name=vendor["name"], phone=vendor.get("phone"),
        total_bills=int(row["bills"]), total_bags=int(row["bags"]),
        total_purchase=_round2(float(row["purchase"])),
        total_paid=_round2(float(row["paid"])),
        outstanding=outstanding,
    )


class VendorDayLineOut(BaseModel):
    lot_id: str
    lot_no: str
    farmer_name: str
    bags: int
    auction_rate: float


@api.get("/vendors/{vendor_id}/unbilled-lines", response_model=List[VendorDayLineOut])
async def unbilled_lines(vendor_id: str, user=Depends(current_user), date: Optional[str] = None):
    """List every sale to this vendor on the given date (defaults to today).
    The biller can pick which lines to include in a new vendor bill."""
    d = date or _today_str()
    out: List[VendorDayLineOut] = []
    async for lot in db.lots.find({"shop_id": user["shop_id"], "date": d}, {"_id": 0}):
        for s in lot.get("sales", []):
            if s["vendor_id"] == vendor_id:
                out.append(VendorDayLineOut(
                    lot_id=lot["id"], lot_no=lot["lot_no"],
                    farmer_name=lot["farmer_name"], bags=int(s["bags"]),
                    auction_rate=float(s["rate_per_bag"]),
                ))
    return out


# ---------- OCR: Action Diary photo → structured rows ----------
class OcrRequest(BaseModel):
    image_base64: str = Field(min_length=100)  # bare base64 (no data URL prefix ok)
    mime_type: str = Field(default="image/jpeg")
    hint: Optional[str] = Field(default=None, max_length=500)  # optional user hint
    # One-shot key when env/settings missing (from Scan screen paste).
    gemini_api_key: Optional[str] = Field(default=None, max_length=200)
    persist_key: bool = False


class OcrTextRequest(BaseModel):
    """Fallback: paste / type diary text when camera OCR is unavailable."""
    text: str = Field(min_length=3, max_length=20000)


class OcrRow(BaseModel):
    lot_serial_no: Optional[int] = None  # e.g. 1 in "1/5"
    total_bags: Optional[int] = None      # e.g. 5 in "1/5" (announced auction quantity for the lot)
    lot_no: Optional[str] = None          # legacy full string like "1/5" (kept for compat)
    farmer_name: Optional[str] = None
    vendor_name: Optional[str] = None
    bags: Optional[int] = None            # bags SOLD to this vendor in this line
    rate_per_bag: Optional[float] = None
    bhada_total: Optional[float] = None   # TOTAL bhada for the lot (circled amount) when known
    # Deprecated in output — kept for backward compat with older clients / responses.
    bhada_per_bag: Optional[float] = None


class OcrResponse(BaseModel):
    rows: List[OcrRow]
    model: str
    warning: Optional[str] = None


_OCR_SYSTEM = """You are an expert OCR system for Indian mandi Action Diaries (handwritten lemon auction records).
Read BOTH columns if present (left column first, top to bottom).

PRIMARY DIARY PATTERN (merchant standard):
  LOT NO. / TOTAL BAGS    FARMER    (BHADA PER BAG)
  VENDOR    BAGS    AUCTION RATE
  VENDOR    BAGS    AUCTION RATE

Example block:
  1/5   ABDG   (50)
  MM    02    1000
  AB    02    1000
  MC    01    1000

Means ONE lot:
  lot_serial_no = 1          ← the number BEFORE the slash (NEVER store "1/5" as one field)
  total_bags    = 5          ← the number AFTER the slash
  farmer_name   = "ABDG"
  bhada_per_bag = 50         ← circled/parens after farmer = ₹ bhada PER BAG (transport rent)
  bhada_total   = 250        ← compute 50 × 5 when both known
  Three vendor sale rows under the SAME lot (not three lots):
    MM bags=2 rate=1000; AB bags=2 rate=1000; MC bags=1 rate=1000

Another example:
  3/12 MMA (50)
  ZX 07 850
  MC 05 800
→ lot 3, bags 12, farmer MMA, bhada 50/bag; vendors ZX 7@850 and MC 5@800.

FIELD RULES:
1. "1/5" is TWO fields: lot_serial_no=1, total_bags=5. NEVER lot_no="1/5" as the only identity.
2. Same farmer on different headers (1/5 ABDG then 2/6 ABDG) = TWO separate lots → two Farmer Pattis.
3. Multiple vendor lines under ONE header = ONE lot. Emit one JSON row PER vendor, repeating
   lot_serial_no, total_bags, farmer_name, bhada_per_bag, bhada_total on each row.
4. Do NOT invent extra lots for each vendor. Do NOT invent farmers from vendor names.
5. Do NOT invent vendor slots that are not on the page.
6. Parentheses after slash-header = bhada_per_bag (₹), NOT total bags.

ALTERNATE FORMAT (only when there is NO slash like 1/5):
  Header: "<code> <farmer_name> (<total_bags>)" e.g. 135 HRB (12)
  Then rate lines may be "12 @ 1800" without vendor name → vendor_name null, bags+rate filled.
  In that alternate format, parentheses = total_bags (not bhada).

Return ONLY valid JSON (no markdown):
{
  "rows": [
    {
      "lot_serial_no": <int or null>,
      "total_bags": <int or null>,
      "farmer_name": "<string or null>",
      "vendor_name": "<string or null>",
      "bags": <int or null>,
      "rate_per_bag": <number or null>,
      "bhada_total": <number or null>,
      "bhada_per_bag": <number or null>
    }
  ]
}
Use null when unreadable. Skip titles/totals/doodles. If unreadable: {"rows": []}."""


def _ocr_int(v) -> Optional[int]:
    try:
        return int(float(v)) if v is not None and str(v).strip() != "" else None
    except Exception:
        return None


def _ocr_flt(v) -> Optional[float]:
    try:
        return float(v) if v is not None and str(v).strip() != "" else None
    except Exception:
        return None


def _normalize_ocr_rows(raw_rows: list) -> List[OcrRow]:
    rows: List[OcrRow] = []
    for r in raw_rows[:100]:
        if not isinstance(r, dict):
            continue
        serial = _ocr_int(r.get("lot_serial_no"))
        total = _ocr_int(r.get("total_bags"))
        lot_no_str = (str(r.get("lot_no")).strip() if r.get("lot_no") is not None else None) or None
        if (serial is None or total is None) and lot_no_str:
            ps, pt = _parse_lot_no_str(lot_no_str)
            if serial is None:
                serial = ps
            if total is None:
                total = pt
        bhada_total_val = _ocr_flt(r.get("bhada_total"))
        bhada_pb = _ocr_flt(r.get("bhada_per_bag"))
        if bhada_total_val is None and bhada_pb is not None and total:
            bhada_total_val = round(bhada_pb * total, 2)
        if bhada_pb is None and bhada_total_val is not None and total and total > 0:
            bhada_pb = round(bhada_total_val / total, 6)
        rows.append(OcrRow(
            lot_serial_no=serial,
            total_bags=total,
            lot_no=lot_no_str or (f"{serial}/{total}" if serial is not None and total is not None else None),
            farmer_name=(str(r.get("farmer_name")).strip() if r.get("farmer_name") is not None else None) or None,
            vendor_name=(str(r.get("vendor_name")).strip() if r.get("vendor_name") is not None else None) or None,
            bags=_ocr_int(r.get("bags")),
            rate_per_bag=_ocr_flt(r.get("rate_per_bag")),
            bhada_total=bhada_total_val,
            bhada_per_bag=bhada_pb,
        ))
    return rows


def _parse_diary_text(text: str) -> List[OcrRow]:
    """Heuristic parser for typed/pasted Action Diary text (and clean OCR transcriptions).

    Supports:
      Format A: 1/5 ABDG (50)  then  MM 02 1000
      Format B: 135 HRB (12)   then  12 @ 1800  /  5 x 1800
    """
    lines = [ln.strip() for ln in (text or "").replace("\r", "\n").split("\n")]
    lines = [ln for ln in lines if ln]
    header_slash_re = re.compile(
        r"^(\d+)\s*[/\\-]\s*(\d+)\s+([A-Za-z][A-Za-z0-9 ._-]{0,40}?)\s*(?:\(([\d.]+)\)|\[([\d.]+)\]|\{([\d.]+)\})?\s*$"
    )
    # 135 HRB (12)  |  76 ZAKIR(10)  — parens = total bags
    header_code_re = re.compile(
        r"^(\d+)\s+([A-Za-z][A-Za-z0-9 .()_-]{0,40}?)\s*\((\d+)\)\s*$"
    )
    vendor_re = re.compile(
        r"^([A-Za-z][A-Za-z0-9 ._-]{0,30}?)\s+(\d+)\s*(?:[/\\|@x×]\s*|\s+)(\d+(?:\.\d+)?)\s*$"
    )
    # Rate-only: 12 @ 1800  |  12 x 1800  |  12 × 1800
    rate_only_re = re.compile(
        r"^(\d+)\s*[@x×X]\s*(\d+(?:\.\d+)?)\s*$"
    )
    rows: List[OcrRow] = []
    cur_serial: Optional[int] = None
    cur_total: Optional[int] = None
    cur_farmer: Optional[str] = None
    cur_bhada: Optional[float] = None

    def _append_sale(vendor: Optional[str], bags: int, rate: float):
        nonlocal rows
        if cur_serial is None:
            return
        bhada_total = None
        if cur_bhada is not None and cur_total:
            bhada_total = round(cur_bhada * cur_total, 2)
        rows.append(OcrRow(
            lot_serial_no=cur_serial,
            total_bags=cur_total,
            lot_no=f"{cur_serial}/{cur_total}" if cur_total is not None else str(cur_serial),
            farmer_name=cur_farmer,
            vendor_name=(vendor.strip() if vendor else None) or None,
            bags=bags,
            rate_per_bag=rate,
            bhada_total=bhada_total,
            bhada_per_bag=cur_bhada,
        ))

    for ln in lines:
        hm = header_slash_re.match(ln)
        if hm:
            cur_serial = int(hm.group(1))
            cur_total = int(hm.group(2))
            cur_farmer = hm.group(3).strip()
            braw = hm.group(4) or hm.group(5) or hm.group(6)
            cur_bhada = float(braw) if braw else None
            continue
        hm2 = header_code_re.match(ln)
        if hm2:
            cur_serial = int(hm2.group(1))
            cur_farmer = hm2.group(2).strip()
            cur_total = int(hm2.group(3))
            cur_bhada = None  # Format B parens = bags, not bhada
            continue
        vm = vendor_re.match(ln)
        if vm and cur_serial is not None:
            _append_sale(vm.group(1), int(vm.group(2)), float(vm.group(3)))
            continue
        rm = rate_only_re.match(ln)
        if rm and cur_serial is not None:
            _append_sale(None, int(rm.group(1)), float(rm.group(2)))
            continue
    return rows


def _gemini_api_key() -> Optional[str]:
    return (
        os.environ.get("GEMINI_API_KEY")
        or os.environ.get("GOOGLE_API_KEY")
        or os.environ.get("EMERGENT_LLM_KEY")
        or None
    )


async def _resolve_ocr_api_key(shop_id: str, override: Optional[str] = None) -> Optional[str]:
    """Override → env key → shop Settings.ocr_gemini_api_key."""
    if override and str(override).strip():
        return str(override).strip()
    env_key = _gemini_api_key()
    if env_key and env_key.strip():
        return env_key.strip()
    doc = await db.settings.find_one({"shop_id": shop_id}, {"_id": 0, "ocr_gemini_api_key": 1}) or {}
    k = doc.get("ocr_gemini_api_key")
    return (str(k).strip() if k else None) or None


def _gemini_key_auth_failed(status_code: int, body: str) -> bool:
    """True when Google rejects the API key (try alternate auth style)."""
    if status_code not in (400, 401, 403):
        return False
    low = (body or "").lower()
    return (
        "api key" in low
        or "api_key" in low
        or "apikey" in low
        or "permission" in low
        or "credential" in low
        or "unauthorized" in low
        or "forbidden" in low
        or ("invalid" in low and "key" in low)
    )


def _call_gemini_vision(image_b64: str, mime_type: str, hint: Optional[str], api_key: str) -> tuple[str, str]:
    """Call Google Gemini generateContent. Returns (raw_text, model_name). Raises RuntimeError on failure."""
    import requests as _requests

    # Prefer Gemini 3 Flash (quota-friendly); Pro if available. Env overrides first.
    preferred = os.environ.get("GEMINI_OCR_MODEL") or "gemini-3-flash-preview"
    models = [
        preferred,
        "gemini-3-flash-preview",
        "gemini-3.5-flash",
        "gemini-3.1-pro-preview",
        "gemini-2.0-flash",
        "gemini-1.5-flash",
    ]
    seen = set()
    models = [m for m in models if m and not (m in seen or seen.add(m))]
    hint_line = f"\nHint from user: {hint}" if hint else ""
    prompt = (
        _OCR_SYSTEM
        + hint_line
        + "\n\nExtract every auction lot from this diary page. Return only JSON."
    )
    last_err = None
    key = api_key.strip()
    # Newer AI Studio auth keys (AQ.*) need x-goog-api-key; classic AIza* often use ?key=.
    auth_modes = ("header", "query") if key.startswith("AQ.") else ("query", "header")

    for model in models:
        base_url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent"
        )
        payload = {
            "contents": [{
                "parts": [
                    {"text": prompt},
                    {"inline_data": {"mime_type": mime_type or "image/jpeg", "data": image_b64}},
                ]
            }],
            "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"},
        }
        for auth_mode in auth_modes:
            url = f"{base_url}?key={key}" if auth_mode == "query" else base_url
            headers = {"Content-Type": "application/json"}
            if auth_mode == "header":
                headers["x-goog-api-key"] = key
            try:
                resp = _requests.post(url, json=payload, headers=headers, timeout=55)
                if resp.status_code == 404:
                    last_err = f"{model} not found"
                    break  # next model
                if resp.status_code == 429:
                    last_err = f"{model}: quota exceeded"
                    break  # next model — do not treat as invalid key
                if resp.status_code >= 400:
                    last_err = f"{model}: {resp.status_code} {resp.text[:300]}"
                    if _gemini_key_auth_failed(resp.status_code, resp.text or ""):
                        if auth_mode == auth_modes[0]:
                            continue  # retry same model with other auth
                        low = (resp.text or "").lower()
                        if "api key not valid" in low or ("invalid" in low and "key" in low):
                            raise RuntimeError(
                                "Gemini API key not valid. In AI Studio click Copy key, then paste into "
                                "Settings → Gemini API key (or Scan paste box) and Save."
                            )
                        raise RuntimeError(f"OCR model call failed: {last_err}")
                    break  # non-key 4xx → next model
                data = resp.json()
                parts = (
                    data.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [])
                )
                text = "".join(p.get("text", "") for p in parts if isinstance(p, dict))
                return text, model
            except RuntimeError:
                raise
            except Exception as e:
                last_err = str(e)
                continue
    raise RuntimeError(f"OCR model call failed: {last_err}")


def _parse_model_json(full_text: str) -> tuple[List[OcrRow], Optional[str]]:
    import json
    text = (full_text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.M).strip()
    warning: Optional[str] = None
    rows: List[OcrRow] = []
    try:
        parsed = json.loads(text) if text else {}
        raw_rows = parsed.get("rows", []) if isinstance(parsed, dict) else []
        rows = _normalize_ocr_rows(raw_rows if isinstance(raw_rows, list) else [])
        if not rows:
            warning = "No rows extracted. The photo may be blurry or the page unreadable."
    except json.JSONDecodeError:
        # Last chance: treat as plain diary text
        rows = _parse_diary_text(text)
        if not rows:
            warning = "Model returned non-JSON. Please retake the photo more clearly."
    return rows, warning


@api.get("/ocr/status")
async def ocr_status(user=Depends(current_user)):
    """Whether photo OCR has a Gemini key (env or Settings) — never returns the key."""
    key = await _resolve_ocr_api_key(user["shop_id"])
    return {"configured": bool(key and str(key).strip())}


@api.post("/ocr/action-diary", response_model=OcrResponse)
async def ocr_action_diary(body: OcrRequest, user=Depends(current_user)):
    # Strip data URL prefix if present
    img_b64 = body.image_base64
    if img_b64.startswith("data:"):
        try:
            img_b64 = img_b64.split(",", 1)[1]
        except Exception:
            pass

    api_key = await _resolve_ocr_api_key(user["shop_id"], body.gemini_api_key)
    model_name = "gemini"
    full_text = ""

    if api_key:
        # Optionally remember key in Settings for next scans (owner can always write;
        # for staff, still allow one-shot via body without persist).
        if body.persist_key and body.gemini_api_key and str(body.gemini_api_key).strip():
            await db.settings.update_one(
                {"shop_id": user["shop_id"]},
                {"$set": {"ocr_gemini_api_key": str(body.gemini_api_key).strip(), "updated_at": utc_now()}},
                upsert=True,
            )
        try:
            import asyncio
            full_text, model_name = await asyncio.to_thread(
                _call_gemini_vision, img_b64, body.mime_type or "image/jpeg", body.hint, api_key
            )
        except Exception as e:
            raise HTTPException(502, f"OCR model call failed: {e}")
    else:
        return OcrResponse(
            rows=[],
            model="none",
            warning="NO_CLOUD_OCR_KEY",
        )

    rows, warning = _parse_model_json(full_text)
    return OcrResponse(rows=rows, model=model_name, warning=warning)


@api.post("/ocr/action-diary-text", response_model=OcrResponse)
async def ocr_action_diary_text(body: OcrTextRequest, user=Depends(current_user)):
    """Parse pasted/typed Action Diary text into the same row structure as photo OCR."""
    rows = _parse_diary_text(body.text)
    warning = None if rows else "Could not parse any lots. Use format like: 1/5 ABDG (50) then MM 2 1000"
    return OcrResponse(rows=rows, model="text-parser", warning=warning)


# ---------- Register + CORS ----------
app.include_router(api)

# Bearer-token API (no cookies) — credentials must be False when using wildcard origins,
# otherwise browsers hide error responses as opaque "Failed to fetch".
app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)
