"""Platform admin audit log helpers."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional


def _uid() -> str:
    return str(uuid.uuid4())


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


async def write_admin_audit(
    db,
    *,
    admin_user_id: Optional[str],
    admin_username: Optional[str],
    action: str,
    resource_type: str,
    resource_id: Optional[str] = None,
    shop_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    doc = {
        "id": _uid(),
        "admin_user_id": admin_user_id,
        "admin_username": admin_username,
        "action": action,
        "resource_type": resource_type,
        "resource_id": resource_id,
        "shop_id": shop_id,
        "metadata": metadata or {},
        "created_at": _utc_now(),
    }
    try:
        await db.platform_admin_audit_log.insert_one(doc)
    except Exception:
        # Audit must never break the primary action.
        pass
