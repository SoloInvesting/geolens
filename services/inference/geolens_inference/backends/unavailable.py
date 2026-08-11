from __future__ import annotations

from geolens_inference.schemas import InferenceRequest, InferenceResponse

from .base import BackendReadiness


class UnavailableBackend:
    version = "unavailable"

    def __init__(self, name: str) -> None:
        self.name = name

    async def load(self) -> None:
        return None

    async def close(self) -> None:
        return None

    def readiness(self) -> BackendReadiness:
        return BackendReadiness(
            ready=False,
            inference_enabled=False,
            detail=f"Backend '{self.name}' is not installed in this service image.",
        )

    async def infer(self, request: InferenceRequest) -> InferenceResponse:
        del request
        raise RuntimeError(f"Backend '{self.name}' is unavailable.")
