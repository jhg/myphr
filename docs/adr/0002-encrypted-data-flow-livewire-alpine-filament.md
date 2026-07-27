# ADR 0002: Encrypted data flow between Livewire, Alpine, and Filament

* **Status**: Accepted
* **Date**: 2026-07-25
* **Decider**: Development Team

## Context

ADR 0001 fixed the stack and left one rule: plaintext data and keys do not enter Livewire state, ciphertext does. What
is still missing is how that ciphertext actually travels — where it comes down from the server, where it goes up,
where it gets decrypted without the re-render wiping it, and what we do about Filament, which assumes it can search and
sort in SQL.

We investigated the Livewire 4 and Filament 5 code installed in `vendor/`, not the documentation. Three findings shape
the decision.

The DOM morph overwrites text Alpine has written, and the Alpine effect does not run again, so the decrypted data
disappears with no error. An `@island` is not re-rendered by default: the server emits an empty fragment and the morph
skips the whole region.

The component snapshot goes up and comes down in full on every request, and Livewire computes its HMAC twice. Method
parameters and return values, on the other hand, travel outside the snapshot.

Any write to the state from the client reaches the server on the next request, wherever that request comes from. That
includes `$entangle` and every variant of `wire:model`, whose `live` modifier only delays the network call, not the
write to the state.

## Decision

Ciphertext comes down as the return value of a component method and goes up as a parameter of another. It does not live
in public properties. Only identifiers and non-sensitive metadata stay in the snapshot.

The decrypted region is wrapped in an `@island` and carries `wire:ignore` inside, with a stable `wire:key` derived from
the record id. Actions that trigger requests go outside the island, because an action fired from inside is bound to
that island and re-renders it, which would wipe the decrypted data. The input field carries no `wire:model`: Alpine
reads it from the DOM and encrypts before calling the component.

The master key in use lives in the scope of an ES module, never in `x-data`. It survives `wire:navigate`, which only
replaces the body, and redirects inside the authenticated area use `navigate: true` to avoid triggering a reload. How
it survives a full page load, which `navigate` cannot always avoid, is decided in ADR 0003
(`docs/adr/0003-master-key-survival-in-browser.md`).

The boundary with Filament is this: Filament handles the panel, the navigation, the policies, the actions, and the CRUD
of the plaintext columns. Views showing encrypted data are our own Livewire components. Inside Filament we only use
custom fields and columns when a record mixes plaintext and encrypted data and splitting the screen would come out
worse.

The server validates the outer shape and the authorization, never the content: envelope format, maximum size,
encoding, and permissions. Content validation becomes a client-side interface aid, with no integrity guarantee.

For the first version there is no search over encrypted data, and the panel's global search is disabled from the start.

## Rationale

Taking ciphertext out of the snapshot is not an optimization, it is what makes it structurally impossible for a slip to
persist it into the state. The cost was real too: with four 50 KB fields, the snapshot moves on the order of half a
megabyte per interaction against a 1 MB cap per request, and the HMAC is recomputed over the whole blob twice.

We considered three alternatives. Keeping ciphertext in public properties is the most direct option and the first one
we thought of, but it pays that cost on every round trip and leaves the ciphertext exposed to being mistaken for
ordinary state. Using custom Filament fields with `$entangle` works, because what gets entangled is ciphertext and
ciphertext is meant to go to the server, but the state of a Filament field is public properties, so it inherits the
same cost; we reserve it for mixed screens. Pulling the data through a dedicated HTTP endpoint, outside Livewire, is
the most efficient route for large blobs, and we keep it for attachments, not for the general flow.

On search, we rejected doing it client-side over a paginated table: Filament paginates in SQL, so you would only search
within the visible page and the result would be an interface lie. A blind index would allow exact equality on the
server, but it leaks the frequency histogram of the column, which in clinical data is exactly what has to be protected.
Doing without search in the first version leaves the system with the strongest privacy property and closes no doors.

* **Pros**: the snapshot stays a few hundred bytes; plaintext data cannot be persisted by mistake; Filament keeps the
  panel, the policies, the actions, and the plaintext CRUD; the server remains the authority on authorization.
* **Cons**: we have to write our own components for every view with encrypted data; content validation stops being a
  guarantee; we lose search, sorting, aggregates, export, and any server-side rendering of content; and reloading the
  page forces re-authentication.

## Consequences

We add two guardrails, because the ways to break this do not fail visibly. On the client, a Livewire request
interceptor inspects what goes out and aborts if it finds a long value without the encrypted envelope prefix. On the
server, a listener on property updates rejects the same thing. Both come with a test checking that no public property
of the snapshot contains anything that is not metadata or an encrypted envelope.

Banned in components handling encrypted data: `wire:model` in any variant, `$entangle` over plaintext data, Alpine's
`$persist`, `wire:replace`, islands with `always`, and properties exposed in the URL.

Honoring that last ban in our own code is not enough: Filament pages ship six properties that publish the open action
and its arguments in the address bar, and an event identifier there is already clinical metadata. The base page our
screens inherit from redeclares them without that behavior, with a test that fails if any of them shows up again.

Attachment upload cannot use `wire:model` on the file input, which would send the original file, and the file name is
replaced with an opaque one before uploading because the name is clinical data.

Filament resources with encrypted content define no title attribute, so that breadcrumbs and delete modals do not show
ciphertext. The panel's exports and imports are removed: they run on a queue, with no browser and no key.

Two things this decision assumes and that are still unresolved. The key is derived per user, so today the owner cannot
share a record with a professional, and sharing is the whole point of a PHR. And if a user loses their password, their
data is unrecoverable as long as no escrow mechanism exists. Both shape the key scheme and are worth closing before the
first components are written.

The first one already has a design: ADR 0011 (`docs/adr/0011-shared-clipping-for-professionals.md`) shares an encrypted
clipping with its own key, without touching the per-user derivation. Its package uses the `s1.` prefix, which the two
guardrails here would abort, so it goes up through a dedicated HTTP endpoint outside Livewire — the route this ADR
reserves for large blobs.
