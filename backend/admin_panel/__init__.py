"""Platform Admin Panel backend package.

Registers:
  /api/admin/auth/*
  /api/admin/dashboard
  /api/admin/merchants/*
  /api/admin/pattis/*
  /api/admin/vendor-bills/*
  /api/admin/purchases/*
  /api/admin/reports/*
  /api/admin/audit-log
"""
from __future__ import annotations

from fastapi import APIRouter

from admin_panel.auth import (
    bootstrap_admin_if_needed,
    ensure_admin_indexes,
    register_auth_routes,
)
from admin_panel.routes import register_admin_routes


async def startup_admin_panel(db) -> None:
    await ensure_admin_indexes(db)
    # Cross-shop day indexes for admin queries
    try:
        await db.pattis.create_index([("date", 1), ("shop_id", 1)])
        await db.vendor_bills.create_index([("date", 1), ("shop_id", 1)])
        await db.bag_purchases.create_index([("status", 1), ("paid_at", 1)])
        await db.bag_purchases.create_index([("status", 1), ("created_at", 1)])
        await db.shops.create_index([("active", 1)])
    except Exception:
        pass
    await bootstrap_admin_if_needed(db)


def register_platform_admin(api: APIRouter, db) -> None:
    register_auth_routes(api, db)
    register_admin_routes(api, db)
