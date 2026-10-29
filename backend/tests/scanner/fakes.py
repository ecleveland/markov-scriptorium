"""Test doubles for the recognition pipeline (VEG-231, VEG-653, ADR 0026, ADR 0027).

FakeOcr answers from canned lines, so pipeline and API tests never touch a
real engine. A read of the bottom of the frame answers with the corner lines.
The catalog helpers seed a throwaway SQLite file the same way test_cards_api
does.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing

from scriptorium import db
from scriptorium.migrations import apply_migrations
from scriptorium.scanner.ocr import Box, TextLine

_REQUIRED_DEFAULTS = {
    "set_code": "tst",
    "set_name": "Test Set",
    "collector_number": "1",
    "rarity": "common",
    "lang": "en",
    "layout": "normal",
}


def line(
    text: str,
    y: float,
    *,
    x: float = 0.3,
    width: float = 0.4,
    height: float = 0.05,
    confidence: float = 1.0,
) -> TextLine:
    return TextLine(text=text, confidence=confidence, box=Box(x, y, width, height))


class FakeOcr:
    """An engine that returns canned lines and records how it was asked."""

    name = "fake"

    def __init__(
        self,
        upright: list[TextLine],
        upside_down: list[TextLine] | None = None,
        full_frame: list[TextLine] | None = None,
        *,
        corner: list[TextLine] | None = None,
        raise_: Exception | None = None,
        corner_raise: Exception | None = None,
    ) -> None:
        self.upright = upright
        self.upside_down = upside_down or []
        self.full_frame = full_frame or []
        self.corner = corner or []
        self.raise_ = raise_
        self.corner_raise = corner_raise
        self.calls: list[tuple[bool, Box | None]] = []
        self.images: list[bytes] = []

    def read_lines(
        self, image: bytes, *, upside_down: bool = False, region: Box | None = None
    ) -> list[TextLine]:
        self.calls.append((upside_down, region))
        self.images.append(image)
        if self.raise_ is not None:
            raise self.raise_
        # Checked before the turn, so an upside-down corner read gets the
        # corner lines and never the title's.
        if region is not None and region.y >= 0.5:
            if self.corner_raise is not None:
                raise self.corner_raise
            return self.corner
        if upside_down:
            return self.upside_down
        if region is None:
            return self.full_frame
        return self.upright


def insert_card(
    conn: sqlite3.Connection,
    scryfall_id: str,
    name: str,
    *,
    faces: tuple[str, ...] = (),
    **overrides: object,
) -> None:
    cols = {"scryfall_id": scryfall_id, "name": name, **_REQUIRED_DEFAULTS, **overrides}
    placeholders = ", ".join("?" for _ in cols)
    conn.execute(
        f"INSERT INTO cards ({', '.join(cols)}) VALUES ({placeholders})",
        tuple(cols.values()),
    )
    for index, face in enumerate(faces):
        conn.execute(
            "INSERT INTO card_faces (scryfall_id, face_index, name) VALUES (?, ?, ?)",
            (scryfall_id, index, face),
        )


def seed_catalog(*cards: tuple[str, str] | tuple[str, str, dict[str, object]]) -> None:
    """Migrate the catalog at SCRIPTORIUM_DB_PATH and insert the given cards.

    Each card is ``(scryfall_id, name)`` or ``(scryfall_id, name, overrides)``,
    where overrides may carry ``faces`` and any cards column.
    """
    with closing(db.connect()) as conn:
        apply_migrations(conn)
        for card in cards:
            extra: dict[str, object] = dict(card[2]) if len(card) == 3 else {}
            faces = extra.pop("faces", ())
            assert isinstance(faces, tuple)
            insert_card(conn, card[0], card[1], faces=faces, **extra)
        conn.commit()
