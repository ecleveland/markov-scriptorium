"""Tests for frame geometry (VEG-231, ADR 0026)."""

from __future__ import annotations

import pytest

from scriptorium.scanner.ocr import Box
from scriptorium.scanner.region import title_region, to_bottom_left, to_top_left, unscale


def test_to_top_left_flips_the_vertical_origin() -> None:
    box = to_top_left(0.283, 0.848, 0.251, 0.07)
    assert box.x == pytest.approx(0.283)
    assert box.y == pytest.approx(1 - 0.918)
    assert box.width == pytest.approx(0.251)
    assert box.height == pytest.approx(0.07)


def test_title_region_is_the_top_of_the_centre_column() -> None:
    region = title_region()
    assert region.y == 0
    assert region.height == pytest.approx(0.3)
    assert 0 <= region.x < 0.5 < region.x + region.width <= 1
    # Centred, so the slack is the same on both sides.
    assert region.x == pytest.approx(1 - (region.x + region.width))


def test_title_region_widens_for_a_narrow_frame_and_clamps() -> None:
    assert title_region(4 / 3).width == pytest.approx(0.6)
    narrow = title_region(0.5)
    assert (narrow.x, narrow.width) == (0.0, 1.0)


def test_unscale_maps_a_region_relative_box_back_to_the_frame() -> None:
    # The smoke check read this box inside the region ((0.1, 0.7), (0.8, 0.3))
    # in Vision's bottom-left terms. In top-left terms the region starts at
    # y 0.0 and the box at y 1 - (0.517 + 0.182) inside it.
    region = to_top_left(0.1, 0.7, 0.8, 0.3)
    in_region = to_top_left(0.234, 0.517, 0.301, 0.182)
    box = unscale(in_region, region)
    # Vision coordinates would be about (0.287, 0.855, 0.241, 0.055).
    assert box.x == pytest.approx(0.1 + 0.234 * 0.8)
    assert box.width == pytest.approx(0.301 * 0.8)
    assert box.height == pytest.approx(0.182 * 0.3)
    assert box.y == pytest.approx(1 - ((0.7 + 0.517 * 0.3) + 0.182 * 0.3))
    assert box.x == pytest.approx(0.287, abs=1e-3)


def test_unscale_offsets_by_where_the_region_starts() -> None:
    region = Box(0.1, 0.5, 0.8, 0.3)
    box = unscale(Box(0.0, 0.5, 1.0, 0.1), region)
    assert box.y == pytest.approx(0.5 + 0.5 * region.height)
    assert box.x == pytest.approx(0.1)


def test_to_bottom_left_round_trips() -> None:
    box = Box(0.2, 0.1, 0.6, 0.3)
    (x, y), (width, height) = to_bottom_left(box)
    assert (x, y, width, height) == pytest.approx((0.2, 0.6, 0.6, 0.3))
    back = to_top_left(x, y, width, height)
    assert (back.x, back.y, back.width, back.height) == pytest.approx((0.2, 0.1, 0.6, 0.3))
