# ADR 0004: Client-side cryptography: dependencies and encrypted data format

* **Status**: Accepted
* **Date**: 2026-07-25
* **Updated**: 2026-07-27
* **Decider**: Development Team

## Context

ADR 0002 and ADR 0003 fixed what the client does with cryptography, but not what it does it with. Time to choose the
JavaScript dependencies, which are the only third-party code with access to key material and therefore what most needs
to stay small and auditable.

One finding forces the decision now. `docs/OPAQUE.md` specifies deriving the KEK with HKDF-SHA-512 using
`libsodium-wrappers`, and that package **does not expose that function**: it publishes the HKDF constants but not the
operations, neither in its standard build nor in the `sumo` one. The standard build does not ship SHA-512 or
HMAC-SHA-512 either. Verified by running it. The specification is not implementable as written.

The constraints that narrow the choice: no Node in production, working on Safari and iPadOS because clinical staff use
iPads, interoperating with the PHP server where needed, and not creating key material that ends up persisted in the
browser with nobody to clean it up.

## Decision

For the login protocol we use `@serenity-kit/opaque` pinned to version 1.1.0 exactly, which bundles `opaque-ke` 4.0.1
and therefore final RFC 9807. It is the only live option: every other OPAQUE client on npm follows 2022 drafts, is
abandoned, or publishes without an auditable repository. The KSF parameter is set explicitly (Argon2id, three
iterations, 64 MiB, parallelism four) and passed to `finishRegistration` and `finishLogin`, never to the `start`
functions, where it is silently ignored despite what its documentation says.

For data encryption we use `@noble/ciphers` and `@noble/hashes`, both pinned to version 2.2.0 exactly. They provide
XChaCha20-Poly1305-IETF and HKDF-SHA-512, have no transitive dependencies, are pure JavaScript with no WebAssembly, and
weigh nine kilobytes compressed against libsodium's hundred and fifty.

We keep XChaCha20-Poly1305 for clinical fields and reserve WebCrypto's AES-256-GCM for chunks of large attachments,
where hardware acceleration multiplies throughput twentyfold and adds not a single byte to the bundle. WebCrypto keys
are ephemeral and live only in memory: no key material is persisted in any browser store.

The encrypted envelope is binary and versioned from the very first record: version, algorithm identifier, KDF
identifier, flags, **key identifier**, salt, nonce, and ciphertext with its tag, transported as `v1.` followed by
base64url. The key identifier is reserved even though it is unused today, because otherwise future rotation and sharing
would require re-encrypting the whole history, and that is precisely what the server cannot do.

Each envelope is encrypted with a derived key, and the `info` of that derivation and the AEAD associated data carry the
same context: who the user is and what identifies the record within its table. What identifies the record depends on
the feature and is fixed by each ADR: for tracking events it is the instant they occurred (ADR 0006). The field name
enters that context only when encrypting field by field; when the envelope covers a whole record, there is no such
field.

These data-at-rest rules apply to any feature that encrypts, not just the first one:

**Padding to fixed sizes before encrypting** (256, 1024, 4096 bytes). Ciphertext length gives the content away: if one
record type takes 120 bytes and another 2,000, the server classifies them without decrypting anything and encrypting
the type is left as decoration. Padding costs a few bytes today; doing it later would require re-encrypting the
history.

The three sizes work for a single record and not for a large package. Sharing a clipping with a professional (ADR 0011,
`docs/adr/0011-shared-clipping-for-professionals.md`) is the exception and goes with its own format: transport prefix
`s1.` instead of `v1.`, its own ladder from 64 KiB to 4 MiB, compression before padding, its own validator on the
server, and associated data without `user_id`, because there it is the reader that builds it. The ladder here is not
widened: it would stop narrowing events down.

**A version inside every envelope**, which is never removed. Adding an optional field does not bump it; changing the
meaning of an existing one does. Migration is lazy and client-side, on rewriting the record: there is no migration job,
because the server cannot read the data. The client keeps a reader for each version that has ever existed and none is
ever deleted.

**Decimals as strings** (`"1.50"`), treated the way money is treated: fixed point in storage. In medication doses we do
not want the floating-point conversation.

**Stable tokens, never visible labels** inside the envelope: `"breakfast"`, not `"Desayuno"`. Labels are translated
into the languages of ADR 0005; tokens are not.

**Canonical date form** whenever a date enters the associated data or the derivation: `YYYY-MM-DDTHH:MM:SS.ffffffZ`,
always UTC, `Z` suffix, always six digits, zero-padded if the source gives less precision. The client canonicalizes on
encrypt and on decrypt, without trusting the format that arrives over the network. Plain ISO 8601 is not enough: it
allows variants that are different bytes, and the project's own tools produce three mutually incompatible forms. For
the same reason, when a user identifier enters the associated data, it enters in its canonical textual form in
lowercase and not as bytes.

**Decryption failure**: if the associated data does not match, the client cannot tell tampering from corruption, but in
both cases it must treat it as a visible error and never silently hide the record. A clinical record that disappears
without warning is worse than one shown as unreadable.

We write by hand, in `resources/js/crypto/`, the base64url codec with the canonicity check the project requires, the
envelope format, memory zeroization, and attachment chunking. That is about a hundred and fifty lines and no library
does exactly what we need.

Browser state is inventoried and closed: the master key in use lives in memory, its wrapped package under the session
secret lives in `sessionStorage`, and there is nothing else. No IndexedDB, no `localStorage`, no service worker,
no persisted keys. Zeroization applies only to our own byte buffers, and even there it is at most an attempt: a
password is an immutable JavaScript string and the OPAQUE WebAssembly keeps its copies in its own memory for as long
as the tab lives.

We pin versions with no ranges, with `save-exact` and `ignore-scripts` in `.npmrc`, installation with `npm ci`, and
`npm audit signatures` as a blocking continuous integration step.

## Rationale

We rejected `libsodium-wrappers` for three cumulative reasons, not out of preference: it cannot derive the KEK, it
weighs seventeen times more, and it publishes no provenance attestations on npm. Its WebAssembly is embedded in base64
and cannot be used partially, so using a single function costs the whole package, and it forces you to wait for it to
compile before decrypting the first screen.

We rejected solving it with WebCrypto alone because it implements ChaCha in no browser, and giving up XChaCha20 means
losing the 192-bit nonce that lets you generate it at random without keeping counters. With a small team, the design
with fewer ways to break by accident is worth more than the one that performs better in a microbenchmark, and for text
fields the performance difference between the three routes is irrelevant.

We rejected vendoring the libraries' code into the repository. It seemed consistent with wanting little third-party
code, but we would lose automatic signature verification and security alerts, which is exactly what protects us today
from an npm compromise, and it would not defend against the most likely vector, which is a compromise of our own
server.

* **Pros**: the whole crypto stack weighs about ten kilobytes compressed and has no transitive dependencies; there is
  no startup cost because there is no WebAssembly to compile before the first decryption; both libraries have a Cure53
  audit and verifiable provenance; the versioned envelope allows migrating later without re-encrypting everything at
  once.
* **Cons**: we depend on two projects with a single publishing maintainer each; the OPAQUE WebAssembly is not
  reproducible from source, so verifying it is limited to the provenance of the build; and maintaining two algorithms
  adds one more code path to audit.

## Consequences

`docs/OPAQUE.md` needs its client-side encryption section rewritten — it currently describes something that cannot be
implemented — and a correction: a wrong password returns `undefined`, not `null`.

The AEAD associated data is not decoration. If the envelope is not tied to its context, a compromised server can move
the ciphertext from one patient's allergies field into another patient's diagnosis field, and the client will decrypt
it with no error at all. Tying it to the user, the record, and the field, in the AEAD and in the derivation, makes that
move fail twice over.

Continuous integration gets three blocking checks: signature and attestation verification, a fixed registration and
login vector that must keep producing the same `exportKey`, and cross-language test vectors of the envelope format
between PHP and JavaScript even though the server never decrypts. Without the second, a change to the KSF would show up
in production as every user losing access to their master key.

Updates to these dependencies are not automated: a fourteen-day quarantine and a read of the full diff before bumping a
version. Releases are rare and small, so it is workable.

The Argon2id parameters (three iterations, 64 MiB, parallelism four) stay as they are and are not measured before
production: measurement will happen with real users and real devices. This is an explicitly accepted risk: if they turn
out too slow on an old device, changing them afterwards forces every registered person to register again from scratch.
There is a cheap mitigation that blocks nothing: the first user, who is the one bootstrapping the system, can measure
it on the oldest device they have available before inviting anyone else, and that catches the bad case while it still
costs nothing.

One thing is left to decide before the first data is written in production: whether a trial is worth it with the master
key living as a non-extractable WebCrypto object, which persists nothing and would take the bytes out of the JavaScript
heap.

The first application of these rules is tracking event capture, in ADR 0006
(`docs/adr/0006-encrypted-event-model.md`), which also fixes what identifies an event within its table and how the
split between plaintext columns and encrypted content ends up.

## Decision History

### 2026-07-27 — Padding to three fixed sizes stops being universal
Previously decided: the 256, 1024, and 4096 byte sizes applied to any feature that encrypted, with no exceptions.
Changed because: a sharing package does not fit there by a long way, and widening the common ladder would have stopped
narrowing single events down. ADR 0011 defines a sibling format with its own ladder, its own prefix, and its own
validator; the rest of the data-at-rest rules still apply to it the same way.
