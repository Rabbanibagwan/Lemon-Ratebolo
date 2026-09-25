"""Production OCR engine for Action Diary extraction.

Primary: Gemini Vision (server-side API key only)
Fallback: Google Cloud Vision text → diary text parser (optional)

Includes: error classification, retries with backoff, concurrency queue,
and in-memory metrics. Never logs API keys or auth tokens.
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import os
import re
import threading
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger("ocr")

# ---------------------------------------------------------------------------
# Error classification
# ---------------------------------------------------------------------------


class OcrErrorClass(str, Enum):
    RATE_LIMIT = "rate_limit"  # 429 RPM / short-term
    DAILY_QUOTA = "daily_quota"  # 429 RPD / daily
    TOKEN_QUOTA = "token_quota"  # 429 TPM / token budget
    BILLING = "billing"
    AUTH = "auth"  # invalid / missing key
    TIMEOUT = "timeout"
    TEMP_UNAVAILABLE = "temp_unavailable"  # 503 / overloaded
    MODEL_UNAVAILABLE = "model_unavailable"  # 404 model not found / shutdown
    MALFORMED = "malformed"
    NETWORK = "network"
    OTHER = "other"


USER_MESSAGES: Dict[OcrErrorClass, str] = {
    OcrErrorClass.RATE_LIMIT: "OCR service is temporarily busy. Retrying automatically...",
    OcrErrorClass.DAILY_QUOTA: (
        "OCR quota has been reached. Please try again after the quota resets or contact administrator."
    ),
    OcrErrorClass.TOKEN_QUOTA: (
        "OCR quota has been reached. Please try again after the quota resets or contact administrator."
    ),
    OcrErrorClass.BILLING: "OCR billing/quota configuration requires attention.",
    OcrErrorClass.AUTH: "OCR service configuration error. Please contact administrator.",
    OcrErrorClass.TIMEOUT: "OCR request timed out. Please try again.",
    OcrErrorClass.TEMP_UNAVAILABLE: "OCR service is temporarily unavailable. Retrying...",
    OcrErrorClass.MODEL_UNAVAILABLE: (
        "OCR model is not available for this project. Please check server model configuration."
    ),
    OcrErrorClass.MALFORMED: "OCR request was rejected. Please check the image and try again.",
    OcrErrorClass.NETWORK: "Unable to reach OCR server. Please check the connection.",
    OcrErrorClass.OTHER: "OCR provider error. Please try again shortly.",
}


@dataclass
class ClassifiedOcrError:
    error_class: OcrErrorClass
    http_status: Optional[int]
    retryable: bool
    retry_after_seconds: Optional[float]
    provider: str
    model: Optional[str]
    message: str
    upstream_snippet: str = ""


def _safe_snippet(body: str, limit: int = 400) -> str:
    raw = body or ""
    redacted = re.sub(
        r"(?i)(AIza[0-9A-Za-z_-]{10,}|AQ\.[0-9A-Za-z._-]{10,}|key=)[^\s\"'&]*",
        r"\1[REDACTED]",
        raw,
    )
    return " ".join(redacted.split())[:limit]


def _parse_retry_after(headers: Optional[Dict[str, str]], body: str) -> Optional[float]:
    if headers:
        ra = headers.get("Retry-After") or headers.get("retry-after")
        if ra:
            try:
                return max(0.0, float(ra))
            except Exception:
                pass
    # Gemini sometimes embeds retryDelay like "12s" in JSON details
    m = re.search(r'"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"', body or "")
    if m:
        try:
            return float(m.group(1))
        except Exception:
            pass
    m2 = re.search(r'"retry_delay"\s*:\s*\{\s*"seconds"\s*:\s*(\d+)', body or "")
    if m2:
        try:
            return float(m2.group(1))
        except Exception:
            pass
    return None


def classify_provider_error(
    *,
    status_code: Optional[int],
    body: str = "",
    exc: Optional[BaseException] = None,
    provider: str = "gemini",
    model: Optional[str] = None,
) -> ClassifiedOcrError:
    low = (body or "").lower()
    snippet = _safe_snippet(body)
    retry_after = _parse_retry_after(None, body)

    if exc is not None:
        ename = type(exc).__name__.lower()
        emsg = str(exc).lower()
        if "timeout" in ename or "timeout" in emsg or "timed out" in emsg:
            return ClassifiedOcrError(
                OcrErrorClass.TIMEOUT,
                status_code,
                True,
                2.0,
                provider,
                model,
                USER_MESSAGES[OcrErrorClass.TIMEOUT],
                snippet or str(exc)[:200],
            )
        if any(x in emsg for x in ("connection", "network", "name or service", "dns", "refused")):
            return ClassifiedOcrError(
                OcrErrorClass.NETWORK,
                status_code,
                True,
                2.0,
                provider,
                model,
                USER_MESSAGES[OcrErrorClass.NETWORK],
                snippet or str(exc)[:200],
            )

    # Billing — only when clearly a billing/account problem, NOT free-tier quota text
    # that merely links to billing docs ("check your plan and billing details").
    if any(
        x in low
        for x in (
            "billing account",
            "enable billing",
            "billing is not enabled",
            "payment required",
            "spend limit",
            "budget exceeded",
        )
    ) and "quota" not in low and status_code != 429:
        return ClassifiedOcrError(
            OcrErrorClass.BILLING,
            status_code,
            False,
            None,
            provider,
            model,
            USER_MESSAGES[OcrErrorClass.BILLING],
            snippet,
        )

    # Auth / invalid key
    if status_code in (401, 403) or (
        status_code == 400
        and any(
            x in low
            for x in (
                "api key not valid",
                "api_key_invalid",
                "invalid api key",
                "permission denied",
                "unauthenticated",
            )
        )
    ):
        return ClassifiedOcrError(
            OcrErrorClass.AUTH,
            status_code,
            False,
            None,
            provider,
            model,
            USER_MESSAGES[OcrErrorClass.AUTH],
            snippet,
        )

    # 429 subtypes — must run before generic "billing" heuristics in message text
    if status_code == 429 or "resource_exhausted" in low or "rate limit" in low or "quota" in low:
        if any(
            x in low
            for x in (
                "per_day",
                "perday",
                "daily",
                "rpd",
                "requests per day",
                "generate_requests_per_model_per_day",
                "free_tier",
                "exceeded your current quota",
                "check your plan and billing details",
            )
        ):
            return ClassifiedOcrError(
                OcrErrorClass.DAILY_QUOTA,
                status_code or 429,
                False,
                retry_after,
                provider,
                model,
                USER_MESSAGES[OcrErrorClass.DAILY_QUOTA],
                snippet,
            )
        if any(x in low for x in ("token", "tpm", "tokensperminute", "per_minute_tokens")):
            return ClassifiedOcrError(
                OcrErrorClass.TOKEN_QUOTA,
                status_code or 429,
                True,
                retry_after or 15.0,
                provider,
                model,
                USER_MESSAGES[OcrErrorClass.TOKEN_QUOTA],
                snippet,
            )
        # Default 429 → short-term rate limit (retryable)
        return ClassifiedOcrError(
            OcrErrorClass.RATE_LIMIT,
            status_code or 429,
            True,
            retry_after or 8.0,
            provider,
            model,
            USER_MESSAGES[OcrErrorClass.RATE_LIMIT],
            snippet,
        )

    if status_code in (503, 502, 504) or "high demand" in low or "overloaded" in low or (
        status_code != 404 and "unavailable" in low and "not found" not in low
    ):
        # High-demand 503s are transient — short retry then switch model.
        default_ra = 2.0 if "high demand" in low else 5.0
        return ClassifiedOcrError(
            OcrErrorClass.TEMP_UNAVAILABLE,
            status_code,
            True,
            retry_after or default_ra,
            provider,
            model,
            USER_MESSAGES[OcrErrorClass.TEMP_UNAVAILABLE],
            snippet,
        )

    # Permanent: model shutdown / not found / not supported for generateContent
    if status_code == 404 or "not_found" in low or (
        ("not found" in low or "is not found" in low or "not supported for generatecontent" in low)
        and ("model" in low or (model or "").lower() in low)
    ):
        return ClassifiedOcrError(
            OcrErrorClass.MODEL_UNAVAILABLE,
            status_code or 404,
            False,
            None,
            provider,
            model,
            USER_MESSAGES[OcrErrorClass.MODEL_UNAVAILABLE],
            snippet,
        )

    if status_code == 400 or "invalid argument" in low or "malformed" in low:
        return ClassifiedOcrError(
            OcrErrorClass.MALFORMED,
            status_code,
            False,
            None,
            provider,
            model,
            USER_MESSAGES[OcrErrorClass.MALFORMED],
            snippet,
        )

    return ClassifiedOcrError(
        OcrErrorClass.OTHER,
        status_code,
        bool(status_code and status_code >= 500),
        retry_after,
        provider,
        model,
        USER_MESSAGES[OcrErrorClass.OTHER],
        snippet,
    )


class OcrServiceError(RuntimeError):
    def __init__(self, classified: ClassifiedOcrError, attempts: Optional[List[Dict[str, Any]]] = None):
        super().__init__(classified.message)
        self.classified = classified
        self.attempts = list(attempts or [])

    def http_payload(self) -> Dict[str, Any]:
        c = self.classified
        code_map = {
            OcrErrorClass.RATE_LIMIT: "OCR_RATE_LIMIT",
            OcrErrorClass.DAILY_QUOTA: "OCR_DAILY_QUOTA",
            OcrErrorClass.TOKEN_QUOTA: "OCR_TOKEN_QUOTA",
            OcrErrorClass.BILLING: "OCR_BILLING",
            OcrErrorClass.AUTH: "OCR_AUTH",
            OcrErrorClass.TIMEOUT: "OCR_TIMEOUT",
            OcrErrorClass.TEMP_UNAVAILABLE: "OCR_TEMP_UNAVAILABLE",
            OcrErrorClass.MODEL_UNAVAILABLE: "OCR_MODEL_UNAVAILABLE",
            OcrErrorClass.MALFORMED: "OCR_MALFORMED",
            OcrErrorClass.NETWORK: "OCR_NETWORK",
            OcrErrorClass.OTHER: "OCR_UPSTREAM",
        }
        # Prefer a clearer user message for Gemini high-demand 503.
        message = c.message
        if is_high_demand_503(c):
            message = "OCR model is busy due to high demand. Retrying with a backup model..."
        payload = {
            "code": code_map.get(c.error_class, "OCR_UPSTREAM"),
            "class": c.error_class.value,
            "message": message,
            "retryable": c.retryable,
            "retry_after_seconds": c.retry_after_seconds,
            "provider": c.provider,
            "model": c.model,
            "status_code": c.http_status,
            "upstream_body": c.upstream_snippet[:300],
            "high_demand": is_high_demand_503(c),
        }
        if self.attempts:
            payload["attempts"] = self.attempts
        return payload


# ---------------------------------------------------------------------------
# Metrics (in-process; safe to log aggregates only)
# ---------------------------------------------------------------------------


class OcrMetrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.requests = 0
        self.success = 0
        self.failure = 0
        self.retries = 0
        self.fallback_used = 0
        self.by_class: Dict[str, int] = {}
        self.by_provider: Dict[str, int] = {}
        self.latencies_ms: List[float] = []

    def record_request(self) -> None:
        with self._lock:
            self.requests += 1

    def record_success(self, provider: str, latency_ms: float) -> None:
        with self._lock:
            self.success += 1
            self.by_provider[provider] = self.by_provider.get(provider, 0) + 1
            self.latencies_ms.append(latency_ms)
            if len(self.latencies_ms) > 200:
                self.latencies_ms = self.latencies_ms[-200:]

    def record_failure(self, error_class: str) -> None:
        with self._lock:
            self.failure += 1
            self.by_class[error_class] = self.by_class.get(error_class, 0) + 1

    def record_retry(self) -> None:
        with self._lock:
            self.retries += 1

    def record_fallback(self) -> None:
        with self._lock:
            self.fallback_used += 1

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            lats = list(self.latencies_ms)
            avg = sum(lats) / len(lats) if lats else 0.0
            return {
                "requests": self.requests,
                "success": self.success,
                "failure": self.failure,
                "retries": self.retries,
                "fallback_used": self.fallback_used,
                "by_class": dict(self.by_class),
                "by_provider": dict(self.by_provider),
                "avg_latency_ms": round(avg, 1),
            }


METRICS = OcrMetrics()


# ---------------------------------------------------------------------------
# Concurrency gate
# ---------------------------------------------------------------------------

_MAX_CONCURRENT = max(1, int(os.environ.get("OCR_MAX_CONCURRENT", "2")))
_gemini_sem: Optional[asyncio.Semaphore] = None
_sem_lock = asyncio.Lock()


async def _get_sem() -> asyncio.Semaphore:
    global _gemini_sem
    async with _sem_lock:
        if _gemini_sem is None:
            _gemini_sem = asyncio.Semaphore(_MAX_CONCURRENT)
        return _gemini_sem


# ---------------------------------------------------------------------------
# Job store (in-memory; process-local)
# ---------------------------------------------------------------------------


class OcrJobState(str, Enum):
    IDLE = "IDLE"
    QUEUED = "QUEUED"
    UPLOADING = "UPLOADING"
    PROCESSING = "PROCESSING"
    RETRYING = "RETRYING"
    SUCCESS = "SUCCESS"
    TEMPORARILY_UNAVAILABLE = "TEMPORARILY_UNAVAILABLE"
    FAILED = "FAILED"


@dataclass
class OcrJob:
    id: str
    shop_id: str
    state: OcrJobState = OcrJobState.QUEUED
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    provider: Optional[str] = None
    model: Optional[str] = None
    rows: Optional[List[Dict[str, Any]]] = None
    warning: Optional[str] = None
    error: Optional[Dict[str, Any]] = None
    attempt: int = 0
    latency_ms: Optional[float] = None
    # Per-model attempt trail for ops (model / http / class / success).
    attempts: List[Dict[str, Any]] = field(default_factory=list)


_JOBS: Dict[str, OcrJob] = {}
_JOBS_LOCK = threading.Lock()
_JOB_TTL_SEC = 3600


def _prune_jobs() -> None:
    now = time.time()
    with _JOBS_LOCK:
        dead = [jid for jid, j in _JOBS.items() if now - j.created_at > _JOB_TTL_SEC]
        for jid in dead:
            _JOBS.pop(jid, None)


def get_job(job_id: str) -> Optional[OcrJob]:
    _prune_jobs()
    with _JOBS_LOCK:
        return _JOBS.get(job_id)


def _set_job(job: OcrJob) -> None:
    job.updated_at = time.time()
    with _JOBS_LOCK:
        _JOBS[job.id] = job


# ---------------------------------------------------------------------------
# Image optimize + Gemini / Vision callers
# ---------------------------------------------------------------------------


def gemini_api_key() -> Optional[str]:
    key = (
        os.environ.get("GEMINI_API_KEY")
        or os.environ.get("GOOGLE_API_KEY")
        or os.environ.get("EMERGENT_LLM_KEY")
    )
    return key.strip() if key and key.strip() else None


def vision_api_key() -> Optional[str]:
    key = (
        os.environ.get("GOOGLE_VISION_API_KEY")
        or os.environ.get("GOOGLE_CLOUD_VISION_API_KEY")
        or gemini_api_key()
    )
    return key.strip() if key and key.strip() else None


# Shutdown / retired models — never call these (404 NOT_FOUND in production).
OBSOLETE_GEMINI_MODELS = frozenset(
    {
        "gemini-2.0-flash",
        "gemini-2.0-flash-001",
        "gemini-2.0-flash-lite",
        "gemini-1.5-flash",
        "gemini-1.5-flash-001",
        "gemini-1.5-flash-8b",
        "gemini-1.5-pro",
        "gemini-1.5-pro-001",
    }
)

# Capacity-flaky models: demote from primary when configured.
FLAKY_CAPACITY_MODELS = frozenset(
    {
        "gemini-3.6-flash",
        "gemini-3.6-flash-preview",
        "gemini-3.0-flash",
    }
)

# Current multimodal OCR chain (image-capable).
DEFAULT_PRIMARY_MODEL = "gemini-2.5-flash"
DEFAULT_FALLBACK_MODEL = "gemini-2.5-flash-lite"
DEFAULT_FALLBACK_MODEL_2 = "gemini-3.5-flash-lite"

_available_models_cache: Optional[Tuple[float, set]] = None
_AVAILABLE_MODELS_TTL_SEC = 300.0


def primary_model() -> str:
    configured = (os.environ.get("GEMINI_OCR_MODEL") or DEFAULT_PRIMARY_MODEL).strip()
    if configured in OBSOLETE_GEMINI_MODELS:
        logger.warning("OCR_SKIP_OBSOLETE_PRIMARY model=%s → %s", configured, DEFAULT_PRIMARY_MODEL)
        return DEFAULT_PRIMARY_MODEL
    return configured or DEFAULT_PRIMARY_MODEL


def fallback_model() -> str:
    configured = (os.environ.get("GEMINI_OCR_FALLBACK_MODEL") or DEFAULT_FALLBACK_MODEL).strip()
    if configured in OBSOLETE_GEMINI_MODELS:
        logger.warning("OCR_SKIP_OBSOLETE_FALLBACK model=%s → %s", configured, DEFAULT_FALLBACK_MODEL)
        return DEFAULT_FALLBACK_MODEL
    return configured or DEFAULT_FALLBACK_MODEL


def fallback_model_2() -> str:
    configured = (os.environ.get("GEMINI_OCR_FALLBACK_MODEL_2") or DEFAULT_FALLBACK_MODEL_2).strip()
    if configured in OBSOLETE_GEMINI_MODELS:
        logger.warning("OCR_SKIP_OBSOLETE_FALLBACK_2 model=%s → %s", configured, DEFAULT_FALLBACK_MODEL_2)
        return DEFAULT_FALLBACK_MODEL_2
    return configured or DEFAULT_FALLBACK_MODEL_2


def list_available_gemini_models(api_key: str) -> Optional[set]:
    """Return set of model ids supporting generateContent, or None if listing fails."""
    global _available_models_cache
    now = time.time()
    if _available_models_cache and (now - _available_models_cache[0]) < _AVAILABLE_MODELS_TTL_SEC:
        return set(_available_models_cache[1])
    import requests as _requests

    key = (api_key or "").strip()
    if not key:
        return None
    url = "https://generativelanguage.googleapis.com/v1beta/models"
    try:
        resp = _requests.get(url, params={"key": key, "pageSize": 200}, timeout=20)
        if resp.status_code >= 400:
            logger.warning("OCR_LIST_MODELS_FAIL status=%s body=%s", resp.status_code, _safe_snippet(resp.text or "", 200))
            return None
        names: set = set()
        for m in (resp.json() or {}).get("models") or []:
            if not isinstance(m, dict):
                continue
            name = (m.get("name") or "").replace("models/", "").strip()
            methods = m.get("supportedGenerationMethods") or m.get("supported_generation_methods") or []
            if name and ("generateContent" in methods or "generateContent" in str(methods)):
                names.add(name)
        _available_models_cache = (now, set(names))
        return names
    except Exception as e:
        logger.warning("OCR_LIST_MODELS_ERROR err=%s", type(e).__name__)
        return None


def model_candidates(api_key: Optional[str] = None) -> List[str]:
    """Ordered unique Gemini models for OCR — current multimodal chain only.

    Never includes shutdown models (gemini-2.0-flash / gemini-1.5-flash).
    When ListModels succeeds, filters to models that exist for this API key.
    """
    configured = primary_model()
    fb1 = fallback_model()
    fb2 = fallback_model_2()

    preferred: List[str] = []
    if configured in FLAKY_CAPACITY_MODELS:
        preferred.extend([DEFAULT_PRIMARY_MODEL, fb1, fb2, configured])
    else:
        preferred.extend([configured, fb1, fb2])

    # Optional extra chain from env (still filtered for obsolete).
    extra = (os.environ.get("GEMINI_OCR_MODEL_CHAIN") or "").strip()
    if extra:
        preferred.extend(x.strip() for x in extra.split(",") if x.strip())

    # Ensure defaults are present as safety net.
    for m in (DEFAULT_PRIMARY_MODEL, DEFAULT_FALLBACK_MODEL, DEFAULT_FALLBACK_MODEL_2):
        preferred.append(m)

    out: List[str] = []
    seen = set()
    for m in preferred:
        if not m or m in seen:
            continue
        if m in OBSOLETE_GEMINI_MODELS:
            logger.warning("OCR_SKIP_OBSOLETE_MODEL model=%s", m)
            continue
        seen.add(m)
        out.append(m)

    # Demote flaky capacity models away from position 0.
    if out and out[0] in FLAKY_CAPACITY_MODELS and len(out) > 1:
        bad = out.pop(0)
        out.append(bad)

    available = list_available_gemini_models(api_key) if api_key else None
    if available:
        def _is_listed(name: str) -> bool:
            if name in available:
                return True
            # ListModels may return versioned ids (e.g. gemini-2.5-flash-001).
            return any(a == name or a.startswith(name + "-") for a in available)

        filtered = [m for m in out if _is_listed(m)]
        if filtered:
            out = filtered
            logger.info(
                "OCR_MODEL_CHAIN_FILTERED chain=%s available_count=%s",
                ",".join(out),
                len(available),
            )
        else:
            logger.warning(
                "OCR_MODEL_CHAIN_UNVERIFIED no overlap with ListModels; keeping configured chain=%s",
                ",".join(out),
            )

    return out


def is_high_demand_503(classified: ClassifiedOcrError) -> bool:
    snip = (classified.upstream_snippet or "").lower()
    return classified.error_class == OcrErrorClass.TEMP_UNAVAILABLE and (
        "high demand" in snip or "overloaded" in snip or "unavailable" in snip
    )


def optimize_ocr_image_b64(image_b64: str, mime_type: str) -> Tuple[str, str]:
    try:
        from PIL import Image as _PILImage  # type: ignore
    except Exception:
        return image_b64, mime_type or "image/jpeg"
    try:
        raw = base64.b64decode(image_b64)
        img = _PILImage.open(io.BytesIO(raw))
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        elif img.mode == "L":
            img = img.convert("RGB")
        w, h = img.size
        max_side = 1024
        if max(w, h) > max_side:
            if w >= h:
                nh = max(1, int(h * (max_side / float(w))))
                img = img.resize((max_side, nh), _PILImage.Resampling.LANCZOS)
            else:
                nw = max(1, int(w * (max_side / float(h))))
                img = img.resize((nw, max_side), _PILImage.Resampling.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=72, optimize=True)
        return base64.b64encode(buf.getvalue()).decode("ascii"), "image/jpeg"
    except Exception:
        return image_b64, mime_type or "image/jpeg"


def call_gemini_vision(
    image_b64: str,
    mime_type: str,
    hint: Optional[str],
    api_key: str,
    system_prompt: str,
    model: Optional[str] = None,
) -> Tuple[str, str]:
    import requests as _requests

    model = (model or primary_model()).strip()
    hint_line = f"\nHint: {hint}" if hint else ""
    prompt = system_prompt + hint_line + "\nExtract all lots. JSON only."
    key = api_key.strip()
    auth_mode = "header" if key.startswith("AQ.") else "query"
    req_timeout = int(os.environ.get("OCR_GEMINI_TIMEOUT_SEC", "180"))
    base_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt},
                    {"inline_data": {"mime_type": mime_type or "image/jpeg", "data": image_b64}},
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.0,
            "responseMimeType": "application/json",
            "maxOutputTokens": 4096,
        },
    }
    url = f"{base_url}?key={key}" if auth_mode == "query" else base_url
    headers = {"Content-Type": "application/json"}
    if auth_mode == "header":
        headers["x-goog-api-key"] = key

    t0 = time.time()
    try:
        resp = _requests.post(url, json=payload, headers=headers, timeout=req_timeout)
    except Exception as e:
        classified = classify_provider_error(status_code=None, body="", exc=e, provider="gemini", model=model)
        raise OcrServiceError(classified) from e

    latency_ms = (time.time() - t0) * 1000
    if resp.status_code >= 400:
        raw_body = resp.text or ""
        if resp.status_code == 429:
            logger.warning(
                "OCR_PROVIDER_429 provider=gemini model=%s latency_ms=%.0f body=%s",
                model,
                latency_ms,
                _safe_snippet(raw_body, 800),
            )
        classified = classify_provider_error(
            status_code=resp.status_code,
            body=raw_body,
            provider="gemini",
            model=model,
        )
        # Prefer Retry-After header when present
        ra = _parse_retry_after(dict(resp.headers), raw_body)
        if ra is not None:
            classified.retry_after_seconds = ra
        raise OcrServiceError(classified)

    data = resp.json()
    parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    text = "".join(p.get("text", "") for p in parts if isinstance(p, dict))
    if not (text or "").strip():
        raise OcrServiceError(
            ClassifiedOcrError(
                OcrErrorClass.OTHER,
                502,
                True,
                2.0,
                "gemini",
                model,
                USER_MESSAGES[OcrErrorClass.OTHER],
                "empty response",
            )
        )
    logger.info(
        "OCR_PROVIDER_OK provider=gemini model=%s latency_ms=%.0f chars=%s http=200",
        model,
        latency_ms,
        len(text),
    )
    return text, model


def call_google_vision_text(image_b64: str, api_key: str) -> str:
    """DOCUMENT_TEXT_DETECTION → plain text. Raises OcrServiceError on failure."""
    import requests as _requests

    url = f"https://vision.googleapis.com/v1/images:annotate?key={api_key.strip()}"
    payload = {
        "requests": [
            {
                "image": {"content": image_b64},
                "features": [{"type": "DOCUMENT_TEXT_DETECTION"}],
            }
        ]
    }
    t0 = time.time()
    try:
        resp = _requests.post(url, json=payload, timeout=60)
    except Exception as e:
        classified = classify_provider_error(status_code=None, body="", exc=e, provider="vision", model="document_text")
        raise OcrServiceError(classified) from e

    latency_ms = (time.time() - t0) * 1000
    if resp.status_code >= 400:
        classified = classify_provider_error(
            status_code=resp.status_code,
            body=resp.text or "",
            provider="vision",
            model="document_text",
        )
        raise OcrServiceError(classified)

    data = resp.json()
    responses = data.get("responses") or []
    if not responses:
        return ""
    full = (responses[0] or {}).get("fullTextAnnotation") or {}
    text = (full.get("text") or "").strip()
    logger.info(
        "OCR_PROVIDER_OK provider=vision model=document_text latency_ms=%.0f chars=%s http=200",
        latency_ms,
        len(text),
    )
    return text


# ---------------------------------------------------------------------------
# Retry + extract orchestration
# ---------------------------------------------------------------------------


def _should_use_fallback(err: ClassifiedOcrError) -> bool:
    """Fallback only for temporary provider/rate/quota — never for auth/malformed."""
    if err.error_class in (OcrErrorClass.AUTH, OcrErrorClass.MALFORMED, OcrErrorClass.BILLING):
        return False
    return err.error_class in (
        OcrErrorClass.RATE_LIMIT,
        OcrErrorClass.DAILY_QUOTA,
        OcrErrorClass.TOKEN_QUOTA,
        OcrErrorClass.TEMP_UNAVAILABLE,
        OcrErrorClass.TIMEOUT,
        OcrErrorClass.NETWORK,
        OcrErrorClass.OTHER,
    )


async def _sleep_backoff(attempt: int, retry_after: Optional[float]) -> None:
    if retry_after is not None and retry_after > 0:
        delay = min(60.0, float(retry_after))
    else:
        delay = min(45.0, (2 ** attempt) * 1.5)
    await asyncio.sleep(delay)


@dataclass
class OcrExtractResult:
    rows_raw_text: str
    model: str
    provider: str
    warning: Optional[str] = None
    attempts: List[Dict[str, Any]] = field(default_factory=list)


async def extract_with_resilience(
    *,
    image_b64: str,
    mime_type: str,
    hint: Optional[str],
    system_prompt: str,
    parse_diary_text: Callable[[str], list],
    shop_id: str,
    job: Optional[OcrJob] = None,
) -> OcrExtractResult:
    """Run Gemini (queued + retries), then optional Vision fallback."""
    METRICS.record_request()
    api_key = gemini_api_key()
    if not api_key:
        raise OcrServiceError(
            ClassifiedOcrError(
                OcrErrorClass.AUTH,
                None,
                False,
                None,
                "gemini",
                None,
                USER_MESSAGES[OcrErrorClass.AUTH],
                "NO_CLOUD_OCR_KEY",
            )
        )

    img_b64, mime = await asyncio.to_thread(optimize_ocr_image_b64, image_b64, mime_type or "image/jpeg")
    sem = await _get_sem()
    models_to_try = model_candidates(api_key=api_key)

    last_err: Optional[OcrServiceError] = None
    # Per-model attempts: fewer for high-demand 503 so we rotate models faster.
    max_attempts = max(1, int(os.environ.get("OCR_MAX_RETRIES", "3")))
    t_start = time.time()
    attempt_trail: List[Dict[str, Any]] = []

    def _record_attempt(
        *,
        model: str,
        http_status: Optional[int],
        error_class: Optional[str],
        success: bool,
        attempt_n: int,
    ) -> None:
        entry = {
            "model": model,
            "http_status": http_status,
            "error_class": error_class,
            "success": success,
            "attempt": attempt_n,
        }
        attempt_trail.append(entry)
        if job is not None:
            job.attempts = list(attempt_trail)
            _set_job(job)

    async with sem:
        if job:
            job.state = OcrJobState.PROCESSING
            _set_job(job)

        logger.info(
            "OCR_START shop=%s models=%s max_attempts_per_model=%s",
            shop_id,
            ",".join(models_to_try),
            max_attempts,
        )

        for model in models_to_try:
            model_attempts = max_attempts
            for attempt in range(model_attempts):
                if job:
                    job.attempt = attempt + 1
                    job.state = OcrJobState.PROCESSING if attempt == 0 else OcrJobState.RETRYING
                    job.provider = "gemini"
                    job.model = model
                    _set_job(job)
                try:
                    logger.info(
                        "OCR_ATTEMPT shop=%s provider=gemini model=%s attempt=%s/%s",
                        shop_id,
                        model,
                        attempt + 1,
                        model_attempts,
                    )
                    text, used_model = await asyncio.to_thread(
                        call_gemini_vision,
                        img_b64,
                        mime,
                        hint,
                        api_key,
                        system_prompt,
                        model,
                    )
                    latency = (time.time() - t_start) * 1000
                    METRICS.record_success("gemini", latency)
                    _record_attempt(
                        model=used_model or model,
                        http_status=200,
                        error_class=None,
                        success=True,
                        attempt_n=attempt + 1,
                    )
                    logger.info(
                        "OCR_SUCCESS shop=%s provider=gemini model=%s latency_ms=%.0f",
                        shop_id,
                        used_model,
                        latency,
                    )
                    return OcrExtractResult(
                        rows_raw_text=text,
                        model=used_model,
                        provider="gemini",
                        attempts=list(attempt_trail),
                    )
                except OcrServiceError as e:
                    last_err = e
                    METRICS.record_failure(e.classified.error_class.value)
                    _record_attempt(
                        model=e.classified.model or model,
                        http_status=e.classified.http_status,
                        error_class=e.classified.error_class.value,
                        success=False,
                        attempt_n=attempt + 1,
                    )
                    logger.warning(
                        "OCR_ATTEMPT_FAIL shop=%s provider=%s model=%s class=%s status=%s "
                        "retryable=%s attempt=%s provider_msg=%s",
                        shop_id,
                        e.classified.provider,
                        e.classified.model,
                        e.classified.error_class.value,
                        e.classified.http_status,
                        e.classified.retryable,
                        attempt + 1,
                        (e.classified.upstream_snippet or "")[:240],
                    )
                    if e.classified.error_class in (OcrErrorClass.AUTH, OcrErrorClass.MALFORMED, OcrErrorClass.BILLING):
                        raise
                    # 404 model-not-found is permanent for this model — never retry it.
                    if e.classified.error_class == OcrErrorClass.MODEL_UNAVAILABLE:
                        logger.warning(
                            "OCR_MODEL_UNAVAILABLE_SKIP shop=%s model=%s — rotating to next candidate",
                            shop_id,
                            model,
                        )
                        break
                    # Project-level quota: stop burning remaining Gemini models; try Vision fallback.
                    if e.classified.error_class == OcrErrorClass.DAILY_QUOTA:
                        last_err = e
                        break
                    # High-demand 503: one short retry on same model, then rotate.
                    if is_high_demand_503(e.classified):
                        if attempt == 0 and model_attempts > 1:
                            METRICS.record_retry()
                            if job:
                                job.state = OcrJobState.RETRYING
                                _set_job(job)
                            await _sleep_backoff(0, e.classified.retry_after_seconds or 1.5)
                            continue
                        break
                    if e.classified.retryable and attempt < model_attempts - 1:
                        METRICS.record_retry()
                        if job:
                            job.state = OcrJobState.RETRYING
                            _set_job(job)
                        await _sleep_backoff(attempt, e.classified.retry_after_seconds)
                        continue
                    # Non-retryable or retries exhausted for this model → try next model
                    break
            else:
                continue
            # break from inner due to DAILY_QUOTA → exit model loop
            if last_err and last_err.classified.error_class == OcrErrorClass.DAILY_QUOTA:
                break

    # Fallback to Vision when appropriate
    if last_err and _should_use_fallback(last_err.classified):
        vkey = vision_api_key()
        if vkey:
            try:
                if job:
                    job.state = OcrJobState.PROCESSING
                    job.provider = "vision"
                    _set_job(job)
                logger.info("OCR_FALLBACK_START shop=%s from_class=%s", shop_id, last_err.classified.error_class.value)
                vision_text = await asyncio.to_thread(call_google_vision_text, img_b64, vkey)
                METRICS.record_fallback()
                if vision_text.strip():
                    # Prefer structured Gemini text-only if still possible; else local diary parse.
                    # Local parse always available:
                    rows = parse_diary_text(vision_text)
                    if rows:
                        latency = (time.time() - t_start) * 1000
                        METRICS.record_success("vision", latency)
                        _record_attempt(
                            model="vision+parser",
                            http_status=200,
                            error_class=None,
                            success=True,
                            attempt_n=1,
                        )
                        # Encode as JSON for the shared parser path
                        payload = {
                            "rows": [
                                r if isinstance(r, dict) else (r.model_dump() if hasattr(r, "model_dump") else {})
                                for r in rows
                            ]
                        }
                        return OcrExtractResult(
                            rows_raw_text=json.dumps(payload),
                            model="vision+parser",
                            provider="vision",
                            warning="Extracted via fallback OCR. Please review carefully.",
                            attempts=list(attempt_trail),
                        )
                    # No structured rows — return raw text wrapped so caller can warn
                    return OcrExtractResult(
                        rows_raw_text=json.dumps({"rows": []}),
                        model="vision+parser",
                        provider="vision",
                        warning="Fallback OCR found text but could not structure lots. Please enter manually or retake.",
                        attempts=list(attempt_trail),
                    )
            except OcrServiceError as ve:
                logger.warning(
                    "OCR_FALLBACK_FAIL shop=%s class=%s status=%s",
                    shop_id,
                    ve.classified.error_class.value,
                    ve.classified.http_status,
                )
                # Keep original Gemini error if Vision also fails
                if ve.classified.error_class == OcrErrorClass.AUTH:
                    pass  # Vision not enabled / bad key — ignore
                else:
                    last_err = last_err or ve

    if last_err:
        if job:
            job.state = (
                OcrJobState.TEMPORARILY_UNAVAILABLE
                if last_err.classified.retryable
                else OcrJobState.FAILED
            )
            err_payload = last_err.http_payload()
            err_payload["attempts"] = list(attempt_trail)
            job.error = err_payload
            job.attempts = list(attempt_trail)
            _set_job(job)
        raise OcrServiceError(last_err.classified, attempts=attempt_trail)

    raise OcrServiceError(
        ClassifiedOcrError(
            OcrErrorClass.OTHER,
            None,
            True,
            None,
            "gemini",
            primary_model(),
            USER_MESSAGES[OcrErrorClass.OTHER],
            "unknown",
        ),
        attempts=attempt_trail,
    )


async def run_ocr_job(
    *,
    shop_id: str,
    image_b64: str,
    mime_type: str,
    hint: Optional[str],
    system_prompt: str,
    parse_model_json: Callable[[str], Tuple[list, Optional[str]]],
    parse_diary_text: Callable[[str], list],
    job_id: Optional[str] = None,
) -> OcrJob:
    job = OcrJob(id=job_id or str(uuid.uuid4()), shop_id=shop_id, state=OcrJobState.QUEUED)
    _set_job(job)
    try:
        result = await extract_with_resilience(
            image_b64=image_b64,
            mime_type=mime_type,
            hint=hint,
            system_prompt=system_prompt,
            parse_diary_text=parse_diary_text,
            shop_id=shop_id,
            job=job,
        )
        rows, warning = parse_model_json(result.rows_raw_text)
        if result.warning:
            warning = result.warning if not warning else f"{result.warning} {warning}"
        job.rows = [
            r.model_dump() if hasattr(r, "model_dump") else (r if isinstance(r, dict) else {})
            for r in rows
        ]
        job.warning = warning
        job.model = result.model
        job.provider = result.provider
        job.state = OcrJobState.SUCCESS
        job.latency_ms = (time.time() - job.created_at) * 1000
        _set_job(job)
        return job
    except OcrServiceError as e:
        job.error = e.http_payload()
        job.state = (
            OcrJobState.TEMPORARILY_UNAVAILABLE
            if e.classified.retryable
            else OcrJobState.FAILED
        )
        _set_job(job)
        raise
