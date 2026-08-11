from __future__ import annotations

import asyncio
from copy import deepcopy
from pathlib import Path
import sys

from fastapi.testclient import TestClient
import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from geolens_inference.config import Settings  # noqa: E402
from geolens_inference.backends.base import BackendReadiness  # noqa: E402
from geolens_inference.backends.mock import MockBackend  # noqa: E402
from geolens_inference.main import create_app  # noqa: E402


def sample_payload() -> dict:
    return {
        "requestId": "9a711941-6382-4bd0-89a9-c0a7a02d1255",
        "model": {
            "id": "prithvi-eo-2.0-sen1floods11",
            "version": "2.0-300M",
            "task": "Flood segmentation",
            "modelCardUrl": "https://huggingface.co/ibm-nasa-geospatial/Prithvi-EO-2.0-300M-TL-Sen1Floods11",
        },
        "query": "Map flooding in New Orleans on 2023-08-15",
        "intent": "flood",
        "dateRange": {"startDate": "2023-08-10", "endDate": "2023-08-20"},
        "requestedObjects": ["flood water"],
        "location": {
            "name": "New Orleans, Louisiana, USA",
            "latitude": 29.9511,
            "longitude": -90.0715,
            "bbox": [-90.35, 29.75, -89.75, 30.18],
        },
        "scenes": [
            {
                "id": "S2B_TEST_SCENE",
                "collection": "sentinel-2-l2a",
                "datetime": "2023-08-15T16:45:20Z",
                "resolution": "10 meters per pixel",
                "bbox": [-90.35, 29.75, -89.75, 30.18],
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [-90.35, 29.75],
                        [-89.75, 29.75],
                        [-89.75, 30.18],
                        [-90.35, 30.18],
                        [-90.35, 29.75],
                    ]],
                },
                "stacUrl": "https://stac.dataspace.copernicus.eu/v1/collections/sentinel-2-l2a/items/S2B_TEST_SCENE",
                "catalog": "Copernicus Data Space",
                "assetAccess": "public-http",
                "license": {
                    "licenseId": "Copernicus Sentinel data terms",
                    "commercialUse": None,
                    "redistribution": None,
                    "attributionRequired": None,
                    "sourceProvider": "European Commission Copernicus / ESA",
                    "sourceItemId": "S2B_TEST_SCENE",
                    "termsUrl": "https://dataspace.copernicus.eu/terms-and-conditions",
                    "note": "Review source terms before use.",
                },
                "assets": [
                    {
                        "label": "B04 Red",
                        "href": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/test/B04.tif",
                    }
                ],
            }
        ],
    }


def headers(token: str | None = None, payload: dict | None = None) -> dict[str, str]:
    request_payload = payload or sample_payload()
    values = {
        "X-GeoLens-Contract": "geolens-inference/v1",
        "X-GeoLens-Model": request_payload["model"]["id"],
        "Idempotency-Key": request_payload["requestId"],
    }
    if token:
        values["Authorization"] = f"Bearer {token}"
    return values


def test_health_and_mock_readiness_are_explicit() -> None:
    with TestClient(create_app(Settings())) as client:
        health = client.get("/health")
        ready = client.get("/ready")

    assert health.status_code == 200
    assert health.json()["contract"] == "geolens-inference/v1"
    assert ready.status_code == 200
    assert ready.json() == {
        "ready": True,
        "status": "validation-only",
        "contract": "geolens-inference/v1",
        "backend": "mock",
        "backendVersion": "validation-only/v1",
        "inferenceEnabled": False,
        "modelIds": [],
        "detail": "Validation-only mock is ready. No model weights are loaded and no detection conclusion is produced.",
    }


def test_mock_validates_request_without_making_a_detection_claim() -> None:
    with TestClient(create_app(Settings())) as client:
        response = client.post("/v1/infer", json=sample_payload(), headers=headers())

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["contract"] == "geolens-inference/v1"
    assert body["requestId"] == sample_payload()["requestId"]
    assert body["detected"] is None
    assert body["outcome"] == "inconclusive"
    assert body["geometry"] is None
    assert body["confidence"] is None
    assert body["confidenceCalibrated"] is False
    assert body["warnings"] == ["MOCK_BACKEND_NO_INFERENCE"]
    assert response.headers["X-GeoLens-Backend"] == "mock"


def test_optional_bearer_is_required_when_configured() -> None:
    settings = Settings(bearer_token="test-secret")
    with TestClient(create_app(settings)) as client:
        missing = client.post("/v1/infer", json=sample_payload(), headers=headers())
        wrong = client.post("/v1/infer", json=sample_payload(), headers=headers("wrong"))
        accepted = client.post("/v1/infer", json=sample_payload(), headers=headers("test-secret"))

    assert missing.status_code == 401
    assert wrong.status_code == 401
    assert accepted.status_code == 200


def test_contract_and_model_headers_are_bound_to_payload() -> None:
    with TestClient(create_app(Settings())) as client:
        missing_contract = client.post(
            "/v1/infer",
            json=sample_payload(),
            headers={"X-GeoLens-Model": "prithvi-eo-2.0-sen1floods11"},
        )
        wrong_model = client.post(
            "/v1/infer",
            json=sample_payload(),
            headers={"X-GeoLens-Contract": "geolens-inference/v1", "X-GeoLens-Model": "another-model"},
        )

    assert missing_contract.status_code == 400
    assert wrong_model.status_code == 409


def test_idempotency_key_is_required_and_must_match_request_id() -> None:
    no_key = headers()
    no_key.pop("Idempotency-Key")
    wrong_key = headers()
    wrong_key["Idempotency-Key"] = "ae4f29a5-7a77-4f95-8ca6-79dac3211234"

    with TestClient(create_app(Settings())) as client:
        missing = client.post("/v1/infer", json=sample_payload(), headers=no_key)
        mismatch = client.post("/v1/infer", json=sample_payload(), headers=wrong_key)

    assert missing.status_code == 400
    assert mismatch.status_code == 409


def test_model_must_match_registered_intent() -> None:
    payload = sample_payload()
    payload["intent"] = "wildfire"
    with TestClient(create_app(Settings())) as client:
        response = client.post("/v1/infer", json=payload, headers=headers())

    assert response.status_code == 422
    assert "intent" in response.json()["detail"]


def test_asset_and_stac_hosts_are_allowlisted() -> None:
    bad_asset = sample_payload()
    bad_asset["scenes"][0]["assets"][0]["href"] = "https://attacker.example/private.tif"
    bad_stac = sample_payload()
    bad_stac["scenes"][0]["stacUrl"] = "https://attacker.example/item.json"

    with TestClient(create_app(Settings())) as client:
        asset_response = client.post("/v1/infer", json=bad_asset, headers=headers())
        stac_response = client.post("/v1/infer", json=bad_stac, headers=headers())

    assert asset_response.status_code == 422
    assert "allowlist" in asset_response.json()["detail"]
    assert stac_response.status_code == 422
    assert "allowlist" in stac_response.json()["detail"]


def test_non_public_scene_assets_cannot_cross_boundary() -> None:
    payload = sample_payload()
    payload["scenes"][0]["assetAccess"] = "requester-pays"
    with TestClient(create_app(Settings())) as client:
        response = client.post("/v1/infer", json=payload, headers=headers())

    assert response.status_code == 422


def test_requester_pays_requires_explicit_server_opt_in() -> None:
    payload = sample_payload()
    payload["scenes"][0]["assetAccess"] = "requester-pays"
    with TestClient(create_app(Settings(allow_requester_pays=True))) as client:
        response = client.post("/v1/infer", json=payload, headers=headers())

    assert response.status_code == 200


def test_payload_is_strict_and_rejects_unknown_fields() -> None:
    payload = sample_payload()
    payload["pretendDetected"] = True
    with TestClient(create_app(Settings())) as client:
        response = client.post("/v1/infer", json=payload, headers=headers())

    assert response.status_code == 422


def test_model_version_is_required_by_contract() -> None:
    payload = sample_payload()
    payload["model"].pop("version")
    with TestClient(create_app(Settings())) as client:
        response = client.post("/v1/infer", json=payload, headers=headers())

    assert response.status_code == 422


def test_declared_oversized_body_is_rejected_before_validation() -> None:
    settings = Settings(max_request_bytes=100)
    with TestClient(create_app(settings)) as client:
        response = client.post("/v1/infer", json=sample_payload(), headers=headers())

    assert response.status_code == 413


def test_chunked_oversized_body_without_content_length_is_rejected() -> None:
    async def scenario() -> None:
        async def body_chunks():
            yield b"x" * 60
            yield b"y" * 60

        app = create_app(Settings(max_request_bytes=100))
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/v1/infer",
                content=body_chunks(),
                headers={"Content-Type": "application/json"},
            )

        assert "content-length" not in response.request.headers
        assert response.status_code == 413

    asyncio.run(scenario())


def test_unavailable_backend_fails_readiness_and_inference() -> None:
    settings = Settings(backend_name="prithvi", bearer_token="test-secret")
    with TestClient(create_app(settings)) as client:
        ready = client.get("/ready")
        inference = client.post("/v1/infer", json=sample_payload(), headers=headers("test-secret"))

    assert ready.status_code == 503
    assert ready.json()["ready"] is False
    assert inference.status_code == 503


def test_http_asset_is_rejected_by_schema() -> None:
    payload = deepcopy(sample_payload())
    payload["scenes"][0]["assets"][0]["href"] = "http://sentinel-cogs.s3.us-west-2.amazonaws.com/test/B04.tif"
    with TestClient(create_app(Settings())) as client:
        response = client.post("/v1/infer", json=payload, headers=headers())

    assert response.status_code == 422


class OutsideAoiBackend:
    name = "outside-test"
    version = "1"

    def readiness(self) -> BackendReadiness:
        return BackendReadiness(ready=True, inference_enabled=True, detail="test")

    async def infer(self, request):
        return {
            "contract": "geolens-inference/v1",
            "requestId": request.request_id,
            "runId": "b09fcb51-3008-4a87-856d-f6a51f85a875",
            "model": {"id": request.model.id, "version": request.model.version, "backend": self.name},
            "detected": True,
            "outcome": "positive",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[10.0, 10.0], [11.0, 10.0], [11.0, 11.0], [10.0, 10.0]]],
            },
            "confidence": 0.9,
            "confidenceCalibrated": True,
            "summary": "Deliberately outside the mission AOI.",
            "warnings": [],
            "provenance": {
                "backend": self.name,
                "backendVersion": self.version,
                "modelId": request.model.id,
                "sceneIds": [request.scenes[0].id],
                "startedAt": "2026-08-11T12:00:00+00:00",
                "completedAt": "2026-08-11T12:00:01+00:00",
            },
        }


def test_backend_geometry_outside_mission_aoi_is_rejected() -> None:
    settings = Settings(backend_name="outside-test", bearer_token="test-secret")
    with TestClient(create_app(settings, backend=OutsideAoiBackend())) as client:
        response = client.post("/v1/infer", json=sample_payload(), headers=headers("test-secret"))

    assert response.status_code == 502
    assert "AOI" in response.json()["detail"]


def test_non_mock_backend_cannot_start_without_token() -> None:
    with pytest.raises(RuntimeError, match="GEOLENS_INFERENCE_TOKEN"):
        create_app(Settings(backend_name="outside-test"), backend=OutsideAoiBackend())


class OutsidePointBackend(OutsideAoiBackend):
    async def infer(self, request):
        result = await super().infer(request)
        result["geometry"] = {"type": "Point", "coordinates": [-89.70, 29.95]}
        return result


def test_backend_point_just_outside_mission_aoi_is_rejected() -> None:
    settings = Settings(backend_name="outside-test", bearer_token="test-secret")
    with TestClient(create_app(settings, backend=OutsidePointBackend())) as client:
        response = client.post("/v1/infer", json=sample_payload(), headers=headers("test-secret"))

    assert response.status_code == 502
    assert "every point inside" in response.json()["detail"]


class MostlyOutsidePolygonBackend(OutsideAoiBackend):
    async def infer(self, request):
        result = await super().infer(request)
        result["geometry"] = {
            "type": "Polygon",
            "coordinates": [[
                [-90.60, 29.80],
                [-90.20, 29.80],
                [-90.20, 30.00],
                [-90.60, 30.00],
                [-90.60, 29.80],
            ]],
        }
        return result


def test_backend_polygon_mostly_outside_mission_aoi_is_rejected() -> None:
    settings = Settings(backend_name="outside-test", bearer_token="test-secret")
    with TestClient(create_app(settings, backend=MostlyOutsidePolygonBackend())) as client:
        response = client.post("/v1/infer", json=sample_payload(), headers=headers("test-secret"))

    assert response.status_code == 502
    assert "half of every polygon" in response.json()["detail"]


class CountingBackend(MockBackend):
    name = "counting-mock"
    version = "validation-only/v1"

    def __init__(self) -> None:
        self.calls = 0

    async def infer(self, request):
        self.calls += 1
        return await super().infer(request)


class BlockingMockBackend(MockBackend):
    name = "blocking-mock"

    def __init__(self) -> None:
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def infer(self, request):
        self.started.set()
        await self.release.wait()
        return await super().infer(request)


class SlowMockBackend(MockBackend):
    name = "slow-mock"

    async def infer(self, request):
        await asyncio.sleep(0.1)
        return await super().infer(request)


def test_backend_execution_timeout_returns_504() -> None:
    backend = SlowMockBackend()
    settings = Settings(backend_name=backend.name, inference_timeout_seconds=0.01)
    with TestClient(create_app(settings, backend=backend)) as client:
        response = client.post("/v1/infer", json=sample_payload(), headers=headers())

    assert response.status_code == 504


def test_full_inference_capacity_returns_429_without_running_another_request() -> None:
    async def scenario() -> None:
        backend = BlockingMockBackend()
        app = create_app(
            Settings(
                backend_name=backend.name,
                max_concurrent_inferences=1,
                max_queued_inferences=0,
            ),
            backend=backend,
        )
        second_payload = deepcopy(sample_payload())
        second_payload["requestId"] = "ae4f29a5-7a77-4f95-8ca6-79dac3211234"
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            first_task = asyncio.create_task(
                client.post("/v1/infer", json=sample_payload(), headers=headers())
            )
            await asyncio.wait_for(backend.started.wait(), timeout=1)
            try:
                second = await client.post(
                    "/v1/infer",
                    json=second_payload,
                    headers=headers(payload=second_payload),
                )
            finally:
                backend.release.set()
            first = await asyncio.wait_for(first_task, timeout=1)

        assert first.status_code == 200
        assert second.status_code == 429
        assert second.headers["Retry-After"] == "1"

    asyncio.run(scenario())


def test_completed_response_is_reused_for_retry() -> None:
    backend = CountingBackend()
    with TestClient(create_app(Settings(backend_name=backend.name), backend=backend)) as client:
        first = client.post("/v1/infer", json=sample_payload(), headers=headers())
        second = client.post("/v1/infer", json=sample_payload(), headers=headers())

    assert first.status_code == 200
    assert second.status_code == 200
    assert backend.calls == 1
    assert first.json()["runId"] == second.json()["runId"]
    assert first.headers["X-GeoLens-Idempotency"] == "miss"
    assert second.headers["X-GeoLens-Idempotency"] == "hit"


def test_same_idempotency_key_rejects_a_changed_body() -> None:
    backend = CountingBackend()
    changed = sample_payload()
    changed["query"] = "A different request reusing the same requestId"
    with TestClient(create_app(Settings(backend_name=backend.name), backend=backend)) as client:
        first = client.post("/v1/infer", json=sample_payload(), headers=headers())
        conflict = client.post("/v1/infer", json=changed, headers=headers())

    assert first.status_code == 200
    assert conflict.status_code == 409
    assert backend.calls == 1
