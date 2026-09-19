"""Merchant account deletion — owner-only, shop_id from auth token only.

Deletes Lemon Mandi server-side shop data. Google Drive backups are NOT deleted
(OAuth tokens are client-side only; files remain in the user's Drive).
"""
from __future__ import annotations

import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backup import SHOP_COLLECTIONS

logger = logging.getLogger(__name__)

CONFIRM_PHRASE = "DELETE"

# Explicitly never touch these (global / platform).
PROTECTED_COLLECTIONS = frozenset({"platform_billing_settings"})

DRIVE_NOTICE = (
    "Your Lemon Mandi account and associated merchant data have been deleted "
    "from Lemon Mandi servers. Google Drive backup files created by Lemon Mandi "
    "may still remain in your Google Drive and must be deleted separately."
)


class DeleteAccountBody(BaseModel):
    """Require an explicit confirmation phrase. shop_id is never accepted from the client."""

    confirm: str = Field(min_length=1, max_length=40)


class DeleteAccountOut(BaseModel):
    deleted: bool
    shop_id: str
    deleted_collections: List[str]
    drive_backups_deleted: bool = False
    message: str


async def delete_merchant_account(db, shop_id: str) -> DeleteAccountOut:
    """Delete all shop-scoped operational data, then the shops login document.

    Order (failure-safe as far as multi-collection Mongo allows without a txn):
      1. Verify shop exists.
      2. Delete every SHOP_COLLECTIONS row for this shop_id.
      3. Only then delete the shops document.

    patti_audit_log: treated as shop-scoped operational audit (same as backup
    restore wipe). It is deleted with the merchant account — not retained as
    platform-wide permanent audit (no platform_admin_audit_log exists).

    platform_billing_settings: never deleted.
    """
    if not shop_id or not isinstance(shop_id, str):
        raise HTTPException(400, "Invalid shop")

    for name in PROTECTED_COLLECTIONS:
        if name in SHOP_COLLECTIONS:
            raise HTTPException(500, "Refusing deletion: protected collection in shop list")

    shop = await db.shops.find_one({"id": shop_id}, {"_id": 0, "password_hash": 0})
    if not shop:
        raise HTTPException(404, "Account not found or already deleted")

    deleted_collections: List[str] = []
    try:
        for name in SHOP_COLLECTIONS:
            if name in PROTECTED_COLLECTIONS:
                continue
            await db[name].delete_many({"shop_id": shop_id})
            deleted_collections.append(name)
    except Exception as e:
        logger.exception(
            "Account deletion failed while wiping shop-scoped data shop_id=%s "
            "completed=%s err=%s",
            shop_id,
            deleted_collections,
            e,
        )
        raise HTTPException(
            500,
            (
                "Account deletion failed while removing shop data. "
                "The login may still work. Please retry or contact support. "
                f"Partial collections cleared: {len(deleted_collections)}."
            ),
        ) from e

    try:
        result = await db.shops.delete_one({"id": shop_id})
        deleted_count = getattr(result, "deleted_count", None)
        if deleted_count == 0:
            # Race: another request deleted the shop. Treat as success if gone.
            still = await db.shops.find_one({"id": shop_id}, {"_id": 0})
            if still:
                raise HTTPException(
                    500,
                    (
                        "Shop data was cleared but the login record could not be removed. "
                        "Please contact support."
                    ),
                )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(
            "CRITICAL: shop-scoped data deleted but shops document remove failed "
            "shop_id=%s err=%s",
            shop_id,
            e,
        )
        raise HTTPException(
            500,
            (
                "Shop data was cleared but the login record could not be removed. "
                "Please contact support."
            ),
        ) from e

    logger.info(
        "Merchant account deleted shop_id=%s collections=%s drive_backups_deleted=false",
        shop_id,
        len(deleted_collections),
    )

    return DeleteAccountOut(
        deleted=True,
        shop_id=shop_id,
        deleted_collections=deleted_collections,
        drive_backups_deleted=False,
        message=DRIVE_NOTICE,
    )


def register_delete_account_routes(api: APIRouter, db, owner_only) -> None:
    @api.post("/auth/delete-account", response_model=DeleteAccountOut)
    async def delete_account_endpoint(
        body: DeleteAccountBody,
        user=Depends(owner_only),
    ):
        if (body.confirm or "").strip() != CONFIRM_PHRASE:
            raise HTTPException(
                400,
                f'Type {CONFIRM_PHRASE} to confirm permanent account deletion',
            )
        # Authority is the authenticated owner token only — ignore any client shop_id.
        shop_id = user["shop_id"]
        if user.get("role") != "owner":
            raise HTTPException(403, "Owner role required")
        return await delete_merchant_account(db, shop_id)
