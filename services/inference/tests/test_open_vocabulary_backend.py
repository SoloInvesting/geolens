from __future__ import annotations

import asyncio
from copy import deepcopy
from pathlib import Path
import sys

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from geolens_inference.backends.open_vocabulary import (  # noqa: E402
    EngineResult,
    GeoDetection,
    OpenVocabularyBackend,
    TransformersGroundedSamEngine,
    build_object_prompts,
    requested_color_terms,
)
from geolens_inference.config import Settings  # noqa: E402
from geolens_inference.main import create_app  # noqa: E402
from geolens_inference.schemas import InferenceRequest, Scene  # noqa: E402

from test_api import headers, sample_payload  # noqa: E402


def open_vocab_payload() -> dict:
    payload = deepcopy(sample_payload())
    payload["model"] = {
        "id": "grounding-dino-sam2-eo",
        "version": "grounding-dino-tiny+sam2.1-hiera-small/v1",
        "task": "Open-vocabulary instance segmentation",
        "modelCardUrl": "https://huggingface.co/IDEA-Research/grounding-dino-tiny",
    }
    payload["intent"] = "building"
    payload["query"] = "Find red vehicles in the selected area"
    payload["requestedObjects"] = ["building"]
    payload["location"]["bbox"] = [-90.10, 29.90, -90.00, 30.00]
    payload["location"]["latitude"] = 29.95
    payload["location"]["longitude"] = -90.05
    return payload


class FakeEngine:
    version = "fake-grounded-sam/v1"

    def __init__(self, result: EngineResult) -> None:
        self.result = result
        self.loaded = False
        self.closed = False
        self.prompts: tuple[str, ...] = ()
        self.colors: tuple[str, ...] = ()

    def load(self) -> None:
        self.loaded = True

    def close(self) -> None:
        self.closed = True

    def infer(self, request, prompts, requested_colors, limits):
        del request, limits
        self.prompts = prompts
        self.colors = requested_colors
        return self.result


def positive_result() -> EngineResult:
    return EngineResult(
        detections=(
            GeoDetection(
                geometry={
                    "type": "Polygon",
                    "coordinates": [[
                        [-90.10, 29.90],
                        [-90.09, 29.90],
                        [-90.09, 29.91],
                        [-90.10, 29.90],
                    ]],
                },
                class_name="vehicle",
                color_name="red",
                score=0.87,
                scene_id="S2B_TEST_SCENE",
            ),
        ),
        processed_scene_ids=("S2B_TEST_SCENE",),
        coverage_complete=True,
    )


def test_prompt_and_color_extraction_prefers_specific_query_over_generic_request() -> None:
    assert build_object_prompts(["building"], "מצא כלי רכב אדומים", maximum=8) == ("vehicle",)
    assert requested_color_terms(["building"], "מצא כלי רכב אדומים") == ("red",)


def test_backend_is_ready_only_after_engine_load_and_returns_reviewable_features() -> None:
    engine = FakeEngine(positive_result())
    backend = OpenVocabularyBackend(Settings(), engine=engine)
    assert backend.readiness().ready is False

    asyncio.run(backend.load())
    response = asyncio.run(backend.infer(InferenceRequest.model_validate(open_vocab_payload())))

    assert backend.readiness().inference_enabled is True
    assert response.outcome == "positive"
    assert response.confidence_calibrated is False
    assert response.provenance.scene_ids == ["S2B_TEST_SCENE"]
    feature = response.geometry.features[0]
    assert feature.properties == {
        "class": "vehicle",
        "color": "red",
        "score": 0.87,
        "sceneId": "S2B_TEST_SCENE",
    }
    assert engine.prompts == ("vehicle",)
    assert engine.colors == ("red",)


def test_api_lifecycle_loads_open_vocabulary_backend_and_advertises_only_its_model() -> None:
    engine = FakeEngine(positive_result())
    settings = Settings(backend_name="open-vocabulary", bearer_token="test-secret")
    backend = OpenVocabularyBackend(settings, engine=engine)
    payload = open_vocab_payload()

    with TestClient(create_app(settings, backend=backend)) as client:
        ready = client.get("/ready")
        result = client.post("/v1/infer", json=payload, headers=headers("test-secret", payload))

    assert ready.status_code == 200
    assert ready.json()["inferenceEnabled"] is True
    assert ready.json()["modelIds"] == ["grounding-dino-sam2-eo"]
    assert result.status_code == 200, result.text
    assert engine.closed is True


def test_planetary_asset_signatures_are_temporary_and_not_written_to_scene() -> None:
    calls: list[str] = []

    def signer(value: str) -> str:
        calls.append(value)
        return f"{value}?st=temporary&sig=secret"

    payload = open_vocab_payload()["scenes"][0]
    payload["catalog"] = "Microsoft Planetary Computer"
    payload["collection"] = "naip"
    payload["stacUrl"] = "https://planetarycomputer.microsoft.com/api/stac/v1/collections/naip/items/test"
    payload["assets"] = [{"label": "RGB image", "href": "https://naipeuwest.blob.core.windows.net/naip/test.tif"}]
    scene = Scene.model_validate(payload)
    engine = TransformersGroundedSamEngine(Settings(), url_signer=signer)

    signed = engine._rgb_assets(scene)

    assert calls == ["https://naipeuwest.blob.core.windows.net/naip/test.tif"]
    assert signed[0].endswith("sig=secret")
    assert "?" not in scene.assets[0].href


def test_partial_coverage_without_detections_is_inconclusive() -> None:
    engine = FakeEngine(EngineResult((), ("S2B_TEST_SCENE",), False, ("PARTIAL_COVERAGE_MAX_TILES",)))
    backend = OpenVocabularyBackend(Settings(), engine=engine)
    asyncio.run(backend.load())

    response = asyncio.run(backend.infer(InferenceRequest.model_validate(open_vocab_payload())))

    assert response.detected is None
    assert response.outcome == "inconclusive"
    assert response.geometry is None


def test_complete_coverage_without_detections_remains_inconclusive_until_calibrated() -> None:
    engine = FakeEngine(EngineResult((), ("S2B_TEST_SCENE",), True))
    backend = OpenVocabularyBackend(Settings(), engine=engine)
    asyncio.run(backend.load())

    response = asyncio.run(backend.infer(InferenceRequest.model_validate(open_vocab_payload())))

    assert response.detected is None
    assert response.outcome == "inconclusive"
    assert response.geometry is None
    assert "NEGATIVE_NOT_CALIBRATED" in response.warnings


def test_backend_rejects_a_model_version_that_does_not_match_runtime_provenance() -> None:
    payload = open_vocab_payload()
    payload["model"]["version"] = "unreviewed-checkpoint"
    engine = FakeEngine(positive_result())
    backend = OpenVocabularyBackend(Settings(), engine=engine)
    asyncio.run(backend.load())

    try:
        asyncio.run(backend.infer(InferenceRequest.model_validate(payload)))
    except Exception as exc:
        assert "model version" in str(exc).lower()
    else:
        raise AssertionError("A mismatched model version must be rejected.")
