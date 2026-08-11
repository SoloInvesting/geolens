from __future__ import annotations

from geolens_inference.schemas import InferenceRequest, InferenceResponse

from .base import BackendReadiness


class UnavailableBackend:
    version = "unavailable"

    def __init__(self, name: str) -> None:
        self.name = name

    def readiness(self) -> BackendReadiness:
        return BackendReadiness(
            ready=False,
            inference_enabled=False,
            detail=f"Backend '{self.name}' is not installed in this service image.",
        )

    async def infer(self, request: InferenceRequest) -> InferenceResponse:
        del request
        raise RuntimeError(f"Backend '{self.name}' is unavailable.")
