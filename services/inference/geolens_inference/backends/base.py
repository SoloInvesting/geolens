from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from geolens_inference.schemas import InferenceRequest, InferenceResponse


@dataclass(frozen=True, slots=True)
class BackendReadiness:
    ready: bool
    inference_enabled: bool
    detail: str


class Backend(Protocol):
    name: str
    version: str

    def readiness(self) -> BackendReadiness:
        """Return operational readiness without loading model weights."""

    async def infer(self, request: InferenceRequest) -> InferenceResponse:
        """Run one inference request and return a fully validated contract response."""
