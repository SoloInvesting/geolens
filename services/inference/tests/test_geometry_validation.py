from __future__ import annotations

from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from geolens_inference.geometry_validation import geometry_is_mostly_within_aoi  # noqa: E402


AOI = [0.0, 0.0, 10.0, 10.0]


def polygon(west: float, south: float, east: float, north: float) -> dict:
    return {
        "type": "Polygon",
        "coordinates": [[
            [west, south],
            [east, south],
            [east, north],
            [west, north],
            [west, south],
        ]],
    }


def test_point_must_be_inside_aoi() -> None:
    assert geometry_is_mostly_within_aoi({"type": "Point", "coordinates": [5.0, 5.0]}, AOI)
    assert not geometry_is_mostly_within_aoi({"type": "Point", "coordinates": [10.1, 5.0]}, AOI)


def test_polygon_with_most_of_its_area_inside_is_accepted() -> None:
    assert geometry_is_mostly_within_aoi(polygon(-1.0, 1.0, 4.0, 5.0), AOI)


def test_polygon_with_most_of_its_area_outside_is_rejected() -> None:
    assert not geometry_is_mostly_within_aoi(polygon(-8.0, 1.0, 2.0, 5.0), AOI)


def test_every_multipolygon_component_must_have_majority_coverage() -> None:
    geometry = {
        "type": "MultiPolygon",
        "coordinates": [
            polygon(1.0, 1.0, 2.0, 2.0)["coordinates"],
            polygon(-8.0, 1.0, 2.0, 5.0)["coordinates"],
        ],
    }
    assert not geometry_is_mostly_within_aoi(geometry, AOI)
