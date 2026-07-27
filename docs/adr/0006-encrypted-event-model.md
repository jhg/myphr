# ADR 0006: Encrypted event model

* **Status**: Accepted
* **Date**: 2026-07-25
* **Updated**: 2026-07-27
* **Decider**: Development Team

## Context

The first MVP records the tracking of a person with diabetes: blood glucose several times a day, injected
insulin with its type and dose, blood pressure from an arm monitor, and meals. Later, without redoing the
model, heart rate, temperature, and patient notes about symptoms.

ADR 0002 and ADR 0005 left it to each feature to decide what gets encrypted. This is the first one that asks
for it, and the problem is not the value of a blood glucose reading but the metadata: if there is a glucose
readings table, or a plaintext type column, the server knows that person is diabetic without decrypting
anything. And if they record six times a day, it knows even more.

The four kinds of record are not independent either. The clinical value is in their relationship: they ate,
took six units of rapid insulin, two hours later they were at 180. It's a sequence of events in time, not
four parallel lists.

## Decision

A single events table, with the type encrypted alongside the rest of the content:

```
events
  id           uuid       primary
  user_id      uuid       not null, fk
  occurred_at  datetime   not null, precision 6, UTC    when it actually happened
  payload      text       not null                      encrypted envelope, v1. prefix
  created_at   datetime                                 when it was recorded
  updated_at   datetime
  deleted_at   datetime   nullable

  index (user_id, occurred_at)
```

Every plaintext column earns its place by proving the server needs it to query: `user_id` to authorize and
narrow down, `occurred_at` for range, ordering, and pagination, `id` as a handle to edit or re-read an event.
Nothing else. We accept that the time pattern stays visible, which is the price of paginating and limiting on
the server instead of downloading everything.

Primary keys are UUIDs in all our tables, to avoid enumeration and for compatibility with the activity log.
We prefer UUIDv7 for index locality, except where the creation time is sensitive.

The decrypted content is JSON with version, type, time offset, and data:

```json
{"v": 1, "type": "glucose", "tz": "+02:00", "origin": "manual", "recordedBy": "self",
 "data": {"value": "142", "unit": "mg/dL", "loinc": "41653-7", "method": "capillary"}}
```

Fields common to any type go at the top level, next to `v`, `type`, and `tz`; what belongs to the type goes
inside `data`, and there the method token is mandatory for every measurement, by ADR 0008.

We don't use a database JSON column: the server can't query what it can't decrypt, so a `json` type adds
nothing over `text` and does invite someone to try indexing it a year from now. Text with the `v1.` prefix
also fits the ADR 0002 guardrail, which checks that prefix.

The envelope format, padding to fixed sizes, the key identifier, versioning, decimals as strings, stable
tokens, and the canonical date form are general rules for data at rest and live in ADR 0004
(`docs/adr/0004-client-crypto-and-data-format.md`). Only what is specific to events is fixed here.

An event is not the same thing as a resource in the target format: blood pressure, which here is a single
event because that's what the device gives and what the patient lives through, is exported as two separate
observations, because the blood pressure profile does not accept pulse as a component. The exporter resolves
the asymmetry.

An event is a single envelope, not one envelope per field: its fields make no sense separately, and
encrypting them one by one would multiply them for nothing.

What identifies an event for the AEAD associated data and for deriving its key is `user_id` and
`occurred_at`. They tie the envelope to its row, so that moving a ciphertext to another date or another user
makes decryption fail instead of showing a correct value attributed to the wrong day. `user_id` is redundant
today, because the per-user master key already prevents reading someone else's envelopes, but it covers the
day shared keys exist. We use the instant and not the row `id` because that is what defines the event and the
client already knows it before inserting.

A consequence worth writing down: the clinical type can't go into the associated data, because it is
encrypted inside the envelope itself and can't take part in its own authentication. If someone puts `glucose`
there, they break exactly the property we were after.

The five MVP types and their immediate future: `glucose` (see below), `insulin` (type `rapid|long|mixed`,
dose, and the product code where applicable, because it is a medication administration and not an
observation), `bloodPressure` (a single event with systolic, diastolic, and pulse, as the device gives it),
`meal` (an explicit `mealType` plus a list of food items, each with its free text, its quantity, and its
unit, in the shape fixed by ADR 0010, `docs/adr/0010-uncoded-food-entries.md`), and `note` (text and optional
coded findings).

Blood glucose is not a single kind of measurement: the sensor measures in interstitial fluid, the capillary
meter measures blood, and urine test strips give a presence, not a number. Each one has its own code and they
are not interchangeable. The measurement method as part of the data, and its consequences for statistics, are
decided in ADR 0008 (`docs/adr/0008-measurement-method.md`), because they affect every quantity and not just
blood glucose.

Sharing a clipping of these events with a professional who has no account is decided by ADR 0011
(`docs/adr/0011-shared-clipping-for-professionals.md`), which inherits the rule from here: no plaintext
column describes what the clipping contains, neither its types nor its range. Its table is also the only one
in the project without `deleted_at`, because revoking has to really delete.

The server validates the envelope format, the encoding, and the size, which with padding to fixed sizes can
only be one of the allowed values plus the envelope header. Never the content.

The unit of measure is a user preference, not a per-record choice: it is set once (mg/dL or mmol/L for blood
glucose) and determines which LOINC code is stored, because they are different codes under ADR 0005. It lives
in the user's encrypted configuration, decided by ADR 0007 (`docs/adr/0007-encrypted-user-configuration.md`),
and the client needs it before it can record the first data point.

Fields we capture even though we don't use them today, because the user or the device knows them at that
moment and afterwards they are unrecoverable. Common to every event: whether the data is manual or comes from
a device, the device if there is one, whether the person records it themselves or someone caring for them
does, and an optional free note that works as an escape valve for whatever doesn't fit. Per type: for blood
glucose, the measurement method and the meal context (fasting, before meal, after meal, bedtime), which is
the field with the most clinical value on the list and is only known at the moment of recording, but is
optional and comes with no preselected value, so that if the person doesn't state it the field doesn't enter
the encrypted content instead of being stored empty; for insulin, the specific product as free text, because
rapid, long-acting, or mixed is not a medication code and the target format demands one, plus the injection
site; for blood pressure, the arm and the posture, which together form its measurement method under ADR 0008
and are not two incidental metadata; for meals, the order of the food items and their quantity with a unit
(ADR 0010); and for notes, onset, duration, and severity.

We don't store the record status: it is mandatory in the target format but it is derived on export, and the
same goes for the subject, the category, and the profiles.

## Rationale

We rejected a table per type and a plaintext type column for the same reason: the schema would reveal the
disease without decrypting anything, which is exactly what the design wants to avoid.

On associated data, the first proposal was to tie the envelope to the row identifier, which forced generating
the UUID in the browser to encrypt before inserting. `occurred_at` turned out better: it is what
defines the event, the client already knows it before sending, and the identifier goes back to being a
storage accident that the server can generate.

For meals we rejected asking for carbohydrates. If the patient doesn't know them, asking produces empty
fields or made-up numbers, and a made-up number is worse than none. The doctor estimates better from the food
item and the quantity. Adding them later is an optional field, which under the versioning rules breaks
nothing.

That same argument rules the meal context. A dropdown that already reads "fasting" turns carelessness into
false data, and a blood glucose reading mislabeled as fasting reads worse than an unlabeled one. That's why
the field is optional, with no preselected option, and absent from the content when it isn't answered.

Food quantity has only one possible shape because two slots forced a later decision about what to do with "a
plate" or "a handful", and that decision never came. Now the unit always comes from a closed list coded in
UCUM, at the cost that whoever doesn't weigh their food has to estimate. Which units those are and why food
items aren't coded is decided by ADR 0010 (`docs/adr/0010-uncoded-food-entries.md`), which also makes clear
that there is no conversion between those units: a summary that mixes grams and milliliters doesn't add up.

* **Pros**: the server doesn't know what the user records, only when; the model takes new types without
  touching the schema; the format at rest is closed with room for key rotation and schema changes; and the
  queries the server does need (range, ordering, limit) are covered by a single index.
* **Cons**: filtering by type on the server doesn't exist, so drawing three months of blood glucose forces
  downloading the meals and the insulin from that range too; server pagination only works for the mixed
  chronological view; and editing an event's date forces re-encrypting its envelope.

## Consequences

Two concrete adjustments, because Laravel's default date format is `Y-m-d H:i:s` and truncates microseconds
on any engine, not just MySQL: the model declares `protected $dateFormat = 'Y-m-d H:i:s.u'` and the migration
asks for `dateTime('occurred_at', precision: 6)`. Without both, the client encrypts with one date and reads
back another, and every envelope in that row becomes undecryptable.

From that comes a mandatory test: store an event with nonzero microseconds, read it back through the API, and
check that the canonical associated-data string is byte-for-byte identical. This failure shows up in
production as data corruption with no apparent cause.

The client keeps a reader for each combination of type and version that has ever existed, and none of them is
deleted. For each one there is a frozen test encrypted payload in the repository that continuous integration
decrypts and validates, just like the `exportKey` vector from ADR 0004.

The volume is manageable: on the order of 5,000 events a year, between 2 and 3.5 MB, and decrypting them
takes tens of milliseconds. What isn't free is that without browser persistence every session downloads the
range again, so the default views arrive narrowed to a range from day one and the download goes in
cursor-paged batches, outside the Livewire snapshot as ADR 0002 requires.

One vector this design does not cover, and it's better not to assume it does: restoring an earlier version of
the same envelope into the same row. Associated data does not protect against rolling a record back to a
previous state.

When offline support arrives, `deleted_at` becomes a tombstone so that deletions propagate between devices,
which is the reason for reserving it now even though the MVP doesn't sync.

The server activity log only records what the server already sees. Records created and deleted, users
modified (knowing only that there was a change, never what changed nor what configuration they have, because
it's encrypted), log in and log out when it happens, knowing that many people never log out and simply let
the session expire. It's for auditing the server and nothing else: it doesn't log clinical content, nor
anything coming from the encrypted envelopes, nor client activity such as opening or reading a record. A
detailed access log would end up revealing more of the usage pattern than the events table itself, which is
exactly what the design avoids. We have to review the default configuration of whichever package we use,
because they tend to log too much.

When adding an event type we have to check what the export format demands, even though export isn't
implemented, because fields that aren't captured at the source can't be recovered later: there is no possible
migration over encrypted data.

No format is mandatory for us today. The GDPR only asks for structured and machine-readable, without naming
any. The European Health Data Space regulation binds Member States and EHR systems, not a wellness
application like this one, whose declared interoperability is voluntary; and its technical specifications
don't even exist yet. The goal, then, is our own documented JSON format, designed so that mapping to FHIR R4
compatible with the International Patient Summary is mechanical the day we need it.

There is a boundary not to cross without analyzing it first: if one day the application imports the patient
summary from the public health system, it starts storing priority category data and stops being clearly
outside the regulation's definition of an EHR system. That's a product scope decision, not a field decision.

## Decision History

### 2026-07-25: meal context becomes optional and has no preselected value
Previously decided: the context was always captured and the dropdown arrived with the first enum case
(`fasting`) selected by the browser, so it entered the encrypted content even though nobody had chosen it.
Changed because: it's the same reason we don't ask for carbohydrates, a made-up value is worse than none.
When the person doesn't state it, the field is omitted from the content instead of being stored with a silent
default.

### 2026-07-25: food quantity no longer has two slots
Previously decided: quantity was stored with two slots, a unit code when one existed and free text when the
measure was a household one.
Changed because: the free-text slot produced quantities that couldn't be compared with each other. Now
quantity is a number and the unit always comes from a closed list, which ADR 0010
(`docs/adr/0010-uncoded-food-entries.md`) enumerates and justifies together with the decision not to code the
food item text.
