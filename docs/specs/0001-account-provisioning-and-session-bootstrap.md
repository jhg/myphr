# Spec 0001: Account provisioning and session bootstrap

* Related ADR(s): `docs/adr/0002-encrypted-data-flow-livewire-alpine-filament.md`,
  `docs/adr/0003-master-key-survival-in-browser.md`, `docs/adr/0004-client-crypto-and-data-format.md`,
  `docs/adr/0007-encrypted-user-configuration.md`, `docs/adr/0009-user-provisioning-and-session-lifecycle.md`,
  `docs/OPAQUE.md`

This spec depends on the previous ADRs and on `docs/OPAQUE.md` as prior reading: it does not repeat their
rationale, it only applies it. If a point in this spec and an ADR disagree, the ADR wins and this spec has an
error to fix.

## 1. Scope

It covers everything that happens from the moment an administrator runs the Artisan command that issues a link
until the invited person is inside the panel, with their master key (User Master Key, UMK) in memory and ready
to encrypt and decrypt data.

It includes: server setup (`opaque:setup`), issuing registration links, public sign-up without an invitation,
setting the initial password and the birth of the UMK, later logins, recovering the UMK after a page reload, the
idle lock and logout.

Explicitly out of scope:

* **Password change** by someone who remembers the current one. It exists and works (`password/*` routes of the
  panel, `Auth\Opaque\PasswordChange*` controllers, `tests/Feature/PasswordChangeTest.php`); ADR 0009 describes
  it and this spec does not develop it because it is not part of session bootstrap. Reissuing the link, with the
  loss of history it implies, is only for a **forgotten** password.
* **Account recovery** with no password and no new link. There is no escrow in this phase (ADR 0002).
* **Sharing** data with a professional or another user. The key identifier in ADR 0004 reserves the slot, but
  nothing uses it yet.
* The **pattern for screens with encrypted data** once the user is inside the panel (islands, cursor-paged
  batches, Alpine components of a specific view). That is a spec of its own, written when the first real screen
  exists.

## 2. User stories

**Administrator starting the system up.** Before any user exists, someone with access to the server runs
`php artisan opaque:setup` once. The command generates the static server key material and prints it to the
screen; the person copies it into the environment configuration. Without this step nobody can be registered.

**Administrator creating another person's account.** An already registered user (the first one is created with a
console command, the rest from the panel) enters the name and email of a new person. The system creates the user
row, with no password and no key, and generates a single-use link. The link is shown on screen once; the
application never sends it by email. The administrator gets it to the person through whatever channel they
choose.

**Person setting their password.** They open the link in their browser, type a password and its confirmation.
The browser runs the OPAQUE registration, generates their random UMK, wraps it and uploads the result to the
server in a single operation. If all goes well, they end up authenticated and inside the panel with no second
login form.

**Person signing up without an invitation.** They reach the login screen, click the sign-up link and type their
name, their email and a password, with no invitation code at all. The browser runs the same OPAQUE registration
as the invited person, with the difference that there is no link to consume: they supply the name and the email
themselves. If the email already has an account, they see a message saying so, with a direct link to log in,
instead of a generic error that leaves them not knowing what to do.

**Person logging back in.** They type their login and password on the login screen. The browser runs the full
OPAQUE login, recovers their existing UMK and enters the panel.

**Person reloading the page.** An F5, a 419 error or a deployment mid-session do not ask for the password again:
the browser recovers the UMK from a secret tied to their server session, without deriving anything from the
password again.

**Workstation left unattended.** After fifteen minutes with no activity, the session is closed completely, on
the server and on the client. The next person to touch the keyboard sees the login screen, not a panel with
somebody else's data.

## 3. Data schema

Everything that follows assumes that the primary key of `users` is a **UUID (UUIDv7)**, decided before writing
the first migration. It is a project decision, not one specific to this feature, but it blocks it: the `user_id`
goes into the AEAD associated data and into the `registration/start` response, so changing the key type after
encrypting the first envelope invalidates the AAD of the whole history. The form that goes into the derivation
and into the AAD is always the canonical lowercase text representation of the UUID, never its raw bytes
(ADR 0004).

### 3.1 New columns on `users`

`id`, UUID (UUIDv7), primary key: replaces the current autoincrement `bigint`.

`password`, `string` nullable: not used to authenticate. It stays nullable for framework compatibility; see the
`AuthenticateSession` limitation in section 9.

`opaque_credential_identifier`, 32-byte binary, unique, nullable:
`HMAC-SHA-256(ENUM_KEY, normalize(login))`, computed at registration and reused from then on (OPAQUE.md section
13.1).

`opaque_registration_record`, 192-byte binary, nullable: `client_public_key || masking_key || envelope`, exactly
as it arrives from the client.

`opaque_profile`, `varchar(96)` nullable: full profile name (it includes the KSF parameters, see ADR 0004 and
OPAQUE.md section 2).

`opaque_registered_at`, nullable timestamp: filled in when `registration/finish` completes. `NULL` is
indistinguishable from "account does not exist" for the purposes of the login fake branch (OPAQUE.md section
13.3).

`encrypted_settings`, `text`, nullable in the schema but never empty after account creation: the single
encrypted configuration envelope (ADR 0007). It is written with empty content `{"v":1}` during that same account
creation, so that no user is distinguishable from another by having configuration or not.

`email_verified_at` is not added at account creation: the link is delivered by an administrator through a
channel the application does not control, so nobody has proved control of the mailbox. A column claiming
otherwise would end up being used as if it were true.

The `name` column, already present in the Laravel base schema and not new, is stored in the clear, unencrypted.
The login identifier is already in the clear out of necessity, so encrypting the name would add little real
privacy and would break the user menu, the breadcrumbs and Filament's administration listing, which all resolve
it on the server. It is a deliberate, narrowly scoped exception to the general rule of encrypting (ADR 0009),
and it does not extend to any other field.

`SQLite`, this project's default driver, has no real `BINARY(n)` type: `->binary()` generates a `BLOB` with no
length. The exact lengths (32, 192 bytes) are always validated in the application layer, never taken as
guaranteed by the schema.

### 3.2 OPAQUE tables

**`opaque_registrations`** (pending registration, OPAQUE.md section 14.2):

| Column | Type |
|---|---|
| `id` | UUID, primary key |
| `user_id` | UUID, fk |
| `invitation_ref` | UUID, reference to the registration link that originated it |
| `credential_identifier` | binary, 32 bytes |
| `profile` | `varchar(96)` |
| `expires_at` | timestamp |
| `created_at` | timestamp |

**`opaque_login_handshakes`** (state of a login in progress, OPAQUE.md section 14.3):

| Column | Type |
|---|---|
| `id` | UUID, primary key |
| `user_id` | UUID, nullable (null in the fake flow) |
| `state_ciphertext` | `text`, `ServerLoginState` encrypted with Laravel's `Crypt` |
| `expires_at` | timestamp, 180-second TTL |
| `created_at` | timestamp |

Both tables need scheduled pruning of expired rows (`opaque:prune-handshakes` or equivalent): every
unauthenticated `login/start` creates a row, so without pruning the growth is driven by anyone from outside.

### 3.3 Registration links

**`user_registration_links`**:

| Column | Type |
|---|---|
| `id` | UUID, primary key |
| `user_id` | UUID, fk |
| `token_hash` | binary, 32 bytes, unique (`sha256` of the plaintext token) |
| `expires_at` | timestamp |
| `consumed_at` | timestamp, nullable |
| `created_by` | UUID, nullable, fk to `users` (who issued it, for auditing) |
| `created_at` | timestamp |

The plaintext token is never persisted, only its hash. The TTL is 24 hours, a decision already taken, passed as
an explicit parameter of the command and not as a hidden default (ADR 0009).

### 3.4 Key envelopes: the UMK is append-only

The envelope that wraps the UMK **does not live in a column of `users`**. It lives in its own append-only table,
because reissuing a link can never overwrite the envelope the previous password knew how to open: if it did, a
lost password that was recoverable for whoever remembered it would stop being recoverable (ADR 0009).

**`user_master_key_envelopes`**:

| Column | Type |
|---|---|
| `id` | UUID, primary key |
| `user_id` | UUID, fk |
| `envelope` | `text`, encrypted envelope with the `v1.` prefix (ADR 0004) |
| `created_at` | timestamp |
| `retired_at` | timestamp, nullable |

There is at most one row with `retired_at IS NULL` per user: it is the current envelope. Issuing a link for an
account that already has a current envelope requires explicit confirmation (not a generic "Yes", but typing the
account's email) and, when the registration completes, inserts a new row and marks the previous one with
`retired_at`. That guard lives in the service that issues links (`RegistrationLinks`), not in the command or in
the Filament action: if it lived in two places, one of the two would end up without it, and the command's
`--no-interaction` flag would skip any confirmation placed only in the interface.

### 3.5 Session secrets

The session secret from ADR 0003 lives inside the Laravel session payload itself, with no dedicated table and no
dedicated column. It is minted at login, stored as one more session value and protected by the same server store
(database or Redis) that protects the rest of its content.

Locking and logging out destroy it with no extra mechanism: destroying the Laravel session destroys its payload
and with it the secret (ADR 0003). What is lost compared to a table of its own is being able to inspect or
selectively revoke somebody's cryptographic session without deserializing their payload: there is no row to list
or delete apart from the whole session. It is a loss accepted in exchange for not maintaining a schema of its
own for a single value.

### 3.6 What is decided before the first user

Three things in this section are blocking and cannot be fixed later without invalidating already encrypted data:
the UUID type of `id` on `users`, the canonical form of the user identifier in the AAD (lowercase, textual), and
the 24-hour TTL of the registration link, already decided. All three must be settled before running
`opaque:setup` in an environment with real data.

## 4. HTTP contract

All routes are mounted through the Filament panel, not through `routes/web.php`: the panel already provides the
session, CSRF and the `/phr` prefix. The four OPAQUE routes (registration and login) go in `$panel->routes()`,
which runs outside the authentication middleware group. The two session routes (`session-secret` and `lock`) go
in `$panel->authenticatedRoutes()`, which does require an authenticated session: verified that `routes()` runs
outside the `getAuthMiddleware()` group and `authenticatedRoutes()` inside it.

This diverges from the path described in `docs/OPAQUE.md` section 15 (which talked about `routes/web.php`), but
it meets the substance of the requirement: `web` group, session and CSRF available. `OPAQUE.md` is still pending
correction on that point.

Every response carries `Cache-Control: no-store`. The browser JavaScript sends the CSRF token and uses
`credentials: 'same-origin'` on every request.

### 4.1 `POST /phr/auth/opaque/registration/start`

Unauthenticated. Request:

```json
{ "registrationRequest": "<base64url 32B>", "registrationToken": "<link token>" }
```

The token arrives here and not earlier: there is no prior validation route that consumes it. The
password-setting page is served generically (with no token in the path, see section 7) and the browser reads the
token from the URL fragment (`#<token>`), which never travels to the server except inside the body of this
request.

Response 200:

```json
{
  "registrationId": "<uuid>",
  "registrationResponse": "<base64url 64B>",
  "serverPublicKey": "<base64url 32B>",
  "userId": "<uuid>",
  "profile": "OPAQUE-R255-SHA512-A2ID-m65536-t3-p4-ctx0-v1"
}
```

`userId` is needed here, and not only at the end of the flow, because the client needs it to build the AEAD
associated data before encrypting the UMK and the configuration in step 4 of the cryptographic order (section
5). `serverPublicKey` enables the pinning described in section 5.

Invalid, expired or already consumed token: a generic error, the same shape for all three cases (this avoids
giving away which of the three happened).

Rate limiting: by IP and by token hash.

### 4.2 `POST /phr/auth/opaque/registration/finish`

Unauthenticated. Request:

```json
{
  "registrationId": "<uuid>",
  "registrationRecord": "<base64url 192B>",
  "wrappedUserMasterKey": "<v1. envelope>",
  "encryptedSettings": "<v1. envelope>"
}
```

A single database transaction: it consumes the pending `opaque_registrations`, consumes the matching
`user_registration_links`, inserts the current row into `user_master_key_envelopes`, writes `encrypted_settings`
and updates the user's OPAQUE columns. It does not open the UMK envelope, it does not store the
`RegistrationResponse`, it does not store passwords.

**Idempotent.** If the response is lost on the network but the transaction already ran on the server, a retry
with the same `registrationId` must not fail confusingly or duplicate rows: it detects that the pending row is
gone and, if the user already ended up registered with that same `registrationRecord`, it responds with success
again instead of a generic "registration not found" error. See section 7 for the detail of the failure mode this
covers.

Rate limiting: by IP and by hash of the `registrationId`. It does not share a limiter with `registration/start`,
because this route does not receive the link token: the per-token key would be the one for the empty value for
everybody, that is, a single shared bucket that anyone can exhaust from one IP to block sign-up for the whole
installation.

### 4.3 `POST /phr/auth/opaque/login/start`

Unauthenticated. Request:

```json
{ "login": "user@example.com", "startLoginRequest": "<base64url 96B>" }
```

`login` only locates the account, it never enters the cryptography. Real branch or fake branch per OPAQUE.md
section 13, identical in shape and cost. Always HTTP 200 for structurally valid messages.

Response:

```json
{
  "handshakeId": "<uuid>",
  "loginResponse": "<base64url 320B>",
  "profile": "OPAQUE-R255-SHA512-A2ID-m65536-t3-p4-ctx0-v1"
}
```

Rate limiting: by IP, by hash of the normalized login, and by the combination of both. Never the plaintext email
as the rate limiting key.

### 4.4 `POST /phr/auth/opaque/login/finish`

Unauthenticated until it finishes. Request:

```json
{ "handshakeId": "<uuid>", "finishLoginRequest": "<base64url 64B>" }
```

It consumes the handshake **before** validating the MAC (inverting the order opens a retry oracle over the same
handshake). Failure, in any of its forms (invalid MAC, expired handshake, reused handshake, non-existent user):
a single generic error, with no session created.

Success with a real user:

```php
Auth::guard('web')->login($user, remember: false);
$request->session()->regenerate();
```

followed by minting the session secret, after regenerating the session id, never before (see the table in
section 5: doing it before ties it to a session id that disappears in the regeneration).

Response 200:

```json
{
  "userId": "<user uuid>",
  "redirect": "<intended url or the panel>",
  "csrf": "<new token>",
  "sessionSecret": "<base64url 32B>",
  "encryptedUserMasterKey": "<current v1. envelope>",
  "encryptedSettings": "<v1. envelope>"
}
```

`userId` is essential, not informative: it goes into the associated data of the two envelopes that come in this
same response (step 9 of section 5), so without it the client cannot open them. Section 4.1 returns it for the
same reason. It reveals nothing that whoever receives a 200 does not already know, because the fake branch never
gets this far: it responds with the generic credentials error.

`redirect` is `session()->pull('url.intended', $panelUrl)`, so as not to lose the destination that
`redirect()->guest()` left when a middleware pulled someone out of a deep URL. The OPAQUE `session_key` is not
returned to the browser: the client already has its own copy and the server does not need it after the
handshake.

Rate limiting: the same three keys as `login/start`.

### 4.5 `POST /phr/auth/session-secret`

Authenticated (session cookie, inside `authenticatedRoutes()`). No request body.

It is `POST`, not `GET`: a `GET` is cacheable by design and an intermediary caching this response would write
the secret to somebody else's disk. Headers: `Cache-Control: no-store`, `Vary: Cookie`.

Response 200:

```json
{ "sessionSecret": "<base64url 32B>", "encryptedSettings": "<v1. envelope>" }
```

It includes `encryptedSettings` because the configuration does not travel inside the `sessionStorage` package,
only the wrapped UMK does: without this field here, any screen that starts up through recovery (section 6, the
reload part) would have no unit of measure and no target range until the next full login.

Error responses: `401` if the Laravel session does not exist or expired, `410` if the secret was destroyed (idle
lock or logout, section 8). Both take the client to the login screen.

### 4.6 `POST /phr/auth/lock`

Authenticated. No relevant request body.

It destroys the session secret and the whole Laravel session (section 8), and responds 200. The client does a
hard reload after receiving the response, never before: if it reloads before the server confirms, a network
failure leaves the secret alive on the server with the client already without the UMK in memory, which in
practice is a lock that locked nothing on the server side.

### 4.7 `POST /phr/auth/opaque/registration/public/start`

Unauthenticated. It is the equivalent of 4.1 for someone arriving without an invitation: the same step 4 of the
cryptographic order in section 5, with the user row being created here instead of arriving already created by a
link. Request:

```json
{ "name": "<full name>", "login": "user@example.com", "registrationRequest": "<base64url 32B>" }
```

The login is normalized (`LoginNormalizer::normalize`) before its shape is checked, the same as in
`phr:issue-registration-link`: outer spaces and uppercase are valid variations of the same login, not format
errors.

The `users` row is created with `User::create(['name' => ..., 'email' => $login])` inside the controller itself
(`RegistrationPublicStartController`), with no prior uniqueness check by `SELECT`: the column's `unique`
constraint decides, at `INSERT` time, which of two simultaneous sign-ups with the same email wins. The one that
loses leaves no row and receives a 409 `login_taken`. From there on, the derivation of the
`credential_identifier` and the creation of the pending `OpaqueRegistration` (with `invitation_ref` at `null`,
because there is no link to reference) are the same as in 4.1.

Response 200:

```json
{
  "userId": "<uuid>",
  "registrationId": "<uuid>",
  "registrationResponse": "<base64url 64B>",
  "profile": "OPAQUE-R255-SHA512-A2ID-m65536-t3-p4-ctx0-v1",
  "serverPublicKey": "<base64url 32B>"
}
```

Errors: `422 invalid_registration` for a malformed OPAQUE message or a login that is not shaped like an email,
the same generic error the rest of the subsystem uses. `409 login_taken` when the email already has an account,
deliberately different from the generic one: whoever receives it has to find out that an account with that email
already exists, not believe their sign-up got lost. The sign-up screen (`register.blade.php`,
`resources/js/auth/registerPage.js`) turns this code into a message with a link to log in.

From here on, the flow is identical to 4.2 through 4.4: `registration/finish` with the same `registrationId`,
followed by the immediate OPAQUE login with the same password (section 5, steps 12 to 20).
`registration/finish` tells the origin of the pending row apart by `invitation_ref`: if it is `null`, it does not
try to consume any link.

Rate limiting: by IP only (`opaque-registration-public`, 10/min), stricter than 4.1's because here there is no
link token to spread the abuse across several buckets, and because every attempt, besides querying whether the
email exists, writes a user row.

The screen is served at `GET /phr/register` under the name `filament.phr.auth.register`, from
`RegisterPageController`, which responds with the view without any database query: just like the
password-setting one, there is nothing to validate yet at this point. The link from `login.blade.php` to it
checks with `Route::has()` before using `route()`, a safeguard written back when the route did not exist yet and
kept because it costs nothing and stops the login screen from blowing up entirely if somebody renames the route.

## 5. Cryptographic order of setting the password

It is the most delicate sequence in the whole system: any operation out of order or any step split into two
requests can leave an account that authenticates but has no usable key, with no possible recovery in this phase.

```
 1 [N] await opaque.ready
 2 [N] password <- input.value ; input.value = ''
 3 [N] {clientRegistrationState, registrationRequest} = startRegistration({password})
       no keyStretching here
 4 [S] validates the link token (does not consume it yet) ; evaluates OPRF ;
       inserts the pending row into opaque_registrations
 5 [N] assert(profile === PROFILE_PINNED)
       assert(serverPublicKey === SERVER_PUBLIC_KEY_PINNED)
 6 [N] {registrationRecord, exportKey} = finishRegistration({..., identifiers: {server},
       keyStretching: KSF})
       Argon2id runs here (t=3, m=64 MiB, p=4)
 7 [N] KEK = HKDF-SHA-512(exportKey, info = "myphr/kek/v1")
 8 [N] UMK = getRandomValues(32)                       <- the master key is born here
 9 [N] wrappedUMK        = seal(KEK, UMK, aad = ctx(userId, "umk"))
10 [N] encryptedSettings = seal(deriveRecordKey(UMK, ctx(userId, "settings")), '{"v":1}')
11 [N] zeroize(exportKey, KEK)
12 [S] registration/finish: one transaction -> consume the pending row + consume the link +
       write the current row in user_master_key_envelopes + write encrypted_settings
       (idempotent, sections 4.2 and 7)
13 [N] full OPAQUE login with the same password, still in memory
14 [S] verifies the MAC -> Auth::login -> session()->regenerate() -> mints sessionSecret
15 [N] KEK2 = HKDF(exportKey2) ; UMK' = open(KEK2, encryptedUserMasterKey)
16 [N] assert(UMK' === UMK)                            <- sign-up verification
17 [N] zeroize(password, exportKey2, KEK2)
18 [N] SK = HKDF(sessionSecret) ; sessionStorage['phr.rk'] = seal(SK, UMK) ;
       zeroize(SK, sessionSecret)
19 [N] decrypts encryptedSettings ; updates <meta name="csrf-token">
20 [N] Alpine.navigate(redirect)
```

`[N]` is the browser, `[S]` the server. Steps 13 to 20 are, deliberately, the same order as a normal login
(section 6): instead of creating the session directly at the end of step 12, the client runs a full OPAQUE login
with the password it has just set. It costs one extra Argon2id, but it uncovers right then (while there is still
no data to lose) any mismatch between the KSF or the `identifiers.server` used at registration and the ones
every future login will use, instead of uncovering it at the first real login, already with encrypted data in
the way.

**Public sign-up variant (section 4.7).** Step 4 changes: instead of validating a link token, the server creates
the `users` row from the name and the login that arrive in the request itself and checks the email's uniqueness
at `INSERT` time. Step 12 changes accordingly: the `registration/finish` transaction consumes no link, because
`invitation_ref` is `null` in the pending row. The rest of the sequence, from 1 to 20, is identical, including
the UMK being born from the CSPRNG in step 8 and not from the password.

### What breaks if the order is altered

`keyStretching` in step 3 (`startRegistration`) instead of step 6 (`finishRegistration`): it is silently ignored
and the package default is applied. The `registrationRecord` ends up tied to a KSF different from the configured
one, and every future login that does pass the correct `KSF` fails as "wrong password".

UMK generated before step 6: it does not break the cryptography as such, but it invites the variant where the
UMK is derived from the password instead of being random, which is exactly what ADR 0009 rejects. If the
registration fails afterwards, an orphan key is left that has to be zeroized in the error handling.

Comparing `profile` and `serverPublicKey` (step 5) after step 6 instead of before: at registration there is no
`server_mac` yet, nothing else authenticates the server. Without this comparison before deriving the KEK, a
spoofed server can complete a whole registration without the client noticing.

Consuming the link in step 4 instead of step 12: a network failure during the Argon2id of step 6 leaves the
person with no link and no usable account, with no way to recover other than a manual reissue.

Splitting step 12 into two requests (`registrationRecord` first, `wrappedUserMasterKey` afterwards): a failure
halfway leaves an account that authenticates but has no usable master key. The link is already consumed, the
account is permanently broken. It is the worst failure mode of the whole design, and it is the reason step 12 is
a single transactional request.

Zeroizing the password before step 13: the immediate login of step 13 becomes impossible, and the link is
already consumed, so there is no second chance to set the password without reissuing the link.

Skipping steps 15 and 16 and creating the session directly in `registration/finish`: it saves one Argon2id, but
it opens a second session-creation path to audit separately, and it loses the early check for a KSF or server
identity mismatch.

Writing `sessionStorage` (step 18) before step 14: the package ends up encrypted under a session secret that
does not exist yet, useless material that opens nothing.

Writing `sessionStorage` (step 18) before step 16: it persists a UMK that has not yet been verified as one the
server knows how to give back correctly.

Minting `sessionSecret` (step 14) before `session()->regenerate()`: the secret ends up tied to the previous
session id and is lost in the regeneration, with no symptom until that person's first F5.

Navigating (step 20) before step 19: `session()->regenerate()` also regenerated the CSRF token. The page's
`<meta>` is out of date and the next authenticated POST responds 419 intermittently.

Navigating (step 20) before step 18: if that navigation ends in a hard reload (a version-tracked asset that
changed), the UMK dies with no backup left in `sessionStorage`.

## 6. Cryptographic order of login and of recovery after a reload

### 6.1 Later logins

```
 1 [N] await opaque.ready
 2 [N] password <- input.value ; input.value = ''
 3 [N] {clientLoginState, startLoginRequest} = startLogin({password})     no keyStretching
 4 [S] login/start: real or fake branch, identical in shape and cost. Always 200.
 5 [N] result = finishLogin({..., identifiers: {server}, keyStretching: KSF})
       if (!result)  -> generic error                (undefined, never null)
       catch (e)     -> configuration error          (an invalid KSF throws)
 6 [S] login/finish: consumes the handshake before validating the MAC ; hash_equals ;
       Auth::login ; session()->regenerate() ; mints sessionSecret ; zeroizes the state
 7 [N] KEK = HKDF(exportKey) ; UMK = open(KEK, encryptedUserMasterKey)
       failure -> visible error, never hide the record (ADR 0004)
 8 [N] zeroize(password, exportKey, KEK)
 9 [N] SK = HKDF(sessionSecret) ; sessionStorage['phr.rk'] = seal(SK, UMK) ;
       zeroize(SK, sessionSecret)
10 [N] decrypts encryptedSettings ; updates <meta name="csrf-token">
11 [N] Alpine.navigate(redirect)
```

Two ordering risks specific to login, on top of the ones already covered in section 5:

* Taking the real branch when `opaque_registration_record IS NULL` or `opaque_profile` does not match the
  current profile gives away, by shape or by response time, a user mid-migration. The fake branch is taken
  always in those two cases, not only when the account does not exist.
* A fixed `redirect` to the panel, instead of `session()->pull('url.intended', ...)`, loses the destination an
  authorization middleware saved when it pulled the person out of a deep URL.

### 6.2 Recovery after a reload (F5, 419, deployment)

```
1 [N] empty keyring -> read sessionStorage['phr.rk'] ; if there is none -> to login
2 [N] POST /phr/auth/session-secret   (session cookie)
      401 -> session dead -> to login
      410 -> secret destroyed by idle lock or logout -> to login
3 [N] SK = HKDF(sessionSecret) ; UMK = open(SK, package) ; zeroize(SK, sessionSecret)
4 [N] decrypts encryptedSettings ; continues
```

It is the same reduced order as section 6.1, and it is what every screen with encrypted data runs before asking
for its first batch of data. Losing the UMK from memory is a normal, frequent state, not an error: the interface
degrades to asking for authentication, never to a broken screen (ADR 0003).

## 7. Failure modes

**Response lost in `registration/finish`.** The server transaction runs all the same, but the response does not
reach the client because of a network cut. Without idempotency, an automatic retry would fail with "pending
registration not found" and would leave the person stuck believing the registration did not work when in fact it
did complete. With the endpoint idempotent (section 4.2), the client can retry with the same `registrationId`
and, if it detects that the account already ended up registered with that same `registrationRecord`, carry on
with the flow as if it had succeeded the first time. If the retry never arrives (the tab was closed), the person
sees the link as consumed if they open it again, and the way out is the same as for an already used link: ask an
administrator to reissue one, with the explicit confirmation an existing UMK envelope requires.

**Consumed link.** Opening a link that is already used, expired or non-existent always shows the same generic
"invalid link" screen, without distinguishing the reason (OPAQUE.md section 13.3, applied here too for
consistency). The way out is to ask an administrator for a new link.

**Two tabs.** The UMK lives in the scope of an ES module per tab (ADR 0003), so each tab needs its own login or
its own recovery; there is no memory shared between tabs. Two tabs completing a `registration/finish` for the
same link in parallel are the same case as the idempotency above: one wins the transaction, the other gets the
idempotent response if it arrives in time, or sees the link as consumed if it arrives later.

**KSF or profile mismatch.** If the KSF configured on the client changes without the profile name changing, or
if an account's `opaque_profile` does not match the server's current profile, that account's login behaves
exactly like a wrong password: a generic error, with no hint that the problem is configuration and not the
person. It is indistinguishable by design (it avoids giving away accounts in a special state), and that is why a
server-side metric is needed, not exposed to the client, counting how many times the fake branch is taken for
this specific cause (record and profile present but different from the current one) instead of because the
account is absent. Without that metric, a KSF change shows up in production as "everybody forgot their
password", with no prior signal.

**What the user sees in each case.** The principle is the same in all four cases: never a broken screen, never a
technical error, always one concrete action to take (retry, ask for a new link, log in again). The technical
detail of each failure is logged on the server, with no clinical content, so that whoever operates the system
can diagnose what the person never sees.

## 8. Idle lock, logout and idle timeout

After fifteen minutes of inactivity (ADR 0009), a timer in the browser fires `POST /phr/auth/lock`. The lock
**closes the whole session**, not just the secret: it destroys the session secret and the Laravel session in the
same server operation. Leaving the Laravel session alive would keep the person inside the panel, with access to
other people's plaintext data and to destructive actions like reissuing a link, which is exactly the shared
workstation risk that motivates the lock.

The one counting the time is the **server**, over the last authenticated request, not a timer in the browser: a
client timer does not run in a tab the operating system discarded for memory, nor in one that was never opened.
The browser timer is only what fires the hard reload once the server has already closed the session, not what
decides whether it should close it.

That counting lives in the `EnforceIdleTimeout` middleware, inside the panel's `authMiddleware()` group and
behind `Authenticate`. It stores the mark of the last authenticated request in the session payload itself, with
no new column, and when fifteen minutes pass it does the same as the lock route: destroys the secret, closes the
Laravel session and rotates the CSRF token. The response is a 401 with a JSON body when the client asks for
JSON, which is what the recovery in section 6.2 already knows how to take to the login screen, and a redirect to
the login on a normal navigation. The lock route is exempt on purpose: it is the one that already performs that
same destruction, and answering it with a 401 would leave the client retrying its own logout in a loop.

Filament mounts its own `POST /logout` by default. That endpoint knows nothing about the session secret, so
normal logout (the person clicks "log out") has to go through the same destruction path the lock uses, not trust
Filament's logout to do it.

The client does a hard reload after each of these three closes (logout, lock, landing on the login screen with
the UMK still in memory), never before the server confirms, because only a hard reload destroys the JavaScript
context and with it the DOM snapshots Livewire holds with decrypted data (ADR 0003).

`sessionStorage['phr.rk']` is not explicitly cleared on any of these paths: once the session secret dies on the
server, that package is encrypted under a secret that no longer exists anywhere, so it is useless without anyone
having to clean it up. Laravel's `session.lifetime` is a related parameter, not the same mechanism: if it is
longer than the fifteen-minute lock nothing happens as long as the lock keeps destroying the secret, but both
must be reviewed together and neither changed without looking at the other (ADR 0009).

## 9. Guardrails and prohibitions

**Client interceptor.** An interceptor over Livewire requests inspects what leaves the browser and aborts if it
finds a long value that does not carry the `v1.` prefix of the encrypted envelope (ADR 0002).

**Server listener.** A listener over Livewire property updates rejects the same thing on the server side, to
cover the case of somebody adding a `wire:model` without thinking: the client interceptor does not protect
against that slip, because the client itself is what generated it. It comes with a snapshot test that fails if
any public property of a component handling encrypted data contains something that is not metadata or an
encrypted envelope.

**Properties in the URL.** `InteractsWithActions` ships six properties marked `#[Url]` (`$defaultAction`,
`$defaultActionArguments`, `$defaultActionContext`, `$defaultTableAction`, `$defaultTableActionRecord`,
`$defaultTableActionArguments`) that publish the open Filament action and its arguments in the address bar. An
event identifier there is already clinical metadata. Every page handling encrypted data extends a base page of
our own that redeclares those six properties without the `#[Url]` attribute, together with an architecture test
that fails if any of them shows up with the attribute again on any page of the panel.

**Forbidden Filament commands.** `make:filament-user` and `filament:user` are disabled (with `Command::forget`
or an override that aborts with an explanatory message). Both ask for `--password` and do `Hash::make()` on the
server, which in this project would produce an account that looks valid and is not: no OPAQUE registration, no
UMK, impossible to use to encrypt anything.

**Mandatory configuration.** `session.driver` can never be `cookie`: with that driver the session content
travels to the browser on every request, and the browser would then hold both halves of the UMK at once
(ADR 0003). A test fails explicitly if `config('session.driver') === 'cookie'`. `APP_DEBUG` stays off in every
environment with real data, staging included, because a 500 error with debug on opens the Livewire trace in a
dialog without reloading, and that trace can carry clinical data in the arguments of a call (ADR 0003).
`.npmrc` carries `save-exact=true`, on top of the `ignore-scripts` and `audit` it already had: without
`save-exact`, installing any of the client cryptographic dependencies writes a version range, and a change of
defaults in a minor version can invalidate every existing OPAQUE registration (ADR 0004). That exact pinning
belongs to those JavaScript cryptographic dependencies; `filament/filament` stays on the `^5.0` range, not
pinned to an exact version, and the mitigation for the deployment eviction risk described in ADR 0003 is
operational: a maintenance window or advance notice, never version pinning.

## 10. Parts inventory

**Artisan commands**

* `opaque:setup`: generates and prints to the screen (it never writes `.env`) the static server material: OPAQUE
  key pair, `oprf_seed`, `OPAQUE_ENUMERATION_KEY`, `fake_registration_record`. Running it twice carelessly makes
  every existing registration unusable, so it never autogenerates anything silently.
* `phr:issue-registration-link`: creates the user row if it does not exist and issues a single-use link. It
  aborts if `STDOUT` is not a terminal. It never accepts or prints passwords.
* `opaque:prune-handshakes`: scheduled pruning of expired `opaque_login_handshakes` and `opaque_registrations`.

**Migrations**

* Change of the `users` primary key to UUID, and OPAQUE columns (`opaque_credential_identifier`,
  `opaque_registration_record`, `opaque_profile`, `opaque_registered_at`, `encrypted_settings`), `password`
  nullable.
* `user_registration_links`.
* `opaque_registrations`, `opaque_login_handshakes`.
* `user_master_key_envelopes`, append-only.

**Models**

`User` (with no `password` in the mass assignment list, no `hashed` cast, `getAuthPassword()` overridden,
implements `FilamentUser::canAccessPanel()`), `UserRegistrationLink`, `OpaqueRegistration`,
`OpaqueLoginHandshake`, `UserMasterKeyEnvelope`.

**PHP services**

* `App\Opaque\*`: `Ristretto255`, `HkdfSha512`, `ExpandMessageXmdSha512`, `Oprf`, `LoginNormalizer` (the single
  source of `normalize(login)`), `CredentialIdentifier`, `ServerSetup`, `RegistrationFlow`, `LoginFlow`
  (including the mandatory fake branch). Detailed in `docs/OPAQUE.md`.
* `App\Provisioning\RegistrationLinks`: issues, validates and atomically consumes links; it holds the "account
  already registered" guard described in section 3.4.
* `App\Auth\SessionSecrets`: mints, delivers and destroys the session secret.
* `App\Crypto\EnvelopeValidator`: validates the `v1.` prefix, canonical base64url and the allowed size of an
  envelope. Never its content.

**Controllers** (plain invokables, no Livewire)

`LoginController`, `SetPasswordPageController` (serves the generic page; the real token validation happens in
`registration/start`), `InvitedRegistrationStartController`, `RegistrationPublicStartController` (section 4.7,
sign-up without an invitation), `RegistrationFinishController`, `LoginStartController`, `LoginFinishController`,
`SessionSecretController`, `LockController`.

**Blade views**

`resources/views/phr/auth/login.blade.php`, `set-password.blade.php`, `register.blade.php` (section 4.7),
`link-invalid.blade.php`. All four replicate by hand the structure of Filament's `fi-simple-page` with
`<x-filament-panels::layout.simple>`, because there is no Livewire component behind them to resolve
`$this->getHeading()`.

**Filament**

`PhrPanelProvider` (SPA with no prefetching, its own login, its own routes, global search disabled, crypto
module emitted in the panel's `<head>`), `UserResource` with its creation action (user + link in one
transaction, an informational modal with the URL that is never sent by email) and its link reissue action
(requires typing the email if there is already a current envelope), `UserPolicy`, the base page that redeclares
the `#[Url]` properties (section 9).

**JS modules** (`resources/js/`)

`app.js` (Vite entry point, imports the key module first), `crypto/base64url.js`, `crypto/envelope.js`,
`crypto/kdf.js`, `crypto/zeroize.js`, `crypto/canonicalDate.js`, `auth/opaqueClient.js` (the only place that
calls `@serenity-kit/opaque`, with the KSF fixed as a frozen constant), `auth/keyring.js` (owner of the UMK in
memory, never exposes it outside its own module), `auth/recovery.js` (reads and writes the `sessionStorage`
package, requests the session secret), `auth/setPasswordPage.js`, `auth/registerPage.js` (section 4.7, mirrors
`setPasswordPage.js` without a link token), `auth/loginPage.js`, `auth/lock.js` (idle timer, which warns and
fires the reload, but is not what decides the timeout), `guards/livewirePayloadGuard.js` (the section 9
interceptor).

**Middleware**

`App\Http\Middleware\EnforceIdleTimeout` (idle timeout counted on the server, section 8), `NoStore`,
`SetLocale`.

## 11. Acceptance criteria and tests

* The official RFC 9497 and RFC 9807 vectors pass (OPAQUE.md sections 20.1 and 20.2), and the categories of that
  same section (injectable randomness, reference fixtures, interoperability with `@serenity-kit/opaque`,
  negative cases, light fuzzing, enumeration tests) are covered.
* The fixed KSF regression vector (OPAQUE.md section 20.5) passes in continuous integration: a change to the KSF
  or to its defaults is caught there, not in production.
* The UMK envelope is verifiably append-only: a test creates two envelopes for the same user and checks that the
  first ends up with a non-null `retired_at` and that its content did not change.
* `registration/finish` is idempotent under a test that calls it twice with the same `registrationId` and checks
  that the second call neither fails nor duplicates rows.
* Consuming `opaque_login_handshakes` and `opaque_registrations` is atomic under real concurrency, not only in
  the sequential case (OPAQUE.md section 20.6, the race between two simultaneous `login/finish` requests with
  the same `handshakeId`).
* The test that fails if `config('session.driver') === 'cookie'` exists, and so does the one that fails if any
  page of the panel exposes a `#[Url]` property (section 9).
* The snapshot test that fails if a public property of an encrypted component contains something that is not
  metadata or an encrypted envelope (section 9).
* A non-existent user and an existing one produce the same shape, the same HTTP code and the same response size
  in `login/start` (OPAQUE.md section 20.8), and that sameness is checked before and after registering the
  account too, not only at one fixed moment.
* The login fake branch is also taken when `opaque_registration_record` exists but `opaque_profile` does not
  match the current profile, not only when the account does not exist.
* Scheduled pruning of expired `opaque_login_handshakes` and `opaque_registrations` exists, verified with a test
  that creates expired rows and checks that the command deletes them.
* The full sign-up flow (sections 5 and 6.1 chained) is tested end-to-end: from issuing the link to checking
  that the UMK recovered after a later login is the same one that was born at registration.
* The recovery-after-reload flow (section 6.2) is tested by simulating the loss of the UMK from memory and
  checking that it is recovered without asking for the password, and that a destroyed session secret produces a
  410 and leads to the login screen.
* The lock is tested by checking that, after `POST /phr/auth/lock`, a later request to `session-secret` responds
  410, and that the Laravel session is no longer authenticated.
* An authenticated session whose last request was more than fifteen minutes ago is closed on the next request,
  without the browser having called `POST /phr/auth/lock`: the session stops being authenticated, the secret
  disappears and the response is a 401 in JSON or a redirect to the login on a navigation.
* The login and password-setting forms declare no `method` and no `action`, and no password field declares a
  `name`, so that a native form submission (with Alpine not yet hydrated, or with the bundle not loaded) cannot
  carry the password to the server.

## 12. Accepted risks

The registration link TTL (24 hours) is already decided and fixed in ADR 0009 and in section 3.3; it is not left
as an open question.

1. **Argon2id (t=3, m=64 MiB, p=4) not measured on the staff's slowest device.** Decision taken: the parameters
   stay and the measurement is done with real users and real devices, not before production. Explicitly accepted
   risk: lowering them later forces everybody to register again, and with the order in section 5 (immediate
   login after registration) that cost is paid twice at sign-up. Cheap mitigation: the first user, the one who
   starts the system up, can measure it on the oldest device they have available before inviting anyone else,
   and that catches the bad case while it still costs nothing (ADR 0004).
2. **Sharing with a professional and recovery escrow are still deferred.** It is a decision taken and reviewed,
   not an oversight: it is deferred on purpose because the key identifier ADR 0004 reserves makes the delay
   cheap, and because escrow can be added to existing users the next time they log in, which is when they have
   the key in memory. Out of scope for this spec (section 1).

One point of the original design that has not been carried into this spec: the option of writing the
registration link to a file with restricted permissions (mode `0600`) as an alternative to printing it only to
the terminal. We rejected it because there is no automated deployment that needs it today; if one appears, it is
a small, localized change in `phr:issue-registration-link`.

## 13. History

### 2026-07-26 — Public sign-up, without an invitation, is added
Previously: the only way to create an account was to open an invitation link, issued by another user or by the
first user's console command; sections 1, 2 and 4 contemplated no other route. Now
`POST /phr/auth/opaque/registration/public/start` exists (section 4.7), which creates the user row in the
endpoint itself and responds 409 `login_taken` if the email already has an account, instead of requiring a
token. `registration/finish` (section 4.2) keeps its contract unchanged, but stops consuming a link when the
pending row has `invitation_ref` at `null` (ADR 0009).

### 2026-07-26 — The idle timeout moves to being counted on the server
Previously: section 8 already required the server to count it, but the only counting that existed was the
`setTimeout` in `auth/lock.js`, so a tab discarded for memory, a closed laptop or a lock call that never made it
out left the session and the secret alive until Laravel's `session.lifetime`, today 120 minutes. Now
`EnforceIdleTimeout` counts it and the browser timer only warns and fires the reload.

### 2026-07-26 — `registration/finish` stops sharing a rate limiter with `registration/start`
Previously: section 4.2 asked for limiting by IP, and the route was mounted on the `registration/start` limiter,
whose second key is the hash of the `registrationToken`. That route does not receive that field, so all of its
requests fell into the same bucket of 15 per minute and anyone could exhaust it to block sign-up for the whole
installation.
