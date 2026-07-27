# Spec 0002: Tracking event capture

* Related ADR(s): `docs/adr/0002-encrypted-data-flow-livewire-alpine-filament.md`,
  `docs/adr/0004-client-crypto-and-data-format.md`, `docs/adr/0005-clinical-vocabulary-loinc-snomed.md`,
  `docs/adr/0006-encrypted-event-model.md`, `docs/adr/0007-encrypted-user-configuration.md`,
  `docs/adr/0008-measurement-method.md`, `docs/adr/0010-uncoded-food-entries.md`

This spec depends on those ADRs as prior reading: it does not repeat their rationale, it only applies it. If a
point in this spec and an ADR disagree, the ADR wins and this spec has an error to fix. Spec 0001
(`docs/specs/0001-account-provisioning-and-session-bootstrap.md`) covers what happens before: with no master key
in memory, nothing that follows can run.

## 1. Scope, and why a single spec

It covers the four MVP capture screens that already have a settled shape: blood glucose, insulin, blood pressure
and meals. For each one, what the user is asked, what JSON comes out of that screen, how it is encrypted and how
it travels. It leaves out notes, the only type in ADR 0006 that still has no settled data shape: there is
neither a screen nor a catalog of coded findings, so their JSON is not decided. It also leaves out the home
dashboard with its per-period statistics, which has its own spec
(`docs/specs/0003-health-dashboard-summaries.md`) because it consumes these events instead of producing them.

It is a single spec for the four types, and it is worth writing down why. What they share is not the layout,
which differs on every screen, but the cryptographic contract: the context string, the canonical date form, the
derivation labels and the envelope format. If that lives duplicated across four documents, they end up
diverging, and diverging here does not produce a documentation inconsistency but an entire history that cannot
be decrypted. One source for the shared part, and one short section per type for what really changes.

The four screens already exist (`app/Filament/Pages/`, `resources/js/health/`), so this spec describes code that
runs. Where something is still pending, it says so.

## 2. User stories

Person recording a blood glucose reading. They have just pricked their finger, they look at the number on the
meter and type it in. They pick the method (capillary or sensor), adjust the date and time if it is not right
now, and optionally state whether they were fasting, before a meal, after a meal or at bedtime. They do not pick
the unit here: it comes from their configuration. On save, the record appears in the list and in the chart
without reloading the page.

Person recording their blood pressure. The monitor gives them three numbers at once — systolic, diastolic and
pulse — and they type them together because it is a single measurement and that is how they experience it. They
state which arm they took it on and in which posture, because their doctor told them always the same arm and
sitting down.

Person recording what they ate. They write the dish or the food item in their own words, without searching any
catalog, and add how much: a number and a unit from a short list. They can add several lines to the same meal.
Nobody asks them about carbohydrates.

Person injecting insulin. They prepare the dose in their pen or their pump, inject it and record it right then,
or a bit later if they forgot at the time. They write the dose exactly as they read it on the pen, half units
included, because in children those are a common dose. They pick the type — rapid, long-acting or mixed —
without the screen proposing any default, because confusing one with another is a serious mistake. If they care
to, they note the product's brand name and the site where they injected, so they can rotate and not irritate the
same spot every time.

Person reviewing what they have recorded. They enter one of the four screens and see their latest records
ordered by when they happened, not by when they wrote them down, and they can keep pulling further back in
batches.

Person recording with an expired session. Fifteen minutes have passed, the master key is no longer in memory.
The screen does not break and does not silently lose what was typed: it warns that they need to log in again
(`Necesitas iniciar sesión para ver tu historial.`, "You need to log in to see your history.").

## 3. Shared cryptographic contract

This section is the reason the spec exists. Every literal string that appears here goes at once into the
derivation of the record key and into the AEAD associated data, so they **are frozen the moment the first real
data exists**: changing a separator, the order of a segment or a digit of the fractional second leaves
everything before it undecryptable. There is no way to re-encrypt from the server, because the server does not
have the key; the only possible migration is to open every envelope in every user's browser, with their key in
memory, and seal it again. Before the first real user this is one line of code, after it it is a project.

### 3.1 Event context

The event context is built with the template `${userId.toLowerCase()}/event/${canonicalDate(occurredAt)}`, where
the middle segment is `event`, singular and lowercase, and the separator is a single slash. Literal result:

```
0f1c8a2e-...-uuid-in-lowercase/event/2026-07-25T09:30:00.000000Z
```

The user identifier always goes in as its canonical lowercase text form, never as raw bytes. The clinical type
does **not** go into the context: only `user_id` and `occurred_at` tie the envelope to its row, and the reason
is in ADR 0006 (the type is encrypted inside the envelope itself and cannot take part in its own
authentication). `eventContext` throws `TypeError('userId must be a non-empty string.')` if the identifier is
not a non-empty string.

The other two contexts in the system are from the same family and are worth keeping in sight so they don't get
confused: `${userId.toLowerCase()}/umk` for the master key envelope and `${userId.toLowerCase()}/settings` for
the configuration one (`resources/js/auth/context.js`).

### 3.2 Canonical date form

`YYYY-MM-DDTHH:MM:SS.ffffffZ`: always UTC, `Z` suffix, `T` separator and always **six** fraction digits.
JavaScript's `Date` only gives milliseconds, so three zeros are padded on the right. The fraction is
**truncated** to six digits, never rounded.

`canonicalDate` accepts a `Date`, an epoch in milliseconds (a finite number) or a string matching the ISO
pattern with a **mandatory** offset. A string with no offset is rejected on purpose: guessing the local zone
would produce different bytes on different devices, and with them a different key. It also rejects impossible
calendar components (month outside 1..12, day out of range with the leap year computed, hour above 23, minute or
second above 59), because `Date` overflows silently and turns `2026-02-30` into `2026-03-02`: two different
strings would end up in the same canonical form and therefore under the same key. Failures are
`CanonicalDateError`.

`canonicalDateBytes` is that same string encoded as UTF-8, and it is the form that goes into the AEAD associated
data and into the `info` of the derivation.

On the server the counterpart is `CANONICAL_DATE_FORMAT = 'Y-m-d\TH:i:s.u\Z'` with
`CANONICAL_DATE_REGEX = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/'`.

### 3.3 Record key derivation

The derivation labels are frozen with `Object.freeze` in `resources/js/crypto/kdf.js` and carry the version
inside the text itself: `myphr/kek/v1`, `myphr/session/v1`, `myphr/record/v1`, `myphr/settings/v1`,
`myphr/envelope/v1`. Changing what a derivation means forces bumping its version, never reusing the label.

The HKDF `info` is built as `label || 0x00 || context`: UTF-8 bytes of the label, a `0x00` separator byte, and
the context bytes. The separator stops two different label-and-context pairs from producing the same `info` by
concatenation. With no context, `info` is just the label.

The KDF is HKDF-SHA-512 (RFC 5869) on `@noble/hashes` 2.2.0, byte-for-byte compatible with
`app/Security/Opaque/HkdfSha512.php`. `HASH_LENGTH` 64, `MAX_OUTPUT_LENGTH` 16320 (255 times 64), `KEY_LENGTH`
32, which is the symmetric key of XChaCha20-Poly1305. Default output of 32 bytes, `salt` and `info` empty by
default.

An event is never encrypted with the master key directly. A per-record key is derived with the label
`myphr/record/v1` and the event context, that same context travels as associated data when sealing and when
opening, and the derived key is wiped with `zeroize` in a `finally`
(`resources/js/health/eventEnvelope.js`).

### 3.4 Envelope format

Transport: the literal prefix `v1.` followed by base64url **without** padding of the binary envelope. The
constant lives on both sides, `ENVELOPE_PREFIX` on the client and `EnvelopeValidator::PREFIX` on the server.

Binary header, 64 bytes:

```
offset  0   1 byte    format version             0x01
offset  1   1 byte    algorithm                  0x01  XChaCha20-Poly1305-IETF
offset  2   1 byte    KDF                        0x01  HKDF-SHA-512
offset  3   1 byte    flags                      bit 0 = padded content (FLAG_PADDED 0x01)
offset  4   4 bytes   key identifier             reserved, always zero today
offset  8  32 bytes   derivation salt
offset 40  24 bytes   nonce
offset 64   n bytes   ciphertext || tag (16 bytes)
```

The real AEAD associated data is the full header concatenated with the context the caller supplies, that is,
`header || associatedData`. That way, changing a flag or the key identifier invalidates the tag. That same
context also goes in as the context of `deriveKey` with the label `myphr/envelope/v1` and the envelope's own
salt, which is a different derivation from the one in section 3.3 and must not be confused with it.

The content is padded to fixed sizes of 256, 1024 or 4096 bytes. It is prefixed with its length in four
big-endian bytes and filled with zeros up to the first size it fits in, which leaves the maximum content at 4092
bytes. `unpad` rejects a size that is not one of the three and a declared length larger than the size itself.

When opening, the client rejects: a prefix other than `v1.`; a length below 336 bytes (64 of header, 16 of tag
and the smallest padding); a version, algorithm or KDF byte other than `0x01`; the padding flag not set; and a
content size that is not one of the three allowed ones. All of them throw `EnvelopeError`, which does not
distinguish tampering from corruption and must **never** be silenced.

### 3.5 What the server checks

`EnvelopeValidator::isValid` checks three things and nothing more: the `v1.` prefix, that the base64url is
canonical, and that the binary length is exactly 336, 1104 or 4176 bytes (`HEADER_BYTES` 64 plus `TAG_BYTES` 16
plus each padding size). It never validates the content, because it does not have the key.

The same guardrail lives in the model: `Event::booted()` throws
`LogicException('events.payload no tiene forma de sobre cifrado válido.')` in `saving()` if validation fails. It
is a format guardrail, not a content one. The `payload` column has no cast and no mutator on purpose: it is an
opaque string end-to-end.

## 4. Transport contract

The two transport methods are shared by every event screen and live in a single place, `HealthEventPage`, which
blood glucose, blood pressure, meals and insulin all extend. The ciphertext always crosses in the same logical
direction: it comes down as a return value and goes up as a parameter. It never lives in a public property of
the component, per ADR 0002.

`storeEvent(string $payload, string $occurredAt): array{id: string, occurredAt: string}` authorizes with
`Gate::authorize('create', Event::class)`, validates the envelope with `EnvelopeValidator::isValid` and, if that
fails, throws `ValidationException` with key `payload` and the literal message
`El sobre cifrado no tiene un formato válido.` ("The encrypted envelope does not have a valid format."); then it
validates the date. Both checks abort before touching the database. It creates the `Event` with `user_id` from
`Auth::id()`, `occurred_at` and `payload`, and returns the identifier plus the `occurredAt` re-canonicalized
**from the saved row**, not from the parameter: that is what catches a microsecond truncation right away, not a
month later.

`fetchEvents(?string $before = null, int $limit = 100): list<array{id, occurredAt, payload}>` authorizes with
`Gate::authorize('viewAny', Event::class)`. The hard cap is `MAX_FETCH_LIMIT = 500`, applied as
`min(max($limit, 1), 500)`: 100 by default, minimum 1, maximum 500. The query is narrowed to
`where('user_id', Auth::id())`, `orderByDesc('occurred_at')` and `limit`, with an optional cursor
`where('occurred_at', '<', ...)` over the canonical date received.

Date validation on the server is `parseCanonicalOccurredAt` and has three steps. If the regex does not match,
`ValidationException` with key `occurredAt` and the literal message
`La fecha debe tener la forma canónica YYYY-MM-DDTHH:MM:SS.ffffffZ.` ("The date must have the canonical form
YYYY-MM-DDTHH:MM:SS.ffffffZ."). Then `CarbonImmutable::createFromFormat` in UTC. And finally a round-trip check:
if reformatting does not return exactly the string received, `ValidationException` with
`La fecha no es una fecha canónica válida.` ("The date is not a valid canonical date."). That round trip is what
catches overflows like month 13 or day 32, which `createFromFormat` accepts silently.

The server cannot filter by type. It returns every event of the user in the requested range and it is the client
that discards the ones it does not need, after decrypting. That is the cost already accepted in the Cons of
ADR 0006, and it has two practical consequences: the limit of 100 records per batch does not amount to 100 blood
glucose readings, and a screen that wants to draw three months of one type has to request batches until the
range is exhausted, not until its list is full.

An envelope that fails to open doesn't break the screen: it is counted separately (`failedToOpenCount`) and the
user is told, while the rest of the history keeps being shown.

## 5. Fields shared by every event

The four shared fields listed in ADR 0006 are built by a shared pure function, `buildCommonEventFields`
(`resources/js/health/eventCommonFields.js`), and they go at the top level of the decrypted content, next to
`v`, `type` and `tz`, never inside `data`, because they do not belong to any one type.

`origin` distinguishes how the data entered the application, typed in (`manual`) or imported from a device
(`device`), and it is not asked on any form: there is no automatic import today, so it stays fixed at `manual`
and it will be the import, the day it exists, that builds the event with `device`. It does not answer the same
question as the measurement method (ADR 0008): looking at the sensor and typing the number is still an
interstitial reading entered by hand.

`recordedBy` is asked, with `self` as the default, and `device` (which device the reading was taken with) and
`note` are free text. The last two are omitted from the content when they arrive empty, on the same criterion as
the meal context: absence means absence and never an empty string saved as if it were data.

## 6. Blood glucose

The plaintext content produced by `buildGlucoseContent`, with every optional field present, is:

```json
{"v": 1, "type": "glucose", "tz": "+02:00", "origin": "manual", "recordedBy": "self",
 "device": "Accu-Chek Guide", "note": "after walking",
 "data": {"value": "142", "unit": "mg/dL", "loinc": "41653-7", "method": "capillary",
          "mealContext": "after_meal"}}
```

`origin` and `recordedBy` are always there, because they carry a default (section 5); `device`, `note` and
`mealContext` only appear when the person fills them in, so the minimum content is the five top-level keys plus
`data` with its four mandatory fields.

`v` is the number 1 and `type` the literal string `glucose`. `value` always travels as a string, exactly as the
person typed it, never as a number (ADR 0004, decimals as strings); if it is not a string or is empty after
trimming spaces, the screen responds `Introduce un valor.` ("Enter a value."). `unit` is a UCUM code and `loinc`
is resolved against the server's table, never invented: `GlucoseLoincCode::resolve()` is total over the
supported combinations and throws `ValueError` for a combination with no code, instead of returning a default
code.

`tz` is the `±HH:MM` offset at the moment of the record, positive when local time is ahead of UTC, and it is
computed with the offset in force for **that** particular date, respecting the daylight saving time of the day
recorded and not today's.

The method is a stable token from `GlucoseMeasurementMethod`: `capillary` (capillary blood with a meter after a
finger prick) and `interstitial` (interstitial fluid with a continuous sensor). That token is serialized inside
the encrypted payload, so it can never change once published; adding a new case is safe, renaming or removing an
existing one is not.

The four LOINC codes, resolved by method and unit, are `41653-7` and `14743-9` for capillary in mg/dL and
mmol/L, and `99504-3` and `105272-9` for interstitial in those same two units. Interstitial in mmol/L has six
digits before the hyphen, which is a valid LOINC format and which any future validation must accept.

### 6.1 The meal context is optional

The `MealContext` tokens are `fasting`, `before_meal`, `after_meal` and `bedtime`, in snake_case and with the
same immutability pact as the methods.

The field is optional and has no preselected value. The dropdown starts with an empty option selected
(`Sin especificar`, "Not specified") and, when the person picks nothing, the `mealContext` key does not enter the
payload, instead of entering with an empty string or with `null`. The client's reader treats the missing key as
"not stated" and statistics that group by context count it separately, never distribute it.

The reason is the same one ADR 0006 uses for not asking about carbohydrates: a dropdown that arrives with
"fasting" already written turns any slip into false data, and when reading the history back a made-up value
cannot be told apart from a real one.

### 6.2 Display unit

The unit is a presentation preference that lives in the encrypted configuration (ADR 0007), under the key
`glucoseUnit`, with `mg/dL` as the value when there is no saved preference. The server cannot read it.

There is no conversion between units. Events whose unit does not match the display unit stay out of the chart
and are counted in `excludedByUnit`, because converting would require fixing precision and rounding. Series are
grouped by method, one per method, and the chart caption always says which methods it includes (ADR 0008).

### 6.3 Urine test strip, pending

ADR 0008 contemplates a third blood glucose method whose result is qualitative (`25428-4`, presence in urine).
Its payload has a different shape: instead of a value with a unit it carries an ordinal result, and it does not
enter means or the percentage in range. Neither the catalog nor the client supports it today, and the specific
ordinal vocabulary is still undecided (section 11). In the meantime, the catalog exposes only `capillary` and
`interstitial`, and `units` only `mg/dL` and `mmol/L`.

## 7. Blood pressure

A single event with the three numbers the device gives — systolic, diastolic and pulse — because that is what
the patient experiences as one measurement (ADR 0006). The asymmetry with the destination is resolved by the
exporter: the FHIR blood pressure profile does not admit pulse as a component, so one of our events is exported
as two separate observations. That asymmetry is deliberate and must not be "fixed" by splitting the event in two
at capture time, because that would lose that both readings come from the same instant and the same device.

The three LOINC codes are `8480-6` for systolic (official term `Systolic blood pressure`), `8462-4` for
diastolic (`Diastolic blood pressure`) and `8867-4` for pulse (`Heart rate`). The official term of the third one
is heart rate, not pulse, so the documentation and the catalog use that term when they cite the code, even
though the patient-facing label may keep saying pulse. All three are in active status and **none carries a
third-party copyright notice**, checked on 2026-07-25 against `tx.fhir.org` with LOINC 2.82, which does publish
that property when it exists. They meet the rule in ADR 0005.

The UCUM units are `mm[Hg]` for both pressures, which matches the example units LOINC itself declares, and
`/min` for heart rate. There is a verified nuance about the latter: LOINC does not propose bare `/min` for
`8867-4` but `{beats}/min`, which is the same quantity with an annotation that does not change the semantics.
`/min` is valid UCUM and appears in the HL7 Common UCUM units value set; see section 11.

Arm and posture are the measurement method of this quantity, not two incidental pieces of metadata: both change
the value in a known way and both are only known at the moment of measuring, which is the criterion in ADR 0008.
Their two vocabularies are closed and are enumerated in that ADR: `left` and `right` for the arm
(`App\Catalog\BloodPressureArm`), and `sitting`, `lying` and `standing` for the posture
(`App\Catalog\BloodPressurePosture`).

Inside the content they travel as two tokens of their own, `data.arm` and `data.posture`, because the screen
asks for them separately and that is how they are read and filtered. The method the statistics group by is their
combination, `${arm}_${posture}`, from `left_sitting` to `right_standing`, and it is computed while grouping
(`methodKey`) instead of being stored: derived data that gets stored is data that can drift out of sync with
what generates it.

The content of a reading looks like this. Pulse is optional, because not every monitor measures it, and when it
is missing neither `pulse` nor its unit nor its code travel, instead of travelling empty:

```json
{"v": 1, "type": "bloodPressure", "tz": "+02:00", "origin": "manual", "recordedBy": "self",
 "data": {"systolic": "128", "diastolic": "82", "unit": "mm[Hg]",
          "pulse": "71", "pulseUnit": "/min",
          "loinc": {"systolic": "8480-6", "diastolic": "8462-4", "pulse": "8867-4"},
          "arm": "left", "posture": "sitting"}}
```

## 8. Meals

A meal is recorded with free text for the food item, the dish or the preparation, plus a number for the
quantity, plus a unit selector from a closed list of seven values: grams, milligrams, kilos, centiliters, liters,
milliliters and units. The quantity travels as a string, like any decimal (ADR 0004).

Food items are not coded against any vocabulary. This is a deliberate, narrowly scoped exception to the ADR 0005
rule of not storing only the label, and it is decided by ADR 0010
(`docs/adr/0010-uncoded-food-entries.md`): coding home cooking against a food vocabulary does not produce better
data, it produces false data that looks precise. The doctor estimates from the food item and the quantity, which
is the same reasoning by which ADR 0006 rejects asking about carbohydrates.

This refines what ADR 0006 said about the shape of the quantity. There is no longer a quantity with two slots, a
unit code when one exists and free text when the measure is a household one: the unit always comes from the
closed list. A free-text slot for the unit makes any future statistic impossible and piles up beyond repair,
while seven options cover what people actually write and leave the data comparable.

The UCUM mapping of six of the seven is direct and is verified against the normative file `ucum-essence.xml`
from the official UCUM repository: `g` for grams, `mg` for milligrams, `kg` for kilos, `cL` for centiliters, `L`
for liters and `mL` for milliliters. UCUM admits both `l` and `L` for the liter; the uppercase one is chosen
because it is the form of clinical use and of the HL7 Common UCUM units value set, and because a lowercase L is
confused with a one.

The seventh, units understood as a count of pieces, has no UCUM atom of its own: there is no `each`, `unit` or
`count` in the normative file. ADR 0010 picks the annotation `{each}`, which the specification defines as
exactly `1` with a label that adds no semantics, and not the bare dimensionless unit `1`: from `{each}` you get
to `1` by ignoring the annotation, whereas from `1` you cannot recover that what was being counted were pieces.
The seven live in `App\Catalog\FoodQuantityUnit`.

A meal admits several food lines in the same event, with an explicit `mealType`, as ADR 0006 lays down. The
order they are recorded in is the order of `data.foods`, with no separate field, and each line carries `name`,
`quantity` and `unit`. A half-filled row (with two of the three fields filled) is rejected with a clear message
instead of being saved incomplete. With the envelope's fixed-size padding, a long meal can go from 256 to 1024
bytes of content, which is normal and needs no action: the only thing that does not fit is content larger than
4092 bytes, and that case must fail with a clear message to the user and not with a generic `EnvelopeError`.

## 9. Insulin

Unlike blood glucose, an insulin event is not the observation of a quantity but the record of a medication
administration, and that is why it **carries no LOINC code**. There is no (type, unit) → code table to resolve,
and there is no need to add one: it is the deliberate difference from `Glucose::catalog()` (ADR 0006).

The plaintext content produced by `buildInsulinContent` (`resources/js/health/insulinPage.js`), with every
optional field present, is:

```json
{"v": 1, "type": "insulin", "tz": "+02:00", "origin": "manual", "recordedBy": "self",
 "device": "NovoPen pen", "note": "before the meal",
 "data": {"insulinType": "rapid", "dose": "0.5", "unit": "[iU]",
          "product": "NovoRapid", "site": "abdomen"}}
```

`insulinType` and `dose` are mandatory: with no dose the screen responds `Introduce la dosis.` ("Enter the
dose.") and with no type, `Selecciona el tipo de insulina.` ("Select the insulin type."). `product` and `site`
only enter `data` when the person fills them in, on the same criterion as `mealContext` in blood glucose:
absence means absence, never an empty string saved as if it were data.

The dose always travels as a string, with the dot as the decimal separator (ADR 0004), and it admits decimals
because half a unit is a real dose in pediatric patients. The unit is the UCUM code of the insulin international
unit, `[iU]`, verified against unitsofmeasure.org, and it is the only one the catalog exposes today: the unit
dropdown is shown but cannot be edited, because there is no other option to choose from.

The product is free text, and the reason is in ADR 0006: "rapid", "long-acting" or "mixed" is not a drug code
and the export format requires one, so the brand name (`NovoRapid`, `Lantus`, `Humalog Mix 25`) is the only
thing that lets it be resolved later.

The type is a stable token from `InsulinType` (`App\Catalog\InsulinType`): `rapid`, `long` and `mixed`, with no
preselected option in the dropdown, unlike the blood glucose method, because confusing rapid with long-acting is
a serious clinical error. The injection site is a stable token from `InjectionSite`
(`App\Catalog\InjectionSite`): `abdomen`, `thigh`, `glute` and `arm`, optional and with no preselected value, on
the same criterion as the meal context in blood glucose. Both vocabularies are frozen the moment the first real
envelope exists: adding a new case is safe, renaming or removing an existing one is not.

`origin` is not asked on the form, the same as on every other screen (section 5): there is no integration with
any device on this screen today, so entry is always manual and `buildCommonEventFields` fixes it to `manual`
without showing any control. `device`, in contrast, is asked, and here it is the pen or the pump the dose was
given with, useful information even with manual entry.

A dose is not a continuous quantity like blood glucose: there is no value "between" two injections. That is why
the history is grouped by local calendar day and insulin type, summing the total dose of each type
(`groupInsulinByDay`), and drawn with a bar chart, never a line chart, which would suggest a continuity that
does not exist. The day is computed with the `tz` offset each event was recorded with, not with the time zone of
the device that opens the screen.

The form's dose field is today an `<input type="text" inputmode="decimal">`, and `buildInsulinContent` only
checks that it is not empty. This differs from the blood glucose value and from systolic, diastolic and pulse,
which do use `numericValue.js` (`type="number"`, `step="any"`, a two-decimal limit and normalization of the
comma to a dot before encrypting). With a text field you can type `7,8` or `7.8`, the same decimal separator
ambiguity that `numericValue.js` exists to avoid for every other measurement value, and here there is no
equivalent guardrail in front of the dose. It is a discrepancy between screens that this spec merely describes,
not a decision taken; it stays as an open question (section 11).

## 10. Acceptance criteria

* Save an event with non-zero microseconds, read it back through the same method and check that the canonical
  associated data string is byte-for-byte identical. It is the mandatory test from ADR 0006 and without it the
  failure shows up in production as corruption with no apparent cause.
* For every combination of type and version there is a frozen test encrypted payload in the repository that
  continuous integration decrypts and validates. None is ever deleted, even if the type evolves.
* The event context is compared against its expected literal string in a test, not just against the result of
  calling the same function again. A test that compares the function with itself does not detect a template
  change.
* `canonicalDate` truncates and does not round: an input with nine fraction digits produces the first six and
  not a rounding. A string with no offset is rejected. `2026-02-30` is rejected instead of turning into March.
* An envelope tampered with in any header byte (flag, key identifier, salt, nonce) fails to open. A valid
  envelope moved to another date or another user fails too.
* `EnvelopeValidator::isValid` accepts exactly 336, 1104 and 4176 bytes and rejects any other size, base64
  padding, and a prefix other than `v1.`.
* `storeEvent` rejects an invalid envelope and a non-canonical date without writing to the database, checked by
  counting rows after the attempt.
* `fetchEvents` respects the cap of 500 even when asked for more, and returns at least 1 even when asked for 0
  or a negative number.
* The name of the method the client calls matches the one the page exposes. A rename in PHP without its
  counterpart in JavaScript leaves the screen saving against a method that does not exist, and no PHP test
  catches it.
* Saving a blood glucose reading without touching the meal context dropdown produces a payload with no
  `mealContext` key, not one with `fasting` or with an empty string.
* Saving a blood glucose reading with a method and a unit that have no LOINC code fails explicitly, without
  falling back to any default code.
* An event whose envelope fails to open does not break the screen: the rest of the history keeps being shown and
  the failure is counted and reported.
* Content larger than 4092 bytes produces a message the user can understand, not a generic exception.
* Saving an insulin record without stating product or injection site produces a payload whose `data` has no
  `product` or `site` keys, not ones with an empty string.
* Saving an insulin record with no type or no dose fails with the corresponding message
  (`Selecciona el tipo de insulina.` or `Introduce la dosis.`) without writing to the database.

## 11. Open questions

1. `/min` or `{beats}/min` for heart rate. ADR 0005 declares `/min` and that is not wrong, it is the unannotated
   form; `{beats}/min` is LOINC's own example unit. Pick one and make the ADR, the catalog and this spec say the
   same thing.
2. The ordinal vocabulary of the urine test strip (section 6.3), and whether the code `25428-4` enters the
   catalog now or waits until the screen exists.
3. What `origin` writes the day an import from a device exists, and whether that import reuses these same
   transport methods or needs its own. While it does not exist, `origin` is `manual` on every event and the
   field adds nothing, but it is stored because it cannot be recovered afterwards.
4. Whether the insulin dose should be validated with the same guardrail as every other measurement value
   (`numericValue.js`, a two-decimal limit and the comma normalized to a dot) instead of with a text field
   checked for nothing beyond "not empty" (section 9). It is the highest-risk field in the whole application, a
   misread dose is a misgiven dose, and today it is the only numeric value in the MVP without that guardrail.
