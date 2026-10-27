"""Tests for picking title candidates (VEG-231, ADR 0026)."""

from __future__ import annotations

from scriptorium.scanner.title import pick_title_candidates
from tests.scanner.fakes import line


def test_top_most_tall_line_comes_first() -> None:
    rules = line("Lifelink. Whenever another Vampire enters", 0.55, height=0.03)
    type_line = line("Legendary Creature Vampire Knight", 0.45, height=0.035)
    title = line("Edgar Markov", 0.1, height=0.06)
    picked = pick_title_candidates([rules, type_line, title])
    assert picked[0] == title
    assert picked == [title, type_line, rules]


def test_taller_line_wins_a_tie_on_height_order() -> None:
    small = line("Edgar", 0.1, height=0.03)
    tall = line("Edgar Markov", 0.1, height=0.06)
    assert pick_title_candidates([small, tall]) == [tall, small]


def test_lines_with_fewer_than_three_letters_are_dropped() -> None:
    lines = [line("2", 0.12), line("123/280", 0.9), line("1R", 0.1)]
    assert pick_title_candidates(lines) == []


def test_a_mana_cost_read_alone_is_dropped() -> None:
    assert pick_title_candidates([line("3BRW", 0.1), line("{2}{U}{U}", 0.1)]) == []


def test_letters_are_counted_after_fixing_misread_digits() -> None:
    # Vision reads the O of "Opt" as a zero often enough to matter.
    misread = line("0pt", 0.1)
    assert pick_title_candidates([misread]) == [misread]
    assert pick_title_candidates([line("123/280", 0.1), line("2", 0.1)]) == []


def test_a_three_letter_title_is_kept() -> None:
    opt = line("Opt", 0.1)
    assert pick_title_candidates([opt]) == [opt]


def test_lines_centred_outside_the_middle_band_are_ignored() -> None:
    edge = line("Edgar Markov", 0.1, x=0.0, width=0.1)
    assert pick_title_candidates([edge]) == []


def test_empty_in_gives_empty_out() -> None:
    assert pick_title_candidates([]) == []


def test_at_most_three_candidates_in_order() -> None:
    lines = [line(f"Line number {i}", 0.1 * i) for i in range(5, 0, -1)]
    picked = pick_title_candidates(lines)
    assert [p.text for p in picked] == ["Line number 1", "Line number 2", "Line number 3"]
    assert pick_title_candidates(lines, max_candidates=1) == picked[:1]
