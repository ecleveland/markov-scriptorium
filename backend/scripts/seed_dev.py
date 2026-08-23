"""Seed a handful of cards into the local catalog for development.

Lets the Inscribe flow be exercised without the full ~500 MB Scryfall bulk
download. Safe to re-run: rows are keyed by their fake Scryfall id and upserted,
so a database seeded before a card definition changed picks the new values up.
That also means a re-run **overwrites** any hand-edit you made to a seeded row.
The set deliberately includes a name reprinted across two sets (Lightning Bolt)
so the printing picker has something to disambiguate, and a mix of
finishes/colors.

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
# The two Lightning Bolt printings share an `oracle_id`, so the catalog's
# cross-printing ownership summary exercises the real grouping path locally
# rather than its NULL-oracle_id name fallback.
_CARDS: list[dict[str, Any]] = [
    {
        "scryfall_id": "dev-bolt-lea",
        "oracle_id": "dev-oracle-lightning-bolt",
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
        "oracle_id": "dev-oracle-lightning-bolt",
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
        "oracle_id": "dev-oracle-sol-ring",
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
        "oracle_id": "dev-oracle-counterspell",
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
        "oracle_id": "dev-oracle-brainstorm",
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
        "oracle_id": "dev-oracle-llanowar-elves",
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
        "oracle_id": "dev-oracle-swords-to-plowshares",
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
        "oracle_id": "dev-oracle-edgar-charmed-groom",
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
    """Insert or refresh the dev cards; return ``(newly_added, catalog_total)``.

    Upserts rather than skipping rows that already exist. A dev database seeded
    before a card definition changed (``oracle_id`` arrived with VEG-220, for
    instance) would otherwise keep the stale row forever, and local behaviour
    would quietly diverge from a fresh clone's.
    """
    with closing(db.connect()) as conn:
        apply_migrations(conn)
        ids = [card["scryfall_id"] for card in _CARDS]
        placeholders = ", ".join("?" for _ in ids)
        present = {
            row[0]
            for row in conn.execute(
                f"SELECT scryfall_id FROM cards WHERE scryfall_id IN ({placeholders})", ids
            ).fetchall()
        }
        added = 0
        for card in _CARDS:
            row = _row(card)
            columns = ", ".join(row)
            values = ", ".join("?" for _ in row)
            assignments = ", ".join(
                f"{column} = excluded.{column}" for column in row if column != "scryfall_id"
            )
            conn.execute(
                f"INSERT INTO cards ({columns}) VALUES ({values}) "
                f"ON CONFLICT(scryfall_id) DO UPDATE SET {assignments}",
                tuple(row.values()),
            )
            if card["scryfall_id"] not in present:
                added += 1
        # FTS5 external content must be told to rebuild after direct inserts so
        # autocomplete/search can find the seeded names.
        catalog.rebuild_name_index(conn)
        conn.commit()
        total: int = conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
    return added, total


def main() -> None:
    added, total = seed()
    refreshed = len(_CARDS) - added
    print(f"Seeded {added} new card(s); catalog now holds {total}.")
    if refreshed:
        print(f"(Refreshed {refreshed} card(s) already present.)")


if __name__ == "__main__":
    main()
