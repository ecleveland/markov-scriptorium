"""Tests for the decklist text parser (VEG-414).

The parser is pure text — no catalog, no I/O — so these are fast unit tests of
the grammar: quantities, printing pins, comments, blank lines, section headers,
foil markers, and the per-line problem reports that ensure no line is dropped.
"""

from __future__ import annotations

import pytest

from scriptorium.onboarding.decklist import (
    ParsedLine,
    ParseProblem,
    parse_decklist,
)


def test_parsed_line_rejects_non_positive_quantity() -> None:
    """The quantity>=1 invariant is total, not only enforced on the parse path."""
    with pytest.raises(ValueError):
        ParsedLine(line_number=1, name="Forest", quantity=0)


def test_quantity_and_name() -> None:
    result = parse_decklist("4 Lightning Bolt")
    assert result.problems == []
    assert result.entries == [ParsedLine(line_number=1, name="Lightning Bolt", quantity=4)]


def test_bare_name_defaults_to_quantity_one() -> None:
    (entry,) = parse_decklist("Sol Ring").entries
    assert entry.quantity == 1
    assert entry.name == "Sol Ring"


def test_x_suffix_quantity_variants() -> None:
    for line in ("4x Lightning Bolt", "4X Lightning Bolt", "4 x Lightning Bolt"):
        (entry,) = parse_decklist(line).entries
        assert entry == ParsedLine(line_number=1, name="Lightning Bolt", quantity=4), line


def test_set_pin_in_parens() -> None:
    (entry,) = parse_decklist("4 Lightning Bolt (2X2)").entries
    assert entry.name == "Lightning Bolt"
    assert entry.set_code == "2X2"
    assert entry.collector_number is None


def test_set_pin_with_collector_number() -> None:
    (entry,) = parse_decklist("4 Lightning Bolt (2X2) 117").entries
    assert entry.name == "Lightning Bolt"
    assert entry.set_code == "2X2"
    assert entry.collector_number == "117"


def test_collector_number_with_letters() -> None:
    (entry,) = parse_decklist("1 Hangarback Walker (SLD) 123a").entries
    assert entry.set_code == "SLD"
    assert entry.collector_number == "123a"


def test_split_card_name_is_preserved() -> None:
    """A split/MDFC name carries '//' mid-line; it is not a comment or a pin."""
    (entry,) = parse_decklist("2 Fire // Ice").entries
    assert entry.name == "Fire // Ice"
    assert entry.set_code is None


def test_blank_and_comment_lines_are_skipped() -> None:
    text = "\n".join(
        [
            "# My burn deck",
            "",
            "4 Lightning Bolt",
            "   ",
            "// a note",
            "2 Shock",
        ]
    )
    result = parse_decklist(text)
    assert result.problems == []
    assert [(e.name, e.quantity) for e in result.entries] == [
        ("Lightning Bolt", 4),
        ("Shock", 2),
    ]


def test_inline_hash_comment_is_stripped() -> None:
    (entry,) = parse_decklist("4 Lightning Bolt  # a playset").entries
    assert entry.name == "Lightning Bolt"
    assert entry.quantity == 4


def test_section_headers_are_skipped() -> None:
    text = "\n".join(
        [
            "Deck",
            "4 Lightning Bolt",
            "Sideboard:",
            "2 Pyroblast",
            "Commander",
            "1 Krenko, Mob Boss",
        ]
    )
    result = parse_decklist(text)
    assert result.problems == []
    assert [e.name for e in result.entries] == [
        "Lightning Bolt",
        "Pyroblast",
        "Krenko, Mob Boss",
    ]


def test_header_lookalike_card_name_is_not_swallowed() -> None:
    """A real card whose name starts with a header word stays a card, not a header."""
    (entry,) = parse_decklist("1 Commander's Sphere").entries
    assert entry.name == "Commander's Sphere"
    assert entry.quantity == 1


def test_empty_parens_carry_no_set_code() -> None:
    """A whitespace-only "( )" is no pin: set_code is None, not the empty string."""
    (entry,) = parse_decklist("4 Lightning Bolt (   )").entries
    assert entry.name == "Lightning Bolt"
    assert entry.set_code is None
    assert entry.collector_number is None


def test_foil_marker_is_stripped() -> None:
    (entry,) = parse_decklist("4 Lightning Bolt (2X2) 117 *F*").entries
    assert entry.set_code == "2X2"
    assert entry.collector_number == "117"


def test_line_numbers_track_original_lines() -> None:
    text = "\n".join(["# header", "", "4 Lightning Bolt", "", "2 Shock"])
    nums = [e.line_number for e in parse_decklist(text).entries]
    assert nums == [3, 5]


def test_quantity_without_name_is_a_problem() -> None:
    for bad in ("4", "4x", "12 x"):
        result = parse_decklist(bad)
        assert result.entries == []
        assert len(result.problems) == 1
        assert result.problems[0].line_number == 1
        assert result.problems[0].text == bad


def test_zero_quantity_is_a_problem() -> None:
    result = parse_decklist("0 Forest")
    assert result.entries == []
    assert result.problems[0].reason


def test_problems_and_entries_account_for_every_card_line() -> None:
    """Invariant: each non-blank/comment/header line is exactly one entry or problem."""
    text = "\n".join(
        [
            "# notes",  # comment   -> skipped
            "",  # blank             -> skipped
            "Sideboard",  # header   -> skipped
            "4 Lightning Bolt",  # entry
            "4",  # problem (no name)
            "Sol Ring",  # entry
        ]
    )
    result = parse_decklist(text)
    assert len(result.entries) == 2
    assert len(result.problems) == 1
    assert isinstance(result.problems[0], ParseProblem)


def test_empty_text_yields_nothing() -> None:
    result = parse_decklist("")
    assert result.entries == [] and result.problems == []
