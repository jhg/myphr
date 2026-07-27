# ADR 0001: UI stack: Livewire, Filament, and Alpine

* **Status**: Accepted
* **Date**: 2026-07-25
* **Decider**: Development Team

## Context

We are building a PHR (Personal Health Record): a health history controlled by the person themselves, not by a
healthcare facility. The distinction from EMR and EHR is deliberate and defines the product, because in a PHR the owner
decides what is stored and who it is shared with (see
https://orionhealth.com/us/blog/emr-vs-ehr-vs-phr-whats-the-difference-and-why-does-it-matter/). It fits the
zero-knowledge design: the key belongs to the owner, not to the service provider.

Two forces shape the interface, and they pull in opposite directions.

The first is the volume of CRUD. A PHR is mostly forms, tables, filters, and permissions over domain entities:
episodes, medication, tests, professionals it is shared with. Writing all of that by hand, screen by screen, eats the
time we need for the clinical domain.

The second is zero-knowledge. Clinical data is encrypted in the browser and the server stores only ciphertext, never
seeing the password or the keys. Authentication is OPAQUE (see `docs/OPAQUE.md`) and from it the client derives the key
it encrypts with. That demands real JavaScript, with fine control over where each secret lives.

The team is small and mostly PHP. Today there is no native mobile client to serve, and no third parties consuming an
API.

## Decision

We adopt Laravel's first-party interface stack: Livewire 4 for components, with state on the server and rendering in
Blade; Filament 5 for the panel and the domain CRUD, on the `phr` panel that already exists in
`app/Providers/Filament/PhrPanelProvider.php`; Alpine for client-side interactivity; and Tailwind with Vite for styles
and bundling.

Alpine is not an independent decision: Livewire ships it and Filament uses it internally, so choosing Livewire and
Filament is already choosing Alpine. What we really decide is not to add a second client framework.

The exception, narrowly scoped: we write our own JavaScript only for client-side cryptography, with
`@serenity-kit/opaque` for authentication and the encryption libraries fixed by ADR 0004
(`docs/adr/0004-client-crypto-and-data-format.md`). It is the only JS code we maintain and audit ourselves.

For charts we use Chart.js installed via npm, pinned to an exact version. Filament bundles it for its widgets but does
not expose it: its build only exports the Alpine component and loads it on demand when rendering a widget, which we do
not use here because the data arrives encrypted. It is a third party that receives clinical data in the clear and sits
inside the trust boundary. What we do verify: it makes no network requests, loads no external fonts, does not use
`eval`, does not write to browser storage, and does not force us to relax any content policy.

## Rationale

Livewire keeps state on the server, and that removes three jobs an SPA forces on you: defining and versioning an API
for the interface, duplicating the data model on the client, and keeping both copies in sync. Validation and
authorization are written once, in PHP. For a PHR there is an extra benefit: if state never travels to the client,
clinical data is not replicated into a JavaScript store, so there are fewer places it can end up by accident.

Filament gives us the bulk of the CRUD for free (tables with search and pagination, forms, filters, modal actions,
relation managers, authorization via policies) and leaves clean extension points: custom columns and fields, tailored
Blade views, and full Livewire pages inside the panel.

We considered three alternatives. Inertia with Vue or React has better ergonomics for highly interactive interfaces and
would be the natural path toward a native app, but it brings no CRUD for free, duplicates the model on the client, and
adds a second dependency ecosystem. An SPA with its own API gives maximum flexibility and is a requirement for native
mobile, but it forces us to build, version, and defend an entire API before the first useful screen. Plain Blade with
hand-written JavaScript gives maximum control, in exchange for writing by hand exactly what Filament removes. Among
alternative panels (Nova, Backpack), Filament wins for being closest to the stack we already use and for adding no
licenses.

* **Pros**: fast delivery on the CRUD side; a single language for logic, validation, and authorization; no public API
  to design or defend; no build or dependencies to manage for the client framework; our own JS stays a small, auditable
  module.
* **Cons**: every Livewire interaction is a round trip to the server, which hurts on an unstable network; we depend on
  a large, opinionated framework, with real cost on major upgrades; Alpine is not usable for complex client state; and
  if native mobile is ever needed, we will have to build the API we avoid here and rewrite the crypto client.

## Consequences

The consequence that shapes day-to-day work most is where each secret lives. Livewire keeps state on the server, so
plaintext and keys can never enter a component's state. Ciphertext does travel through Livewire — that is the normal
route; what never travels is plaintext data.

Four binding rules follow. The password, the export key, and the derived keys are never bound with `wire:model` nor
stored in public properties. Forms that handle secrets use an input governed by Alpine, isolated from Livewire's
re-render, which encrypts before sending. Only OPAQUE protocol messages, ciphertext, and nonces go to the server. And
the OPAQUE routes live in the `web` middleware group, because they need session and CSRF to authenticate the user once
the handshake finishes.

Filament receives only an already-authenticated Laravel session and takes no part in the cryptography. Views showing
encrypted data will not be able to rely on server-side search or sorting, which work in SQL over content the server
does not understand: those screens will be our own Livewire components. How ciphertext travels between Livewire,
Alpine, and Filament is decided in ADR 0002 (`docs/adr/0002-encrypted-data-flow-livewire-alpine-filament.md`).

We accept the risk that a thoughtlessly placed `wire:model` breaks the system's main property without failing
visibly, and we offset it with explicit code review and a test verifying that no plaintext data appears in the Livewire
payload.

Finally, `npm` stays around even though we manage no build for the interface framework: Vite and Tailwind already
compile CSS, and the crypto module adds JS dependencies that must be pinned to exact versions, because a change to
their default values can invalidate every existing record.
