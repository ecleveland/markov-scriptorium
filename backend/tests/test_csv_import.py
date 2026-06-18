"""Tests for the CSV import parser/normalizer (VEG-415).

Pure text → normalized rows + per-row problems, one parser per source
(Manabox / Deckbox / Archidekt). No catalog access; column maps and the
finish/condition vocab tables are the load-bearing logic, so they're exercised
per source with realistic header rows.
"""

from __future__ import annotations

import pytest

from scriptorium.onboarding.csv_import import (
    CsvProblem,
    UnknownCsvFormat,
    detect_format,
    parse_csv,
)

# --- realistic header + row snippets per source ----------------------------

MANABOX = (
    "Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,"
    "Scryfall ID,Condition,Language\n"
    "Lightning Bolt,2x2,Double Masters 2022,117,normal,uncommon,4,bolt-2x2,near_mint,en\n"
    "Sol Ring,cmd,Commander,256,foil,uncommon,1,sol-cmd,lightly_played,en\n"
)

DECKBOX = (
    "Count,Name,Edition,Card Number,Condition,Language,Foil\n"
    "2,Counterspell,Modern Horizons 2,267,Near Mint,English,\n"
    "1,Brainstorm,Commander Legends,120,Good (Lightly Played),English,foil\n"
)

ARCHIDEKT = (
    "Quantity,Name,Finish,Condition,Language,Edition Name,Edition Code,"
    "Scryfall ID,Collector Number\n"
    "3,Llanowar Elves,Normal,NM,en,Dominaria,dom,elf-dom,168\n"
    "1,Mox Opal,Foil,LP,en,Modern Masters 2015,mm2,mox-mm2,142\n"
)


# --- detection -------------------------------------------------------------


def test_detect_each_format() -> None:
    assert detect_format(MANABOX.splitlines()[0].split(",")) == "manabox"
    assert detect_format(DECKBOX.splitlines()[0].split(",")) == "deckbox"
    assert detect_format(ARCHIDEKT.splitlines()[0].split(",")) == "archidekt"


def test_unknown_header_raises() -> None:
    with pytest.raises(UnknownCsvFormat):
        parse_csv("Foo,Bar,Baz\n1,2,3\n")


def test_declared_format_overrides_detection() -> None:
    # Manabox columns but force deckbox: parsing follows the declared spec, so
    # the (absent) deckbox columns make every row a problem rather than guessing.
    result = parse_csv(MANABOX, declared_format="deckbox")
    assert result.format == "deckbox"


# --- Manabox ---------------------------------------------------------------


def test_manabox_maps_columns_and_normalizes() -> None:
    result = parse_csv(MANABOX)
    assert result.format == "manabox"
    assert result.problems == []
    first, second = result.entries
    assert (first.name, first.quantity, first.set_code, first.collector_number) == (
        "Lightning Bolt",
        4,
        "2x2",
        "117",
    )
    assert first.scryfall_id == "bolt-2x2"
    assert first.finish == "nonfoil"  # "normal" → nonfoil
    assert first.condition == "NM"  # near_mint → NM
    assert second.finish == "foil"
    assert second.condition == "LP"  # lightly_played → LP


# --- Deckbox ---------------------------------------------------------------


def test_deckbox_maps_columns_and_normalizes() -> None:
    result = parse_csv(DECKBOX)
    assert result.format == "deckbox"
    assert result.problems == []
    counter, brainstorm = result.entries
    # Edition is a display NAME, surfaced as set_name (no code, no scryfall id).
    assert counter.set_name == "Modern Horizons 2"
    assert counter.set_code is None
    assert counter.scryfall_id is None
    assert (counter.name, counter.quantity, counter.collector_number) == (
        "Counterspell",
        2,
        "267",
    )
    assert counter.finish == "nonfoil"  # blank Foil → nonfoil
    assert counter.condition == "NM"
    assert counter.language == "en"  # "English" → en
    assert brainstorm.finish == "foil"
    assert brainstorm.condition == "LP"  # "Good (Lightly Played)" → LP


# --- Archidekt -------------------------------------------------------------


def test_archidekt_maps_columns_and_normalizes() -> None:
    result = parse_csv(ARCHIDEKT)
    assert result.format == "archidekt"
    assert result.problems == []
    elves, mox = result.entries
    assert (elves.name, elves.quantity, elves.set_code, elves.collector_number) == (
        "Llanowar Elves",
        3,
        "dom",
        "168",
    )
    assert elves.scryfall_id == "elf-dom"
    assert elves.finish == "nonfoil"  # Normal → nonfoil
    assert elves.condition == "NM"  # already short form
    assert mox.finish == "foil"
    assert mox.condition == "LP"


# --- problems (report, never drop) -----------------------------------------


def test_unmapped_condition_becomes_a_problem() -> None:
    csv_text = (
        "Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,"
        "Scryfall ID,Condition,Language\n"
        "Sol Ring,cmd,Commander,256,normal,uncommon,1,sol-cmd,pristine,en\n"
    )
    result = parse_csv(csv_text)
    assert result.entries == []
    assert len(result.problems) == 1
    assert result.problems[0].row_number == 1
    assert "pristine" in result.problems[0].reason or "condition" in result.problems[0].reason


def test_invalid_quantity_becomes_a_problem() -> None:
    csv_text = (
        "Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,"
        "Scryfall ID,Condition,Language\n"
        "Sol Ring,cmd,Commander,256,normal,uncommon,zero,sol-cmd,near_mint,en\n"
    )
    result = parse_csv(csv_text)
    assert result.entries == []
    assert len(result.problems) == 1


def test_missing_name_becomes_a_problem() -> None:
    csv_text = (
        "Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,"
        "Scryfall ID,Condition,Language\n"
        ",cmd,Commander,256,normal,uncommon,1,sol-cmd,near_mint,en\n"
    )
    result = parse_csv(csv_text)
    assert result.entries == []
    assert isinstance(result.problems[0], CsvProblem)


def test_every_data_row_is_an_entry_or_a_problem() -> None:
    csv_text = (
        "Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,"
        "Scryfall ID,Condition,Language\n"
        "Sol Ring,cmd,Commander,256,normal,uncommon,1,sol-cmd,near_mint,en\n"
        "Bad Card,cmd,Commander,1,normal,uncommon,1,bad,pristine,en\n"
    )
    result = parse_csv(csv_text)
    assert len(result.entries) + len(result.problems) == 2


def test_blank_lines_between_rows_are_ignored() -> None:
    csv_text = (
        "Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,"
        "Scryfall ID,Condition,Language\n"
        "Sol Ring,cmd,Commander,256,normal,uncommon,1,sol-cmd,near_mint,en\n"
        "\n"
        "Mana Crypt,2xm,Double Masters,270,foil,mythic,1,crypt,near_mint,en\n"
    )
    result = parse_csv(csv_text)
    assert [entry.name for entry in result.entries] == ["Sol Ring", "Mana Crypt"]
    assert result.problems == []


def test_quoted_field_with_comma_is_preserved() -> None:
    csv_text = (
        "Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,"
        "Scryfall ID,Condition,Language\n"
        '"Borrowing 100,000 Arrows",ons,Onslaught,89,normal,common,1,arrows,near_mint,en\n'
    )
    result = parse_csv(csv_text)
    assert result.entries[0].name == "Borrowing 100,000 Arrows"


def test_empty_csv_yields_nothing() -> None:
    """A header-only CSV (no data rows) yields no entries and no problems."""
    result = parse_csv(ARCHIDEKT.splitlines()[0] + "\n")
    assert result.entries == [] and result.problems == []
