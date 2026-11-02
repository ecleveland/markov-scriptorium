# 0029 Collector number alone pins among the name's printings

**Status:** accepted (2026-11-02)

Amends [ADR 0027](0027-scanner-corner-read-pins-the-printing.md). Resolves
[VEG-681]. Decides what the scanner does when it reads the collector number
cleanly but misreads the set code.

[VEG-681]: https://linear.app/cleveland-family-enterprises/issue/VEG-681

---

## Decision

**The number pins on its own when the set code fails.** The corner parser
still needs a set line, marked by the language code or a dot. A set line with
no token that fits a set code needs the language code, because a modal card's
bullet lines can fall inside the corner region. Then the parser returns the
numbers with the set code unread. A set code that is read but names no set the
catalog holds goes the same way, and the lookup by set never runs. In both
cases the scanner looks for each number candidate among the printings of the
names read at the accept bar. The first candidate any of them carries decides.
It pins when exactly one printing carries it, English first as before, and
asks through the picker when several do.

**The sibling rule widens to every set.** The set is unknown, so any other
printing of the name at the number plus one non-digit character, or at
"SET-number", blocks the pin, whatever its set. A List reprint, promo or star
variant still sends the card to the picker.

**A bare number still pins nothing.** Without a set line the lines are not a
corner, and a lone number could be a year or a power and toughness box.

**A set code the catalog knows ends the search.** That set code may be right
and the number misread, so the number alone is not tried. A correct set with
a misread number stays on the picker, as under ADR 0027. So does a pair that
holds the name twice or a sibling that prints the same corner.

The parser also takes the language code with a mark glued to it, as in "*EN"
or "EN.", so the dot read as another mark no longer hides the set line.

## Alternatives

- **Match the set code one letter off.** "CLD" against "CLB" would have worked
  for this card. Many set codes sit one letter apart, so a one-letter match
  would need its own ranking and would still guess.
- **Leave it to the picker.** That costs a click on every card whose set code
  misreads, when the number and name already say which printing it is.

## Reasoning

A real scan on 2026-10-30 read Firkraag, Cunning Instigator, CLB 933. Vision
returned the corner lines `('933', 1.0), ('M', 1.0), ('CLD *EN NANOREW MAR',
1.0)`. The dot came back as "*" glued to "EN", so the parser saw no set line,
and CLB came back as CLD, which holds no card. The number read cleanly and is
one of the name's three printings, CLB 642, 648 and 933.

Two checks bound the risk. The fallback looks only at printings of a card the
user's title read named at 0.80 or better. It runs only when the set code is
no set at all, so a correct set with a misread number still pins nothing, and
the picker asks as ADR 0027 prefers.

## Consequences

- `CornerRead.set_code` is nullable. A set code of None means the set line was
  seen but its code was not read.
- Every scan with a set code costs one `set_exists` query on the set code
  index. The fallback path costs one `printings_by_name` query per name read.
