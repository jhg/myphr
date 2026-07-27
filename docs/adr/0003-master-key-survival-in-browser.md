# ADR 0003: Master key survival in the browser

* **Status**: Accepted
* **Date**: 2026-07-25
* **Decider**: Development Team

## Context

ADR 0002 left the master key living in the scope of an ES module, and with it an uncomfortable consequence: any full
page load destroys it and forces re-authentication. The initial proposal was to turn the whole panel into an SPA so
that such a load never happens.

Filament's SPA mode exists, is off by default, and covers the panel well, but the redirect after login is a hard
load, verified by running the flow against the installed code. The key would die right after being derived.

And the SPA does not solve the problem it appeared to solve. Out of its reach: a manual F5, a 419 from an expired
session, a hard redirect from a middleware, a tab crash, a new tab and, above all, a deployment mid-session. Filament
marks all of its assets to force a reload when it changes version, so updating the package kicks out every connected
user.

On browser primitives, tested in Safari 26.5 and Chromium 145, the finding that decides it: none of them lets you
recover a key after a reload without giving that same ability to a same-origin XSS. What you do get to choose is which
other adversaries you protect against.

## Decision

We turn on the panel's SPA mode, without prefetching, with exceptions for same-domain URLs that do not serve HTML
(downloads, PDFs, exports), because Filament marks any same-host link for navigation and a binary run through the HTML
parser breaks the interface. The SPA is an interface decision and it is not what holds the key: the crypto module is
loaded in the document head, which Livewire navigation preserves without re-executing, SPA or no SPA.

We replace the login page with our own, which we needed for OPAQUE anyway. In doing so we stop going through Filament's
response flow, so the destination the user was trying to open has to be returned by us in the login response rather
than assumed.

The key's survival, however, does not rest on the SPA. On authentication, the server generates a random secret tied to
the Laravel session and hands it to the client. The browser stores in `sessionStorage` the master key wrapped under a
key derived from that secret. After a page load, the client asks a dedicated endpoint — authenticated with the session
cookie — for the secret, opens the package, and recovers the key without asking for the password. That way it survives
F5, the 419, the hard redirect, and deployment, and it dies when the tab is closed. The server's half expires and can
be revoked, so any material left orphaned in the browser opens nothing.

`sessionStorage`'s per-tab scope is a visibility property, not a deletion one: browsers persist it in the profile to
restore the session after an unexpected close. What makes that material useless is not its volatility, it is that the
secret that opens it lives on the server and can be revoked.

**The Laravel session has to live on the server**, with a database or Redis store, never with the cookie driver. With
cookies, the session content travels to the browser on every request and the client would then hold both halves at
once, so the whole property falls over from a one-line config change, with no visible symptom.

The session secret has no table or column of its own: it is stored inside the Laravel session payload itself. With a
server-side store and no cookie driver, revocation still works the same, because destroying the session destroys its
payload and with it the secret, with no extra mechanism to maintain. What we lose is the ability to inspect or
selectively revoke someone's crypto session without deserializing their payload; that is accepted in exchange for not
maintaining a schema of our own for a single value.

So there are two independent wrapped copies of the same master key: the permanent one under the KEK derived from
`export_key`, which lives on the server and is opened at login with the password, and the recovery one under the
session secret, which lives in the browser. The rule that holds the design together is that the package and the secret
can never be in the same place: if the package were stored on the server, the server would hold both halves and could
open the master key on its own.

We do not use persistent browser storage for key material. A device key in IndexedDB would add protection only against
someone who obtained both a copy of the browser profile and the session secret, and in exchange it would leave key
material that survives logout and a change of user on a shared workstation, with no deletion guarantee.

Three moments use a hard reload deliberately: logout, the idle lock, and landing on the login page with the key still
in memory. Livewire keeps up to ten DOM snapshots of already-visited pages in memory, with decrypted clinical data, and
exposes no way to purge them: only destroying the JavaScript context removes them.

We assume losing the key is a normal and frequent state, not an error. The interface degrades to asking for
authentication, never to a broken screen.

## Rationale

Doing SPA alone cost a rewrite of the panel in exchange for reducing how often the problem happens, with no security
gain, and it tied the whole application architecture to a cryptographic property. Persisting the wrapped key solves
more cases for far less code. The two complement each other: the SPA avoids navigation reloads, which are the most
frequent, and persistence covers the ones the SPA cannot avoid.

We rejected three alternatives. Persisting a non-extractable WebCrypto key in IndexedDB brings no server-side
revocation and, with the encryption library we chose in ADR 0004, does not protect against XSS either, because the
master key has to materialize as bytes to be usable. An all-WebCrypto chain would avoid that, and that is why ADR 0004
leaves it as a pending trial, but it is a decision about the encryption algorithm, not about where the key is stored. A
Service Worker as custodian does not work: the browser terminates it after thirty seconds of inactivity and a
deployment restarts it with empty memory, so it loses the key more often than the reloads it aimed to avoid, and it
adds attack surface on top. `localStorage` is rejected outright because it persists indefinitely and is shared across
tabs and sessions, which is the exact opposite of what we want on a shared workstation.

* **Pros**: F5, the 419, and deployment stop throwing the user out; the persisted material is useless without the
  server session, so it does not depend on anyone cleaning anything up; we gain session revocation over data that is
  already decryptable, which does not exist today; `sessionStorage`'s per-tab scope fits a shared clinical workstation.
* **Cons**: opening a new tab still requires authenticating, because `sessionStorage` is not inherited; SPA mode
  doubles the interface test surface, since every screen also has to be tested when reached by navigation; and we still
  have no real defense against XSS.

## Consequences

Deployment becomes an operation with clinical impact: it is not just updating Filament, it is rebuilding any of our own
assets, and it happens the same with SPA mode off. Either case throws out every connected user on their next
navigation, losing work in progress. It needs a maintenance window or advance notice, and it has to be treated as an
operational requirement, not an infrastructure detail.

On a 419, Livewire asks for confirmation and reloads, which for someone with a half-written note is data loss. We need
to intercept it with our own warning that lets the draft be kept before reloading.

Turning on SPA mode's prefetching is banned: it preloads on mouse hover, which generates unrequested accesses to
medical records in the audit log. Every redirect of ours carries explicit navigation, and we add a client-side safety
net for third-party redirects that do not.

`APP_DEBUG` stays off in every environment with real data, staging included: on a 500 error, Livewire opens the trace
in a dialog without reloading, and that trace can contain clinical data in the arguments.

We describe the system precisely: it is zero-knowledge with respect to storage — meaning the database, backups, staff
with SQL access, and the hosting provider — and it is not zero-knowledge with respect to delivery, because whoever
controls the server that serves the JavaScript can serve a version that captures the key. The phrasing "the server
never sees anything" is false and must not be used in front of an audit. Sharing with professionals in ADR 0011
(`docs/adr/0011-shared-clipping-for-professionals.md`) makes that half worse: its page is opened on other people's
devices and with key material in the URL itself.

Three decisions are pending and are not taken here. Biometric-gesture unlock through the WebAuthn PRF extension would
solve the new tab without persisting key material, but support for it is still uneven. Moving the cryptography to a
separate origin is the only measure with real effect against XSS, and it costs less than rewriting the panel. And
migrating data encryption to WebCrypto only makes sense before there is production data.
