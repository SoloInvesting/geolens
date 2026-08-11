from __future__ import annotations

import os
from dataclasses import dataclass


CONTRACT_VERSION = "geolens-inference/v1"

DEFAULT_ASSET_HOSTS = (
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
    idempotency_ttl_seconds: int = 300
    idempotency_max_entries: int = 256

    @classmethod
    def from_env(cls) -> "Settings":
        token = os.getenv("GEOLENS_INFERENCE_TOKEN")
        token = token.strip() if token and token.strip() else None
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
            idempotency_ttl_seconds=_integer("GEOLENS_IDEMPOTENCY_TTL_SECONDS", 300, 10, 3_600),
            idempotency_max_entries=_integer("GEOLENS_IDEMPOTENCY_MAX_ENTRIES", 256, 1, 10_000),
        )
