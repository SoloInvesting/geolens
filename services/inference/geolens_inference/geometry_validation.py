from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any


Point = tuple[float, float]
Bbox = Sequence[float]


def _field(value: Any, name: str) -> Any:
    if isinstance(value, dict):
        return value.get(name)
    return getattr(value, name, None)


def _position(value: Sequence[float]) -> Point:
    return float(value[0]), float(value[1])


def _ring_area(points: Sequence[Point]) -> float:
    if len(points) < 3:
        return 0.0
    return abs(
        sum(
            points[index][0] * points[(index + 1) % len(points)][1]
            - points[(index + 1) % len(points)][0] * points[index][1]
            for index in range(len(points))
        )
    ) / 2.0


def _clip_edge(
    points: list[Point],
    inside: Callable[[Point], bool],
    intersection: Callable[[Point, Point], Point],
) -> list[Point]:
    if not points:
        return []
    clipped: list[Point] = []
    previous = points[-1]
    previous_inside = inside(previous)
    for current in points:
        current_inside = inside(current)
        if current_inside:
            if not previous_inside:
                clipped.append(intersection(previous, current))
            clipped.append(current)
        elif previous_inside:
            clipped.append(intersection(previous, current))
        previous = current
        previous_inside = current_inside
    return clipped


def _vertical_intersection(start: Point, end: Point, longitude: float) -> Point:
    delta = end[0] - start[0]
    if abs(delta) < 1e-15:
        return longitude, start[1]
    fraction = (longitude - start[0]) / delta
    return longitude, start[1] + fraction * (end[1] - start[1])


def _horizontal_intersection(start: Point, end: Point, latitude: float) -> Point:
    delta = end[1] - start[1]
    if abs(delta) < 1e-15:
        return start[0], latitude
    fraction = (latitude - start[1]) / delta
    return start[0] + fraction * (end[0] - start[0]), latitude


def _clip_ring(coordinates: Sequence[Sequence[float]], bbox: Bbox) -> list[Point]:
    west, south, east, north = (float(value) for value in bbox)
    points = [_position(value) for value in coordinates]
    if len(points) > 1 and points[0] == points[-1]:
        points = points[:-1]
    points = _clip_edge(points, lambda point: point[0] >= west, lambda a, b: _vertical_intersection(a, b, west))
    points = _clip_edge(points, lambda point: point[0] <= east, lambda a, b: _vertical_intersection(a, b, east))
    points = _clip_edge(points, lambda point: point[1] >= south, lambda a, b: _horizontal_intersection(a, b, south))
    return _clip_edge(points, lambda point: point[1] <= north, lambda a, b: _horizontal_intersection(a, b, north))


def _polygon_coverage(coordinates: Sequence[Sequence[Sequence[float]]], bbox: Bbox) -> float:
    rings = [[_position(position) for position in ring] for ring in coordinates]
    if not rings:
        return 0.0
    total_area = _ring_area(rings[0]) - sum(_ring_area(ring) for ring in rings[1:])
    if total_area <= 1e-15:
        return 0.0
    clipped_area = _ring_area(_clip_ring(coordinates[0], bbox)) - sum(
        _ring_area(_clip_ring(ring, bbox)) for ring in coordinates[1:]
    )
    return min(1.0, max(0.0, clipped_area / total_area))


def geometry_is_mostly_within_aoi(
    geometry: Any,
    bbox: Bbox,
    *,
    minimum_polygon_coverage: float = 0.5,
) -> bool:
    """Require points inside the AOI and at least half of every polygon inside it."""

    geometry_type = _field(geometry, "type")
    if geometry_type == "Point":
        longitude, latitude = _position(_field(geometry, "coordinates"))
        west, south, east, north = (float(value) for value in bbox)
        return west <= longitude <= east and south <= latitude <= north
    if geometry_type == "Polygon":
        return _polygon_coverage(_field(geometry, "coordinates"), bbox) + 1e-12 >= minimum_polygon_coverage
    if geometry_type == "MultiPolygon":
        return all(
            _polygon_coverage(polygon, bbox) + 1e-12 >= minimum_polygon_coverage
            for polygon in _field(geometry, "coordinates")
        )
    if geometry_type == "FeatureCollection":
        return all(
            geometry_is_mostly_within_aoi(
                _field(feature, "geometry"),
                bbox,
                minimum_polygon_coverage=minimum_polygon_coverage,
            )
            for feature in _field(geometry, "features")
        )
    return False
