from __future__ import annotations

import json
from pathlib import Path
import sys

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from geolens_inference.schemas import (  # noqa: E402
    InferenceResponse,
    PolygonGeometry,
    ResultModel,
    RunProvenance,
)


SHARED_CONTRACT_FIXTURE = (
    Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "geolens-inference-v1.json"
)


def provenance() -> RunProvenance:
    return RunProvenance(
        backend="test",
        backendVersion="1",
        modelId="test-model",
        sceneIds=["scene-1"],
        startedAt="2026-08-11T12:00:00+00:00",
        completedAt="2026-08-11T12:00:01+00:00",
    )


def base_response() -> dict:
    return {
        "contract": "geolens-inference/v1",
        "requestId": "9a711941-6382-4bd0-89a9-c0a7a02d1255",
        "runId": "b09fcb51-3008-4a87-856d-f6a51f85a875",
        "model": ResultModel(id="test-model", version="1", backend="test"),
        "confidence": None,
        "confidenceCalibrated": False,
        "summary": "Test result.",
        "warnings": [],
        "provenance": provenance(),
    }


def test_shared_contract_fixture_matches_python_schema() -> None:
    payload = json.loads(SHARED_CONTRACT_FIXTURE.read_text(encoding="utf-8"))
    validated = InferenceResponse.model_validate(payload)

    assert validated.model_dump(mode="json", by_alias=True) == payload


def test_polygon_ring_must_be_closed() -> None:
    with pytest.raises(ValidationError):
        PolygonGeometry.model_validate({
            "type": "Polygon",
            "coordinates": [[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]],
        })


def test_coordinates_must_be_wgs84() -> None:
    with pytest.raises(ValidationError):
        PolygonGeometry.model_validate({
            "type": "Polygon",
            "coordinates": [[[181.0, 0.0], [181.0, 1.0], [179.0, 1.0], [181.0, 0.0]]],
        })


def test_positive_response_requires_geometry() -> None:
    payload = base_response() | {"detected": True, "outcome": "positive", "geometry": None}
    with pytest.raises(ValidationError):
        InferenceResponse.model_validate(payload)


def test_negative_response_rejects_geometry() -> None:
    payload = base_response() | {
        "detected": False,
        "outcome": "negative",
        "geometry": {
            "type": "Point",
            "coordinates": [-90.0, 30.0],
        },
    }
    with pytest.raises(ValidationError):
        InferenceResponse.model_validate(payload)


def test_calibrated_confidence_requires_numeric_confidence() -> None:
    payload = base_response() | {
        "detected": None,
        "outcome": "inconclusive",
        "geometry": None,
        "confidenceCalibrated": True,
    }
    with pytest.raises(ValidationError):
        InferenceResponse.model_validate(payload)
