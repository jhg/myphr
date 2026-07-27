# ADR 0010: Free-text food items, with quantity and a coded unit

* **Status**: Accepted
* **Date**: 2026-07-25
* **Decider**: Development Team

## Context

The `meal` event type from ADR 0006 (`docs/adr/0006-encrypted-event-model.md`) stores what the person ate.
The general rule for clinical vocabulary, in ADR 0005 (`docs/adr/0005-clinical-vocabulary-loinc-snomed.md`),
is that everything recorded carries its standard code from the very first data point, because coding
historical free text requires manual recoding and loses the capture context. Storing only the label is the
one irreversible option, and that's why 0005 rejects it.

With food items that rule can't be met today, and it's better to say so out loud than to leave the gap
unexplained. ADR 0005 imposes two requirements at once on any catalog source: a free license and worldwide
scope, verified against the primary source. For food we have no chosen source that meets them, and the usual
candidates are national or nutritional composition databases, with a catalog designed for dietary analysis
and not for what a person writes down after eating.

There is also a usage problem, not a licensing one. Coding the food item at the moment of recording it forces
searching a list and picking an entry, and that friction is always paid in the same place: people stop
recording. An incomplete meal diary is worth nothing, no matter how well coded the little it contains is.

## Decision

The food items in a meal are stored as free text, without coding them against any vocabulary. Each element of
the meal carries three fields: the text the person writes, a numeric quantity, and a unit chosen from a
closed list. The text is not normalized and no attempt is made to match it against any table, neither at
recording time nor later.

The unit is coded in UCUM, which is what ADR 0005 requires and what avoids an impossible conversion later on.
The closed list has seven values and this is its code: grams `g`, milligrams `mg`, kilograms `kg`,
centiliters `cL`, liters `L`, milliliters `mL`, and units understood as a count of pieces `{each}`. No other
unit is valid, and in particular there is no free-text slot for the quantity: no "a plate", no "two
spoonfuls".

The quantity travels as a string, not as a number, by the decimals rule from ADR 0004
(`docs/adr/0004-client-crypto-and-data-format.md`), just like a blood glucose value. The decrypted content of
a meal looks like this:

```json
{"v": 1, "type": "meal", "tz": "+02:00", "origin": "manual", "recordedBy": "self",
 "data": {"mealType": "lunch",
          "foods": [{"name": "lentils with chorizo", "quantity": "250", "unit": "g"}]}}
```

The order of the food items that ADR 0006 asks to capture is the order of `foods`, with no separate field: a
JSON list already preserves it, and numbering it by hand would only open the door to the two disagreeing.

This refines what ADR 0006 said about meals: there, the quantity had two slots, a unit code when one existed
and text when the measure was a household one. The text slot disappears and the unit always comes from the
list.

The first six codes are straightforward: `g` is the UCUM base unit of mass and `mg` and `kg` are that same
unit with a prefix, and `L`, `mL`, and `cL` are the liter with and without a prefix. We prefer the uppercase
L, which is the usual form in clinical settings and the one collected in the "Common UCUM units" set from HL7
Terminology 7.0.0, even though UCUM equally accepts `l`, `ml`, and `cl` (checked on 2026-07-25 against the
normative file `ucum-essence.xml` in the official repository, https://github.com/ucum-org/ucum, and against
https://terminology.hl7.org/7.0.0/ValueSet-ucum-common.html).

The seventh is not straightforward, because UCUM has no atom for "unit", "piece", or "each": what it has is
the dimensionless unit `1` and the option of annotating it inside braces. `{each}` is exactly `1` with a
label attached, because annotations carry no semantics.

## Rationale

We chose `{each}` and not plain `1` because of an asymmetry: from `{each}` you get to `1` by ignoring the
annotation, which is what any UCUM engine does, whereas from `1` you can't recover that what was being counted
was pieces. Since the code travels inside the encrypted envelope, changing it later would force decrypting
and re-encrypting every event in each user's browser, one by one, so it's better to store the most
informative form from the start. LOINC uses annotations in its own example units (`{beats}/min` for heart
rate, `{score}` in scales), so the precedent exists. The trade-off is that no annotation appears in the HL7
common set, because braces accept free text and can't be enumerated, and a validator that only accepts that
list would reject `{each}`.

On not coding the food item, the alternative was to delay meals until we have a source that meets ADR 0005.
We rejected it because ADR 0006 already solved a related case in the opposite direction: there we decided not
to ask for carbohydrates, because if the patient doesn't know them the field gets filled with made-up numbers
and a made-up number is worse than none, and because the doctor estimates better from the food item and the
quantity. The same argument holds here: forcing someone to pick an entry from a catalog produces the closest
entry, not the correct one, and the result is coded data that says something false with an appearance of
rigor.

This is a deliberate, narrowly scoped exception to ADR 0005, not an oversight. It is limited to the food item
text inside a `meal` event. Everything else in the event follows the rule: the unit is UCUM and the meal type
is a stable token from the catalog. If someone reads this a year from now, what they have to check before
"fixing" it is whether a food source with a free license and worldwide scope now exists, not whether the free
text strikes them as insufficiently rigorous.

* **Pros**: recording a meal costs writing a phrase and a number, which is the only way for the diary to be
  complete; we don't add a terminology source with its license, its size, and its maintenance for a feature
  that doesn't need it yet; and the part that is interoperable, the quantity with its UCUM unit, is right
  from the very first record.
* **Cons**: no aggregation over food items is possible, not even counting how many times one appears, because
  "rice", "white rice", and "a bit of rice" are different strings; the FHIR mapping of a `meal` will carry the
  food item in `text` with no `coding`, which is valid but poor; and coding the history the day a source
  exists will be manual and will lose the capture context, exactly the cost ADR 0005 warns about.

## Consequences

The public plaintext catalog gains the seven meal units, with their UCUM code and their label per language,
and no food entries. They live in their own enum (`App\Catalog\FoodQuantityUnit`) and not inside `UcumUnit`,
which enumerates the units of the clinical quantities: they are lists with different lives even though they
share a standard. The list is closed on both sides, and the unit received from the form is validated against
it before building the content that is going to be encrypted.

There is no conversion between units, for the same reason as with blood glucose: it would require fixing
precision and rounding. A meal summary that mixes grams and milliliters doesn't add up; it groups by unit or
it doesn't group.

Since the food item text is written by the person, it is clinical data in the most literal sense (it can
contain anything they think of writing) and it travels encrypted inside the event's envelope like everything
else, with no blind index and no server-side search.

When a food source that meets ADR 0005 shows up, the way forward is to add an optional code field next to the
text, never to replace it. The original text is always kept: it is what the person stated, and a later coding
is an interpretation of ours that must not erase it.
