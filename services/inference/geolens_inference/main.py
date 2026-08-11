from __future__ import annotations

import hashlib
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Response, status
from pydantic import ValidationError

from geolens_inference.backends.base import Backend
from geolens_inference.backends.mock import MockBackend
from geolens_inference.backends.unavailable import UnavailableBackend
from geolens_inference.body_limit import RequestBodyLimitMiddleware
from geolens_inference.capacity import (
    InferenceCapacity,
    InferenceCapacityExceeded,
    InferenceQueueTimeout,
)
from geolens_inference.config import Settings
from geolens_inference.geometry_validation import geometry_is_mostly_within_aoi
from geolens_inference.idempotency import IdempotencyConflict, IdempotencyStore
from geolens_inference.schemas import (
    HealthResponse,
    InferenceRequest,
    InferenceResponse,
    ReadyResponse,
)
from geolens_inference.security import require_bearer, validate_remote_url


MODEL_INTENTS = {
    "prithvi-eo-2.0-sen1floods11": "flood",
    "prithvi-eo-2.0-burnscars": "wildfire",
    "volcanic-hotspot-rf-s2": "volcano",
    "grounding-dino-sam2-eo": "building",
    "xview3-vessel-s1": "vessel",
}


def build_backend(name: str) -> Backend:
    if name == "mock":
        return MockBackend()
    return UnavailableBackend(name)


def _validate_headers(
    payload: InferenceRequest,
    *,
    contract_header: str | None,
    model_header: str | None,
    settings: Settings,
) -> None:
    if contract_header != settings.contract_version:
        raise HTTPException(status_code=400, detail=f"X-GeoLens-Contract must equal {settings.contract_version}.")
    if not model_header or model_header != payload.model.id:
        raise HTTPException(status_code=409, detail="X-GeoLens-Model must match model.id.")
    if payload.model.id not in settings.model_ids:
        raise HTTPException(status_code=422, detail="Requested model is not on the configured model allowlist.")
    expected_intent = MODEL_INTENTS.get(payload.model.id)
    if expected_intent is not None and payload.intent != expected_intent:
        raise HTTPException(status_code=422, detail="The requested model is not registered for this intent.")


def _validate_scene_sources(payload: InferenceRequest, settings: Settings) -> None:
    for scene_index, scene in enumerate(payload.scenes):
        validate_remote_url(
            scene.stac_url,
            allowed_hosts=settings.stac_hosts,
            allow_private_hosts=settings.allow_private_hosts,
            label=f"scenes[{scene_index}].stacUrl",
        )
        for asset_index, asset in enumerate(scene.assets):
            validate_remote_url(
                asset.href,
                allowed_hosts=settings.asset_hosts,
                allow_private_hosts=settings.allow_private_hosts,
                label=f"scenes[{scene_index}].assets[{asset_index}].href",
            )


def _validate_backend_response(result: InferenceResponse, payload: InferenceRequest, settings: Settings) -> None:
    if result.contract != settings.contract_version:
        raise HTTPException(status_code=502, detail="Backend returned the wrong inference contract version.")
    if result.request_id != payload.request_id:
        raise HTTPException(status_code=502, detail="Backend response requestId does not match the request.")
    if result.model.id != payload.model.id or result.provenance.model_id != payload.model.id:
        raise HTTPException(status_code=502, detail="Backend response model identity does not match the request.")
    if result.model.version != payload.model.version:
        raise HTTPException(status_code=502, detail="Backend response model version does not match the request.")
    requested_scene_ids = {scene.id for scene in payload.scenes}
    if not set(result.provenance.scene_ids).issubset(requested_scene_ids):
        raise HTTPException(status_code=502, detail="Backend provenance contains an unknown scene ID.")
    if result.geometry is not None and not geometry_is_mostly_within_aoi(
        result.geometry,
        payload.location.bbox,
    ):
        raise HTTPException(
            status_code=502,
            detail=(
                "Backend geometry must place every point inside the mission AOI "
                "and at least half of every polygon within it."
            ),
        )


def _request_fingerprint(payload: InferenceRequest) -> str:
    canonical = json.dumps(
        payload.model_dump(mode="json", by_alias=True),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def create_app(settings: Settings | None = None, backend: Backend | None = None) -> FastAPI:
    service_settings = settings or Settings.from_env()
    service_backend = backend or build_backend(service_settings.backend_name)
    if service_settings.bearer_token is not None and not service_settings.bearer_token.strip():
        raise ValueError("GEOLENS_INFERENCE_TOKEN must not be blank.")
    if not isinstance(service_backend, MockBackend) and service_settings.bearer_token is None:
        raise RuntimeError("GEOLENS_INFERENCE_TOKEN is required for every non-mock inference backend.")
    idempotency_store: IdempotencyStore[InferenceResponse] = IdempotencyStore(
        ttl_seconds=service_settings.idempotency_ttl_seconds,
        max_entries=service_settings.idempotency_max_entries,
    )
    inference_capacity = InferenceCapacity(
        max_concurrent=service_settings.max_concurrent_inferences,
        max_queued=service_settings.max_queued_inferences,
        queue_timeout_seconds=service_settings.inference_queue_timeout_seconds,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield

    api = FastAPI(
        title="GeoLens Inference Service",
        version=service_settings.service_version,
        description="Isolated geospatial model boundary implementing geolens-inference/v1.",
        lifespan=lifespan,
    )
    api.state.settings = service_settings
    api.state.backend = service_backend
    api.state.idempotency_store = idempotency_store
    api.state.inference_capacity = inference_capacity
    api.add_middleware(
        RequestBodyLimitMiddleware,
        max_bytes=service_settings.max_request_bytes,
        path="/v1/infer",
    )

    @api.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            service=service_settings.service_name,
            version=service_settings.service_version,
            contract=service_settings.contract_version,
        )

    @api.get(
        "/ready",
        response_model=ReadyResponse,
        responses={503: {"model": ReadyResponse}},
    )
    async def ready(response: Response) -> ReadyResponse:
        readiness = service_backend.readiness()
        if not readiness.ready:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
            readiness_status = "unavailable"
        elif readiness.inference_enabled:
            readiness_status = "ready"
        else:
            readiness_status = "validation-only"
        return ReadyResponse(
            ready=readiness.ready,
            status=readiness_status,
            contract=service_settings.contract_version,
            backend=service_backend.name,
            backendVersion=service_backend.version,
            inferenceEnabled=readiness.inference_enabled,
            modelIds=list(service_settings.model_ids) if readiness.inference_enabled else [],
            detail=readiness.detail,
        )

    @api.post(
        "/v1/infer",
        response_model=InferenceResponse,
        response_model_by_alias=True,
        responses={401: {}, 409: {}, 413: {}, 422: {}, 429: {}, 503: {}},
    )
    async def infer(
        payload: InferenceRequest,
        response: Response,
        authorization: str | None = Header(default=None),
        contract_header: str | None = Header(default=None, alias="X-GeoLens-Contract"),
        model_header: str | None = Header(default=None, alias="X-GeoLens-Model"),
        idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ) -> InferenceResponse:
        require_bearer(authorization, service_settings.bearer_token)
        _validate_headers(
            payload,
            contract_header=contract_header,
            model_header=model_header,
            settings=service_settings,
        )
        if idempotency_key is None:
            raise HTTPException(status_code=400, detail="Idempotency-Key is required for inference requests.")
        if idempotency_key != payload.request_id:
            raise HTTPException(status_code=409, detail="Idempotency-Key must match requestId.")
        _validate_scene_sources(payload, service_settings)

        async def produce() -> InferenceResponse:
            async with inference_capacity.slot():
                readiness = service_backend.readiness()
                if not readiness.ready:
                    raise HTTPException(status_code=503, detail=readiness.detail)
                try:
                    result = InferenceResponse.model_validate(await service_backend.infer(payload))
                except ValidationError as exc:
                    raise HTTPException(
                        status_code=502,
                        detail="Backend returned an invalid geolens-inference/v1 response.",
                    ) from exc
                except HTTPException:
                    raise
                except Exception as exc:
                    raise HTTPException(
                        status_code=502,
                        detail="Inference backend failed before producing a valid response.",
                    ) from exc
                _validate_backend_response(result, payload, service_settings)
                return result

        try:
            result, cache_status = await idempotency_store.execute(
                key=idempotency_key,
                fingerprint=_request_fingerprint(payload),
                producer=produce,
            )
        except IdempotencyConflict as exc:
            raise HTTPException(
                status_code=409,
                detail="Idempotency-Key was already used for a different request body.",
            ) from exc
        except InferenceCapacityExceeded as exc:
            raise HTTPException(
                status_code=429,
                detail="Inference capacity and queue are full. Retry later.",
                headers={"Retry-After": "1"},
            ) from exc
        except InferenceQueueTimeout as exc:
            raise HTTPException(
                status_code=429,
                detail="Timed out while waiting for an inference slot. Retry later.",
                headers={"Retry-After": "1"},
            ) from exc
        response.headers["X-GeoLens-Contract"] = service_settings.contract_version
        response.headers["X-GeoLens-Backend"] = service_backend.name
        response.headers["X-GeoLens-Idempotency"] = cache_status
        return result

    return api


app = create_app()
