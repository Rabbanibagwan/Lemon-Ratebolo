"""Unit tests for production OCR resilience (no live Gemini required)."""
from __future__ import annotations

import asyncio
import json
from unittest.mock import patch

import pytest

from ocr_service import (
    ClassifiedOcrError,
    OcrErrorClass,
    OcrServiceError,
    call_gemini_vision,
    classify_provider_error,
    extract_with_resilience,
)


def test_classify_rate_limit_429():
    c = classify_provider_error(
        status_code=429,
        body='{"error":{"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded for requests per minute"}}',
        provider="gemini",
        model="gemini-2.5-flash",
    )
    assert c.error_class == OcrErrorClass.RATE_LIMIT
    assert c.retryable is True


def test_classify_daily_quota_429():
    c = classify_provider_error(
        status_code=429,
        body='{"error":{"message":"GenerateRequestsPerDayPerProjectPerModel-FreeTier limit: generate_requests_per_model_per_day"}}',
        provider="gemini",
        model="gemini-2.5-flash",
    )
    assert c.error_class == OcrErrorClass.DAILY_QUOTA
    assert c.retryable is False


def test_classify_503_temp():
    c = classify_provider_error(status_code=503, body="Service Unavailable", provider="gemini", model="x")
    assert c.error_class == OcrErrorClass.TEMP_UNAVAILABLE
    assert c.retryable is True


def test_classify_invalid_key():
    c = classify_provider_error(
        status_code=400,
        body='{"error":{"message":"API key not valid. Please pass a valid API key."}}',
        provider="gemini",
        model="x",
    )
    assert c.error_class == OcrErrorClass.AUTH
    assert c.retryable is False


def test_classify_billing():
    c = classify_provider_error(
        status_code=403,
        body='{"error":{"message":"Billing account not configured for this project"}}',
        provider="gemini",
        model="x",
    )
    assert c.error_class == OcrErrorClass.BILLING
    assert c.retryable is False


def test_classify_retry_delay_from_body():
    c = classify_provider_error(
        status_code=429,
        body='{"error":{"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"12s"}]}}',
        provider="gemini",
        model="x",
    )
    assert c.retry_after_seconds == 12.0


def test_http_payload_codes():
    err = OcrServiceError(
        ClassifiedOcrError(
            OcrErrorClass.RATE_LIMIT,
            429,
            True,
            5.0,
            "gemini",
            "gemini-2.5-flash",
            "busy",
            "snip",
        )
    )
    p = err.http_payload()
    assert p["code"] == "OCR_RATE_LIMIT"
    assert p["retryable"] is True
    assert p["status_code"] == 429


def test_extract_retries_then_succeeds():
    calls = {"n": 0}

    def fake_gemini(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] < 3:
            raise OcrServiceError(
                ClassifiedOcrError(
                    OcrErrorClass.RATE_LIMIT,
                    429,
                    True,
                    0.01,
                    "gemini",
                    "gemini-2.5-flash",
                    "busy",
                    "rpm",
                )
            )
        return (
            json.dumps(
                {
                    "rows": [
                        {
                            "lot_serial_no": 1,
                            "total_bags": 5,
                            "farmer_name": "A",
                            "vendor_name": "V",
                            "bags": 2,
                            "rate_per_bag": 1000,
                        }
                    ]
                }
            ),
            "gemini-2.5-flash",
        )

    async def _run():
        with patch.dict("os.environ", {"GEMINI_API_KEY": "test-key", "OCR_MAX_RETRIES": "3", "OCR_MAX_CONCURRENT": "1"}):
            with patch("ocr_service.call_gemini_vision", side_effect=fake_gemini):
                with patch("ocr_service._sleep_backoff", new=lambda *a, **k: asyncio.sleep(0)):
                    return await extract_with_resilience(
                        image_b64="a" * 200,
                        mime_type="image/jpeg",
                        hint=None,
                        system_prompt="sys",
                        parse_diary_text=lambda t: [],
                        shop_id="shop1",
                    )

    result = asyncio.run(_run())
    assert calls["n"] == 3
    assert result.provider == "gemini"
    assert "rows" in result.rows_raw_text


def test_extract_falls_back_to_vision_after_429():
    def always_429(*args, **kwargs):
        raise OcrServiceError(
            ClassifiedOcrError(
                OcrErrorClass.RATE_LIMIT,
                429,
                True,
                0.01,
                "gemini",
                "gemini-2.5-flash",
                "busy",
                "rpm",
            )
        )

    def fake_vision(*args, **kwargs):
        return "1/5 ABDG (50)\nMM 2 1000"

    def parse_diary(text: str):
        return [
            {
                "lot_serial_no": 1,
                "total_bags": 5,
                "farmer_name": "ABDG",
                "vendor_name": "MM",
                "bags": 2,
                "rate_per_bag": 1000.0,
                "bhada_total": 50.0,
            }
        ]

    async def _run():
        with patch.dict(
            "os.environ",
            {
                "GEMINI_API_KEY": "test-key",
                "GOOGLE_VISION_API_KEY": "vision-key",
                "OCR_MAX_RETRIES": "1",
                "GEMINI_OCR_FALLBACK_MODEL": "gemini-2.5-flash",
                "OCR_MAX_CONCURRENT": "1",
            },
        ):
            with patch("ocr_service.call_gemini_vision", side_effect=always_429):
                with patch("ocr_service.call_google_vision_text", side_effect=fake_vision):
                    with patch("ocr_service._sleep_backoff", new=lambda *a, **k: asyncio.sleep(0)):
                        return await extract_with_resilience(
                            image_b64="a" * 200,
                            mime_type="image/jpeg",
                            hint=None,
                            system_prompt="sys",
                            parse_diary_text=parse_diary,
                            shop_id="shop1",
                        )

    result = asyncio.run(_run())
    assert result.provider == "vision"
    assert result.model == "vision+parser"
    data = json.loads(result.rows_raw_text)
    assert len(data["rows"]) == 1


def test_auth_error_does_not_fallback():
    def auth_fail(*args, **kwargs):
        raise OcrServiceError(
            ClassifiedOcrError(
                OcrErrorClass.AUTH,
                400,
                False,
                None,
                "gemini",
                "gemini-2.5-flash",
                "bad key",
                "invalid",
            )
        )

    vision_called = {"n": 0}

    def fake_vision(*args, **kwargs):
        vision_called["n"] += 1
        return "text"

    async def _run():
        with patch.dict(
            "os.environ",
            {"GEMINI_API_KEY": "bad", "GOOGLE_VISION_API_KEY": "vision-key", "OCR_MAX_RETRIES": "2"},
        ):
            with patch("ocr_service.call_gemini_vision", side_effect=auth_fail):
                with patch("ocr_service.call_google_vision_text", side_effect=fake_vision):
                    await extract_with_resilience(
                        image_b64="a" * 200,
                        mime_type="image/jpeg",
                        hint=None,
                        system_prompt="sys",
                        parse_diary_text=lambda t: [],
                        shop_id="shop1",
                    )

    with pytest.raises(OcrServiceError) as ei:
        asyncio.run(_run())
    assert ei.value.classified.error_class == OcrErrorClass.AUTH
    assert vision_called["n"] == 0


def test_concurrency_queue_serializes():
    in_flight = {"n": 0, "max": 0}

    def slow_ok(*args, **kwargs):
        in_flight["n"] += 1
        in_flight["max"] = max(in_flight["max"], in_flight["n"])
        import time

        time.sleep(0.05)
        in_flight["n"] -= 1
        return json.dumps({"rows": []}), "gemini-2.5-flash"

    async def _run():
        import ocr_service as mod

        mod._gemini_sem = asyncio.Semaphore(1)
        with patch.dict("os.environ", {"GEMINI_API_KEY": "k", "OCR_MAX_CONCURRENT": "1", "OCR_MAX_RETRIES": "1"}):
            with patch("ocr_service.call_gemini_vision", side_effect=slow_ok):
                await asyncio.gather(
                    extract_with_resilience(
                        image_b64="a" * 200,
                        mime_type="image/jpeg",
                        hint=None,
                        system_prompt="sys",
                        parse_diary_text=lambda t: [],
                        shop_id="s1",
                    ),
                    extract_with_resilience(
                        image_b64="b" * 200,
                        mime_type="image/jpeg",
                        hint=None,
                        system_prompt="sys",
                        parse_diary_text=lambda t: [],
                        shop_id="s2",
                    ),
                )

    asyncio.run(_run())
    assert in_flight["max"] == 1


def test_call_gemini_vision_classifies_503(monkeypatch):
    class FakeResp:
        status_code = 503
        text = "unavailable"
        headers = {}

        def json(self):
            return {}

    monkeypatch.setenv("GEMINI_OCR_MODEL", "gemini-2.5-flash")
    with patch("requests.post", return_value=FakeResp()):
        with pytest.raises(OcrServiceError) as ei:
            call_gemini_vision("abc", "image/jpeg", None, "test-key", "sys")
    assert ei.value.classified.error_class == OcrErrorClass.TEMP_UNAVAILABLE


def test_high_demand_503_rotates_models():
    """If a stable model returns high-demand 503, rotate to the next candidate."""
    calls: list[str] = []

    def fake_gemini(image_b64, mime_type, hint, api_key, system_prompt, model=None):
        calls.append(model or "")
        if model == "gemini-2.5-flash":
            raise OcrServiceError(
                classify_provider_error(
                    status_code=503,
                    body='{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}',
                    provider="gemini",
                    model=model,
                )
            )
        return json.dumps({"rows": [{"lot_serial_no": 1, "total_bags": 1, "farmer_name": "X", "vendor_name": "Y", "bags": 1, "rate_per_bag": 10}]}), model or "ok"

    async def _run():
        with patch.dict(
            "os.environ",
            {
                "GEMINI_API_KEY": "k",
                "GEMINI_OCR_MODEL": "gemini-3.6-flash",
                "GEMINI_OCR_FALLBACK_MODEL": "gemini-2.0-flash",
                "OCR_MAX_RETRIES": "2",
                "OCR_MAX_CONCURRENT": "1",
            },
        ):
            import ocr_service as mod

            mod._gemini_sem = asyncio.Semaphore(1)
            with patch("ocr_service.call_gemini_vision", side_effect=fake_gemini):
                with patch("ocr_service._sleep_backoff", new=lambda *a, **k: asyncio.sleep(0)):
                    return await extract_with_resilience(
                        image_b64="a" * 200,
                        mime_type="image/jpeg",
                        hint=None,
                        system_prompt="sys",
                        parse_diary_text=lambda t: [],
                        shop_id="shop1",
                    )

    result = asyncio.run(_run())
    assert calls[0] == "gemini-2.5-flash"
    assert "gemini-2.0-flash" in calls or result.model == "gemini-2.0-flash" or result.model == "gemini-1.5-flash"
    assert result.model != "gemini-2.5-flash" or result.provider == "gemini"
    assert result.model != "gemini-3.6-flash"


def test_model_candidates_include_stable_chain():
    with patch.dict("os.environ", {"GEMINI_OCR_MODEL": "gemini-3.6-flash", "GEMINI_OCR_FALLBACK_MODEL": "gemini-2.0-flash"}, clear=False):
        from ocr_service import model_candidates

        models = model_candidates()
    # Flaky 3.6 must not be primary; stables first.
    assert models[0] != "gemini-3.6-flash"
    assert models[0] in {"gemini-2.5-flash", "gemini-2.0-flash"}
    assert "gemini-2.5-flash" in models
    assert "gemini-2.0-flash" in models
    assert "gemini-3.6-flash" in models  # still available as last resort


def test_high_demand_payload_message():
    c = classify_provider_error(
        status_code=503,
        body='{"error":{"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}',
        provider="gemini",
        model="gemini-3.6-flash",
    )
    err = OcrServiceError(c)
    p = err.http_payload()
    assert p["high_demand"] is True
    assert "high demand" in p["message"].lower()
    assert p["code"] == "OCR_TEMP_UNAVAILABLE"


def test_flaky_primary_demoted_so_first_call_uses_stable():
    calls: list[str] = []

    def fake_gemini(image_b64, mime_type, hint, api_key, system_prompt, model=None):
        calls.append(model or "")
        return json.dumps({"rows": [{"lot_serial_no": 1, "total_bags": 1, "farmer_name": "X", "vendor_name": "Y", "bags": 1, "rate_per_bag": 10}]}), model or "ok"

    async def _run():
        with patch.dict(
            "os.environ",
            {
                "GEMINI_API_KEY": "k",
                "GEMINI_OCR_MODEL": "gemini-3.6-flash",
                "GEMINI_OCR_FALLBACK_MODEL": "gemini-2.0-flash",
                "OCR_MAX_RETRIES": "1",
                "OCR_MAX_CONCURRENT": "1",
            },
        ):
            import ocr_service as mod

            mod._gemini_sem = asyncio.Semaphore(1)
            with patch("ocr_service.call_gemini_vision", side_effect=fake_gemini):
                return await extract_with_resilience(
                    image_b64="a" * 200,
                    mime_type="image/jpeg",
                    hint=None,
                    system_prompt="sys",
                    parse_diary_text=lambda t: [],
                    shop_id="shop1",
                )

    result = asyncio.run(_run())
    assert calls[0] != "gemini-3.6-flash"
    assert result.model != "gemini-3.6-flash"
