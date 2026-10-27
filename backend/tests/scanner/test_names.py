"""Tests for the fuzzy name index (VEG-231, ADR 0026).

Each test seeds its own catalog file, and the index is dropped afterwards so
no test sees another's names.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import closing
from pathlib import Path

import pytest

from scriptorium import db
from scriptorium.scanner.names import _variants, fold, invalidate, name_index
from tests.scanner.fakes import insert_card, seed_catalog

DELVER = "Delver of Secrets // Insectile Aberration"


@pytest.fixture(autouse=True)
def catalog(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(tmp_path / "catalog.db"))
    seed_catalog(
        ("edgar", "Edgar Markov"),
        (
            "delver",
            DELVER,
            {"layout": "transform", "faces": ("Delver of Secrets", "Insectile Aberration")},
        ),
        ("fire-ice", "Fire // Ice", {"layout": "split", "faces": ("Fire", "Ice")}),
        ("opt", "Opt"),
        ("optimus", "Optimus Prime, Hero"),
        ("bolt", "Lightning Bolt"),
        ("elves", "Llanowar Elves"),
        ("arrows", "Borrowing 100,000 Arrows"),
        ("probe", "Gitaxian Probe"),
        (
            "edgar-art",
            "Edgar Markov // Edgar Markov",
            {"layout": "art_series", "faces": ("Edgar Markov", "Edgar Markov")},
        ),
        ("vampire-token", "Vampire", {"layout": "token"}),
    )
    invalidate()
    yield
    invalidate()


def _best(text: str) -> tuple[str, float]:
    return name_index().match(text)[0]


def _names(text: str) -> list[str]:
    return [name for name, _ in name_index().match(text)]


def _execute(sql: str, params: tuple[object, ...] = ()) -> None:
    with closing(db.connect()) as conn:
        conn.execute(sql, params)
        conn.commit()


def test_fold_reads_common_ocr_slips_as_the_same_letters() -> None:
    assert fold("Lightning Boit") == fold("Lightning Bolt")
    assert fold("Uanowar EIves") == fold("Uanowar Elves")
    assert fold("Thorn") == fold("Thom")


def test_fold_drops_accents_case_and_punctuation() -> None:
    assert fold("Æther Vial") == fold("aether vial")
    assert fold("Séance") == fold("seance")
    assert fold("Optimus Prime, Hero") == fold("optimus prime hero")


def test_fold_keeps_digits_in_names() -> None:
    assert fold("Borrowing 100,000 Arrows") == fold("Borrowing 100000 Arrows")
    assert fold("Borrowing 100,000 Arrows") != fold("Borrowing Arrows")


def test_exact_title_with_a_trailing_mana_cost_scores_one() -> None:
    assert _best("Edgar Markov 3BRW") == ("Edgar Markov", 1.0)


def test_a_misread_first_letter_still_matches() -> None:
    name, score = _best("Uanowar Elves")
    assert name == "Llanowar Elves"
    assert score > 0.85


def test_an_l_read_for_an_i_matches_exactly() -> None:
    assert _best("Gitaxlan Probe") == ("Gitaxian Probe", 1.0)


def test_a_leading_stray_letter_is_dropped() -> None:
    assert _best("i Edgar Markov") == ("Edgar Markov", 1.0)


def test_a_name_with_digits_matches_itself() -> None:
    assert _best("Borrowing 100,000 Arrows") == ("Borrowing 100,000 Arrows", 1.0)


def test_a_back_face_returns_the_full_card_name() -> None:
    assert _best("Insectile Aberration") == (DELVER, 1.0)


def test_a_front_face_returns_the_full_card_name() -> None:
    assert _best("Delver of Secrets") == (DELVER, 1.0)


def test_a_split_half_returns_the_full_card_name() -> None:
    assert _best("Ice") == ("Fire // Ice", 1.0)


def test_art_series_cards_never_appear() -> None:
    assert "Edgar Markov // Edgar Markov" not in _names("Edgar Markov")
    assert "Edgar Markov // Edgar Markov" not in _names("Edgar Markov // Edgar Markov")


def test_a_short_name_does_not_match_a_long_one_sharing_its_start() -> None:
    assert "Optimus Prime, Hero" not in _names("Opt")
    assert _best("Opt") == ("Opt", 1.0)


def test_tokens_stay_matchable() -> None:
    assert _best("Vampire") == ("Vampire", 1.0)


def test_a_card_wins_a_folded_key_shared_with_a_token() -> None:
    _execute(
        "INSERT INTO cards (scryfall_id, name, set_code, set_name, collector_number, rarity, "
        "lang, layout) VALUES ('ia-token', 'Insectile Aberration', 'tst', 'Test', '1', "
        "'common', 'en', 'token')"
    )
    assert _best("Insectile Aberration") == (DELVER, 1.0)
    assert "Insectile Aberration" not in _names("Insectile Aberration")


def test_tokens_sharing_a_key_with_no_card_all_stay() -> None:
    with closing(db.connect()) as conn:
        insert_card(
            conn,
            "vampire-blood",
            "Vampire // Blood",
            layout="double_faced_token",
            faces=("Vampire", "Blood"),
        )
        conn.commit()
    assert name_index().match("Vampire")[:2] == [("Vampire", 1.0), ("Vampire // Blood", 1.0)]


def test_a_reversible_card_and_its_plain_printing_both_match() -> None:
    # The picker filters on the exact full name, so each name reaches its own
    # printings. Losing either would make those printings unscannable.
    with closing(db.connect()) as conn:
        insert_card(
            conn,
            "bolt-reversible",
            "Lightning Bolt // Lightning Bolt",
            layout="reversible_card",
            faces=("Lightning Bolt", "Lightning Bolt"),
        )
        conn.commit()
    assert name_index().match("Lightning Bolt")[:2] == [
        ("Lightning Bolt", 1.0),
        ("Lightning Bolt // Lightning Bolt", 1.0),
    ]


def test_a_leading_speck_and_a_trailing_cost_are_both_trimmed() -> None:
    assert _best("x Edgar Markov 2RB") == ("Edgar Markov", 1.0)


def test_no_trim_leaves_a_single_word() -> None:
    assert _variants("a Fog") == [fold("a Fog")]
    assert fold("Edgar") not in _variants("x Edgar Markov")


def test_scores_are_between_zero_and_one_best_first() -> None:
    for text in ("Edgar Markov", "Lightnlng", "Uanowar Elves", "Fire Ice", "Opt"):
        scores = [score for _, score in name_index().match(text)]
        assert all(0 <= s <= 1 for s in scores)
        assert scores == sorted(scores, reverse=True)


def test_each_name_appears_once() -> None:
    found = _names("Edgar Markov 3BRW")
    assert len(found) == len(set(found))


def test_garbage_matches_nothing() -> None:
    assert name_index().match("zzqqxj wpvk") == []


def test_an_empty_catalog_matches_nothing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(tmp_path / "empty.db"))
    seed_catalog()
    assert name_index().match("Edgar Markov") == []


def test_the_index_is_cached_while_the_catalog_is_unchanged() -> None:
    assert name_index() is name_index()


def test_the_index_rebuilds_when_the_card_count_changes() -> None:
    assert _best("Sorin Markov")[0] != "Sorin Markov"
    with closing(db.connect()) as conn:
        insert_card(conn, "sorin", "Sorin Markov")
        conn.commit()
    assert _best("Sorin Markov") == ("Sorin Markov", 1.0)


def test_the_index_rebuilds_when_an_import_lands() -> None:
    _execute("INSERT INTO scryfall_refresh (id, imported_at) VALUES (1, '2026-10-26T00:00:00Z')")
    before = name_index()
    # A rename keeps the count, so only the new import stamp can force the rebuild.
    _execute("UPDATE cards SET name = 'Sorin Markov' WHERE scryfall_id = 'edgar'")
    assert name_index() is before
    _execute("UPDATE scryfall_refresh SET imported_at = '2026-10-27T00:00:00Z' WHERE id = 1")
    assert name_index() is not before
    assert _best("Sorin Markov") == ("Sorin Markov", 1.0)


def test_two_catalog_files_get_their_own_index(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    first = name_index()
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(tmp_path / "other.db"))
    seed_catalog(*((f"c{i}", f"Card {i}") for i in range(11)))
    # Same card count as the main catalog, so only the path tells them apart.
    second = name_index()
    assert second is not first
    assert _best("Card 3") == ("Card 3", 1.0)


def test_invalidate_forces_a_rebuild() -> None:
    before = name_index()
    _execute("UPDATE cards SET name = 'Sorin Markov' WHERE scryfall_id = 'edgar'")
    invalidate()
    assert name_index() is not before
    assert _best("Sorin Markov") == ("Sorin Markov", 1.0)
