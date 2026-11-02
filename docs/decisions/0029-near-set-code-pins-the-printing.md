# 0029 A set code one edit off pins under the near set

**Status:** accepted (2026-11-02)

Amends [ADR 0027](0027-scanner-corner-read-pins-the-printing.md). Resolves
[VEG-681]. Decides what the scanner does when it reads the collector number
cleanly but misreads the set code.

[VEG-681]: https://linear.app/cleveland-family-enterprises/issue/VEG-681

---

## Decision

**The language code may carry a glued mark.** Vision can read the dot between
set code and language as another mark glued to "EN", as in "*EN" or "EN.".
The parser takes such a token as the language code, so the set line is still
found and the digit map stays off it. A word such as "QUEEN" is not the
language code.

**A set code one edit off is read as the near set.** The set code stays
required. When the lookup under the read set pins nothing, the scanner
gathers every set the names read at the accept bar were printed in.

- When the read set is among them, the set read true and the number misread,
  or the pair held the name twice. No near set is tried, so a correct set with
  a misread number stays on the picker as under ADR 0027.
- Otherwise a set one substitution, insertion or deletion away from the read
  code is the near set. When exactly one is near, the lookup runs again under
  it, with every ADR 0027 rule: the name cross-check, English first, one
  printing only, and the sibling refusal.
- Two near sets pin nothing, and neither does a code two edits off.

A sibling refusal under the read set ends the lookup there.

## Alternatives

- **The collector number alone among the name's printings.** Review found it
  pins wrong in four ways. A correct set the catalog has not imported yet sent
  the number to every other set. A set line token read as digits, such as
  "282 • EN", became a number candidate. A lower-ranked name at the accept bar
  took the pin across every set. A lone non-English row at the number pinned.
  Each patch left a design that still dropped the set as evidence.
- **Leave it to the picker.** That costs a click on every card whose set code
  misreads by one glyph, when the name, the set and the number already agree.

## Reasoning

A real scan on 2026-10-30 read Firkraag, Cunning Instigator, CLB 933. Vision
returned the corner lines `('933', 1.0), ('M', 1.0), ('CLD *EN NANOREW MAR',
1.0)`. The dot came back as "*" glued to "EN", so the parser saw no set line,
and CLB came back as CLD, which holds no card. The number read cleanly and is
one of the name's three printings, CLB 642, 648 and 933.

The set stays evidence. A pin needs the name, a set the card was printed in
and the number, with at most one of the three read one glyph off. A misread
set code can only move the lookup to a set the card was printed in, never to
any other set.

## Consequences

- `set_codes_of_name` costs one indexed query per name read, and only when the
  lookup under the read set pinned nothing.
- `CornerRead` keeps its type. The set code is still always read.
