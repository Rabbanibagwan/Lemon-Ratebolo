"""Pydantic schemas for platform admin APIs."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class PageMeta(BaseModel):
    page: int
    page_size: int
    total_count: int
    sort: Optional[str] = None
    order: Optional[str] = None


class DashboardOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    business_timezone: str = "Asia/Kolkata"
    from_: str = Field(alias="from")
    to: str
    date: Optional[str] = None
    shop_id: Optional[str] = None
    merchants_total: int
    merchants_active: int
    farmers_directory: int
    farmers_with_patti: int
    farmer_bags: int
    farmer_pattis: int
    vendors_directory: int
    vendors_with_bills: int
    vendor_bills: int
    purchased_bags: int
    definitions: Dict[str, str]

class MerchantListItem(BaseModel):
    shop_id: str
    shop_name: Optional[str] = None
    username: Optional[str] = None
    active: Optional[bool] = None
    owner_name: Optional[str] = None
    mobile: Optional[str] = None
    village: Optional[str] = None
    district: Optional[str] = None
    state: Optional[str] = None
    created_at: Optional[datetime] = None
    # Optional day activity when date filter applied
    farmer_pattis: Optional[int] = None
    farmer_bags: Optional[int] = None
    vendor_bills: Optional[int] = None
    purchased_bags: Optional[int] = None


class MerchantListOut(BaseModel):
    items: List[MerchantListItem]
    page: int
    page_size: int
    total_count: int


class MerchantDetailOut(BaseModel):
    shop_id: str
    shop_name: Optional[str] = None
    username: Optional[str] = None
    active: Optional[bool] = None
    owner_name: Optional[str] = None
    mobile: Optional[str] = None
    alt_mobile: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    village: Optional[str] = None
    taluk: Optional[str] = None
    district: Optional[str] = None
    state: Optional[str] = None
    gst_number: Optional[str] = None
    created_at: Optional[datetime] = None
    dashboard: DashboardOut


class ActivityRow(BaseModel):
    shop_id: str
    shop_name: Optional[str] = None
    username: Optional[str] = None
    active: Optional[bool] = None
    farmer_pattis: int
    farmer_bags: int
    vendor_bills: int
    purchased_bags: int


class ActivityListOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    items: List[ActivityRow]
    page: int
    page_size: int
    total_count: int
    from_: str = Field(alias="from")
    to: str


class PattiListItem(BaseModel):
    id: str
    shop_id: str
    shop_name: Optional[str] = None
    date: str
    patti_no: int
    farmer_id: str
    farmer_name: str
    total_bags: int
    gross_total: float
    net_payable: float
    status: str
    deleted: bool = False


class PattiListOut(BaseModel):
    items: List[PattiListItem]
    page: int
    page_size: int
    total_count: int


class VendorBillListItem(BaseModel):
    id: str
    shop_id: str
    shop_name: Optional[str] = None
    date: str
    bill_no: int
    bill_code: str
    vendor_id: str
    vendor_name: str
    total_bags: int
    grand_total: float
    status: str
    deleted: bool = False


class VendorBillListOut(BaseModel):
    items: List[VendorBillListItem]
    page: int
    page_size: int
    total_count: int


class PurchaseListItem(BaseModel):
    id: str
    shop_id: str
    shop_name: Optional[str] = None
    bags: int
    price_per_bag: float
    base_amount: float
    gst_amount: float
    total_amount: float
    status: str
    created_at: Optional[datetime] = None
    paid_at: Optional[datetime] = None
    event_at: Optional[datetime] = None


class PurchaseListOut(BaseModel):
    items: List[PurchaseListItem]
    page: int
    page_size: int
    total_count: int


class AuditLogItem(BaseModel):
    id: str
    admin_user_id: Optional[str] = None
    admin_username: Optional[str] = None
    action: str
    resource_type: str
    resource_id: Optional[str] = None
    shop_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class AuditLogOut(BaseModel):
    items: List[AuditLogItem]
    page: int
    page_size: int
    total_count: int


class ReportMerchantDailyRow(BaseModel):
    shop_id: str
    shop_name: Optional[str] = None
    farmer_pattis: int
    farmer_bags: int
    vendor_bills: int
    purchased_bags: int


class ReportMerchantDailyOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_: str = Field(alias="from")
    to: str
    items: List[ReportMerchantDailyRow]