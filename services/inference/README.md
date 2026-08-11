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
- Public HTTP scenes are accepted. Requester-pays remains blocked by default and requires `GEOLENS_ALLOW_REQUESTER_PAYS=true` on a server with object-store credentials. Authentication-required and metadata-only scenes are always rejected.
- Input and output GeoJSON accept only WGS84 Point, Polygon, MultiPolygon or FeatureCollection geometries. Rings must close and coordinate/vertex limits apply.
- Output points must fall inside the mission AOI. Every output polygon must have at least half of its area inside the AOI.
- `GEOLENS_MAX_REQUEST_BYTES` is enforced on bytes actually received, including chunked requests without `Content-Length`.
- Unknown JSON fields are rejected.

Unique inference runs are bounded by `GEOLENS_MAX_CONCURRENT_INFERENCES` and `GEOLENS_MAX_QUEUED_INFERENCES`. A full queue or a wait longer than `GEOLENS_INFERENCE_QUEUE_TIMEOUT_SECONDS` returns HTTP 429 with `Retry-After`. Retries sharing an idempotency key also share one admitted run.

Backend execution is bounded separately by `GEOLENS_INFERENCE_TIMEOUT_SECONDS` (300 seconds by default). A timeout returns HTTP 504. A worker thread may still require process-level termination if a native GPU call does not respond to cancellation, so production deployments should also enforce an orchestrator request deadline.

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

## Open-vocabulary RGB backend

`GEOLENS_BACKEND=open-vocabulary` activates a lazy-loaded Grounding DINO plus SAM 2.1 pipeline for the `grounding-dino-sam2-eo` route. The default segmenter is `facebook/sam2.1-hiera-small`. It tiles the AOI, detects requested object classes, segments each candidate, optionally applies a basic HSV/Lab color filter, and returns WGS84 polygons with `class`, `color`, `score`, and `sceneId` properties.

Install the optional runtime separately. It is intentionally not part of the lightweight validation image:

```bash
python3 -m pip install -r requirements-open-vocabulary.txt
export GEOLENS_BACKEND=open-vocabulary
export GEOLENS_INFERENCE_TOKEN='replace-me'
uvicorn geolens_inference.main:app --host 127.0.0.1 --port 8080
```

The backend loads model weights during application startup. `/ready` returns HTTP 503 and `inferenceEnabled: false` until both models and the raster runtime load successfully. The request model version must match `GEOLENS_OPEN_VOCAB_MODEL_VERSION`, so a changed checkpoint cannot silently reuse old provenance. Tests inject a fake engine and never download weights.

The pixel reader accepts one combined RGB GeoTIFF/COG or three aligned red, green and blue assets. Planetary Computer item assets are signed only in memory immediately before opening. SAS query strings are never copied into response provenance. The default allowlist is limited to `planetarycomputer.microsoft.com` and the exact NAIP storage host `naipeuwest.blob.core.windows.net`, plus the existing providers. Requester-pays access relies on credentials already present in the server environment and stays disabled unless explicitly enabled.

The built-in limits cover AOI area, scenes, objects, tiles and detections. A partial tile run can only return `inconclusive`, never a negative finding. Scores are explicitly uncalibrated and every positive result carries an analyst-review warning.

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

For the optional backend image:

```bash
docker build -f services/inference/Dockerfile.open-vocabulary -t geolens-open-vocabulary services/inference
docker run --rm --gpus all -p 8080:8080 \
  -e GEOLENS_BACKEND=open-vocabulary \
  -e GEOLENS_INFERENCE_TOKEN='replace-me' \
  geolens-open-vocabulary
```

Weights are resolved by Transformers at startup unless `GEOLENS_OPEN_VOCAB_LOCAL_FILES_ONLY=true`. For reproducible production builds, set the model variables to reviewed local snapshot directories or immutable revisions managed outside this repository.

The container healthcheck calls `/ready`, not the liveness-only `/health` endpoint.

`/ready` separates service readiness from inference capability. The mock returns `ready: true`, `status: "validation-only"` and `inferenceEnabled: false`. A production caller must require both `ready: true` and `inferenceEnabled: true` before sending imagery to a real model route.

## Response semantics

- Positive: `detected: true`, `outcome: "positive"`, valid GeoJSON required.
- Negative: `detected: false`, `outcome: "negative"`, no geometry. A backend may return this only after a real, eligible model run.
- Inconclusive: `detected: null`, `outcome: "inconclusive"`, no geometry.

`confidenceCalibrated: true` requires a numeric confidence between 0 and 1. A valid response includes model/backend versions, source scene IDs and run timestamps.
