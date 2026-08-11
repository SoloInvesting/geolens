from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from geolens_inference.config import CONTRACT_VERSION
from geolens_inference.schemas import (
    InferenceRequest,
    InferenceResponse,
    ResultModel,
    RunProvenance,
)

from .base import BackendReadiness


class MockBackend:
    """Validation-only backend. It never claims presence or absence of an event."""

    name = "mock"
    version = "validation-only/v1"

    async def load(self) -> None:
        return None

    async def close(self) -> None:
        return None

    def readiness(self) -> BackendReadiness:
        return BackendReadiness(
            ready=True,
            inference_enabled=False,
            detail="Validation-only mock is ready. No model weights are loaded and no detection conclusion is produced.",
        )

    async def infer(self, request: InferenceRequest) -> InferenceResponse:
        started_at = datetime.now(timezone.utc)
        completed_at = datetime.now(timezone.utc)
        return InferenceResponse(
            contract=CONTRACT_VERSION,
            requestId=request.request_id,
            runId=str(uuid4()),
            model=ResultModel(id=request.model.id, version=request.model.version, backend=self.name),
            detected=None,
            outcome="inconclusive",
            geometry=None,
            confidence=None,
            confidenceCalibrated=False,
            summary="The mock backend validated the request but performed no inference. It makes no detection or non-detection claim.",
            warnings=["MOCK_BACKEND_NO_INFERENCE"],
            provenance=RunProvenance(
                backend=self.name,
                backendVersion=self.version,
                modelId=request.model.id,
                sceneIds=[scene.id for scene in request.scenes],
                startedAt=started_at.isoformat(),
                completedAt=completed_at.isoformat(),
            ),
        )
