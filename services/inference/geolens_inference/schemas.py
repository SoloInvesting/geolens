from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MODEL_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{1,127}$")

Position = Annotated[list[float], Field(min_length=2, max_length=3)]
Ring = Annotated[list[Position], Field(min_length=4, max_length=20_000)]
PolygonCoordinates = Annotated[list[Ring], Field(min_length=1, max_length=256)]
MultiPolygonCoordinates = Annotated[list[PolygonCoordinates], Field(min_length=1, max_length=2_000)]


class StrictModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        strict=True,
        str_strip_whitespace=True,
        populate_by_name=True,
        allow_inf_nan=False,
    )


def _validate_position(position: Position) -> None:
    if not all(math.isfinite(value) for value in position):
        raise ValueError("GeoJSON positions must contain finite coordinates.")
    if position[0] < -180 or position[0] > 180 or position[1] < -90 or position[1] > 90:
        raise ValueError("GeoJSON coordinates must use WGS84 longitude and latitude ranges.")


def _validate_ring(ring: Ring) -> None:
    for position in ring:
        _validate_position(position)
    if ring[0][0:2] != ring[-1][0:2]:
        raise ValueError("GeoJSON polygon rings must be closed.")


def _validate_bbox(value: list[float]) -> list[float]:
    if not all(math.isfinite(item) for item in value):
        raise ValueError("bbox must contain finite coordinates.")
    west, south, east, north = value
    if west < -180 or east > 180 or south < -90 or north > 90 or west >= east or south >= north:
        raise ValueError("bbox must be [west, south, east, north] in WGS84.")
    return value


def _validate_uuid(value: str, label: str) -> str:
    try:
        UUID(value)
    except ValueError as exc:
        raise ValueError(f"{label} must be a UUID.") from exc
    return value


def _validate_iso_timestamp(value: str, label: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{label} must be an ISO 8601 timestamp.") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{label} must include a timezone.")
    return value


class PointGeometry(StrictModel):
    type: Literal["Point"]
    coordinates: Position

    @field_validator("coordinates")
    @classmethod
    def validate_coordinates(cls, value: Position) -> Position:
        _validate_position(value)
        return value


class PolygonGeometry(StrictModel):
    type: Literal["Polygon"]
    coordinates: PolygonCoordinates

    @field_validator("coordinates")
    @classmethod
    def validate_coordinates(cls, value: PolygonCoordinates) -> PolygonCoordinates:
        for ring in value:
            _validate_ring(ring)
        return value


class MultiPolygonGeometry(StrictModel):
    type: Literal["MultiPolygon"]
    coordinates: MultiPolygonCoordinates

    @field_validator("coordinates")
    @classmethod
    def validate_coordinates(cls, value: MultiPolygonCoordinates) -> MultiPolygonCoordinates:
        for polygon in value:
            for ring in polygon:
                _validate_ring(ring)
        return value


BaseGeometry = Annotated[PointGeometry | PolygonGeometry | MultiPolygonGeometry, Field(discriminator="type")]
PropertyValue = str | int | float | bool | None


class GeoFeature(StrictModel):
    type: Literal["Feature"]
    geometry: BaseGeometry
    properties: dict[str, PropertyValue] = Field(default_factory=dict, max_length=128)


class FeatureCollectionGeometry(StrictModel):
    type: Literal["FeatureCollection"]
    features: list[GeoFeature] = Field(min_length=1, max_length=10_000)


GeoJsonGeometry = Annotated[
    PointGeometry | PolygonGeometry | MultiPolygonGeometry | FeatureCollectionGeometry,
    Field(discriminator="type"),
]


def geometry_vertex_count(geometry: GeoJsonGeometry) -> int:
    if isinstance(geometry, PointGeometry):
        return 1
    if isinstance(geometry, PolygonGeometry):
        return sum(len(ring) for ring in geometry.coordinates)
    if isinstance(geometry, MultiPolygonGeometry):
        return sum(len(ring) for polygon in geometry.coordinates for ring in polygon)
    return sum(geometry_vertex_count(feature.geometry) for feature in geometry.features)


def geometry_bounds(geometry: GeoJsonGeometry) -> tuple[float, float, float, float]:
    if isinstance(geometry, PointGeometry):
        positions = [geometry.coordinates]
    elif isinstance(geometry, PolygonGeometry):
        positions = [position for ring in geometry.coordinates for position in ring]
    elif isinstance(geometry, MultiPolygonGeometry):
        positions = [position for polygon in geometry.coordinates for ring in polygon for position in ring]
    else:
        child_bounds = [geometry_bounds(feature.geometry) for feature in geometry.features]
        return (
            min(bounds[0] for bounds in child_bounds),
            min(bounds[1] for bounds in child_bounds),
            max(bounds[2] for bounds in child_bounds),
            max(bounds[3] for bounds in child_bounds),
        )
    longitudes = [position[0] for position in positions]
    latitudes = [position[1] for position in positions]
    return min(longitudes), min(latitudes), max(longitudes), max(latitudes)


class DateRange(StrictModel):
    start_date: str = Field(alias="startDate")
    end_date: str = Field(alias="endDate")

    @field_validator("start_date", "end_date")
    @classmethod
    def validate_date(cls, value: str) -> str:
        if not ISO_DATE.fullmatch(value):
            raise ValueError("Dates must use YYYY-MM-DD.")
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except ValueError as exc:
            raise ValueError("Date is not a valid calendar date.") from exc
        return value

    @model_validator(mode="after")
    def validate_order(self) -> "DateRange":
        if self.start_date > self.end_date:
            raise ValueError("startDate must be earlier than or equal to endDate.")
        return self


class ModelDescriptor(StrictModel):
    id: str = Field(min_length=2, max_length=128)
    version: str = Field(min_length=1, max_length=128)
    task: str = Field(min_length=1, max_length=300)
    model_card_url: str | None = Field(default=None, alias="modelCardUrl", max_length=2_048)

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not MODEL_ID.fullmatch(value):
            raise ValueError("model.id contains unsupported characters.")
        return value

    @field_validator("model_card_url")
    @classmethod
    def validate_model_card(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith("https://"):
            raise ValueError("modelCardUrl must use HTTPS.")
        return value


class Location(StrictModel):
    name: str = Field(min_length=1, max_length=500)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    bbox: Annotated[list[float], Field(min_length=4, max_length=4)]

    @field_validator("bbox")
    @classmethod
    def validate_bbox(cls, value: list[float]) -> list[float]:
        return _validate_bbox(value)


class LicenseProvenance(StrictModel):
    license_id: str = Field(alias="licenseId", min_length=1, max_length=200)
    commercial_use: bool | None = Field(alias="commercialUse")
    redistribution: bool | None
    attribution_required: bool | None = Field(alias="attributionRequired")
    source_provider: str = Field(alias="sourceProvider", min_length=1, max_length=200)
    source_item_id: str = Field(alias="sourceItemId", min_length=1, max_length=500)
    terms_url: str = Field(alias="termsUrl", min_length=8, max_length=2_048)
    note: str = Field(max_length=1_000)

    @field_validator("terms_url")
    @classmethod
    def validate_terms_url(cls, value: str) -> str:
        if not value.startswith("https://"):
            raise ValueError("license termsUrl must use HTTPS.")
        return value


class SceneAsset(StrictModel):
    label: str = Field(min_length=1, max_length=120)
    href: str = Field(min_length=8, max_length=8_192)

    @field_validator("href")
    @classmethod
    def validate_href(cls, value: str) -> str:
        if not value.startswith("https://"):
            raise ValueError("Scene assets must use HTTPS.")
        return value


class Scene(StrictModel):
    id: str = Field(min_length=1, max_length=500)
    collection: str = Field(min_length=1, max_length=200)
    datetime: str = Field(min_length=10, max_length=64)
    resolution: str = Field(min_length=1, max_length=120)
    bbox: Annotated[list[float], Field(min_length=4, max_length=4)]
    geometry: GeoJsonGeometry | None = None
    stac_url: str = Field(alias="stacUrl", min_length=8, max_length=8_192)
    catalog: str = Field(min_length=1, max_length=200)
    asset_access: Literal["public-http", "requester-pays", "authentication-required", "metadata-only"] = Field(alias="assetAccess")
    license: LicenseProvenance
    assets: list[SceneAsset] = Field(min_length=1, max_length=32)

    @field_validator("bbox")
    @classmethod
    def validate_bbox(cls, value: list[float]) -> list[float]:
        return _validate_bbox(value)

    @field_validator("datetime")
    @classmethod
    def validate_datetime(cls, value: str) -> str:
        return _validate_iso_timestamp(value, "scene.datetime")

    @field_validator("stac_url")
    @classmethod
    def validate_stac_url(cls, value: str) -> str:
        if not value.startswith("https://"):
            raise ValueError("stacUrl must use HTTPS.")
        return value

    @model_validator(mode="after")
    def validate_asset_access(self) -> "Scene":
        if self.asset_access not in {"public-http", "requester-pays"}:
            raise ValueError("Only public-http or explicitly enabled requester-pays scenes may cross the inference boundary.")
        return self


Intent = Literal["flood", "wildfire", "volcano", "crop", "vessel", "building", "change", "imagery"]


class InferenceRequest(StrictModel):
    request_id: str = Field(alias="requestId", min_length=36, max_length=36)
    model: ModelDescriptor
    query: str = Field(min_length=1, max_length=1_500)
    intent: Intent
    date_range: DateRange = Field(alias="dateRange")
    requested_objects: list[str] = Field(alias="requestedObjects", min_length=1, max_length=50)
    location: Location
    scenes: list[Scene] = Field(min_length=1, max_length=6)

    @field_validator("request_id")
    @classmethod
    def validate_request_id(cls, value: str) -> str:
        return _validate_uuid(value, "requestId")

    @field_validator("requested_objects")
    @classmethod
    def validate_objects(cls, value: list[str]) -> list[str]:
        if any(not item or len(item) > 120 for item in value):
            raise ValueError("requestedObjects must contain non-empty values up to 120 characters.")
        return value

    @model_validator(mode="after")
    def validate_geometry_size(self) -> "InferenceRequest":
        total_vertices = sum(geometry_vertex_count(scene.geometry) for scene in self.scenes if scene.geometry is not None)
        if total_vertices > 100_000:
            raise ValueError("Input scene geometry exceeds the 100,000 vertex limit.")
        return self


class ResultModel(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    version: str = Field(min_length=1, max_length=128)
    backend: str = Field(min_length=1, max_length=128)


class RunProvenance(StrictModel):
    backend: str = Field(min_length=1, max_length=128)
    backend_version: str = Field(alias="backendVersion", min_length=1, max_length=128)
    model_id: str = Field(alias="modelId", min_length=1, max_length=128)
    scene_ids: list[str] = Field(alias="sceneIds", min_length=1, max_length=6)
    started_at: str = Field(alias="startedAt", min_length=20, max_length=64)
    completed_at: str = Field(alias="completedAt", min_length=20, max_length=64)

    @field_validator("started_at", "completed_at")
    @classmethod
    def validate_timestamp(cls, value: str, info) -> str:
        return _validate_iso_timestamp(value, info.field_name)

    @model_validator(mode="after")
    def validate_order(self) -> "RunProvenance":
        started = datetime.fromisoformat(self.started_at.replace("Z", "+00:00"))
        completed = datetime.fromisoformat(self.completed_at.replace("Z", "+00:00"))
        if completed < started:
            raise ValueError("completedAt must not precede startedAt.")
        return self


class InferenceResponse(StrictModel):
    contract: Literal["geolens-inference/v1"]
    request_id: str = Field(alias="requestId", min_length=36, max_length=36)
    run_id: str = Field(alias="runId", min_length=36, max_length=36)
    model: ResultModel
    detected: bool | None
    outcome: Literal["positive", "negative", "inconclusive"]
    geometry: GeoJsonGeometry | None
    confidence: float | None = Field(default=None, ge=0, le=1)
    confidence_calibrated: bool = Field(alias="confidenceCalibrated")
    summary: str = Field(min_length=1, max_length=1_000)
    warnings: list[str] = Field(default_factory=list, max_length=50)
    provenance: RunProvenance

    @field_validator("request_id", "run_id")
    @classmethod
    def validate_uuid(cls, value: str, info) -> str:
        return _validate_uuid(value, info.field_name)

    @model_validator(mode="after")
    def validate_semantics(self) -> "InferenceResponse":
        if self.confidence_calibrated and self.confidence is None:
            raise ValueError("confidenceCalibrated=true requires confidence.")
        if self.detected is True:
            if self.outcome != "positive" or self.geometry is None:
                raise ValueError("A positive result requires detected=true and valid geometry.")
        elif self.detected is False:
            if self.outcome != "negative" or self.geometry is not None:
                raise ValueError("A negative result must not include detection geometry.")
        elif self.outcome != "inconclusive" or self.geometry is not None:
            raise ValueError("An inconclusive result must use detected=null and no geometry.")
        if self.geometry is not None and geometry_vertex_count(self.geometry) > 100_000:
            raise ValueError("Output geometry exceeds the 100,000 vertex limit.")
        return self


class HealthResponse(StrictModel):
    status: Literal["ok"]
    service: str
    version: str
    contract: str


class ReadyResponse(StrictModel):
    ready: bool
    status: Literal["ready", "validation-only", "unavailable"]
    contract: Literal["geolens-inference/v1"]
    backend: str
    backend_version: str = Field(alias="backendVersion")
    inference_enabled: bool = Field(alias="inferenceEnabled")
    model_ids: list[str] = Field(alias="modelIds")
    detail: str
