# GeoLens inference service

This directory is an isolated FastAPI boundary for specialist geospatial models. It does not import or modify the Next/Vinext application. The API implements `geolens-inference/v1` and exposes:

- `GET /health`, process liveness.
- `GET /ready`, backend readiness and whether real inference is enabled.
- `POST /v1/infer`, strict request validation and backend execution.

## Safe default

`GEOLENS_BACKEND=mock` is validation-only. It returns HTTP 200 with `detected: null`, `outcome: "inconclusive"`, no geometry and warning `MOCK_BACKEND_NO_INFERENCE`. It never claims that an event was detected or not detected.

With a token configured, an unsupported backend keeps `/health` alive, returns HTTP 503 from `/ready`, and refuses inference. Without a token, every non-mock configuration fails startup. This prevents either missing authentication or a missing model package from looking operational.

## Security boundary

- `GEOLENS_INFERENCE_TOKEN` is optional only for the validation-only mock. Every non-mock backend fails startup without it. Comparison is constant-time.
- `X-GeoLens-Contract` must equal `geolens-inference/v1`.
- `X-GeoLens-Model` must equal the body model ID.
- `Idempotency-Key` is required and must equal `requestId`.
- Model IDs and model-to-intent routes are allowlisted.
- STAC and pixel asset URLs must be HTTPS, use port 443, contain no URL credentials and match the relevant host allowlist.
- Only scenes marked `assetAccess: "public-http"` are accepted. Requester-pays, authentication-required and metadata-only scenes are rejected at this boundary.
- Input and output GeoJSON accept only WGS84 Point, Polygon, MultiPolygon or FeatureCollection geometries. Rings must close and coordinate/vertex limits apply.
- Output points must fall inside the mission AOI. Every output polygon must have at least half of its area inside the AOI.
- `GEOLENS_MAX_REQUEST_BYTES` is enforced on bytes actually received, including chunked requests without `Content-Length`.
- Unknown JSON fields are rejected.

Unique inference runs are bounded by `GEOLENS_MAX_CONCURRENT_INFERENCES` and `GEOLENS_MAX_QUEUED_INFERENCES`. A full queue or a wait longer than `GEOLENS_INFERENCE_QUEUE_TIMEOUT_SECONDS` returns HTTP 429 with `Retry-After`. Retries sharing an idempotency key also share one admitted run.

Successful responses are cached in memory for a bounded TTL, and simultaneous retries share the same in-flight task. Reusing a key with a different body returns HTTP 409. The default cache is process-local, holds at most 256 results and expires entries after 300 seconds. A multi-replica deployment must replace it with a shared transactional store before scaling beyond one API process.

The default host lists are intentionally narrow. Extend them with exact hosts through `GEOLENS_ASSET_HOSTS` and `GEOLENS_STAC_HOSTS`. A wildcard must be explicit, such as `*.approved.example.com`. Do not add `*.amazonaws.com` or another cloud-wide wildcard.

## Local development

Python 3.10 or newer is required.

```bash
cd services/inference
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r requirements-dev.txt
pytest
uvicorn geolens_inference.main:app --host 127.0.0.1 --port 8080
```

No dependency installation is performed by the repository itself.

## Container

The Dockerfile uses an NVIDIA CUDA/cuDNN runtime and runs the API as a non-root user:

```bash
docker build -t geolens-inference services/inference
docker run --rm --gpus all -p 8080:8080 \
  -e GEOLENS_BACKEND=mock \
  -e GEOLENS_INFERENCE_TOKEN='replace-me' \
  geolens-inference
```

The base image contains no detector weights. A real backend should extend the image, install its pinned model dependencies, load weights during its own lifecycle, implement the `Backend` protocol, and return an `InferenceResponse`. Keep model preprocessing, postprocessing and version metadata inside that backend rather than in the web application.

The container healthcheck calls `/ready`, not the liveness-only `/health` endpoint.

`/ready` separates service readiness from inference capability. The mock returns `ready: true`, `status: "validation-only"` and `inferenceEnabled: false`. A production caller must require both `ready: true` and `inferenceEnabled: true` before sending imagery to a real model route.

## Response semantics

- Positive: `detected: true`, `outcome: "positive"`, valid GeoJSON required.
- Negative: `detected: false`, `outcome: "negative"`, no geometry. A backend may return this only after a real, eligible model run.
- Inconclusive: `detected: null`, `outcome: "inconclusive"`, no geometry.

`confidenceCalibrated: true` requires a numeric confidence between 0 and 1. A valid response includes model/backend versions, source scene IDs and run timestamps.
