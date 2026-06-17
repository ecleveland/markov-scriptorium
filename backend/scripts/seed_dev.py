"""Seed a handful of cards into the local catalog for development.

Lets the Inscribe flow be exercised without the full ~500 MB Scryfall bulk
download. Idempotent: re-running inserts nothing new (rows are keyed by their
fake Scryfall id with ``INSERT OR IGNORE``). The set deliberately includes a
name reprinted across two sets (Lightning Bolt) so the printing picker has
something to disambiguate, and a mix of finishes/colors.

Run from the backend directory:

    uv run python scripts/seed_dev.py

Writes to the same catalog the app uses (``data/scriptorium.db`` at the repo
root, or ``SCRIPTORIUM_DB_PATH``). This is dev tooling — the real catalog comes
from the Scryfall bulk import, never hand-rolled data (see CLAUDE.md).
"""

from __future__ import annotations

import json
from contextlib import closing
from typing import Any

from scriptorium import catalog, db
from scriptorium.migrations import apply_migrations

# Required (NOT NULL) columns get sensible defaults; per-card dicts override.
_DEFAULTS: dict[str, Any] = {"lang": "en", "layout": "normal"}

# A small, varied set. `colors`/`finishes`/`image_uris` are stored as JSON text,
# matching the bulk importer; image_uris is left absent (no offline images).
_CARDS: list[dict[str, Any]] = [
    {
        "scryfall_id": "dev-bolt-lea",
        "name": "Lightning Bolt",
        "set_code": "lea",
        "set_name": "Limited Edition Alpha",
        "collector_number": "161",
        "rarity": "common",
        "colors": ["R"],
        "finishes": ["nonfoil"],
        "type_line": "Instant",
        "mana_cost": "{R}",
        "oracle_text": "Lightning Bolt deals 3 damage to any target.",
    },
    {
        "scryfall_id": "dev-bolt-2x2",
        "name": "Lightning Bolt",
        "set_code": "2x2",
        "set_name": "Double Masters 2022",
        "collector_number": "117",
        "rarity": "uncommon",
        "colors": ["R"],
        "finishes": ["nonfoil", "foil"],
        "type_line": "Instant",
        "mana_cost": "{R}",
        "oracle_text": "Lightning Bolt deals 3 damage to any target.",
    },
    {
        "scryfall_id": "dev-sol-cmd",
        "name": "Sol Ring",
        "set_code": "cmd",
        "set_name": "Commander 2011",
        "collector_number": "222",
        "rarity": "uncommon",
        "colors": [],
        "finishes": ["nonfoil"],
        "type_line": "Artifact",
        "mana_cost": "{1}",
        "oracle_text": "{T}: Add {C}{C}.",
    },
    {
        "scryfall_id": "dev-counterspell-mh2",
        "name": "Counterspell",
        "set_code": "mh2",
        "set_name": "Modern Horizons 2",
        "collector_number": "267",
        "rarity": "common",
        "colors": ["U"],
        "finishes": ["nonfoil", "foil", "etched"],
        "type_line": "Instant",
        "mana_cost": "{U}{U}",
        "oracle_text": "Counter target spell.",
    },
    {
        "scryfall_id": "dev-brainstorm-ema",
        "name": "Brainstorm",
        "set_code": "ema",
        "set_name": "Eternal Masters",
        "collector_number": "40",
        "rarity": "common",
        "colors": ["U"],
        "finishes": ["nonfoil", "foil"],
        "type_line": "Instant",
        "mana_cost": "{U}",
        "oracle_text": "Draw three cards, then put two cards from your hand on top.",
    },
    {
        "scryfall_id": "dev-llanowar-m19",
        "name": "Llanowar Elves",
        "set_code": "m19",
        "set_name": "Core Set 2019",
        "collector_number": "314",
        "rarity": "common",
        "colors": ["G"],
        "finishes": ["nonfoil", "foil"],
        "type_line": "Creature — Elf Druid",
        "mana_cost": "{G}",
        "oracle_text": "{T}: Add {G}.",
    },
    {
        "scryfall_id": "dev-swords-cmr",
        "name": "Swords to Plowshares",
        "set_code": "cmr",
        "set_name": "Commander Legends",
        "collector_number": "60",
        "rarity": "uncommon",
        "colors": ["W"],
        "finishes": ["nonfoil", "foil"],
        "type_line": "Instant",
        "mana_cost": "{W}",
        "oracle_text": "Exile target creature. Its controller gains life equal to its power.",
    },
    {
        "scryfall_id": "dev-edgar-vow",
        "name": "Edgar, Charmed Groom",
        "set_code": "vow",
        "set_name": "Innistrad: Crimson Vow",
        "collector_number": "320",
        "rarity": "mythic",
        "colors": ["B", "R", "W"],
        "finishes": ["nonfoil", "foil"],
        "type_line": "Legendary Creature — Vampire Noble",
        "mana_cost": "{2}{R}{W}{B}",
        "oracle_text": "Whenever Edgar enters or attacks, create a 1/1 white Vampire token.",
    },
]

# Columns stored as JSON text (mirrors the importer's JSON-as-TEXT convention).
_JSON_COLUMNS = ("colors", "finishes")


def _row(card: dict[str, Any]) -> dict[str, Any]:
    row = {**_DEFAULTS, **card}
    for column in _JSON_COLUMNS:
        if column in row:
            row[column] = json.dumps(row[column])
    return row


def seed() -> tuple[int, int]:
    """Insert the dev cards idempotently; return ``(newly_added, catalog_total)``."""
    with closing(db.connect()) as conn:
        apply_migrations(conn)
        added = 0
        for card in _CARDS:
            row = _row(card)
            columns = ", ".join(row)
            placeholders = ", ".join("?" for _ in row)
            cur = conn.execute(
                f"INSERT OR IGNORE INTO cards ({columns}) VALUES ({placeholders})",
                tuple(row.values()),
            )
            added += cur.rowcount
        # FTS5 external content must be told to rebuild after direct inserts so
        # autocomplete/search can find the seeded names.
        catalog.rebuild_name_index(conn)
        conn.commit()
        total: int = conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
    return added, total


def main() -> None:
    added, total = seed()
    print(f"Seeded {added} new card(s); catalog now holds {total}.")
    if added == 0:
        print("(Dev cards already present — nothing to do.)")


if __name__ == "__main__":
    main()
