-- 0004_cards_fts — full-text card-name search index (VEG-215, ADR 0008).
--
-- A trigram FTS5 index over cards.name backs fuzzy/substring search and
-- autocomplete (GET /cards/search, /cards/autocomplete) without the leading-
-- wildcard table scan a plain LIKE '%q%' would force.
--
-- External content (content='cards'): the FTS index stores no copy of the name,
-- reading it from `cards` via the shared rowid. It is repopulated in one shot by
-- the bulk importer after each full-replace load (`INSERT INTO
-- cards_fts(cards_fts) VALUES('rebuild')`) rather than by per-row triggers —
-- triggers would fire ~110k times per refresh, and the migration runner forbids
-- the BEGIN/END trigger body anyway. See catalog.rebuild_name_index().
--
-- Trigram matching needs >=3-character query terms; shorter queries fall back to
-- a prefix/substring LIKE in the query layer (see catalog.py).

CREATE VIRTUAL TABLE cards_fts USING fts5(
    name,
    content = 'cards',
    content_rowid = 'rowid',
    tokenize = 'trigram'
);
