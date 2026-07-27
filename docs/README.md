# myphr

An end-to-end encrypted personal health record (PHR).

## What a PHR is, and why not an EMR or an EHR

All three store health data, but they differ in who is in charge. An EMR is the record of one specific
facility, and an EHR is the one several professionals share. A **PHR is managed by the person themselves**.
The distinction is well explained in [Orion Health, "EMR vs EHR vs PHR"][orion-phr].

| | PHR |
|---|---|
| Purpose | Patient-managed health tracking |
| Ownership | The patient's |
| Scope | Whatever the patient decides to include |
| Sharing | Controlled by the patient |
| Best use | Personal wellness and being able to explain your own health |

Those rows are the reason for the project's technical decisions, not a statement of intent.

If the data belongs to the patient, the server has no business being able to read it. That is why everything
is encrypted in the browser with a key derived from the user's password that never reaches the server:
not the password, not the keys, not the plaintext data. Authentication uses OPAQUE (RFC 9807), which
authenticates without sending the password. See [OPAQUE.md](OPAQUE.md).

Sharing with professionals is designed and implemented in
[ADR 0011](adr/0011-shared-clipping-for-professionals.md): a clipping encrypted in the browser, a link
with the key in the fragment, and a short PIN the server verifies online with an attempt counter. Who you
share with and what you share are cryptographic decisions, not permissions in a table, because the server
cannot grant access to something it cannot read.

## What it is for in practice

The case we are after is the tracking the doctor asks for and the patient keeps up: blood pressure, blood
glucose, symptoms, sticking to a treatment. The patient collects it day to day and, at the appointment,
shows it already chewed over: means, extremes and flagged trends, so the conversation starts where it
matters instead of being spent interpreting a list of numbers.

In the first version this is shown from the patient's own screen. Sending data to the professional comes
later.

## Clinical vocabulary

The interface uses our own patient-facing labels, English first and Spanish second. Each
concept carries its standard code underneath: [LOINC][loinc] for what is measured (blood pressure, blood
glucose, weight) and [SNOMED CT][snomed-docs] for what is found (symptoms, findings), so that patient and
doctor refer to the same thing even when they use different words. The [official glossary][snomed-glossary]
defines the standard's terms, and the decision with its licensing analysis is in
[ADR 0005](adr/0005-clinical-vocabulary-loinc-snomed.md).

We **don't support HL7 or FHIR** yet. They are different things, and compatible ones: HL7 and FHIR define
how data travels between systems, vocabularies define what it means ([Orion Health, "HL7 vs FHIR vs
SNOMED CT"][orion-fhir]). Storing the codes from the very first record is what will make the transport
viable later.

## How it is put together

The architecture is inverted compared to the usual one, and seeing it that way clears up almost everything
else: **Livewire is not the owner of the state, it's a transport.** The real state lives in Alpine, in the
browser. The why of each layer is in its ADR; here is just the map.

**Filament** provides the shell: navigation, theme, dark mode and the login screens. Global search is
disabled on purpose, because it would resolve on the server over encrypted data: it would find nothing and
would only send the server what the person types. It is all configured in `PhrPanelProvider`
(ADR [0001](adr/0001-ui-stack-livewire-filament-alpine.md)).

**Livewire** only transports. Ciphertext goes in as a method argument and comes out as a return value,
**never as a component property**: a public property ends up in the *snapshot*, which travels to the server
and stays there. A guardrail intercepts it, and architecture tests fail if anyone tries
(ADR [0002](adr/0002-encrypted-data-flow-livewire-alpine-filament.md)).

**Alpine** owns everything that matters: it keeps the decrypted events in memory, encrypts before
uploading, decrypts on the way down and builds the DOM. Each screen declares its component in `x-data`, and
they all register in `resources/js/app.js`. If one is missing there, the screen renders and doesn't respond,
**with no visible error**: it's the silent failure that has bitten this project most often.

**The server** does three things, and none of them involves reading clinical data: it authenticates, it
authorizes, and it stores and paginates opaque envelopes. Of an event it only sees `user_id`, `occurred_at`
and `id` (ADR [0006](adr/0006-encrypted-event-model.md)). Two consequences follow that explain half the
application: **it can filter by date, and it cannot filter by type**.

### The boundary between Livewire and Alpine

This is the delicate part. Livewire *morphs* the DOM on every request, so it would wipe out whatever Alpine
has written. There are two defenses, and you need both:

- `wire:ignore` with a **stable** `wire:key` on the regions Alpine writes.
- And the trap: **an `@island` is not enough**. The server re-emits it on every request and wipes whatever
  was inside. That is why the chart canvases live *outside* the islands. If some day a screen loses its
  chart after loading, this is the first thing to look at.

### The master key and navigation

`auth/keyring.js` is imported **first** in `app.js`, which loads in the `<head>`. The key lives in that
module's scope. Filament navigates like an SPA with `wire:navigate`, which replaces the `<body>` but
**does not re-evaluate modules that are already loaded**: that is the whole mechanism by which the key
survives a screen change and dies when the tab closes
(ADR [0003](adr/0003-master-key-survival-in-browser.md)).

The same mechanism has a less friendly side: `wire:navigate` doesn't update the `<html>` attributes either,
so the language was read once and stayed frozen. It is now re-read on every navigation from a marker that
goes in the `<body>`.

### When a Livewire method and when a dedicated endpoint

This is the question that shows up whenever you add any feature, and the rule is:

> **Livewire for the data plane inside an authenticated screen. A dedicated endpoint for the cryptographic
> protocol, for anything with HTTP semantics or its own attempt limit, and for anything with no session.**

`storeEvent` and `fetchEvents` go through `$wire`: the component is already mounted, the session exists and
authorization was resolved on entering the screen.

Everything else goes through a dedicated endpoint, for four different reasons. **What comes before there is
a session**, like OPAQUE, which also requires deliberately indistinguishable errors between a wrong
password, a nonexistent account and an expired handshake. **What needs HTTP semantics**, like saving
settings, which uses `If-Match` and responds 412 or 428. **What lives outside the panel**, like the
professional's screen, which has neither session nor cookies
(ADR [0011](adr/0011-shared-clipping-for-professionals.md)). And **what needs its own rate limiting**: every
Livewire call goes through a single endpoint, so you can't limit login without also limiting saving a blood
glucose reading.

One consequence of this: Filament's SPA router would try to put the response of any same-origin URL into the
`<body>`, and with an endpoint that returns JSON it would paint the JSON on screen. That is why
`PhrPanelProvider` declares explicit exceptions for `/phr/auth/*`, `/phr/logout` and `/phr/settings`. The
profile page is not on that list on purpose: it serves HTML and should be navigated like the rest.

## Documentation

- [OPAQUE.md](OPAQUE.md): password authentication without sending the password.
- [adr/](adr/): architecture decisions, with their context and their trade-offs.
- [specs/](specs/): the implementation detail of each feature, resting on those ADRs. That is where the
  cryptographic contract for tracking event capture lives, and it has to be respected to the letter because
  it is frozen with the first real record.

[orion-phr]: https://orionhealth.com/us/blog/emr-vs-ehr-vs-phr-whats-the-difference-and-why-does-it-matter/
[orion-fhir]: https://orionhealth.com/us/blog/hl7-vs-fhir-vs-snomed-ct/
[loinc]: https://loinc.org/kb/license/
[snomed-docs]: https://docs.snomed.org/
[snomed-glossary]: https://docs.snomed.org/snomed-international-documents/snomed-ct-glossary
