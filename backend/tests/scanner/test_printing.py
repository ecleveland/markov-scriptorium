"""Tests for reading a card's corner to pin its printing (VEG-653, ADR 0027)."""

from __future__ import annotations

import pytest

from scriptorium.scanner.printing import CornerRead, corner_region, parse_corner
from scriptorium.scanner.region import title_region
from tests.scanner.fakes import line


def _parse(*texts: str) -> CornerRead | None:
    return parse_corner([line(text, 0.9 + i * 0.03) for i, text in enumerate(texts)])


@pytest.mark.parametrize(
    ("texts", "expected"),
    [
        (("C 0002", "FRA • EN"), CornerRead(("2", "0002"), "fra")),
        (("C 0002", "FRA•EN Randy Gallegos"), CornerRead(("2", "0002"), "fra")),
        # Vision misread the rarity letter as a digit at 14 px.
        (("2 0002", "FRA • EN"), CornerRead(("2", "0002"), "fra")),
        (("123/280", "M21 EN"), CornerRead(("123",), "m21")),
        (("R 221a", "2X2 • EN"), CornerRead(("221a",), "2x2")),
        (("U0123", "FRA · EN"), CornerRead(("123", "0123"), "fra")),
        (("M 226★", "ELD • EN"), CornerRead(("226★",), "eld")),
        (("C 63s", "M21 EN"), CornerRead(("63s",), "m21")),
        (("R 0017 / 0280", "2X2 • EN"), CornerRead(("17", "0017"), "2x2")),
    ],
)
def test_the_corner_lines_read_to_a_number_and_a_set(
    texts: tuple[str, ...], expected: CornerRead
) -> None:
    assert _parse(*texts) == expected


def test_the_set_line_can_come_first() -> None:
    assert _parse("FRA • EN", "C 0002") == CornerRead(("2", "0002"), "fra")


def test_an_artist_alone_reads_as_nothing() -> None:
    assert _parse("Randy Gallegos") is None


def test_a_set_line_without_a_number_reads_as_nothing() -> None:
    assert _parse("FRA • EN") is None


def test_a_number_without_a_set_line_reads_as_nothing() -> None:
    assert _parse("C 0002") is None


def test_no_lines_read_as_nothing() -> None:
    assert parse_corner([]) is None


def test_a_five_digit_run_is_not_a_collector_number() -> None:
    assert _parse("C 00002", "FRA • EN") is None
    assert _parse("12345", "FRA • EN") is None


def test_an_all_zero_number_is_not_a_collector_number() -> None:
    assert _parse("C 0000", "FRA • EN") is None


def test_letters_misread_inside_the_number_turn_back_into_digits() -> None:
    assert _parse("C O0O2", "FRA • EN") == CornerRead(("2", "0002"), "fra")
    assert _parse("C 0l2I", "FRA • EN") == CornerRead(("121", "0121"), "fra")
    assert _parse("C 01S", "FRA • EN") == CornerRead(("15", "015"), "fra")


def test_a_word_with_no_digit_is_never_read_as_a_number() -> None:
    # "SOIL" would map to "5011" if the map ran on every token.
    assert _parse("SOIL", "FRA • EN") is None


def test_the_digit_map_never_touches_the_set_code() -> None:
    assert _parse("C 0002", "O7E • EN") == CornerRead(("2", "0002"), "o7e")


def test_a_set_code_on_a_line_with_no_language_mark_is_not_taken() -> None:
    assert _parse("C 0002", "FRA") is None


def test_the_language_code_is_not_a_set_code() -> None:
    assert _parse("C 0002", "EN • FRA") == CornerRead(("2", "0002"), "fra")


def test_both_corner_lines_merged_into_one_still_read() -> None:
    assert _parse("C 0002 FRA • EN") == CornerRead(("2", "0002"), "fra")


def test_a_set_code_needs_a_letter() -> None:
    # No set code is all digits, so an all-digit token beside "EN" is a number.
    assert _parse("C 0002", "123 • EN") is None


@pytest.mark.parametrize(
    "copyright_line",
    [
        "™ & © 2024 Wizards of the Coast",
        "© 2024",
        "™ 2024",
        "(TM) 2024",
        "2024 WIZARDS OF THE COAST",
    ],
)
def test_the_copyright_line_never_gives_the_number(copyright_line: str) -> None:
    assert _parse(copyright_line, "C 0002", "FRA • EN") == CornerRead(("2", "0002"), "fra")
    assert _parse(copyright_line, "FRA • EN") is None


def test_a_lone_year_ranks_behind_the_number_beside_its_rarity() -> None:
    # Vision can split the legal line so its year arrives first on a line of
    # its own. The number beside its rarity letter still comes first.
    assert _parse("2024", "C 0002", "FRA • EN") == CornerRead(("2", "0002", "2024"), "fra")


def test_a_number_with_its_set_size_ranks_before_a_bare_one() -> None:
    assert _parse("2024", "17/280", "M21 EN") == CornerRead(("17", "2024"), "m21")


def test_a_bare_number_alone_is_still_a_candidate() -> None:
    assert _parse("117", "2X2 • EN") == CornerRead(("117",), "2x2")


def test_the_candidates_stop_at_three_without_repeats() -> None:
    lines = ("C 0002", "U 0002", "2024", "0031", "FRA • EN")
    assert _parse(*lines) == CornerRead(("2", "0002", "2024"), "fra")


def test_the_corner_region_shares_the_title_column_at_the_bottom() -> None:
    for aspect in (4 / 3, 16 / 9):
        corner, title = corner_region(aspect), title_region(aspect)
        assert corner.y == 0.78
        # One minus the top carries float error, so the depth is compared loosely.
        assert corner.height == pytest.approx(0.22)
        assert corner.y + corner.height == pytest.approx(1.0)
        assert (corner.x, corner.width) == (title.x, title.width)
    assert corner_region() == corner_region(4 / 3)
