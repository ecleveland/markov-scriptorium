"""Fuzzy match OCR text against card names in the catalog (VEG-231, ADR 0026).

The index holds every card name and every face name, folded so the slips OCR
makes most often read as the same letters. A face maps back to its card's full
``cards.name``, because the browser's printing picker filters on the exact
full name, "Front // Back" included.
"""

from __future__ import annotations

import sqlite3
import threading
import unicodedata
from contextlib import closing

from rapidfuzz import fuzz, process

from scriptorium import db
from scriptorium.scryfall.refresh import read_status

# Art series cards are not playable cards, and their names repeat the real
# card's name on both faces, so they are left out.
_NAMES_SQL = """
SELECT DISTINCT name AS key, name AS full_name, layout FROM cards
WHERE layout <> 'art_series'
UNION
SELECT DISTINCT f.name, c.name, c.layout FROM card_faces f
JOIN cards c ON c.scryfall_id = f.scryfall_id
WHERE c.layout <> 'art_series'
"""

# A token can share a name with a card's face (the Insectile Aberration token
# and Delver's back face). The card is what a collector scans far more often,
# so a key with any card name drops its token names.
_TOKEN_LAYOUTS = frozenset({"token", "double_faced_token", "emblem"})

# Vision misreads thin strokes as each other and runs letters together, so
# both the catalog and the OCR text fold these to one spelling.
_CHAR_FOLDS = str.maketrans({"i": "l", "1": "l", "|": "l", "!": "l", "0": "o", "5": "s"})

# rapidfuzz scores 0 to 100. Under 60 a match is noise.
_SCORE_CUTOFF = 60


def fold(text: str) -> str:
    """Reduce a name or an OCR line to the letters a fuzzy match compares."""
    decomposed = unicodedata.normalize("NFKD", text)
    bare = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    # NFKD leaves the ligature whole, and Aether cards are often printed with it.
    lowered = bare.replace("æ", "ae").replace("Æ", "ae").casefold()
    folded = lowered.translate(_CHAR_FOLDS).replace("rn", "m").replace("vv", "w")
    return "".join(ch for ch in folded if ch.isalnum())


def _variants(text: str) -> list[str]:
    """The text and the trims of it worth matching, folded and deduplicated.

    OCR often runs the mana cost or the edge of the art onto the end of the
    title, and can pick up a stray mark before it. The trims drop up to three
    trailing words, with and without a leading one-letter speck. No trim
    leaves fewer than two words, so a short name is never matched from one
    word cut out of a longer line. The text as read is always tried.
    """
    tokens = text.split()
    bases = [tokens]
    if tokens and len(tokens[0]) == 1:
        bases.append(tokens[1:])
    candidates = [text]
    for base in bases:
        for drop in (0, 1, 2, 3):
            kept = base[: len(base) - drop]
            if len(kept) >= 2:
                candidates.append(" ".join(kept))
    folded = (fold(c) for c in candidates)
    return list(dict.fromkeys(f for f in folded if f))


class NameIndex:
    """Folded name keys and the full card names each one stands for.

    A key can stand for several names. "Lightning Bolt" is both its own card
    and the face of the reversible "Lightning Bolt // Lightning Bolt", and the
    picker reaches each one's printings only by its exact full name.
    """

    def __init__(self, entries: dict[str, list[str]]) -> None:
        self._keys = list(entries)
        self._names = list(entries.values())

    def match(self, text: str, *, limit: int = 10) -> list[tuple[str, float]]:
        """Card names that ``text`` could be, with a 0 to 1 score, best first.

        Plain ``ratio`` compares whole strings. Partial scorers would score a
        short name such as "Opt" as a perfect hit inside "Optimus Prime, Hero".
        """
        if not self._keys:
            return []
        best: dict[str, float] = {}
        for query in _variants(text):
            hits = process.extract(
                query, self._keys, scorer=fuzz.ratio, limit=limit, score_cutoff=_SCORE_CUTOFF
            )
            for _key, score, position in hits:
                for name in self._names[position]:
                    best[name] = max(best.get(name, 0.0), score / 100)
        ranked = sorted(best.items(), key=lambda item: (-item[1], item[0]))
        return ranked[:limit]


def _build(conn: sqlite3.Connection) -> NameIndex:
    # For each folded key, every full name behind it and whether it is only
    # ever a token.
    grouped: dict[str, dict[str, bool]] = {}
    for row in conn.execute(_NAMES_SQL):
        key = fold(row[0])
        if not key:
            continue
        names = grouped.setdefault(key, {})
        is_token = row[2] in _TOKEN_LAYOUTS
        names[row[1]] = names.get(row[1], True) and is_token
    entries: dict[str, list[str]] = {}
    for key, names in grouped.items():
        cards = [name for name, is_token in names.items() if not is_token]
        entries[key] = sorted(cards or names)
    return NameIndex(entries)


_CacheKey = tuple[str, str | None, int]

_lock = threading.Lock()
_cached: tuple[_CacheKey, NameIndex] | None = None


def name_index() -> NameIndex:
    """The index for the current catalog, rebuilt when the catalog changes.

    An import stamps ``imported_at`` and usually moves the card count. The
    count also catches cards written without an import, and the path keeps
    two catalog files apart.
    """
    global _cached
    with _lock, closing(db.connect()) as conn:
        status = read_status(conn)
        count = int(conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0])
        key: _CacheKey = (str(db.db_path()), status.imported_at if status else None, count)
        if _cached is not None and _cached[0] == key:
            return _cached[1]
        index = _build(conn)
        _cached = (key, index)
        return index


def invalidate() -> None:
    """Drop the cached index so the next call reads the catalog again."""
    global _cached
    with _lock:
        _cached = None
