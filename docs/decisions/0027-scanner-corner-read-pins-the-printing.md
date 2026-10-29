# 0027 Scanner corner read pins the printing

**Status:** accepted (2026-10-29)

Resolves [VEG-653] and extends [ADR 0026](0026-scanner-recognition-engine-and-name-match.md)
and the [ADR 0025](0025-scanner-capture-and-recognition-contract.md) contract.
Decides when the scanner reads the collector number and set code off a card,
how it parses them, and when that read is allowed to name the exact printing.

[VEG-653]: https://linear.app/cleveland-family-enterprises/issue/VEG-653

---

## Decision

**The corner sharpens the name read and never replaces it.** The title read
from ADR 0026 gives a card, and the user then picks the printing by hand.
Modern cards print the collector number and set code in the bottom-left
corner, and the catalog already indexes `cards` on `(set_code,
collector_number)`. The 0002 migration added that index with scanner
disambiguation in mind. Reading the corner can hand the page the exact
printing. The name stays the primary evidence.

**A fourth read, only after a confident name.** After the three title passes,
the pipeline checks the best reading against the accept bar of 0.80. At or
above it, the pipeline reads the corner region once more. The region takes
the same centre column as the title region, across the bottom 22 percent of
the frame. The read uses the orientation of the pass that won, so an upside-down
card reads its corner upside down too. It costs one more Vision call, about
30 ms. Below the bar the pipeline skips it, because the corner is smaller
print and a worse bet than the title that already failed. When the accepting
pass was the full frame, the card sat off the guide and the corner region
would miss it, so the corner is not read and the picker stays.

What we verified about Vision on the corner:

- At the 1080p scale, with text about 16 pixels tall, Vision reads a drawn
  corner. "C 0002" and "FRA•EN Randy Gallegos" come back as lines. The set
  code often shares a line with the artist.
- At 14 pixels the rarity letter misread as a digit. The parser ignores the
  rarity letter for that reason.
- Upside down works with the same region and the orientation flag.
- On the drawn 1080p card the corner text sits at 88 to 94 percent of the
  frame height, and at 82 percent when the card is held 60 pixels high. A
  region starting at 72 percent read it on one centred frame in four, and
  one starting at 78 percent read every frame from 60 pixels low to 60
  pixels high. The shallower region is the deliberate choice.

**Parse rules.**

- Lines are sorted by position, and the parser reads only lines whose left
  edge is left of the frame's centre. The power and toughness box and the
  copyright line start right of centre, and "2/2" would otherwise parse as a
  collector number with a set size. The rule uses the left edge and not the
  centre because the set line often runs into the artist's name, and on a card
  held a little off the guide its centre crosses the middle.
- The parser collects up to three collector number candidates in preference
  order. Lines with a rarity letter or a set size come first, then bare digit
  lines. The lookup tries each candidate with the set code until one pins.
  That covers a legal line that Vision splits so "2024" arrives alone.
- Within a line the number is the token with the most digits, so "2 0002"
  still gives 2.
- Lines carrying the copyright notice are ignored for the number. A line with
  ©, ™ or "Wizards" never gives one, so "2024" from "™ & © 2024 Wizards of the
  Coast" is never taken as a collector number.
- A confusion map turns O into 0, l and I into 1, and S into 5. It applies
  only to tokens that already hold a digit, so a word never turns into a
  number.
- Each candidate goes in the form the catalog stores, with leading zeros
  stripped, because Scryfall stores "2" where the card prints "0002". When the
  read form differs, it goes in as well, for the few printings whose stored
  number keeps its zero padding. A letter suffix stays, as in "221a". A suffix
  read in capitals is lowercased.
- The set code is a token of 3 to 6 capitals and digits on a line that also
  carries "EN" or a bullet. It is lowercased to match the catalog. On a line
  that carries both, the set code is the token before the language marker or
  bullet, and the parser removes it before it reads the number. "C0002 FRA •
  EN" read as one line still gives 2 and fra, and a code such as "SS1" never
  becomes a number.
- The set code must hold at least one letter. No set code in the catalog is
  all digits, and 338 carry digits. A line that merges number and code, such
  as "C 0002 FRA • EN", still picks FRA.

The name matcher's fold does not apply here. Set codes carry digits, and 0
against O matters in a code where it would not in a name.

**Cross-check against the name.** The pipeline looks up `(set_code,
collector_number)`, keeps the rows whose name is one of the readings, and
prefers English when several languages share the pair. It attaches the
printing only when exactly one row remains. A few pairs hold two rows of the
same name, such as 2x2 117. Those attach nothing, and the picker stays. A
corner that points at a different card also attaches nothing. A misread corner
can never override a good name read. Only readings at or above the accept bar
are candidates. A misread corner that happens to match a doubtful lower name
pins nothing.

The pin is also refused when the catalog holds a sibling printing. A sibling
is a printing of the same name in the read set or its promo set, "p" plus the
code, whose number is the read number plus one non-digit character. Any
printing at the List form "SET-number" is a sibling too. The List reprints,
prerelease promos and star variants print the base card's corner. A silent pin
on the regular printing would break the rule that a card is its printing.
Those cards go through the picker. The scope matters. Without it a quarter of
basic lands could never pin, because some other set holds the same land at a
longer or suffixed number.

**The contract grows one field.** Every reading now carries `printing`. It is
either null or the full printing object in the shape `/cards/search` returns:
`scryfall_id`, `name`, `set_code`, `set_name`, `collector_number`, `rarity`,
`finishes` and `image_uris`. Readings without a corner match carry null. ADR
0025's shape gains a field and loses nothing, so a client that ignores
`printing` still works.

**The page skips the picker when it can.** A reading with a printing goes
straight to the Inscribe form. The form's existing "change printing" control
returns to the picker. A reading without a printing goes through the picker as
before. The reading list shows the set and number beside the name when they
are known.

**Limits.** All of these fall back to the name path and cost nothing:

- Cards printed before about 1998 carry no collector number.
- Frames before 2015 carry no set code in the corner.
- Promo and borderless printings move or hide the corner text.

Non-English printings still cannot be read at all ([VEG-650]).

[VEG-650]: https://linear.app/cleveland-family-enterprises/issue/VEG-650

## Alternatives

- **Read the set symbol.** That is image matching, and the catalog holds no
  data for set symbols to match against.
- **Perceptual hashing of the art against Scryfall images.** A second pipeline
  beside OCR, plus a download of every card image to build the hashes.
- **Ask the user to type the collector number.** Slower than the picker it
  would replace.
- **Trust the corner alone, without the name cross-check.** One misread digit
  would pin the wrong printing with high confidence. Asking is better than
  being confidently wrong.

## Reasoning

The data for this was already on disk. Scryfall gives every printing a set
code and collector number, the import stores both, and the index on the pair
has sat unused since the 0002 migration. The engine was already in place too.
One extra Vision call over a region we can predict from the guide costs less
than any of the alternatives, and it adds no dependency.

Gating the read on a confident name and cross-checking the result keeps the
failure cheap. A bad corner read lands the user on the picker they would have
seen anyway. A good one saves a click per card, which adds up across a binder.

## Consequences

- An upright card lined up to the guide costs two Vision calls instead of one.
- The response grows by at most one printing object per reading.
- The frontend reading type gains one nullable field.
- A failure during the corner read or the printing lookup is logged, and the
  request still answers the readings with no printing. The corner can never
  cost the name read.
- The lookup compares both the lowercased set code and the collector number
  exactly, so SQLite uses both columns of the set and number index.
- [VEG-651]'s portrait work must mirror the corner region as well as the title
  region.

[VEG-651]: https://linear.app/cleveland-family-enterprises/issue/VEG-651
