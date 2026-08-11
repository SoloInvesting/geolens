from __future__ import annotations

import os
from dataclasses import dataclass


CONTRACT_VERSION = "geolens-inference/v1"

DEFAULT_ASSET_HOSTS = (
    "planetarycomputer.microsoft.com",
    "naipeuwest.blob.core.windows.net",
    "catalogue.dataspace.copernicus.eu",
    "download.dataspace.copernicus.eu",
    "eodata.dataspace.copernicus.eu",
    "zipper.dataspace.copernicus.eu",
    "sentinel-cogs.s3.us-west-2.amazonaws.com",
    "sentinel-cogs.s3.amazonaws.com",
    "usgs-landsat.s3.us-west-2.amazonaws.com",
    "landsatlook.usgs.gov",
    "data.lpdaac.earthdatacloud.nasa.gov",
)

DEFAULT_STAC_HOSTS = (
    "planetarycomputer.microsoft.com",
    "stac.dataspace.copernicus.eu",
    "earth-search.aws.element84.com",
    "cmr.earthdata.nasa.gov",
)

DEFAULT_MODEL_IDS = (
    "prithvi-eo-2.0-sen1floods11",
    "prithvi-eo-2.0-burnscars",
    "volcanic-hotspot-rf-s2",
    "grounding-dino-sam2-eo",
    "xview3-vessel-s1",
)


def _csv(name: str, defaults: tuple[str, ...]) -> tuple[str, ...]:
    raw = os.getenv(name)
    if raw is None:
        return defaults
    values = tuple(dict.fromkeys(value.strip().lower().rstrip(".") for value in raw.split(",") if value.strip()))
    return values


def _boolean(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _integer(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        parsed = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer.") from exc
    if parsed < minimum or parsed > maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}.")
    return parsed


def _float(name: str, default: float, minimum: float, maximum: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        parsed = float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be numeric.") from exc
    if parsed < minimum or parsed > maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}.")
    return parsed


def _text(name: str, default: str, maximum: int = 256) -> str:
    value = os.getenv(name, default).strip()
    if not value or len(value) > maximum or any(ord(character) < 32 for character in value):
        raise ValueError(f"{name} must be a non-empty printable string up to {maximum} characters.")
    return value


@dataclass(frozen=True, slots=True)
class Settings:
    service_name: str = "geolens-inference"
    service_version: str = "0.1.0"
    contract_version: str = CONTRACT_VERSION
    backend_name: str = "mock"
    bearer_token: str | None = None
    asset_hosts: tuple[str, ...] = DEFAULT_ASSET_HOSTS
    stac_hosts: tuple[str, ...] = DEFAULT_STAC_HOSTS
    model_ids: tuple[str, ...] = DEFAULT_MODEL_IDS
    allow_private_hosts: bool = False
    max_request_bytes: int = 1_048_576
    max_concurrent_inferences: int = 1
    max_queued_inferences: int = 4
    inference_queue_timeout_seconds: int = 30
    inference_timeout_seconds: float = 300.0
    idempotency_ttl_seconds: int = 300
    idempotency_max_entries: int = 256
    allow_requester_pays: bool = False
    open_vocab_detector_model: str = "IDEA-Research/grounding-dino-tiny"
    open_vocab_segmenter_model: str = "facebook/sam2.1-hiera-small"
    open_vocab_model_version: str = "grounding-dino-tiny+sam2.1-hiera-small/v1"
    open_vocab_device: str = "auto"
    open_vocab_local_files_only: bool = False
    open_vocab_tile_size: int = 768
    open_vocab_tile_overlap: int = 96
    open_vocab_max_tiles: int = 256
    open_vocab_max_detections: int = 500
    open_vocab_max_objects: int = 8
    open_vocab_max_scenes: int = 2
    open_vocab_max_aoi_km2: float = 2_500.0
    open_vocab_box_threshold: float = 0.28
    open_vocab_text_threshold: float = 0.22
    open_vocab_mask_threshold: float = 0.5
    open_vocab_color_min_fraction: float = 0.15

    @classmethod
    def from_env(cls) -> "Settings":
        token = os.getenv("GEOLENS_INFERENCE_TOKEN")
        token = token.strip() if token and token.strip() else None
        tile_size = _integer("GEOLENS_OPEN_VOCAB_TILE_SIZE", 768, 256, 2_048)
        tile_overlap = _integer("GEOLENS_OPEN_VOCAB_TILE_OVERLAP", 96, 0, 1_024)
        if tile_overlap >= tile_size:
            raise ValueError("GEOLENS_OPEN_VOCAB_TILE_OVERLAP must be smaller than GEOLENS_OPEN_VOCAB_TILE_SIZE.")
        device = _text("GEOLENS_OPEN_VOCAB_DEVICE", "auto", 32).lower()
        if device not in {"auto", "cpu", "cuda", "mps"}:
            raise ValueError("GEOLENS_OPEN_VOCAB_DEVICE must be auto, cpu, cuda, or mps.")
        return cls(
            backend_name=os.getenv("GEOLENS_BACKEND", "mock").strip().lower(),
            bearer_token=token,
            asset_hosts=_csv("GEOLENS_ASSET_HOSTS", DEFAULT_ASSET_HOSTS),
            stac_hosts=_csv("GEOLENS_STAC_HOSTS", DEFAULT_STAC_HOSTS),
            model_ids=_csv("GEOLENS_MODEL_IDS", DEFAULT_MODEL_IDS),
            allow_private_hosts=_boolean("GEOLENS_ALLOW_PRIVATE_HOSTS"),
            max_request_bytes=_integer("GEOLENS_MAX_REQUEST_BYTES", 1_048_576, 16_384, 10_485_760),
            max_concurrent_inferences=_integer("GEOLENS_MAX_CONCURRENT_INFERENCES", 1, 1, 32),
            max_queued_inferences=_integer("GEOLENS_MAX_QUEUED_INFERENCES", 4, 0, 256),
            inference_queue_timeout_seconds=_integer(
                "GEOLENS_INFERENCE_QUEUE_TIMEOUT_SECONDS",
                30,
                1,
                600,
            ),
            inference_timeout_seconds=_float(
                "GEOLENS_INFERENCE_TIMEOUT_SECONDS",
                300.0,
                0.1,
                3_600.0,
            ),
            idempotency_ttl_seconds=_integer("GEOLENS_IDEMPOTENCY_TTL_SECONDS", 300, 10, 3_600),
            idempotency_max_entries=_integer("GEOLENS_IDEMPOTENCY_MAX_ENTRIES", 256, 1, 10_000),
            allow_requester_pays=_boolean("GEOLENS_ALLOW_REQUESTER_PAYS"),
            open_vocab_detector_model=_text(
                "GEOLENS_OPEN_VOCAB_DETECTOR_MODEL",
                "IDEA-Research/grounding-dino-tiny",
            ),
            open_vocab_segmenter_model=_text(
                "GEOLENS_OPEN_VOCAB_SEGMENTER_MODEL",
                "facebook/sam2.1-hiera-small",
            ),
            open_vocab_model_version=_text(
                "GEOLENS_OPEN_VOCAB_MODEL_VERSION",
                "grounding-dino-tiny+sam2.1-hiera-small/v1",
            ),
            open_vocab_device=device,
            open_vocab_local_files_only=_boolean("GEOLENS_OPEN_VOCAB_LOCAL_FILES_ONLY"),
            open_vocab_tile_size=tile_size,
            open_vocab_tile_overlap=tile_overlap,
            open_vocab_max_tiles=_integer("GEOLENS_OPEN_VOCAB_MAX_TILES", 256, 1, 4_096),
            open_vocab_max_detections=_integer("GEOLENS_OPEN_VOCAB_MAX_DETECTIONS", 500, 1, 10_000),
            open_vocab_max_objects=_integer("GEOLENS_OPEN_VOCAB_MAX_OBJECTS", 8, 1, 32),
            open_vocab_max_scenes=_integer("GEOLENS_OPEN_VOCAB_MAX_SCENES", 2, 1, 6),
            open_vocab_max_aoi_km2=_float("GEOLENS_OPEN_VOCAB_MAX_AOI_KM2", 2_500.0, 0.01, 100_000.0),
            open_vocab_box_threshold=_float("GEOLENS_OPEN_VOCAB_BOX_THRESHOLD", 0.28, 0.01, 0.99),
            open_vocab_text_threshold=_float("GEOLENS_OPEN_VOCAB_TEXT_THRESHOLD", 0.22, 0.01, 0.99),
            open_vocab_mask_threshold=_float("GEOLENS_OPEN_VOCAB_MASK_THRESHOLD", 0.5, 0.01, 0.99),
            open_vocab_color_min_fraction=_float(
                "GEOLENS_OPEN_VOCAB_COLOR_MIN_FRACTION",
                0.15,
                0.0,
                1.0,
            ),
        )
