from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from geolens_inference.schemas import InferenceRequest, InferenceResponse


@dataclass(frozen=True, slots=True)
class BackendReadiness:
    ready: bool
    inference_enabled: bool
    detail: str


class BackendInputError(ValueError):
    """Raised when a validated contract request is unusable by a backend."""


class Backend(Protocol):
    name: str
    version: str

    async def load(self) -> None:
        """Load optional model weights and runtime dependencies."""

    async def close(self) -> None:
        """Release optional model resources."""

    def readiness(self) -> BackendReadiness:
        """Return operational readiness without initiating model loading."""

    async def infer(self, request: InferenceRequest) -> InferenceResponse:
        """Run one inference request and return a fully validated contract response."""
