from __future__ import annotations

import asyncio
import math
import re
from contextlib import ExitStack
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Protocol
from urllib.parse import urlsplit
from uuid import uuid4

from geolens_inference.config import CONTRACT_VERSION, Settings
from geolens_inference.schemas import (
    GeoFeature,
    InferenceRequest,
    InferenceResponse,
    ResultModel,
    RunProvenance,
    Scene,
)

from .base import BackendInputError, BackendReadiness


SUPPORTED_MODEL_ID = "grounding-dino-sam2-eo"
BACKEND_VERSION = "grounding-dino+sam2.1/v1"


@dataclass(frozen=True, slots=True)
class OpenVocabularyLimits:
    tile_size: int
    tile_overlap: int
    max_tiles: int
    max_detections: int
    max_objects: int
    max_scenes: int
    max_aoi_km2: float
    box_threshold: float
    text_threshold: float
    mask_threshold: float
    color_min_fraction: float

    @classmethod
    def from_settings(cls, settings: Settings) -> "OpenVocabularyLimits":
        return cls(
            tile_size=settings.open_vocab_tile_size,
            tile_overlap=settings.open_vocab_tile_overlap,
            max_tiles=settings.open_vocab_max_tiles,
            max_detections=settings.open_vocab_max_detections,
            max_objects=settings.open_vocab_max_objects,
            max_scenes=settings.open_vocab_max_scenes,
            max_aoi_km2=settings.open_vocab_max_aoi_km2,
            box_threshold=settings.open_vocab_box_threshold,
            text_threshold=settings.open_vocab_text_threshold,
            mask_threshold=settings.open_vocab_mask_threshold,
            color_min_fraction=settings.open_vocab_color_min_fraction,
        )


@dataclass(frozen=True, slots=True)
class GeoDetection:
    geometry: dict[str, Any]
    class_name: str
    color_name: str
    score: float
    scene_id: str


@dataclass(frozen=True, slots=True)
class EngineResult:
    detections: tuple[GeoDetection, ...]
    processed_scene_ids: tuple[str, ...]
    coverage_complete: bool
    warnings: tuple[str, ...] = ()


class OpenVocabularyEngine(Protocol):
    version: str

    def load(self) -> None:
        """Load model weights and verify the raster runtime."""

    def infer(
        self,
        request: InferenceRequest,
        prompts: tuple[str, ...],
        requested_colors: tuple[str, ...],
        limits: OpenVocabularyLimits,
    ) -> EngineResult:
        """Run tiled inference and return WGS84 candidates."""

    def close(self) -> None:
        """Release optional model resources."""


_OBJECT_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"(?:פאנל(?:ים)?\s+סולרי(?:ים)?|לוחות?\s+(?:סולרי(?:ים)?|פוטו-?וולטאיים)|\b(?:solar\s+panels?|photovoltaic\s+panels?|pv\s+arrays?)\b)", re.I), "solar panel"),
    (re.compile(r"(?:כלי\s+רכב|רכב(?:ים)?|מכונית|מכוניות|\b(?:vehicles?|cars?)\b)", re.I), "vehicle"),
    (re.compile(r"(?:משאית|משאיות|\btrucks?\b)", re.I), "truck"),
    (re.compile(r"(?:אוטובוס|אוטובוסים|\bbuses?\b)", re.I), "bus"),
    (re.compile(r"(?:גג|גגות|\b(?:roof|roofs|rooftop|rooftops)\b)", re.I), "rooftop"),
    (re.compile(r"(?:בניין|בניינים|מבנה|מבנים|בית|בתים|\b(?:building|buildings|structure|structures)\b)", re.I), "building"),
    (re.compile(r"(?:מטוס|מטוסים|כלי\s+טיס|\b(?:aircraft|airplane|airplanes|helicopter|helicopters)\b)", re.I), "aircraft"),
    (re.compile(r"(?:טורבינ(?:ת|ות)\s+רוח|\bwind\s+turbines?\b)", re.I), "wind turbine"),
    (re.compile(r"(?:גשר|גשרים|\bbridges?\b)", re.I), "bridge"),
    (re.compile(r"(?:מיכל(?:ים)?|\bstorage\s+tanks?\b)", re.I), "storage tank"),
    (re.compile(r"(?:אתר(?:י)?\s+בנייה|\bconstruction\s+sites?\b)", re.I), "construction site"),
)

_KNOWN_OBJECT_TRANSLATIONS = {
    "מבנה": "building",
    "מבנים": "building",
    "בניין": "building",
    "בניינים": "building",
    "טביעת רגל": "building",
    "גג": "rooftop",
    "גגות": "rooftop",
    "כלי רכב": "vehicle",
    "רכב": "vehicle",
    "רכבים": "vehicle",
    "מכונית": "vehicle",
    "מכוניות": "vehicle",
    "משאית": "truck",
    "משאיות": "truck",
    "פאנל סולרי": "solar panel",
    "פאנלים סולריים": "solar panel",
}

_GENERIC_BUILDING_OBJECTS = {"building", "footprint", "מבנה", "מבנים", "טביעת רגל"}

_COLOR_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"(?:אדום|אדומה|אדומים|אדומות|\bred\b)", re.I), "red"),
    (re.compile(r"(?:כתום|כתומה|כתומים|כתומות|\borange\b)", re.I), "orange"),
    (re.compile(r"(?:צהוב|צהובה|צהובים|צהובות|\byellow\b)", re.I), "yellow"),
    (re.compile(r"(?:ירוק|ירוקה|ירוקים|ירוקות|\bgreen\b)", re.I), "green"),
    (re.compile(r"(?:כחול|כחולה|כחולים|כחולות|\bblue\b)", re.I), "blue"),
    (re.compile(r"(?:סגול|סגולה|סגולים|סגולות|\bpurple\b)", re.I), "purple"),
    (re.compile(r"(?:חום|חומה|חומים|חומות|\bbrown\b)", re.I), "brown"),
    (re.compile(r"(?:לבן|לבנה|לבנים|לבנות|\bwhite\b)", re.I), "white"),
    (re.compile(r"(?:שחור|שחורה|שחורים|שחורות|\bblack\b)", re.I), "black"),
    (re.compile(r"(?:אפור|אפורה|אפורים|אפורות|\bgr[ae]y\b)", re.I), "gray"),
)


def _safe_prompt(value: str) -> str:
    normalized = " ".join(value.strip().split())[:80]
    return "".join(character for character in normalized if character.isalnum() or character in {" ", "-"}).strip()


def build_object_prompts(requested_objects: list[str], query: str, maximum: int) -> tuple[str, ...]:
    query_objects = [label for pattern, label in _OBJECT_PATTERNS if pattern.search(query)]
    translated: list[str] = []
    for value in requested_objects:
        normalized = " ".join(value.strip().split()).lower()
        candidate = _KNOWN_OBJECT_TRANSLATIONS.get(normalized, _safe_prompt(normalized))
        if candidate:
            translated.append(candidate)

    if query_objects and translated and set(translated).issubset(_GENERIC_BUILDING_OBJECTS):
        translated = []
    values = [*query_objects, *translated]
    deduplicated = tuple(dict.fromkeys(value for value in values if value))
    if not deduplicated:
        raise BackendInputError("No safe open-vocabulary object prompt could be derived from requestedObjects or query.")
    if len(deduplicated) > maximum:
        raise BackendInputError(f"Open-vocabulary inference accepts at most {maximum} distinct object prompts.")
    return deduplicated


def requested_color_terms(requested_objects: list[str], query: str) -> tuple[str, ...]:
    text = " ".join([query, *requested_objects])
    return tuple(dict.fromkeys(label for pattern, label in _COLOR_PATTERNS if pattern.search(text)))


def _bbox_area_km2(bbox: list[float]) -> float:
    west, south, east, north = bbox
    mean_latitude = math.radians((south + north) / 2)
    return abs((east - west) * 111.32 * math.cos(mean_latitude) * (north - south) * 110.57)


def _geometry_bounds(geometry: dict[str, Any]) -> tuple[float, float, float, float]:
    coordinates: list[tuple[float, float]] = []

    def collect(value: Any) -> None:
        if isinstance(value, (list, tuple)) and len(value) >= 2 and all(isinstance(item, (int, float)) for item in value[:2]):
            coordinates.append((float(value[0]), float(value[1])))
        elif isinstance(value, (list, tuple)):
            for item in value:
                collect(item)

    collect(geometry.get("coordinates"))
    if not coordinates:
        return (0.0, 0.0, 0.0, 0.0)
    return (
        min(point[0] for point in coordinates),
        min(point[1] for point in coordinates),
        max(point[0] for point in coordinates),
        max(point[1] for point in coordinates),
    )


def _bbox_iou(first: tuple[float, float, float, float], second: tuple[float, float, float, float]) -> float:
    west = max(first[0], second[0])
    south = max(first[1], second[1])
    east = min(first[2], second[2])
    north = min(first[3], second[3])
    intersection = max(0.0, east - west) * max(0.0, north - south)
    first_area = max(0.0, first[2] - first[0]) * max(0.0, first[3] - first[1])
    second_area = max(0.0, second[2] - second[0]) * max(0.0, second[3] - second[1])
    union = first_area + second_area - intersection
    return intersection / union if union > 0 else 0.0


def _deduplicate_detections(values: list[GeoDetection], maximum: int) -> list[GeoDetection]:
    selected: list[GeoDetection] = []
    for candidate in sorted(values, key=lambda item: item.score, reverse=True):
        candidate_bounds = _geometry_bounds(candidate.geometry)
        duplicate = any(
            existing.class_name == candidate.class_name
            and existing.scene_id == candidate.scene_id
            and _bbox_iou(_geometry_bounds(existing.geometry), candidate_bounds) >= 0.6
            for existing in selected
        )
        if duplicate:
            continue
        selected.append(candidate)
        if len(selected) >= maximum:
            break
    return selected


def _clip_edge(
    points: list[tuple[float, float]],
    inside: Any,
    intersection: Any,
) -> list[tuple[float, float]]:
    if not points:
        return []
    output: list[tuple[float, float]] = []
    previous = points[-1]
    previous_inside = inside(previous)
    for current in points:
        current_inside = inside(current)
        if current_inside:
            if not previous_inside:
                output.append(intersection(previous, current))
            output.append(current)
        elif previous_inside:
            output.append(intersection(previous, current))
        previous = current
        previous_inside = current_inside
    return output


def _clip_ring_to_bbox(coordinates: list[list[float]], bbox: list[float]) -> list[list[float]] | None:
    west, south, east, north = bbox
    points = [(float(item[0]), float(item[1])) for item in coordinates]
    if len(points) > 1 and points[0] == points[-1]:
        points = points[:-1]

    def vertical(start: tuple[float, float], end: tuple[float, float], longitude: float) -> tuple[float, float]:
        delta = end[0] - start[0]
        fraction = 0.0 if abs(delta) < 1e-15 else (longitude - start[0]) / delta
        return longitude, start[1] + fraction * (end[1] - start[1])

    def horizontal(start: tuple[float, float], end: tuple[float, float], latitude: float) -> tuple[float, float]:
        delta = end[1] - start[1]
        fraction = 0.0 if abs(delta) < 1e-15 else (latitude - start[1]) / delta
        return start[0] + fraction * (end[0] - start[0]), latitude

    points = _clip_edge(points, lambda point: point[0] >= west, lambda a, b: vertical(a, b, west))
    points = _clip_edge(points, lambda point: point[0] <= east, lambda a, b: vertical(a, b, east))
    points = _clip_edge(points, lambda point: point[1] >= south, lambda a, b: horizontal(a, b, south))
    points = _clip_edge(points, lambda point: point[1] <= north, lambda a, b: horizontal(a, b, north))
    if len(points) < 3:
        return None
    closed = [*points, points[0]]
    return [[round(longitude, 7), round(latitude, 7)] for longitude, latitude in closed]


def _clip_geometry_to_bbox(geometry: dict[str, Any], bbox: list[float]) -> dict[str, Any] | None:
    if geometry.get("type") == "Polygon":
        rings = geometry.get("coordinates")
        if not isinstance(rings, list) or not rings:
            return None
        exterior = _clip_ring_to_bbox(rings[0], bbox)
        return {"type": "Polygon", "coordinates": [exterior]} if exterior else None
    if geometry.get("type") == "MultiPolygon":
        polygons: list[list[list[list[float]]]] = []
        for polygon in geometry.get("coordinates", []):
            if not polygon:
                continue
            exterior = _clip_ring_to_bbox(polygon[0], bbox)
            if exterior:
                polygons.append([exterior])
        if not polygons:
            return None
        return {"type": "MultiPolygon", "coordinates": polygons}
    return None


def _is_planetary_scene(scene: Scene) -> bool:
    hostname = (urlsplit(scene.stac_url).hostname or "").lower()
    return hostname == "planetarycomputer.microsoft.com" or "planetary computer" in scene.catalog.lower()


class TransformersGroundedSamEngine:
    """Optional Rasterio + Transformers Grounding DINO and SAM 2.1 runtime."""

    version = BACKEND_VERSION

    def __init__(self, settings: Settings, *, url_signer: Any | None = None) -> None:
        self._settings = settings
        self._url_signer = url_signer
        self._loaded = False

    def load(self) -> None:
        if self._loaded:
            return
        try:
            import cv2
            import numpy
            import rasterio
            import torch
            from PIL import Image
            from rasterio.features import shapes
            from rasterio.vrt import WarpedVRT
            from rasterio.warp import Resampling, transform_bounds, transform_geom
            from rasterio.windows import Window, from_bounds, transform
            from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor, Sam2Model, Sam2Processor
        except ImportError as exc:
            raise RuntimeError(
                "The open-vocabulary backend requires requirements-open-vocabulary.txt."
            ) from exc

        device = self._settings.open_vocab_device
        if device == "auto":
            if torch.cuda.is_available():
                device = "cuda"
            elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                device = "mps"
            else:
                device = "cpu"
        if device == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("GEOLENS_OPEN_VOCAB_DEVICE=cuda but CUDA is unavailable.")

        load_options = {"local_files_only": self._settings.open_vocab_local_files_only}
        detector_processor = AutoProcessor.from_pretrained(
            self._settings.open_vocab_detector_model,
            **load_options,
        )
        detector = AutoModelForZeroShotObjectDetection.from_pretrained(
            self._settings.open_vocab_detector_model,
            **load_options,
        ).to(device).eval()
        segmenter_processor = Sam2Processor.from_pretrained(
            self._settings.open_vocab_segmenter_model,
            **load_options,
        )
        segmenter = Sam2Model.from_pretrained(
            self._settings.open_vocab_segmenter_model,
            **load_options,
        ).to(device).eval()

        self._cv2 = cv2
        self._np = numpy
        self._rasterio = rasterio
        self._torch = torch
        self._Image = Image
        self._shapes = shapes
        self._WarpedVRT = WarpedVRT
        self._Resampling = Resampling
        self._transform_bounds = transform_bounds
        self._transform_geom = transform_geom
        self._Window = Window
        self._from_bounds = from_bounds
        self._window_transform = transform
        self._detector_processor = detector_processor
        self._detector = detector
        self._segmenter_processor = segmenter_processor
        self._segmenter = segmenter
        self._device = device
        self._loaded = True

    def close(self) -> None:
        if not self._loaded:
            return
        self._detector = None
        self._segmenter = None
        self._loaded = False
        if getattr(self, "_device", "cpu") == "cuda":
            self._torch.cuda.empty_cache()

    def _temporary_asset_href(self, scene: Scene, href: str) -> str:
        if not _is_planetary_scene(scene):
            return href
        signer = self._url_signer
        if signer is None:
            try:
                import planetary_computer
            except ImportError as exc:
                raise RuntimeError("Planetary Computer scenes require the optional planetary-computer package.") from exc
            signer = planetary_computer.sign_url
        signed = signer(href)
        if not isinstance(signed, str) or not signed.startswith("https://"):
            raise RuntimeError("Planetary Computer signing did not return a valid HTTPS URL.")
        return signed

    @staticmethod
    def _normalized_asset_label(label: str) -> str:
        return re.sub(r"[^a-z0-9]+", "", label.lower())

    def _rgb_assets(self, scene: Scene) -> tuple[str, ...]:
        assets = [(self._normalized_asset_label(asset.label), asset.href) for asset in scene.assets]
        combined = next((href for label, href in assets if any(term in label for term in ("rgb", "visual", "image"))), None)
        if combined:
            return (self._temporary_asset_href(scene, combined),)

        def channel(*aliases: str) -> str | None:
            return next((href for label, href in assets if any(alias in label for alias in aliases)), None)

        red = channel("red", "b04", "band4")
        green = channel("green", "b03", "band3")
        blue = channel("blue", "b02", "band2")
        if not red or not green or not blue:
            return ()
        return tuple(self._temporary_asset_href(scene, value) for value in (red, green, blue))

    def _raster_environment(self, requester_pays: bool) -> dict[str, str]:
        values = {
            "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
            "CPL_VSIL_CURL_USE_HEAD": "NO",
            "GDAL_HTTP_MULTIRANGE": "YES",
            "GDAL_HTTP_TIMEOUT": "20",
            "GDAL_HTTP_MAX_RETRY": "2",
            "GDAL_HTTP_RETRY_DELAY": "1",
        }
        if requester_pays:
            values["AWS_REQUEST_PAYER"] = "requester"
            values["AWS_NO_SIGN_REQUEST"] = "NO"
        return values

    def _open_rgb(self, scene: Scene, stack: ExitStack) -> tuple[Any, tuple[Any, ...], bool] | None:
        hrefs = self._rgb_assets(scene)
        if not hrefs:
            return None
        stack.enter_context(self._rasterio.Env(**self._raster_environment(scene.asset_access == "requester-pays")))
        datasets = tuple(stack.enter_context(self._rasterio.open(href)) for href in hrefs)
        base = datasets[0]
        if base.crs is None or base.transform is None:
            raise RuntimeError("RGB raster must declare a CRS and affine transform.")
        if len(datasets) == 1:
            if base.count < 3:
                raise RuntimeError("A combined RGB asset must contain at least three bands.")
            return base, datasets, True

        aligned: list[Any] = [base]
        for dataset in datasets[1:]:
            if dataset.crs == base.crs and dataset.transform == base.transform and dataset.width == base.width and dataset.height == base.height:
                aligned.append(dataset)
            else:
                aligned.append(stack.enter_context(self._WarpedVRT(
                    dataset,
                    crs=base.crs,
                    transform=base.transform,
                    width=base.width,
                    height=base.height,
                    resampling=self._Resampling.bilinear,
                )))
        return base, tuple(aligned), False

    def _analysis_window(self, dataset: Any, bbox: list[float]) -> Any | None:
        projected = self._transform_bounds("EPSG:4326", dataset.crs, *bbox, densify_pts=21)
        candidate = self._from_bounds(*projected, transform=dataset.transform).round_offsets().round_lengths()
        full = self._Window(0, 0, dataset.width, dataset.height)
        try:
            clipped = candidate.intersection(full)
        except Exception:
            return None
        return clipped if clipped.width > 0 and clipped.height > 0 else None

    @staticmethod
    def _tile_windows(window: Any, tile_size: int, overlap: int) -> list[Any]:
        step = tile_size - overlap
        row_start = int(window.row_off)
        column_start = int(window.col_off)
        row_end = int(math.ceil(window.row_off + window.height))
        column_end = int(math.ceil(window.col_off + window.width))
        windows: list[Any] = []
        for row in range(row_start, row_end, step):
            height = min(tile_size, row_end - row)
            for column in range(column_start, column_end, step):
                width = min(tile_size, column_end - column)
                windows.append((column, row, width, height))
        return windows

    def _read_rgb_tile(self, datasets: tuple[Any, ...], combined: bool, window: Any) -> Any | None:
        if combined:
            bands = datasets[0].read([1, 2, 3], window=window, masked=True)
        else:
            bands = self._np.stack([dataset.read(1, window=window, masked=True) for dataset in datasets], axis=0)
        raw = self._np.ma.filled(bands, self._np.nan).astype("float32")
        if raw.shape[1] < 8 or raw.shape[2] < 8 or not self._np.isfinite(raw).any():
            return None
        scaled = self._np.zeros(raw.shape, dtype="uint8")
        for band_index in range(3):
            band = raw[band_index]
            valid = band[self._np.isfinite(band)]
            if not valid.size:
                return None
            low, high = self._np.percentile(valid, [2, 98])
            if high <= low:
                low, high = float(valid.min()), float(valid.max())
            if high <= low:
                continue
            scaled[band_index] = self._np.clip((band - low) * 255.0 / (high - low), 0, 255).astype("uint8")
        image = self._np.transpose(scaled, (1, 2, 0))
        return image if image.any() else None

    def _move_inputs(self, values: Any) -> Any:
        if hasattr(values, "to"):
            return values.to(self._device)
        if isinstance(values, dict):
            return {key: self._move_inputs(value) for key, value in values.items()}
        return values

    def _predict_masks(
        self,
        image_array: Any,
        prompts: tuple[str, ...],
        limits: OpenVocabularyLimits,
    ) -> list[tuple[str, float, Any]]:
        image = self._Image.fromarray(image_array, mode="RGB")
        text = ". ".join(prompts) + "."
        detector_inputs = self._detector_processor(images=image, text=text, return_tensors="pt")
        detector_inputs = self._move_inputs(detector_inputs)
        with self._torch.inference_mode():
            detector_outputs = self._detector(**detector_inputs)
        result = self._detector_processor.post_process_grounded_object_detection(
            detector_outputs,
            detector_inputs.get("input_ids"),
            box_threshold=limits.box_threshold,
            text_threshold=limits.text_threshold,
            target_sizes=[image.size[::-1]],
        )[0]
        boxes = result.get("boxes")
        if boxes is None or len(boxes) == 0:
            return []
        box_values = boxes.detach().cpu().tolist() if hasattr(boxes, "detach") else list(boxes)
        scores = result.get("scores", [])
        score_values = scores.detach().cpu().tolist() if hasattr(scores, "detach") else list(scores)
        labels = result.get("text_labels", result.get("labels", []))
        if hasattr(labels, "detach"):
            labels = labels.detach().cpu().tolist()

        segmenter_inputs = self._segmenter_processor(images=image, input_boxes=[box_values], return_tensors="pt")
        segmenter_inputs = self._move_inputs(segmenter_inputs)
        with self._torch.inference_mode():
            segmenter_outputs = self._segmenter(**segmenter_inputs, multimask_output=False)
        masks = self._segmenter_processor.post_process_masks(
            segmenter_outputs.pred_masks.detach().cpu(),
            segmenter_inputs["original_sizes"].detach().cpu(),
        )[0]

        predictions: list[tuple[str, float, Any]] = []
        for index, raw_mask in enumerate(masks):
            mask = raw_mask[0] if getattr(raw_mask, "ndim", 0) == 3 else raw_mask
            mask_array = mask.detach().cpu().numpy() if hasattr(mask, "detach") else self._np.asarray(mask)
            binary = mask_array > limits.mask_threshold
            if int(binary.sum()) < 16:
                continue
            raw_label = labels[index] if index < len(labels) else prompts[min(index, len(prompts) - 1)]
            label = _safe_prompt(str(raw_label)) or prompts[min(index, len(prompts) - 1)]
            score = float(score_values[index]) if index < len(score_values) else limits.box_threshold
            predictions.append((label[:120], max(0.0, min(1.0, score)), binary))
        return predictions

    def _color_masks(self, image: Any) -> dict[str, Any]:
        hsv = self._cv2.cvtColor(image, self._cv2.COLOR_RGB2HSV)
        lab = self._cv2.cvtColor(image, self._cv2.COLOR_RGB2LAB)
        hue, saturation, value = hsv[..., 0], hsv[..., 1], hsv[..., 2]
        lightness = lab[..., 0]
        return {
            "red": (((hue <= 10) | (hue >= 170)) & (saturation >= 55) & (value >= 45)),
            "orange": ((hue >= 5) & (hue <= 24) & (saturation >= 60) & (value >= 55)),
            "yellow": ((hue >= 20) & (hue <= 40) & (saturation >= 55) & (value >= 70)),
            "green": ((hue >= 35) & (hue <= 90) & (saturation >= 45) & (value >= 35)),
            "blue": ((hue >= 90) & (hue <= 140) & (saturation >= 45) & (value >= 35)),
            "purple": ((hue >= 135) & (hue <= 170) & (saturation >= 40) & (value >= 35)),
            "brown": ((hue >= 5) & (hue <= 25) & (saturation >= 45) & (value >= 25) & (value <= 190) & (lightness <= 190)),
            "white": ((saturation <= 45) & (value >= 180) & (lightness >= 180)),
            "black": ((value <= 65) & (lightness <= 75)),
            "gray": ((saturation <= 45) & (value > 65) & (value < 180)),
        }

    def _mask_color(
        self,
        image: Any,
        mask: Any,
        requested_colors: tuple[str, ...],
        minimum_fraction: float,
    ) -> tuple[bool, str]:
        total = int(mask.sum())
        if total <= 0:
            return False, "unknown"
        fractions = {
            name: float(self._np.logical_and(value, mask).sum()) / total
            for name, value in self._color_masks(image).items()
        }
        if requested_colors:
            selected = max(requested_colors, key=lambda name: fractions.get(name, 0.0))
            return fractions.get(selected, 0.0) >= minimum_fraction, selected
        selected = max(fractions, key=fractions.get)
        return True, selected if fractions[selected] >= 0.08 else "mixed"

    def infer(
        self,
        request: InferenceRequest,
        prompts: tuple[str, ...],
        requested_colors: tuple[str, ...],
        limits: OpenVocabularyLimits,
    ) -> EngineResult:
        if not self._loaded:
            raise RuntimeError("Open-vocabulary model weights are not loaded.")
        detections: list[GeoDetection] = []
        processed_scene_ids: list[str] = []
        warnings: list[str] = []
        tile_count = 0
        coverage_complete = True

        for scene in request.scenes[:limits.max_scenes]:
            try:
                with ExitStack() as stack:
                    opened = self._open_rgb(scene, stack)
                    if not opened:
                        warnings.append(f"RGB_ASSET_UNAVAILABLE:{scene.id}")
                        continue
                    base, datasets, combined = opened
                    analysis_window = self._analysis_window(base, request.location.bbox)
                    if analysis_window is None:
                        warnings.append(f"SCENE_DOES_NOT_INTERSECT_AOI:{scene.id}")
                        continue
                    raw_windows = self._tile_windows(analysis_window, limits.tile_size, limits.tile_overlap)
                    remaining = limits.max_tiles - tile_count
                    if len(raw_windows) > remaining:
                        raw_windows = raw_windows[:max(0, remaining)]
                        coverage_complete = False
                        warnings.append("PARTIAL_COVERAGE_MAX_TILES")
                    scene_processed = False
                    for column, row, width, height in raw_windows:
                        if tile_count >= limits.max_tiles or len(detections) >= limits.max_detections:
                            coverage_complete = False
                            break
                        window = self._Window(column, row, width, height)
                        image = self._read_rgb_tile(datasets, combined, window)
                        if image is None:
                            continue
                        tile_count += 1
                        scene_processed = True
                        tile_transform = self._window_transform(window, base.transform)
                        for label, score, mask in self._predict_masks(image, prompts, limits):
                            color_ok, color_name = self._mask_color(
                                image,
                                mask,
                                requested_colors,
                                limits.color_min_fraction,
                            )
                            if not color_ok:
                                continue
                            for raw_geometry, value in self._shapes(
                                mask.astype("uint8"),
                                mask=mask,
                                transform=tile_transform,
                            ):
                                if int(value) != 1:
                                    continue
                                projected = self._transform_geom(base.crs, "EPSG:4326", raw_geometry, precision=7)
                                clipped = _clip_geometry_to_bbox(projected, request.location.bbox)
                                if clipped is None:
                                    continue
                                detections.append(GeoDetection(
                                    geometry=clipped,
                                    class_name=label,
                                    color_name=color_name,
                                    score=score,
                                    scene_id=scene.id,
                                ))
                                if len(detections) >= limits.max_detections:
                                    coverage_complete = False
                                    warnings.append("DETECTION_LIMIT_REACHED")
                                    break
                            if len(detections) >= limits.max_detections:
                                break
                    if scene_processed:
                        processed_scene_ids.append(scene.id)
            except Exception as exc:
                warnings.append(f"SCENE_PROCESSING_FAILED:{scene.id}:{type(exc).__name__}")

        selected = _deduplicate_detections(detections, limits.max_detections)
        if requested_colors:
            warnings.append("BASIC_COLOR_FILTER_APPLIED")
        if selected:
            warnings.append("OPEN_VOCABULARY_CANDIDATES_REQUIRE_ANALYST_REVIEW")
        return EngineResult(
            detections=tuple(selected),
            processed_scene_ids=tuple(dict.fromkeys(processed_scene_ids)),
            coverage_complete=coverage_complete,
            warnings=tuple(dict.fromkeys(warnings))[:50],
        )


class OpenVocabularyBackend:
    name = "open-vocabulary"
    version = BACKEND_VERSION
    supported_model_ids = (SUPPORTED_MODEL_ID,)

    def __init__(self, settings: Settings, *, engine: OpenVocabularyEngine | None = None) -> None:
        self._settings = settings
        self._limits = OpenVocabularyLimits.from_settings(settings)
        self._engine = engine or TransformersGroundedSamEngine(settings)
        self._load_lock = asyncio.Lock()
        self._loaded = False
        self._load_attempted = False
        self._load_error: str | None = None

    async def load(self) -> None:
        async with self._load_lock:
            if self._loaded or self._load_attempted:
                return
            self._load_attempted = True
            try:
                await asyncio.to_thread(self._engine.load)
            except Exception as exc:
                self._load_error = type(exc).__name__
                self._loaded = False
                return
            self._loaded = True
            self._load_error = None

    async def close(self) -> None:
        close = getattr(self._engine, "close", None)
        if callable(close):
            await asyncio.to_thread(close)
        self._loaded = False

    def readiness(self) -> BackendReadiness:
        if self._loaded:
            return BackendReadiness(
                ready=True,
                inference_enabled=True,
                detail=(
                    "Grounding DINO and SAM 2.1 weights are loaded. "
                    f"The backend accepts at most {self._limits.max_tiles} RGB tiles per request."
                ),
            )
        if self._load_attempted:
            return BackendReadiness(
                ready=False,
                inference_enabled=False,
                detail=f"Open-vocabulary model loading failed ({self._load_error or 'unknown error'}).",
            )
        return BackendReadiness(
            ready=False,
            inference_enabled=False,
            detail="Open-vocabulary model weights have not been loaded.",
        )

    async def infer(self, request: InferenceRequest) -> InferenceResponse:
        if not self._loaded:
            raise RuntimeError("Open-vocabulary backend is not ready.")
        if request.model.id != SUPPORTED_MODEL_ID or request.intent != "building":
            raise BackendInputError("The open-vocabulary backend only supports grounding-dino-sam2-eo with intent=building.")
        if request.model.version != self._settings.open_vocab_model_version:
            raise BackendInputError(
                "The requested model version does not match the configured Grounding DINO and SAM 2.1 runtime."
            )
        area_km2 = _bbox_area_km2(request.location.bbox)
        if area_km2 > self._limits.max_aoi_km2:
            raise BackendInputError(
                f"The AOI is approximately {area_km2:.1f} km2; the open-vocabulary limit is {self._limits.max_aoi_km2:.1f} km2."
            )
        prompts = build_object_prompts(request.requested_objects, request.query, self._limits.max_objects)
        colors = requested_color_terms(request.requested_objects, request.query)
        started_at = datetime.now(timezone.utc)
        result = await asyncio.to_thread(self._engine.infer, request, prompts, colors, self._limits)
        completed_at = datetime.now(timezone.utc)
        requested_scene_ids = {scene.id for scene in request.scenes}
        if not result.processed_scene_ids or any(value not in requested_scene_ids for value in result.processed_scene_ids):
            raise BackendInputError("No validated RGB scene was processed by the open-vocabulary backend.")

        features = [
            GeoFeature(
                type="Feature",
                geometry=detection.geometry,
                properties={
                    "class": detection.class_name[:120],
                    "color": detection.color_name[:32],
                    "score": round(max(0.0, min(1.0, detection.score)), 6),
                    "sceneId": detection.scene_id[:500],
                },
            )
            for detection in result.detections[:self._limits.max_detections]
        ]
        if features:
            detected: bool | None = True
            outcome = "positive"
            geometry: dict[str, Any] | None = {
                "type": "FeatureCollection",
                "features": [feature.model_dump(mode="json", by_alias=True) for feature in features],
            }
            confidence = max(float(feature.properties["score"]) for feature in features)
            summary = (
                f"Grounding DINO and SAM 2.1 returned {len(features)} candidate instance(s) "
                f"for {', '.join(prompts)}. Analyst review is required."
            )
        else:
            detected = None
            outcome = "inconclusive"
            geometry = None
            confidence = None
            if result.coverage_complete:
                summary = (
                    "The open-vocabulary pipeline processed the complete bounded tile set and returned no candidates "
                    f"above the configured thresholds for {', '.join(prompts)}. This uncalibrated route cannot support an absence claim."
                )
                result = EngineResult(
                    detections=result.detections,
                    processed_scene_ids=result.processed_scene_ids,
                    coverage_complete=result.coverage_complete,
                    warnings=(*result.warnings, "NEGATIVE_NOT_CALIBRATED"),
                )
            else:
                summary = "The open-vocabulary pipeline processed only part of the requested coverage and cannot support an absence claim."

        return InferenceResponse(
            contract=CONTRACT_VERSION,
            requestId=request.request_id,
            runId=str(uuid4()),
            model=ResultModel(id=request.model.id, version=request.model.version, backend=self.name),
            detected=detected,
            outcome=outcome,
            geometry=geometry,
            confidence=confidence,
            confidenceCalibrated=False,
            summary=summary,
            warnings=list(result.warnings)[:50],
            provenance=RunProvenance(
                backend=self.name,
                backendVersion=getattr(self._engine, "version", self.version),
                modelId=request.model.id,
                sceneIds=list(result.processed_scene_ids),
                startedAt=started_at.isoformat(),
                completedAt=completed_at.isoformat(),
            ),
        )
