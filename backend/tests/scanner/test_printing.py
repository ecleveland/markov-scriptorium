"""Tests for reading a card's corner to pin its printing (VEG-653, ADR 0027)."""

from __future__ import annotations

import pytest

from scriptorium.scanner.ocr import TextLine
from scriptorium.scanner.printing import CornerRead, corner_region, parse_corner
from scriptorium.scanner.region import title_region
from tests.scanner.fakes import corner_line


def _parse(*texts: str) -> CornerRead | None:
    """Parse lines stacked down the card's left half in the order given."""
    return parse_corner([corner_line(text, 0.85 + i * 0.03) for i, text in enumerate(texts)])


@pytest.mark.parametrize(
    ("texts", "expected"),
    [
        (("C 0002", "FRA • EN"), CornerRead(("2", "0002"), "fra")),
        (("C 0002", "FRA•EN Randy Gallegos"), CornerRead(("2", "0002"), "fra")),
        # Vision misread the rarity letter as a digit at 14 px.
        (("2 0002", "FRA • EN"), CornerRead(("2", "0002"), "fra")),
        (("123/280", "M21 EN"), CornerRead(("123",), "m21")),
        (("R 221a", "2X2 • EN"), CornerRead(("221a",), "2x2")),
        (("R 221A", "2X2 • EN"), CornerRead(("221a",), "2x2")),
        (("U0123", "FRA · EN"), CornerRead(("123", "0123"), "fra")),
        (("U0123", "TSB • EN"), CornerRead(("123", "0123"), "tsb")),
        # The S is the rarity letter, not a 5 the digit map should restore.
        (("S0123", "TSB • EN"), CornerRead(("123", "0123"), "tsb")),
        (("M 226★", "ELD • EN"), CornerRead(("226★",), "eld")),
        (("C 63s", "M21 EN"), CornerRead(("63s",), "m21")),
        (("R 0017 / 0280", "2X2 • EN"), CornerRead(("17", "0017"), "2x2")),
        # Both corner lines run into one, with and without the rarity glued on.
        (("C 0002 FRA • EN",), CornerRead(("2", "0002"), "fra")),
        (("C0002 FRA • EN",), CornerRead(("2", "0002"), "fra")),
        # A set code with a digit is never folded into a number.
        (("U 0002", "SS1 • EN"), CornerRead(("2", "0002"), "ss1")),
        (("2024", "SS1 • EN Artist"), CornerRead(("2024",), "ss1")),
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
    assert _parse("C 1S5", "FRA • EN") == CornerRead(("155",), "fra")


def test_a_trailing_capital_is_a_suffix_before_it_is_a_misread_digit() -> None:
    assert _parse("C 01S", "FRA • EN") == CornerRead(("1s", "01s"), "fra")


def test_a_word_with_no_digit_is_never_read_as_a_number() -> None:
    # "SOIL" would map to "5011" if the map ran on every token.
    assert _parse("SOIL", "FRA • EN") is None


def test_the_digit_map_never_touches_the_set_code() -> None:
    assert _parse("C 0002", "O7E • EN") == CornerRead(("2", "0002"), "o7e")


def test_the_digit_map_never_runs_on_the_set_line() -> None:
    # Folded, "SO1" would read as 501.
    assert _parse("C 0002", "FRA • EN SO1") == CornerRead(("2", "0002"), "fra")


def test_a_set_code_on_a_line_with_no_language_mark_is_not_taken() -> None:
    assert _parse("C 0002", "FRA") is None


def test_the_language_code_is_not_a_set_code() -> None:
    assert _parse("C 0002", "EN • FRA") == CornerRead(("2", "0002"), "fra")


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
    assert _parse("2024", "C 0002", "FRA • EN") == CornerRead(("2", "2024", "0002"), "fra")


def test_a_rarity_misread_as_a_digit_still_anchors_the_number() -> None:
    assert _parse("2024", "2 0002", "FRA • EN") == CornerRead(("2", "2024", "0002"), "fra")


def test_a_number_with_its_set_size_ranks_before_a_bare_one() -> None:
    assert _parse("2024", "17/280", "M21 EN") == CornerRead(("17", "2024"), "m21")


def test_a_bare_number_alone_is_still_a_candidate() -> None:
    assert _parse("117", "2X2 • EN") == CornerRead(("117",), "2x2")


def test_every_stripped_number_comes_before_any_as_read_form() -> None:
    assert _parse("0045", "0007", "C 0002", "FRA • EN") == CornerRead(("2", "45", "7"), "fra")


def test_the_candidates_stop_at_three_without_repeats() -> None:
    lines = ("C 0002", "U 0002", "2024", "0031", "FRA • EN")
    assert _parse(*lines) == CornerRead(("2", "2024", "31"), "fra")


# --- where the lines sit ------------------------------------------------------


def _right(text: str, y: float) -> TextLine:
    # The power and toughness box and the copyright line sit right of centre.
    return corner_line(text, y, x=0.6, width=0.05)


def test_lines_right_of_centre_never_give_the_number() -> None:
    lines = [
        # Rules text is set across the middle of the card.
        corner_line("a 1/1 white Soldier", 0.80, x=0.36, width=0.3),
        _right("2/2", 0.82),
        _right("4/4", 0.84),
        corner_line("C 0123", 0.88),
        corner_line("MOM • EN", 0.91),
    ]
    assert parse_corner(lines) == CornerRead(("123", "0123"), "mom")


def test_a_set_size_shape_on_the_left_ranks_after_the_number_above_it() -> None:
    lines = [corner_line("C 0123", 0.88), corner_line("2/2", 0.90), corner_line("MOM • EN", 0.92)]
    assert parse_corner(lines) == CornerRead(("123", "2", "0123"), "mom")


def test_a_line_centred_on_the_middle_is_right_of_centre() -> None:
    lines = [corner_line("C 0002", 0.88, x=0.45, width=0.1), corner_line("FRA • EN", 0.91)]
    assert parse_corner(lines) is None


def test_the_ranking_follows_where_lines_sit_not_the_order_read() -> None:
    lines = [
        corner_line("FRA • EN", 0.95),
        corner_line("0045", 0.92),
        corner_line("0031", 0.90, x=0.3),
        corner_line("0007", 0.90, x=0.2),
        corner_line("C 0002", 0.86),
    ]
    assert parse_corner(lines) == CornerRead(("2", "7", "31"), "fra")


def test_the_corner_region_shares_the_title_column_at_the_bottom() -> None:
    for aspect in (4 / 3, 16 / 9):
        corner, title = corner_region(aspect), title_region(aspect)
        assert corner.y == 0.78
        # One minus the top carries float error, so the depth is compared loosely.
        assert corner.height == pytest.approx(0.22)
        assert corner.y + corner.height == pytest.approx(1.0)
        assert (corner.x, corner.width) == (title.x, title.width)
    assert corner_region() == corner_region(4 / 3)
