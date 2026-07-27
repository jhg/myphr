# ADR 0009: Account creation, where the key is born, and session end

* **Status**: Accepted
* **Date**: 2026-07-25
* **Updated**: 2026-07-26
* **Decider**: Development Team

## Context

Three moments of the lifecycle were still unwritten and until now implicit: how a user appears in the system,
where their master key is born, and how their session ends. All three touch authentication, encrypted
configuration, and the data model at once, so it's better to decide them together.

The master key is random, it encrypts all of the user's data, and the server can never see it. That fully
constrains account creation: there is no way to create an account with usable data without a person typing
their password into a browser.

## Decision

There are three ways to create an account. A person can sign up themselves from the login screen, with no
invitation code: they type their name, their email, and their password, and the browser runs the OPAQUE
registration right there, with no link in between. An existing user can create another person's account from
the panel, or the first user is created with a console command; in these two ways, all that gets created is
the user row and a single-use link that expires in 24 hours, as an explicit parameter of the command and not
a hidden default.

**Public sign-up reveals whether an account exists.** If the email already has an account, the form says so,
so the person can go and log in instead of thinking their sign-up got lost. The entire OPAQUE design in this
project is built for the opposite: login has a fake branch that answers identically in shape and in cost when
the account doesn't exist, precisely so as not to give accounts away (`docs/OPAQUE.md` reasons it out in
detail). The sign-up form opens that door from another side, and it's a deliberate, narrowly scoped decision,
not an oversight: without saying it, someone who mistypes their email has no way of knowing what happened to
them or what to do next. It is mitigated with a per-IP attempt limit, stricter than the one for invitation
sign-up because here there is no link token to spread the abuse across several buckets.

**In the invitation path and in the first-user path, the link is shown on screen once and never sent by
email.** The application hands it to the administrator who issues it, and it's up to them to get it to the
person through whatever channel they choose. Sending it by email would serialize the URL into the jobs table
and push it through the mail provider, which can log it, and that adds a surface that doesn't exist today.
The accepted cost is that this path always carries a manual communication step.

**The master key is always born in the browser, whether the person uses a link or signs up themselves.** The
person chooses a password, the OPAQUE registration runs, out of it comes the key encryption key, the browser
generates a random master key, wraps it with the KEK, and sends the server only the wrapped version. The
server never sees the key at any point, not even transiently.

The first user is created with an Artisan command that **only issues the link**, without generating any key.
The administrator opens it in their browser and their key is born exactly like anyone else's. From there on,
that user creates the other accounts with the same mechanism, and anyone can also sign themselves up through
the public path.

What doesn't change: the master key is still born in the browser and the password still never reaches the
server, in all three paths. The invitation link still exists for creating someone's account from the panel,
and the console command is still the path for the first user: public sign-up is one more path, not a
replacement for either of the other two. The lack of email verification doesn't change either: neither a
consumed link nor a public sign-up proves that the person controls the mailbox, so the usual consequence
still stands, if the password is forgotten, the data is not recoverable.

The session locks after fifteen minutes of inactivity and asks for the password again. The lock is a hard
reload, not an overlay screen, because the JavaScript context has to be destroyed to clear the DOM
snapshots Livewire retains with decrypted data, as ADR 0003 requires.

**Locking means destroying the session secret on the server**, not just clearing the browser's memory. The
recovery mechanism from ADR 0003 exists precisely so that a reload doesn't throw the user out: the encrypted
package is still in `sessionStorage` and the client can ask for the secret again and open it without a
password. If the lock doesn't kill that secret, the lock's reload is exactly the case recovery solves and the
lock locks nothing. And the server has to do it: deleting the package on the client isn't enough, because
whoever has the machine in front of them can stop that code from ever running.

The lock closes the whole session, not just the secret. Leaving the Laravel session alive keeps the user
inside the panel, with access to other people's plaintext data and to destructive actions such as reissuing a
link, which is exactly the shared workstation risk that motivates the fifteen minutes. And the server counts
the timeout from the last authenticated request: a timer in the browser doesn't run in a tab the system has
discarded, nor in one that was never opened.

Coming back in is then a full authentication: the key is derived from the password and there is no shortcut.

## Rationale

The alternative was for the console command to generate the first user's master key on the server, which is
the convenient thing. It breaks zero-knowledge for that account, because the server would hold the key in the
clear even if only for an instant, and above all it sets a precedent someone will copy for the next case that
looks harmless. Having the command issue a link costs the same and leaves a single mechanism with no
exceptions to explain.

Fifteen minutes is a balance between a shared workstation, where the risk is someone getting up and leaving
the session open, and the real use of someone who records a blood glucose reading, gets distracted, and comes
back. It's a parameter and it can be revisited with real usage, but it's better for it to be explicit and not
whatever the framework ships by default.

* **Pros**: there is no path by which the server touches a master key; public sign-up, invitation, and the
  first user share the same key birth; the idle lock leaves no decrypted data retained in memory; and public
  sign-up lets anyone start using the application without depending on someone else inviting them.
* **Cons**: bulk account creation can't be automated without every person going through a browser; the first
  start-up requires a manual step; fifteen minutes of inactivity force typing the password again, which with
  Argon2id is not instant on a slow device; and public sign-up confirms whether an email already has an
  account, an existence oracle the rest of the design deliberately avoids.

The Laravel session lifetime stops being a loose parameter: if it is longer than the lock, nothing happens as
long as the lock destroys the secret, but it's better to review them together and not let one change without
looking at the other.

## Consequences

**The link is for setting the initial password, not for recovering it.** If it is issued against an account
that already has data, the person will be able to log in with a new password and **will not be able to open
anything from before**, because the master key was wrapped under the key derived from the old password. It's
not a bug, it's the direct consequence of there being no recovery in this version, but the interface has to
stop anyone from using it believing it helps: an administrator resetting a user's password destroys their
history.

That's why the master key envelope is append-only: issuing a link never overwrites the existing one, a new
one is stored and the previous one is left retired with its date. Without that rule, reissuing destroys the
only ciphertext the old password knew how to open, and a loss that was recoverable for anyone who remembered
it stops being so. Issuing against an already registered account requires explicit confirmation, and that
guard lives in the service that issues links, not in each interface that calls it.

Changing the password for someone who does remember the current one is a different thing and it does work:
the master key is opened with the old password and wrapped again with the new one, without touching the data.
**That flow is implemented**, so for a compromised password or one you want to rotate, the correct path is
the password change, not reissuing the link: the link is left only for someone who has forgotten it
completely, with the loss the previous paragraph describes.

The flow is four routes under the panel's `password` prefix (`reauth/start`, `reauth/finish`,
`registration/start`, and `change`, in `PhrPanelProvider`), served by the
`app/Http/Controllers/Auth/Opaque/PasswordChange*` controllers: reauthentication is a full OPAQUE login
against the current password —which also returns the envelope for opening the master key— and the
registration rebuilds the credential with the new one. The master key doesn't change, it's only re-wrapped,
so the history is kept whole. It comes with its own `opaque-password-change` rate limiter (5/min per user,
30/min per IP), stricter than the login one because each attempt costs a full handshake, and
`tests/Feature/PasswordChangeTest.php` covers it.

The activity log records account creation and link use, without content, as ADR 0006 requires.

The fifteen-minute lock has an awkward effect on sharing with professionals
(`docs/adr/0011-shared-clipping-for-professionals.md`): it destroys the screen showing the link, the QR, and
the PIN while the person is waiting in the waiting room. We're not changing the timeout for that; it's
handled by warning that the PIN has to be written down right away and recommending generating the clipping
before going into the appointment.

The normalized login is fixed once the account is registered: the credential identifier was derived from it,
changing it would leave the envelope unrecoverable and would reintroduce the enumeration oracle that
`docs/OPAQUE.md` describes. Neither consuming a link nor completing a public sign-up verifies the email: the
first is handed over by an administrator through whatever channel, and the second is typed by the person
themselves without anyone proving control of the mailbox, so nothing is ever marked as verified. And entering
the panel requires only having a complete OPAQUE registration on an active account: any criterion that
depends on another user approving leaves the first one with nobody to approve them.

The Artisan command neither receives nor asks for passwords, so there's no risk of them ending up in the
shell history or in the server logs.

**The user's name is stored in the clear.** The login identifier is already in the clear out of necessity, so
encrypting the name adds little real privacy and in exchange would break the user menu, the breadcrumbs, and
the Filament administration listing, which resolve them on the server. It is a deliberate, narrowly scoped
exception to the general rule of encrypting, and it doesn't extend to any other field.

The other exception, with the same reasoning and decided later, is the interface language in `users.locale`:
ADR 0007 (`docs/adr/0007-encrypted-user-configuration.md`) documents it with its cost.

## Decision History

### 2026-07-26 — Public sign-up is added, with no invitation
Previously decided: there was no public sign-up. Only an existing user could create another person's account
from the panel, or the first user was created with the console command; in both cases with a single-use link.
Changed because: we decided to open sign-up directly from the login screen, with no invitation code, so that
anyone can create their account without depending on someone else inviting them. This introduces a trade-off
that didn't exist before, public sign-up reveals whether an email already has an account, and it is
deliberately accepted because without saying it, the person who mistypes their email has no way of knowing
what to do. It is mitigated with a per-IP attempt limit. The two earlier paths, the invitation and the
console command, still exist unchanged.
