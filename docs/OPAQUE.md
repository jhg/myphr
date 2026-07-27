# OPAQUE-3DH (RFC 9807) — Client and server implementation specification

Reference document for the password authentication implementation using the OPAQUE protocol in this application.

- **Protocol**: OPAQUE aPAKE, RFC 9807 (July 2025), 3DH instantiation.
- **OPRF**: RFC 9497 (`ristretto255-SHA512`, `modeOPRF = 0x00`).
- **Hash-to-curve**: RFC 9380 (`expand_message_xmd` with SHA-512).
- **Group**: ristretto255, RFC 9496.
- **Client**: [`@serenity-kit/opaque`](https://github.com/serenity-kit/opaque)
  **exactly 1.1.0** (WASM over `opaque-ke` 4.0.1, which implements the final RFC 9807,
  not a draft), Ristretto255 suite.
- **Server**: plain PHP ≥ 8.3 + `ext-sodium`, integrated into Laravel.
- **Normative reference**: <https://www.rfc-editor.org/rfc/rfc9807.txt>

> The absolute priority is **byte-for-byte interoperability** with RFC 9807,
> RFC 9497 and `opaque-ke`. We build no cryptographic API of our own and we
> negotiate no algorithms.

---

## Table of contents

1. [Protocol overview](#1-protocol-overview)
2. [Mandatory cryptographic profile](#2-mandatory-cryptographic-profile)
3. [Technology constraints](#3-technology-constraints)
4. [Notation and helper functions](#4-notation-and-helper-functions)
5. [Binary formats and HTTP encoding](#5-binary-formats-and-http-encoding)
6. [Message structures with offsets](#6-message-structures-with-offsets)
7. [Server cryptographic primitives](#7-server-cryptographic-primitives)
8. [OPRF ristretto255-SHA512](#8-oprf-ristretto255-sha512)
9. [Client credentials and Envelope (client side)](#9-client-credentials-and-envelope-client-side)
10. [Registration phase](#10-registration-phase)
11. [Login phase (3DH AKE)](#11-login-phase-3dh-ake)
12. [Persistent server setup](#12-persistent-server-setup)
13. [Credential identifier and anti-enumeration](#13-credential-identifier-and-anti-enumeration)
14. [Laravel persistence](#14-laravel-persistence)
15. [HTTP endpoints](#15-http-endpoints)
16. [Filament and Livewire integration](#16-filament-and-livewire-integration)
17. [Client-side encryption with export_key](#17-client-side-encryption-with-export_key)
18. [Errors and logging](#18-errors-and-logging)
19. [Security considerations](#19-security-considerations)
20. [Mandatory test plan](#20-mandatory-test-plan)
21. [Implementation order](#21-implementation-order)
22. [Acceptance criteria](#22-acceptance-criteria)
23. [Rotation, backup and known limitations](#23-rotation-backup-and-known-limitations)

---

## 1. Protocol overview

OPAQUE is an aPAKE (Augmented Password-Authenticated Key Exchange) with mutual authentication, no PKI dependency
(except during registration), resistant to precomputation attacks and with forward secrecy. The server **never sees the
password**, not even during registration.

It is made of three functionalities (RFC 9807 §1):

1. **OPRF** — oblivious pseudorandom function: the server holds the key, the client supplies the password; neither
   learns anything about the other.
2. **Key recovery** — the `Envelope` that only the correct password can open.
3. **AKE** — authenticated key exchange (3DH) producing a shared `session_key`.

### 1.1 Phases

**Registration** (requires an authenticated channel with confidentiality, e.g. TLS — RFC 9807 §3.2):

```
Client                                         Server
------------------------------------------------------
(request, blind) = CreateRegistrationRequest(password)
                  RegistrationRequest
              ------------------------->
                                response = CreateRegistrationResponse(...)
                  RegistrationResponse
              <-------------------------
(record, export_key) = FinalizeRegistrationRequest(...)
                  RegistrationRecord
              ------------------------->
------------------------------------------------------
export_key (client only)                       record (stored)
```

**Login / AKE** (RFC 9807 §3.3):

```
Client                                         Server
------------------------------------------------------
ke1 = GenerateKE1(password)
                        KE1
              ------------------------->
                                ke2 = GenerateKE2(...)
                        KE2
              <-------------------------
(ke3, session_key, export_key) = GenerateKE3(...)
                        KE3
              ------------------------->
                                session_key = ServerFinish(ke3)
------------------------------------------------------
(export_key, session_key)                      session_key
```

- `KE1` = CredentialRequest + AuthRequest.
- `KE2` = CredentialResponse + AuthResponse.
- `KE3` = client_mac (explicit client authentication; required for full forward secrecy — RFC 9807 §6).
- The server **MUST NOT** release `session_key` before verifying `KE3` (RFC 9807 §6.2.4).

### 1.2 Split of responsibilities in this application

| Operation | Where it runs |
|---|---|
| OPRF Blind / Finalize | Client (`@serenity-kit/opaque`) |
| KSF (Argon2id) | **Client only** |
| Envelope Store / Recover | Client |
| OPRF BlindEvaluate, DeriveKeyPair | Server (PHP) |
| Masked CredentialResponse | Server |
| 3DH + key schedule | Both (each side its own half) |
| server_mac verification | Client |
| client_mac verification | Server |
| `export_key` | Client only. **Never reaches the server.** |
| Laravel session | Server, after a successful `ServerFinish` |

---

## 2. Mandatory cryptographic profile

We implement **a single versioned profile**, with no negotiation:

| Parameter | Value |
|---|---|
| Name | `OPAQUE-R255-SHA512-A2ID-m65536-t3-p4-ctx0-v1` |
| OPAQUE | RFC 9807 |
| OPRF | RFC 9497, suite `ristretto255-SHA512`, `modeOPRF = 0x00` |
| AKE group | ristretto255 (same as the OPRF, per the §7 recommendation) |
| Hash | SHA-512 |
| KDF | HKDF-SHA-512 (RFC 5869) |
| MAC | HMAC-SHA-512 (RFC 2104) |
| AKE | 3DH |
| KSF | Argon2id v0x13, m=65536 KiB, t=3, p=4, 16-byte zero salt. **Client only** |
| Context (preamble) | empty string in this profile (see §11.5) |

The profile name includes the KSF parameters and the context because RFC 9807 §7 defines the configuration as the tuple
(OPRF, KDF, MAC, Hash, **KSF**, Group, Context). Two deployments with the same short name and a different KSF are
incompatible, and the failure shows up as "wrong password".

Sizes in bytes (RFC 9807 §2 and §7):

```
Nh    = 64   Hash output (SHA-512)
Nx    = 64   Extract output (HKDF-SHA-512)
Nm    = 64   MAC output (HMAC-SHA-512)
Nn    = 32   nonces
Nseed = 32   seeds
Npk   = 32   ristretto255 public key
Nsk   = 32   private key (scalar)
Noe   = 32   serialized OPRF element
Nok   = 32   OPRF private key
```

Rules:

- Suite identifiers sent by the client are not accepted.
- The profile version is stored alongside each user's record (`opaque_profile`) to allow future migrations (RFC 9807 §8,
  "Configuration and envelope updates": any change requires re-registration).
- The KSF does not affect server interoperability: `Stretch()` happens inside `FinalizeRegistrationRequest` and
  `RecoverCredentials`, both on the client. The server never runs Argon2id in this protocol.
- **The KSF is set explicitly on the client**, never left at the library default: that value already changed between
  minor versions of `@serenity-kit/opaque` (0.8.4 used `Argon2::default()`, since 0.9.0 it uses `MemoryConstrained`). A
  KSF change invalidates every existing registration just like rotating the server key, and leaves the User Master Key
  unrecoverable. See §16 for where the parameter is passed and §20.5 for the regression test that protects it.

---

## 3. Technology constraints

**Allowed on the server:**

- PHP ≥ 8.3 with `ext-sodium` (the project's `composer.json` requires `^8.3`, and `"ext-sodium": "*"` has to be added to
  `require`; today it is not declared).
- `hash()`, `hash_hmac()`, `random_bytes()`, `hash_equals()` / `sodium_memcmp()`.
- Ordinary Laravel components for persistence, sessions, configuration and HTTP.

**Forbidden:**

- Node.js in production (only allowed in development/CI for interoperability tests).
- Helper processes/sidecars, PHP FFI, custom PHP extensions.
- Home-grown Ristretto255 implementations (use `sodium_crypto_core_ristretto255_*` /
  `sodium_crypto_scalarmult_ristretto255*` exclusively).
- OpenSSL for the OPAQUE primitives.
- Unaudited cryptographic Composer packages.
- A PHP implementation of the client side.

**Code structure** (implemented inside the app, not as a package):

```
app/
├── Security/Opaque/                 # pure cryptography, no Laravel
│   ├── OpaqueProfile.php
│   ├── ServerSetup.php
│   ├── RegistrationRecord.php
│   ├── ServerLoginState.php
│   ├── BinaryCodec.php
│   ├── Base64Url.php
│   ├── HkdfSha512.php
│   ├── ExpandMessageXmdSha512.php
│   ├── Ristretto255.php
│   ├── Oprf.php
│   ├── OpaqueServer.php
│   ├── RandomSource.php             # interface, see §20.3
│   ├── OpaqueHandshakeStore.php     # interface, see §14.3
│   ├── OpaqueException.php
│   ├── InvalidMessageException.php
│   ├── InvalidPointException.php
│   ├── InvalidConfigurationException.php
│   ├── ExpiredHandshakeException.php
│   └── AuthenticationFailedException.php
│
├── Http/Controllers/Auth/Opaque/
│   ├── StartRegistrationController.php
│   ├── FinishRegistrationController.php
│   ├── StartLoginController.php
│   └── FinishLoginController.php
│
├── Models/
│   ├── OpaqueRegistration.php
│   └── OpaqueLoginHandshake.php
│
└── Services/Auth/
    └── OpaqueAuthenticationService.php
```

Strict separation between: Laravel-independent cryptography, temporary persistence, user lookup, session creation and
HTTP controllers.

---

## 4. Notation and helper functions

Per RFC 9807 §1.2:

- `I2OSP(n, w)` / `OS2IP` — integer ↔ big-endian byte string (RFC 8017 §4). In PHP: `pack('n', $v)` for uint16,
  `chr($v)` for uint8. **Never** `pack('L')` or platform-dependent integers.
- `concat(...)` — binary string concatenation.
- `random(n)` — `random_bytes(n)` (injectable in tests, see §20.3).
- `zeroes(n)` — `str_repeat("\0", n)`.
- `xor(a, b)` — byte-for-byte XOR; error if the lengths differ. Check `strlen($a) === strlen($b)` **before** operating.
- `ct_equal(a, b)` — constant-time comparison: `sodium_memcmp()` or `hash_equals()` after checking lengths.
- `nil` — absence of a value.

PHP rules for binary data:

- `declare(strict_types=1);` in every file.
- `strlen()` / `substr()` (never `mb_*`) on binary strings.
- No implicit binary↔text conversions; no intermediate hex in computations.
- Lengths checked before any slice.
- Immutable message objects (`final`, `readonly` properties, constructors that validate exact sizes).

---

## 5. Binary formats and HTTP encoding

All internal formats are **pure binary**: string concatenation at exact offsets. Serializing cryptographic structures
with internal JSON, `serialize()`, MessagePack, objects or platform integers is forbidden.

Over HTTP we use **URL-safe Base64 without padding**, decoded strictly:

- Allowed alphabet: `A-Z a-z 0-9 - _` only.
- Reject `=`, spaces, line breaks and standard Base64 (`+`, `/`).
- **Canonicity**: after decoding, re-encode and require an exact match with the input (this rejects leftover bits in the
  last character).
- Reject any unexpected length **before** touching cryptography.

This matches what the client does: `@serenity-kit/opaque` encodes all its strings with `URL_SAFE_NO_PAD` and its decoder
**rejects** padding (`DecodePaddingMode::RequireNone`), so the strictness is not a preference of ours but a condition of
interoperability.

Expected sizes:

| Message | Binary | Base64url without padding |
|---|---|---|
| RegistrationRequest | 32 bytes | 43 characters |
| RegistrationResponse | 64 bytes | 86 characters |
| RegistrationRecord | 192 bytes | 256 characters |
| KE1 / startLoginRequest | 96 bytes | 128 characters |
| KE2 / loginResponse | 320 bytes | 427 characters |
| KE3 / finishLoginRequest | 64 bytes | 86 characters |
| ServerLoginState | 128 bytes | 171 characters |

---

## 6. Message structures with offsets

All lengths derive from the profile (§2). Format per RFC 9807 §5.1, §6.1 and §6.3.1.

### 6.1 Registration

```
RegistrationRequest (32 bytes)
  [0..31]    blinded_message[Noe=32]      serialized OPRF element

RegistrationResponse (64 bytes)
  [0..31]    evaluated_message[Noe=32]    serialized OPRF element
  [32..63]   server_public_key[Npk=32]    server static AKE public key

Envelope (96 bytes)                       RFC 9807 §4.1.1
  [0..31]    envelope_nonce[Nn=32]
  [32..95]   auth_tag[Nm=64]

RegistrationRecord (192 bytes)
  [0..31]    client_public_key[Npk=32]
  [32..95]   masking_key[Nh=64]
  [96..191]  envelope[96]
```

### 6.2 Login

```
CredentialRequest (32 bytes)
  [0..31]    blinded_message[Noe=32]

AuthRequest (64 bytes)
  [0..31]    client_nonce[Nn=32]
  [32..63]   client_public_keyshare[Npk=32]   client ephemeral key

KE1 (96 bytes)
  [0..31]    credential_request.blinded_message
  [32..63]   auth_request.client_nonce
  [64..95]   auth_request.client_public_keyshare

CredentialResponse (192 bytes)
  [0..31]    evaluated_message[Noe=32]
  [32..63]   masking_nonce[Nn=32]
  [64..191]  masked_response[Npk+Nn+Nm = 32+32+64 = 128]
             = pad XOR (server_public_key || envelope)

AuthResponse (128 bytes)
  [0..31]    server_nonce[Nn=32]
  [32..63]   server_public_keyshare[Npk=32]   server ephemeral key
  [64..127]  server_mac[Nm=64]

KE2 (320 bytes)
  [0..191]   credential_response
  [192..319] auth_response

KE3 (64 bytes)
  [0..63]    client_mac[Nm=64]
```

### 6.3 Server internal state

```
ServerLoginState (128 bytes)             — encrypted before persisting
  [0..63]    expected_client_mac[Nm=64]
  [64..127]  session_key[Nx=64]
```

### 6.4 CleartextCredentials

It never travels over the wire as such; it is the serialization used in the Envelope MAC (RFC 9807 §4):

```
struct {
  uint8 server_public_key[Npk];
  uint8 server_identity<1..2^16-1>;    // uint16_be(len) || bytes
  uint8 client_identity<1..2^16-1>;    // uint16_be(len) || bytes
} CleartextCredentials;
```

`CreateCleartextCredentials` (RFC 9807 §4):

```
if server_identity == nil: server_identity = server_public_key
if client_identity == nil: client_identity = client_public_key
```

In this deployment: `server_identity` = the UTF-8 string in `OPAQUE_SERVER_IDENTITY`; `client_identity` = **the RFC
default**, that is, `client_public_key` (we do not use the email address: it can change).

---

## 7. Server cryptographic primitives

### 7.1 `Ristretto255.php` — strict ext-sodium wrapper

```php
public static function validatePoint(string $point): void;
public static function scalarMultiply(string $scalar, string $point): string;   // sodium_crypto_scalarmult_ristretto255
public static function scalarMultiplyBase(string $scalar): string;              // sodium_crypto_scalarmult_ristretto255_base
public static function scalarReduce(string $wideScalar): string;                // sodium_crypto_core_ristretto255_scalar_reduce (64-byte input)
public static function scalarInvert(string $scalar): string;                    // sodium_crypto_core_ristretto255_scalar_invert
public static function pointFromHash(string $uniformBytes): string;             // sodium_crypto_core_ristretto255_from_hash (64-byte input)
```

Point validation (RFC 9807 §10.7 — mandatory for every remote input):

1. Length exactly 32.
2. `sodium_crypto_core_ristretto255_is_valid_point($point)`.
3. Explicitly reject the identity (32 zero bytes).
4. Catch `SodiumException` and turn every error into `InvalidMessageException`.

Scalar validation:

1. Length exactly 32.
2. Reject the zero scalar.
3. **Canonicity**: require the scalar to be smaller than the group order, checking it with
   `scalarReduce($sk . zeroes(32)) === $sk`. `sodium_crypto_scalarmult_ristretto255_base()` **does not reduce** its
   input and would silently accept a non-canonical scalar, producing a public key incompatible with `curve25519-dalek`,
   which does reject it.
4. Scalar **generation** follows the RFC (reduction of 64 uniform bytes or `DeriveKeyPair`), never a direct truncation
   of `random_bytes()`.

External scalars are accepted, as long as they pass that validation: the static private key arrives in `.env` and the
RFC vectors supply it directly (see §12.2 and §20.2).

Note: `sodium_crypto_scalarmult_ristretto255()` throws if the result is the identity — this covers the §10.7 requirement
that the shared DH secret must not be the neutral element. Treat it as `InvalidMessageException`.

### 7.2 `HkdfSha512.php` — manual HKDF (RFC 5869)

Our own implementation, to avoid differences of interpretation:

```
Extract(salt, ikm) = HMAC-SHA-512(key = salt, data = ikm)
  // if salt is empty: salt = 64 zero bytes (RFC 5869 §2.2)

Expand(prk, info, L):
  T(0) = ""
  T(i) = HMAC-SHA-512(key = prk, data = T(i-1) || info || I2OSP(i, 1))
  output = first L bytes of T(1) || T(2) || ...
```

- `L <= 255 * 64`. **One-byte** counter.
- Binary inputs and outputs (use `hash_hmac('sha512', $data, $key, true)`).
- Tests with HKDF-SHA-512 vectors.

### 7.3 Expand-Label and Derive-Secret (RFC 9807 §6.4.2.1)

Repurposed from TLS 1.3 (RFC 8446 §3.4 for the struct encoding):

```
Expand-Label(Secret, Label, Context, Length) = Expand(Secret, CustomLabel, Length)

CustomLabel =
    uint16_be(Length)                          // pack('n', $length)
 || uint8(len("OPAQUE-" || Label))
 || "OPAQUE-" || Label                         // no NULL terminator
 || uint8(len(Context))
 || Context

Derive-Secret(Secret, Label, TranscriptHash) =
    Expand-Label(Secret, Label, TranscriptHash, Nx=64)
```

- No textual delimiters; no `pack('L')`.
- Where the RFC passes an empty context (`""` in Km2/Km3), reproduce it exactly (`uint8(0)` and zero context bytes).

### 7.4 `ExpandMessageXmdSha512.php` (RFC 9380 §5.3.1)

Parameters: Hash = SHA-512, `b_in_bytes = 64`, `s_in_bytes = 128` (block size).

```
DST_prime  = DST || I2OSP(len(DST), 1)
Z_pad      = zeroes(128)
l_i_b_str  = I2OSP(len_in_bytes, 2)
ell        = ceil(len_in_bytes / 64)           // require ell <= 255, len_in_bytes <= 65535, len(DST) <= 255

b0 = SHA512(Z_pad || msg || l_i_b_str || I2OSP(0,1) || DST_prime)
b1 = SHA512(b0 || I2OSP(1,1) || DST_prime)
bi = SHA512(xor(b0, b_(i-1)) || I2OSP(i,1) || DST_prime)     // i = 2..ell

uniform_bytes = first len_in_bytes bytes of b1 || b2 || ...
```

If `len(DST) > 255`, RFC 9380 §5.3.3 requires replacing it with `H("H2C-OVERSIZE-DST-" || DST)`. No OPAQUE DST comes
close to that limit, but the implementation has to handle it to be conformant.

It supports a variable output length, although OPAQUE mostly uses 64 bytes for `HashToScalar`. XOR only after checking
that the lengths are equal.

---

## 8. OPRF ristretto255-SHA512

RFC 9497, `modeOPRF = 0x00`, suite `ristretto255-SHA512`.

```
contextString = "OPRFV1-" || I2OSP(0x00, 1) || "-" || "ristretto255-SHA512"
```

### 8.1 Client functions (run by @serenity-kit/opaque — documented for interop and fixtures)

```
Blind(input):
  blind = RandomScalar()                                  // random non-zero scalar
  inputElement = HashToGroup(input)                       // DST = "HashToGroup-" || contextString
       // HashToGroup = pointFromHash(expand_message_xmd(input, DST, 64))
  if inputElement == identity: error InvalidInputError
  blindedElement = blind * inputElement
  return (blind, blindedElement)

Finalize(input, blind, evaluatedElement):
  N = blind^-1 * evaluatedElement                         // unblind
  unblindedElement = SerializeElement(N)
  oprf_output = SHA512(
      I2OSP(len(input), 2)  || input ||
      I2OSP(len(unblindedElement), 2) || unblindedElement ||
      "Finalize")
```

### 8.2 Server functions (PHP)

**HashToScalar** (RFC 9497 §4.1; the DST is received as an explicit parameter):

```
uniform_bytes = expand_message_xmd(msg, DST, 64)
scalar        = scalarReduce(uniform_bytes)     // mod L
```

RFC 9497 §4.1 specifies for ristretto255 that the 64 bytes are interpreted as a **little-endian** integer before
reducing. `sodium_crypto_core_ristretto255_scalar_reduce()` is already little-endian, so the mapping is direct: nothing
has to be reversed. We write it down because an implementer who "fixes" the endianness breaks interoperability
completely.

**DeriveKeyPair** (RFC 9497 §3.2):

```
DeriveKeyPair(seed, info):
  deriveInput = seed || I2OSP(len(info), 2) || info
  counter = 0
  repeat until skS != 0:
    if counter > 255: error DeriveKeyPairError (fatal internal)
    skS = HashToScalar(deriveInput || I2OSP(counter, 1),
                       DST = "DeriveKeyPair" || contextString)
    counter += 1
  pkS = scalarMultiplyBase(skS)
  return (skS, pkS)
```

**BlindEvaluate** (RFC 9497 §3.3.1):

```
BlindEvaluate(oprf_key, blindedElement):
  validatePoint(blindedElement)          // before operating
  evaluatedElement = scalarMultiply(oprf_key, blindedElement)
```

### 8.3 Per-user OPRF key derivation (RFC 9807 §5.2.2 / §6.3.2.2)

For every registration or login response:

```
seed = HKDF-Expand-SHA512(
    PRK  = oprf_seed,                              // Expand directly, with NO prior Extract
    info = credential_identifier || "OprfKey",
    L    = Nok = 32)

(oprf_key, _) = DeriveKeyPair(seed, "OPAQUE-DeriveKeyPair")
```

- Do **not** store a per-user OPRF key: it is derived on every operation.
- The same `oprf_seed` is used for every client (needed for the indistinguishable fake response — RFC 9807 §10.9).
- The RFC concatenates `credential_identifier || "OprfKey"` **without a length prefix**, so the identifier must have a
  fixed length across the whole system. The 32 bytes fixed in §13.1 guarantee it; mixing lengths would open up domain
  collisions (`"ab" || "cOprfKey"` versus `"abc" || "OprfKey"`).

### 8.4 DeriveDiffieHellmanKeyPair (RFC 9807 §6.4.1.1)

For the AKE DH keys (client static keys derived from the envelope, ephemeral keys on both sides, server key in
`opaque:setup`):

```
DeriveDiffieHellmanKeyPair(seed) =
    DeriveKeyPair(seed, "OPAQUE-DeriveDiffieHellmanKeyPair")
```

> ⚠️ Keep the two `info` values apart: the **OPRF** key uses `"OPAQUE-DeriveKeyPair"`; the **AKE DH** keys use
> `"OPAQUE-DeriveDiffieHellmanKeyPair"`. Confusing them breaks the test vectors and interoperability with `opaque-ke`.
> Always check against the official vectors (Appendix C of the RFC), not against summarized pseudocode.

---

## 9. Client credentials and Envelope (client side)

Run by `@serenity-kit/opaque`; documented here because it defines the bytes the server stores and masks, and because the
interop fixtures reproduce it.

### 9.1 Randomized password (RFC 9807 §5.2.3 / §6.3.2.3)

```
oprf_output           = Finalize(password, blind, evaluated_element)
stretched_oprf_output = Stretch(oprf_output)                 // Argon2id on the client
randomized_password   = Extract("", oprf_output || stretched_oprf_output)
```

### 9.2 Store — creating the Envelope during registration (RFC 9807 §4.1.2)

```
envelope_nonce = random(32)
masking_key    = Expand(randomized_password, "MaskingKey", 64)
auth_key       = Expand(randomized_password, envelope_nonce || "AuthKey", 64)
export_key     = Expand(randomized_password, envelope_nonce || "ExportKey", 64)
seed           = Expand(randomized_password, envelope_nonce || "PrivateKey", 32)
(_, client_public_key) = DeriveDiffieHellmanKeyPair(seed)

cleartext_credentials = CreateCleartextCredentials(
    server_public_key, client_public_key, server_identity, client_identity)

auth_tag = HMAC-SHA-512(auth_key,
    envelope_nonce
 || server_public_key
 || uint16_be(len(server_identity)) || server_identity
 || uint16_be(len(client_identity)) || client_identity)

envelope = envelope_nonce || auth_tag        // 96 bytes
```

The client private key **is neither encrypted nor stored**: it is re-derived from the password on every login. If
`DeriveDiffieHellmanKeyPair` were to fail (negligible probability), retry with a new `envelope_nonce`.

### 9.3 Recover — opening the Envelope at login (RFC 9807 §4.1.3)

```
auth_key   = Expand(randomized_password, envelope.nonce || "AuthKey", 64)
export_key = Expand(randomized_password, envelope.nonce || "ExportKey", 64)
seed       = Expand(randomized_password, envelope.nonce || "PrivateKey", 32)
(client_private_key, client_public_key) = DeriveDiffieHellmanKeyPair(seed)

cleartext_credentials = CreateCleartextCredentials(...)
expected_tag = HMAC-SHA-512(auth_key, envelope.nonce || cleartext_credentials)

if !ct_equal(envelope.auth_tag, expected_tag):
    EnvelopeRecoveryError    // erase every intermediate value (RFC §4.1.3)
```

The envelope MAC requires a **random-key robust** MAC — HMAC-SHA-512 is one (RFC 9807 §10.6, Appendix A).

---

## 10. Registration phase

### 10.1 Client — CreateRegistrationRequest (RFC 9807 §5.2.1)

```
(blind, blinded_element) = Blind(password)     // InvalidInputError with negligible probability
request = SerializeElement(blinded_element)    // 32 bytes
```

### 10.2 Server — CreateRegistrationResponse (RFC 9807 §5.2.2)

```
seed = Expand(oprf_seed, credential_identifier || "OprfKey", 32)
(oprf_key, _) = DeriveKeyPair(seed, "OPAQUE-DeriveKeyPair")

blinded_element   = DeserializeElement(request)          // validates the point
evaluated_element = BlindEvaluate(oprf_key, blinded_element)

response = SerializeElement(evaluated_element) || server_public_key    // 64 bytes
```

If `DeriveKeyPair` were to fail (negligible), pick a different `credential_identifier` and retry.

### 10.3 Client — FinalizeRegistrationRequest (RFC 9807 §5.2.3)

```
evaluated_element = DeserializeElement(response.evaluated_message)
oprf_output = Finalize(password, blind, evaluated_element)
randomized_password = Extract("", oprf_output || Stretch(oprf_output))

(envelope, client_public_key, masking_key, export_key) =
    Store(randomized_password, response.server_public_key,
          server_identity, client_identity)

record = client_public_key || masking_key || envelope    // 192 bytes
```

The client keeps `export_key` for end-to-end encryption (§17). The server never receives it.

### 10.4 Server — receiving the record

1. Decode exactly 192 bytes.
2. Split into `client_public_key[32] || masking_key[64] || envelope[96]`.
3. **Validate** the `client_public_key` point (§10.7 of the RFC).
4. Do **not** try to open or verify the envelope: only the client can.
5. Persist (`§14`) atomically, together with consuming the pending registration.

---

## 11. Login phase (3DH AKE)

### 11.1 Client — GenerateKE1 (RFC 9807 §6.2.1 / §6.4.3)

```
(request, blind) = CreateCredentialRequest(password)      // Blind, same as registration
client_nonce = random(32)
client_keyshare_seed = random(32)
(client_secret, client_public_keyshare) =
    DeriveDiffieHellmanKeyPair(client_keyshare_seed)

KE1 = blinded_message || client_nonce || client_public_keyshare
client state: {password, blind, client_secret, ke1}
```

### 11.2 Server — parsing KE1

```
[0..31]   blinded_message          → validatePoint
[32..63]  client_nonce
[64..95]  client_public_keyshare   → validatePoint
```

Validate both Ristretto points **before** any other operation.

### 11.3 Server — CreateCredentialResponse (RFC 9807 §6.3.2.2)

```
seed = Expand(oprf_seed, credential_identifier || "OprfKey", 32)
(oprf_key, _) = DeriveKeyPair(seed, "OPAQUE-DeriveKeyPair")
evaluated_message = BlindEvaluate(oprf_key, blinded_message)

masking_nonce = random(32)
credential_response_pad = Expand(
    record.masking_key,
    masking_nonce || "CredentialResponsePad",
    Npk + Nn + Nm = 128)

masked_response = credential_response_pad XOR (server_public_key || record.envelope)
    // server_public_key || envelope = 32 + 96 = exactly 128 bytes

CredentialResponse = evaluated_message || masking_nonce || masked_response
```

### 11.4 Server — AuthServerRespond, 3DH (RFC 9807 §6.4.4)

```
server_nonce = random(32)
server_keyshare_seed = random(32)
(server_ephemeral_private_key, server_public_keyshare) =
    DeriveDiffieHellmanKeyPair(server_keyshare_seed)      // NEVER reuse ephemeral keys

dh1 = scalarMultiply(server_ephemeral_private_key, client_public_keyshare)
dh2 = scalarMultiply(server_private_key,           client_public_keyshare)
dh3 = scalarMultiply(server_ephemeral_private_key, record.client_public_key)
ikm = dh1 || dh2 || dh3
```

The client computes the mirror image (RFC 9807 §6.4.3):

```
dh1 = DH(client_secret,       server_public_keyshare)
dh2 = DH(client_secret,       server_public_key)          // from the recovered envelope
dh3 = DH(client_private_key,  server_public_keyshare)
```

### 11.5 Preamble (RFC 9807 §6.4.2.1)

```
preamble =
    "OPAQUEv1-"
 || uint16_be(len(context))          || context            // "" in this profile
 || uint16_be(len(client_identity))  || client_identity    // = client_public_key
 || KE1                                                    // 96 bytes as-is
 || uint16_be(len(server_identity))  || server_identity    // OPAQUE_SERVER_IDENTITY
 || credential_response                                    // 192 bytes
 || server_nonce                                           // 32 bytes
 || server_public_keyshare                                 // 32 bytes
```

- `context = ""` for as long as the `@serenity-kit/opaque` client does not let us configure it. Application isolation is
  achieved with a stable, deployment-specific `server_identity`.
- The same `identifiers.server` must be passed to the JS client during registration and login; if a single byte differs,
  the MACs do not match.

### 11.6 DeriveKeys (RFC 9807 §6.4.2.2)

```
prk              = Extract("", ikm)
preamble_hash    = SHA512(preamble)
handshake_secret = Derive-Secret(prk, "HandshakeSecret", preamble_hash)
session_key      = Derive-Secret(prk, "SessionKey",      preamble_hash)
Km2              = Derive-Secret(handshake_secret, "ServerMAC", "")
Km3              = Derive-Secret(handshake_secret, "ClientMAC", "")
```

> The preamble hash goes in as the `Context` of `Expand-Label` for `HandshakeSecret` and `SessionKey`; `Km2`/`Km3` carry
> an empty context. **Mandatory verification against the Appendix C vectors** — do not trust the pseudocode alone.

MACs:

```
server_mac          = HMAC-SHA-512(Km2, SHA512(preamble))
expected_client_mac = HMAC-SHA-512(Km3, SHA512(preamble || server_mac))
```

Response:

```
AuthResponse = server_nonce || server_public_keyshare || server_mac
KE2          = CredentialResponse || AuthResponse       // 320 bytes
```

Persist only:

```
ServerLoginState = expected_client_mac || session_key    // 128 bytes, encrypted
```

Zeroize after use (best effort with `sodium_memzero()`, documenting that PHP does not guarantee wiping every copy):
`server_ephemeral_private_key`, `dh1..dh3`, `ikm`, `prk`, `handshake_secret`, `Km2`, `Km3`.

### 11.7 Client — GenerateKE3 (RFC 9807 §6.2.3 / §6.4.3)

```
RecoverCredentials:
  oprf_output = Finalize(password, blind, evaluated_message)
  randomized_password = Extract("", oprf_output || Stretch(oprf_output))
  masking_key = Expand(randomized_password, "MaskingKey", 64)
  pad = Expand(masking_key, masking_nonce || "CredentialResponsePad", 128)
  server_public_key || envelope = pad XOR masked_response
  (client_private_key, cleartext_credentials, export_key) = Recover(...)

AuthClientFinalize:
  dh1..dh3, ikm, preamble, DeriveKeys — as in §11.4-11.6
  verify ct_equal(ke2.server_mac, HMAC(Km2, SHA512(preamble)))
      → on failure: ServerAuthenticationError (wrong password or fake server)
  client_mac = HMAC(Km3, SHA512(preamble || server_mac))
  KE3 = client_mac
```

The client **must not use `export_key`** before verifying `server_mac` (RFC 9807 §6, Appendix A).

### 11.8 Server — ServerFinish (RFC 9807 §6.2.4 / §6.4.4)

```
if !ct_equal(ke3.client_mac, state.expected_client_mac):
    ClientAuthenticationError      // do NOT return session_key
return state.session_key
```

Any client that does not send a valid KE3 counts as a failed attempt (RFC 9807 §9.2): assume failure by default until
`ServerFinish` passes.

---

## 12. Persistent server setup

State required:

```
oprf_seed[64]                  // Nh bytes, random_bytes(64)
server_private_key[32]         // the already-derived SCALAR, not the seed
server_public_key[32]          // derived from the private key at boot
fake_registration_record[192]  // §13.2
profile_version                // see §2
server_identity                // stable, versioned string
context                        // empty string in this profile
```

`OPAQUE_SERVER_PRIVATE_KEY` holds **the scalar**, not the 32-byte seed it was derived from. Both are "32 bytes in
base64url" and confusing them produces a public key different from the one clients already have signed into their
envelopes, with no visible error until every login fails. Storing the scalar is also what lets us load the RFC vectors
(§20.2) directly, since they supply it in that form.

### 12.1 `php artisan opaque:setup` command

1. Generates `oprf_seed = random_bytes(64)`.
2. Generates the static key: `DeriveDiffieHellmanKeyPair(random_bytes(32))` (the RFC's DeriveKeyPair procedure, never 32
   random bytes used directly as a scalar).
3. Derives and prints the public key.
4. Generates a valid `fake_registration_record` (§13.2).
5. **Prints** the values in Base64url on screen, ready to copy into `.env`; it never writes the `.env` file itself.
6. **Never** writes secrets into the repository.
7. Warns explicitly: *losing or changing the setup makes every existing OPAQUE registration useless* (the envelopes are
   bound to `server_public_key`).
8. Running it a second time on a deployment that already has registered users makes every existing registration useless
   with no visible error: it must say so explicitly and ask for confirmation before continuing.

### 12.2 `.env` configuration

```
OPAQUE_PROFILE=OPAQUE-R255-SHA512-A2ID-m65536-t3-p4-ctx0-v1
OPAQUE_OPRF_SEED=<base64url 64 bytes>
OPAQUE_SERVER_PRIVATE_KEY=<base64url 32 bytes, the scalar>
OPAQUE_FAKE_REGISTRATION_RECORD=<base64url 192 bytes>
OPAQUE_SERVER_IDENTITY=my-application.example/opaque-v1
OPAQUE_ENUMERATION_KEY=<base64url 32 bytes>
OPAQUE_CONTEXT=
```

- The public key is derived from the private key at boot; optionally it is checked against a configured copy.
- **Validation at boot**: every variable must decode as canonical base64url and have its exact length (64, 32, 192, 32).
  The private scalar must also pass the canonicity check from §7.1.
- If configuration is missing or fails to validate: **fail at boot** with an explicit error. Silently auto-generating
  secrets is forbidden.
- `OPAQUE_SERVER_IDENTITY` must match **exactly** the `identifiers.server` passed to `@serenity-kit/opaque`.
- `OPAQUE_CONTEXT` exists, empty, from day one so that we do not have to migrate the day the client exposes the
  parameter. Today `@serenity-kit/opaque` pins it to `None` internally (see §23.3).

---

## 13. Credential identifier and anti-enumeration

### 13.1 credential_identifier

The identifier **must be derived deterministically from the normalized login**, with the same value for real and
non-existent accounts:

```
credential_identifier = HMAC-SHA-256(
    key  = OPAQUE_ENUMERATION_KEY,
    data = normalize(login))                   // 32 bytes
```

At registration it is computed this way and **persisted** alongside the user. At login, if the account exists the
**stored** identifier is used; if it does not exist, the HMAC is computed. Both branches match.

On a password change the existing identifier is **reused**, never regenerated.

`OPAQUE_ENUMERATION_KEY` must be different from `APP_KEY`, from `oprf_seed` and from the OPAQUE static key.

**Why not a random value per registration.** The OPRF evaluation is deterministic given the same blinded element. With a
random identifier, an attacker sending the *same* `blinded_message` before and after someone registers sees the
`evaluated_message` change, because the OPRF key goes from being derived from the fake identifier to being derived from
the random one. That reveals the account's creation, and since every password change would regenerate the identifier, it
also reveals every password change. RFC 9807 §10.9 defines exactly that as the attack to avoid: *"whether a given user
identity is registered with a server or whether a reregistration or change of password was performed"*.

**Note about the RFC.** The RFC does not forbid using an email address or username as the identifier. RFC 9807 §8 says
the opposite: *"this identifier can be set to those alternate values"*. The only normative requirement is uniqueness
across clients (`MUST NOT use the same credential identifier for multiple clients`). We use the HMAC rather than the
email directly so as not to expose the login identifier inside key derivation and to get a fixed length of 32 bytes
(see §8.3).

**Documented residual risk.** If the user changes their email address, the stored identifier stops matching
`HMAC(normalize(new email))`. Trying the old address, now non-existent, gives the change away. That is the price of the
separation between `credential_identifier` and `client_identity` that RFC §8 proposes, and it is explicitly accepted.

### 13.1.1 `normalize(login)`

Normalization must be defined in a single place and be **the only source** both for looking the user up in the database
and for computing the HMAC:

```
normalize(login) = mb_strtolower(NFKC(trim(login)), 'UTF-8')
```

If they differ, an enumeration oracle appears within two requests. The database lookup is in practice case-insensitive
(`utf8mb4_unicode_ci` collation on MySQL, application-level comparison on SQLite), so with the HMAC computed over the
raw string, `alice@x.com` and `Alice@x.com` would give the **same** `evaluated_message` if the account exists and a
**different** one if it does not. Two requests with the same blinded element and two capitalizations answer "does this
account exist?" with certainty, without knowing the password.

That is why the login column is stored already normalized and indexed, and why we do not rely on the database collation.
Every normalization axis (whitespace, case, Unicode forms) needs its own negative test (see §20.6).

### 13.2 Fake record (RFC 9807 §6.3.2.2)

Generated once in `opaque:setup` and reused (the RFC recommends having the fake record materialized so timings are
comparable):

```
(fake_sk, fake_client_public_key) = DeriveDiffieHellmanKeyPair(random(32))
fake_masking_key                  = random_bytes(64)
fake_envelope                     = zeroes(96)          // Nn + Nm, per the RFC

fake_registration_record =
    fake_client_public_key || fake_masking_key || fake_envelope
```

- Never use 32 random bytes directly as a "public key".
- `DeriveDiffieHellmanKeyPair` already returns the pair: do not recompute the public key separately, which invites using
  the seed instead of the scalar.
- `fake_envelope` is **zeros**, not random bytes: RFC 9807 §6.3.2.2 says *"the byte string consisting only of zeros of
  length Nn + Nm"*, and vector C.2.1 does not list the envelope among its inputs for exactly that reason. The XOR with
  the pad makes them indistinguishable either way, but reproducing the official vector requires the zeros.
- The fake private key is discarded after the pair is generated.
- `opaque-ke` generates a fresh `masking_key` on every fake response. We use a fixed one, which is the RECOMMENDED
  option in the RFC (a fake record materialized once, so the lookup time is comparable to that of a real record). A
  deliberate divergence.

The fake flow runs **everything**: OPRF derivation, evaluation, masking, three DHs, DeriveKeys, MACs and temporary
handshake persistence. Timing differences from database queries are mitigated with rate limiting and timing tests, not
with fragile artificial delays.

### 13.3 Indistinguishability rules

Login start, for an existing and a non-existent user:

- Same HTTP status (200), same JSON structure, same `loginResponse` size (320 bytes), no user name/ID/status.

We take the **fake branch** whenever `opaque_registration_record IS NULL` or `opaque_profile` does not match the current
profile, not only when the user does not exist. A user mid-migration or on an old profile must be indistinguishable from
a non-existent one; giving them their own path gives them away by response shape or by response time.

Login finish — one single generic error for: wrong credentials, non-existent user, invalid MAC, expired handshake,
reused handshake.

Rate limiting: by IP, by hash of the normalized identifier, and by the IP+identifier combination. Never the plaintext
email address as the rate limiting key.

Registration and password recovery reveal account existence by their very nature (RFC 9807 §10.9): protect them at the
application layer with invitations, verified emails or generic responses.

---

## 14. Laravel persistence

### 14.1 User columns

```
opaque_credential_identifier  BINARY(32)   nullable unique
opaque_registration_record    BINARY(192)  nullable
opaque_profile                VARCHAR(96)  nullable
opaque_registered_at          TIMESTAMP    nullable
```

- Blobs in binary columns; if the deployment requires text, canonical Base64url (never `serialize()`).
- `BINARY(n)` does not exist in SQLite, which is the default driver here: Laravel's `->binary()` produces a `BLOB` with
  no length. **Exact lengths are validated in the application layer**, never assumed to be guaranteed by the schema.
- `opaque_profile` is 96 characters because the profile name includes the KSF parameters (§2).
- Do **not** reuse the `password` field (it can stay nullable during the migration; OPAQUE does not produce fake
  hashes).

### 14.2 Pending registration (`opaque_registrations`)

```
id UUID primary
user_id / invitation_ref
credential_identifier BINARY(32)
profile VARCHAR(64)
expires_at TIMESTAMP
created_at TIMESTAMP
```

Consumed atomically in `registration/finish` together with the user update (one transaction).

### 14.3 Login handshake (`opaque_login_handshakes`)

```
id UUID primary
user_id nullable            // null in the fake flow
state_ciphertext TEXT       // ServerLoginState encrypted with Laravel Crypt
expires_at TIMESTAMP        // TTL 180 seconds
created_at TIMESTAMP
```

The TTL is 180 seconds, not 90: the client KSF runs between `login/start` and `login/finish`, and Argon2id with 64 MiB
on a slow device can eat an appreciable fraction of the window.

In production we persist **only `expected_client_mac`**. The `session_key` is not returned to the browser (§15.4), and
storing it would write a 64-byte secret for every login attempt, fake ones included, encrypted under `APP_KEY`. Storing
it is enabled only behind a test flag, for the interoperability tests.

We need a scheduled command to prune expired handshakes (`opaque:prune-handshakes`). Every unauthenticated
`login/start` creates a row, so without pruning this is unbounded growth an attacker can steer.

Abstraction:

```php
interface OpaqueHandshakeStore
{
    public function create(
        string $id,
        string $encryptedState,
        ?int $userId,
        DateTimeImmutable $expiresAt,
    ): void;

    public function consume(string $id): ?OpaqueStoredHandshake;
}
```

`consume()` must be atomic and single-use. **Do not use `SELECT ... FOR UPDATE`**: Laravel's SQLite grammar ignores
`lockForUpdate()` and returns an empty string, and SQLite is this project's default driver. The `SELECT` → check →
`DELETE` pattern is then open to a race, and two concurrent requests can consume the same handshake.

The correct pattern, atomic on any driver, is a conditional write that checks the affected rows:

```php
$state = /* read the row inside the same transaction */;

$deleted = DB::table('opaque_login_handshakes')
    ->where('id', $id)
    ->where('expires_at', '>', now())
    ->delete();

if ($deleted !== 1) {
    throw new ExpiredHandshakeException();
}
```

With SQLite ≥ 3.35 or PostgreSQL you can use `DELETE ... RETURNING` directly and skip the prior read. Do not trust
`Cache::pull()` to be atomic on every driver either.

Forbidden in the state: IP address, password, `exportKey`, complete KE1/KE2, already-used ephemeral keys. IP and user
agent only for auditing or abuse prevention, never inside the OPAQUE transcript.

---

## 15. HTTP endpoints

The four routes are registered through the Filament panel routes, which already mount them with session and CSRF; that
is why they are not needed in `routes/web.php`. **They cannot go in an `api` group**: that group includes neither
`StartSession` nor `VerifyCsrfToken`, so `$request->session()->regenerate()` would throw `RuntimeException: Session
store not set on request` and `Auth::guard('web')->login()` would persist nothing. This project also registers no `api`
group in `bootstrap/app.php` today.

As a consequence, the browser JavaScript must send the CSRF token and use `credentials: 'same-origin'`.

All four responses carry `Cache-Control: no-store`.

### 15.1 `POST /phr/auth/opaque/registration/start`

```json
{ "registrationRequest": "<base64url 32B>", "registrationToken": "<token>" }
```

1. Validate the registration/invitation token (the application authorizes **before** creating the OPAQUE response).
   There is also a second path with no token, the public sign-up from ADR 0009, which arrives via
   `registration/public/start`: there, what authorizes before the OPAQUE response is created is not a token but the
   creation of the user row, and abuse is narrowly scoped with per-IP rate limiting instead of with an invitation.
2. Decode strictly and validate the blinded element.
3. Compute `credential_identifier = HMAC-SHA-256(ENUM_KEY, normalize(login))` (§13.1).
4. Derive the OPRF key (§8.3) and evaluate.
5. Create the pending registration (UUID, reference, identifier, profile, TTL).
6. Respond:

```json
{
  "registrationId": "<uuid>",
  "registrationResponse": "<base64url 64B>",
  "serverPublicKey": "<base64url 32B>",
  "userId": "<uuid>",
  "profile": "OPAQUE-R255-SHA512-A2ID-m65536-t3-p4-ctx0-v1"
}
```

(`serverPublicKey` is redundant for the protocol; it is exposed for pinning and diagnostics. The client needs `userId`
because the user identifier goes into the associated data of the encryption, so it has to know it before encrypting
anything.)

### 15.2 `POST /phr/auth/opaque/registration/finish`

```json
{ "registrationId": "<uuid>", "registrationRecord": "<base64url 192B>" }
```

Atomically consume the pending registration → decode exactly 192 bytes → split and validate `client_public_key` → write
the user columns → mark the account as registered. Do not open the envelope; do not store the RegistrationResponse; do
not store passwords.

### 15.3 `POST /phr/auth/opaque/login/start`

```json
{ "login": "user@example.com", "startLoginRequest": "<base64url 96B>" }
```

`login` only locates the account; it never enters the cryptography or the envelope. Real or fake flow per §13,
**identical in shape and cost**. Response (always HTTP 200 for structurally valid messages):

```json
{
  "handshakeId": "<uuid>",
  "loginResponse": "<base64url 320B>",
  "profile": "OPAQUE-R255-SHA512-A2ID-m65536-t3-p4-ctx0-v1"
}
```

### 15.4 `POST /phr/auth/opaque/login/finish`

```json
{ "handshakeId": "<uuid>", "finishLoginRequest": "<base64url 64B>" }
```

1. Consume the handshake atomically **before** validating the MAC.
2. If it does not exist / was consumed / expired: run a fake 64-byte comparison and respond with the generic error.
3. Decode and verify exactly 64 bytes.
4. Compare against `expected_client_mac` via `sodium_memcmp()` or `hash_equals()` (lengths already checked).
5. Failure → generic error with no distinction of cause; no session.
6. Success with a real user:

```php
Auth::guard('web')->login($user, remember: false);
$request->session()->regenerate();
```

7. Success in the fake flow → treat it as the generic error.
8. Zeroize the recovered state.

The `session_key` **is not returned to the browser** (the client already has its own copy). It does not replace the
session cookie, CSRF, TLS, the Laravel session or authorization; it is kept only for the duration of the handshake and
for the interoperability tests.

---

## 16. Filament and Livewire integration

- The password is **never** bound to `wire:model` nor stored in Livewire public properties.
- The form has an `<input type="password">` driven by JavaScript; the submit is intercepted and
  `@serenity-kit/opaque` runs in the browser.
- Only these travel to the server: `registrationRequest`, `registrationRecord`, `startLoginRequest`,
  `finishLoginRequest`.
- After a successful `login/finish`, redirect to the panel: Filament receives nothing but an ordinary, already
  authenticated Laravel session.

Reference usage of the JS client, `@serenity-kit/opaque` **exactly 1.1.0** (bundles `opaque-ke` 4.0.1, final RFC 9807):

```js
import * as opaque from "@serenity-kit/opaque";

/** Explicit KSF. It matches the current default, but pinning it makes us
 *  immune to a default change in a future version. See §2. */
const KSF = Object.freeze({
  "argon2id-custom": { iterations: 3, memory: 65536, parallelism: 4 },
});

await opaque.ready;

// Registration
const { clientRegistrationState, registrationRequest } =
  opaque.client.startRegistration({ password });        // no keyStretching here
// → POST registration/start → { registrationResponse }
const { registrationRecord, exportKey, serverStaticPublicKey } =
  opaque.client.finishRegistration({
    clientRegistrationState,
    registrationResponse,
    password,
    identifiers: { server: OPAQUE_SERVER_IDENTITY },
    keyStretching: KSF,                                 // required HERE
  });
// → POST registration/finish

// Login
const { clientLoginState, startLoginRequest } =
  opaque.client.startLogin({ password });               // no keyStretching here
// → POST login/start → { loginResponse }
const result = opaque.client.finishLogin({
  clientLoginState,
  loginResponse,
  password,
  identifiers: { server: OPAQUE_SERVER_IDENTITY },
  keyStretching: KSF,                                   // the same value
});
if (!result) {
  // undefined => wrong password (server_mac does not verify). NEVER null.
  return showGenericAuthError();
}
const { finishLoginRequest, sessionKey, exportKey } = result;
// → POST login/finish
```

Four things to follow to the letter:

- **`keyStretching` goes in the `finish*` functions, not the `start*` ones.** The package documentation says otherwise;
  the published code and types say `finish*`. Passing it in `start*` is ignored **silently** and the default applies:
  you think you configured Argon2 and you did not.
- **A wrong password returns `undefined`, not `null`.** Comparing with `=== null` would always be false and the code
  would try to destructure `undefined`. Use `if (!result)`.
- An invalid KSF configuration **throws**, it does not return `undefined`. The two cases have to be told apart.
- `identifiers.server` must be exactly `OPAQUE_SERVER_IDENTITY` in registration and in login. `identifiers.client` is
  not passed (RFC default: the client public key).

`serverStaticPublicKey` returns the server static public key and allows pinning on the client. It is optional and not
part of the protocol.

---

## 17. Client-side encryption with export_key

Not implemented in PHP. The dependencies and the format are decided in ADR 0004
(`docs/adr/0004-client-crypto-and-data-format.md`); what is collected here is what affects interoperability with this
document.

```
password
   ↓ OPAQUE
export_key                      (client only, stable across logins)
   ↓ HKDF-SHA-512 with a versioned label
Key Encryption Key (KEK)
   ↓ unwraps
User Master Key (random UMK)
   ↓ derives a per-record key and decrypts
keys and data
```

The browser uses `@noble/ciphers` for XChaCha20-Poly1305-IETF and `@noble/hashes` for HKDF-SHA-512, both at an exact
version.

**We do not use `libsodium-wrappers`.** That package does not expose the HKDF functions (it publishes their constants,
but neither `crypto_kdf_hkdf_sha512_extract` nor `_expand`, in the standard build or in the `sumo` one), and its
standard build does not ship SHA-512 or HMAC-SHA-512 either. With it the KEK cannot be derived. On top of that it is
about seventeen times heavier and publishes no provenance attestations on npm.

The HKDF in `@noble/hashes` produces byte-for-byte the same output as the `HkdfSha512.php` of §7.2: both are RFC 5869,
so the cross-language test vectors are direct.

Each field is encrypted with a per-record key, and the envelope is versioned from the very first record (version,
algorithm identifier, KDF identifier, flags, salt, nonce, ciphertext and tag), transported as `v1.` plus base64url. The
AEAD associated data and the `info` of the derivation include the user, the record type and the identifier; the field
name only enters when the encryption is per field. When the envelope covers a whole record there is no such field (see
ADR 0004 and ADR 0006 for the detail of what identifies each record). Without that binding, a compromised server can
move a ciphertext from one patient's allergies field to another patient's diagnosis field and the client would decrypt
it without error.

Laravel stores only: `encrypted_user_master_key`, each field's envelope and the format version. Laravel **never**
receives: the password, `export_key`, the KEK or the UMK in the clear.

A password change = a new OPAQUE registration (fresh random values, RFC 9807 §8) + re-wrapping only the UMK with the new
KEK. The `export_key` changes on every re-registration; the UMK persists, and that is why the data is not re-encrypted.

---

## 18. Errors and logging

Distinct internal exceptions:

```
InvalidMessageException        // parsing, base64, lengths, invalid points
InvalidPointException          // rejected point/scalar (subtype of the previous one)
InvalidConfigurationException  // setup missing or corrupt (boot fails)
AuthenticationFailedException  // wrong MAC
ExpiredHandshakeException      // TTL expired or already consumed
```

The controllers collapse every sensitive authentication error into a single public response:

```json
{ "message": "Authentication failed." }
```

Explicit RFC errors (§9.3): `EnvelopeRecoveryError` (client), `ServerAuthenticationError` (client),
`ClientAuthenticationError` (server). The implicit ones (sizes, deserialization) must also produce a controlled error,
never a 500.

**Forbidden in logs**: full bodies of OPAQUE endpoints, RegistrationRecord, KE1/KE2/KE3, ServerLoginState, keys, MACs,
cryptographic nonces.

**Allowed**: handshake ID, non-sensitive internal code, date, IP anonymized/hashed per the privacy policy, OPAQUE
profile, total duration.

---

## 19. Security considerations

An applied summary of RFC 9807 §9–§10:

- **Input validation (§10.7)**: validate every public key and OPRF element received (range, on the curve, not the
  identity); the DH secret can never be the neutral element. Covered by the wrapper in §7.1.
- **Constant-time (§9.1)**: compare secrets with `sodium_memcmp`/`hash_equals`; no secret-dependent branching, including
  when building the fake response.
- **Random-key robust MAC (§10.6)**: HMAC-SHA-512 qualifies. Never GMAC/GCM for the envelope `auth_tag`.
- **Key stretching (§10.8)**: Argon2id on the client makes the offline attack after a server compromise expensive.
  Trade-off on slow devices.
- **Enumeration (§10.9)**: indistinguishable fake response + global `oprf_seed` + masking key. Registration is exposed
  by design → rate limit.
- **masking_key (§10.10)**: requires a confidential channel during registration (TLS).
- **No additional salt (§10.11)**: the OPRF key is the secret salt. A corrupt server can mount an offline dictionary
  attack — inherent to any single-server aPAKE. If the `oprf_seed` leaks or has low entropy, everything derived from the
  password becomes attackable.
- **Server-side password rules**: impossible by design (the server does not see the password). Apply them on the client.
- **HSM (§10.12)**: optionally the private AKE key can live in an HSM (only the DH operations are needed). Out of the
  initial scope.
- **Online guessing (§9.2)**: a KE2 with no subsequent KE3 counts as a failure; rate limiting on every endpoint.
- **export_key (§10.4, Appendix A)**: use it only after authenticating the peer (server_mac verified).
- **Ephemeral state (§6)**: `ClientState`/`ServerState` are erased on completion; in PHP, `sodium_memzero()` as a
  documented best effort.

---

## 20. Mandatory test plan

The implementation is not finished until **every** category passes.

### 20.1 RFC 9497 vectors

- `expand_message_xmd` (RFC 9380 vectors for SHA-512).
- `HashToScalar`, `DeriveKeyPair`, blind evaluation, Ristretto255 serialization.

### 20.2 RFC 9807 vectors (Appendix C)

Suite `ristretto255, SHA-512, HKDF-SHA-512, HMAC-SHA-512`, KSF = Identity per the vector. The server must reproduce
exactly: `RegistrationResponse`, `CredentialResponse`, preamble, `server_mac`, `expected_client_mac`, `session_key`.

Use the **Real Test Vectors** C.1.1 (no identities) and C.1.2 (with `client_identity`/`server_identity`) and the **Fake
Test Vectors** C.2.1 for the non-existent user flow. The vectors bring fixed `envelope_nonce`, `masking_nonce`,
`server_nonce`, `client_nonce`, seeds and blinds → they are injected via `RandomSource`.

**Do not mix them with the other vectors in the appendix**: C.1.3, C.1.4 and C.2.2 use `Group: curve25519`, and C.1.5,
C.1.6 and C.2.3 use P-256. They do not apply to this profile and comparing against them produces baffling failures.

### 20.3 Injectable randomness

```php
interface RandomSource
{
    public function bytes(int $length): string;
}
```

Production: `random_bytes()`. Tests: a deterministic source with the exact bytes from the vector. No partial mocks of
global functions.

### 20.4 Reference fixtures

We do not generate fixtures by compiling `opaque-ke` in Rust: it would require a toolchain this project does not have
and that §3 does not authorize, and it would be redundant. `@serenity-kit/opaque` **bundles `opaque-ke` 4.0.1** and
includes the server implementation in JavaScript, so it serves as the reference oracle in CI, covering the same ground.
The fixtures are stored, versioned, in `tests/Fixtures`.

### 20.5 Interoperability with @serenity-kit/opaque

Node.js in development and CI only. Full flow:

1. JS generates `registrationRequest` → 2. PHP `registrationResponse` →
3. JS `registrationRecord` + `exportKey` → 4. PHP stores →
5. JS `startLoginRequest` → 6. PHP `loginResponse` →
7. JS `finishLoginRequest` + `sessionKey` + `exportKey` →
8. PHP validates → 9. session keys equal → 10. `exportKey` identical to the registration one on later logins.

The client version is pinned exactly (`1.1.0`, no range) in `package.json`, and installed with `npm ci`.

**KSF regression test** (blocking). A fixed, versioned fixture with `password`, `serverSetup`, `registrationRecord` and
the expected `exportKey`. In CI: run the login against that record and check that the `exportKey` is still the same. It
detects any change of KSF, of suite, of key schedule or of encoding. Add a sentinel that checks that **omitting**
`keyStretching` produces the same `exportKey`: the day it fails, the package default has changed.

Without this test, a KSF change shows up in production as "every user's password is wrong" and, worse, as loss of access
to the User Master Key.

Also add `npm audit signatures` as a blocking step: `@serenity-kit/opaque` publishes verifiable SLSA attestations.

### 20.6 Negative cases

Wrong password · non-existent user · invalid point · identity point · non-canonical point · zero scalar · non-canonical
Base64 · Base64 padding · truncated message · extra bytes · KE1/KE3 of the wrong length · wrong MAC · expired handshake
· handshake consumed twice · RegistrationRecord with an invalid public key · profile change · server identity change ·
wrong setup · existing user with no OPAQUE registration · non-canonical scalar in the setup.

Login normalization, one test per axis: upper and lower case, leading and trailing whitespace, and equivalent Unicode
forms (NFC versus NFD). All of them must produce the same `credential_identifier` and therefore the same
`evaluated_message`.

Concurrency: two simultaneous `login/finish` requests with the same `handshakeId` and the same valid `client_mac` must
result in exactly one session. The sequential case is not enough to catch the race in §14.3.

### 20.7 Light fuzzing

Random inputs of 0–512 bytes against every parser. Requirements: no PHP warning, no out-of-range access, no uncontrolled
type error, no HTTP 500 from remote input, only controlled protocol exceptions.

### 20.8 Enumeration tests

For an existing versus a non-existent user: same HTTP status on login/start, JSON identical in structure,
`loginResponse` always 320 bytes, the full cryptographic flow executed, no user data in the response, no session before
login/finish. Document the residual database timing risk (total absence cannot be demonstrated from PHPUnit) + rate
limiting.

**`evaluated_message` stability** (the test that was missing). With a fixed `blinded_message` and the same login, the
response must be identical before and after the account is registered, and also before and after a password change. If
it changes, the `credential_identifier` is not deterministic and the anti-enumeration of §13 does not work, no matter
how well the HTTP status codes and the lengths match.

---

## 21. Implementation order

Do not start with the controllers. First prove the interoperability of the standalone cryptographic library:

1. Inspect PHP, Laravel, the database and the project structure.
2. Verify that every Ristretto255 function of `ext-sodium` is available.
3. Base64url and binary codecs.
4. HKDF-SHA-512.
5. Expand-Label and Derive-Secret.
6. `expand_message_xmd`.
7. Ristretto255 wrapper.
8. OPRF.
9. RFC 9497 vectors.
10. ServerSetup.
11. OPAQUE registration.
12. RFC 9807 registration vectors.
13. Masked credential response.
14. 3DH AKE.
15. RFC 9807 login vectors.
16. Reference fixtures (§20.4).
17. `@serenity-kit/opaque` interop and the KSF regression test.
18. Laravel persistence.
19. Endpoints.
20. Laravel authentication.
21. Rate limiting.
22. A Filament-compatible login page.
23. Static analysis and negative cases.
24. Document risks and limits.

Required quality: `declare(strict_types=1)`, explicit types, `final` classes, `readonly` properties, PHPStan/Larastan at
the highest reasonable level, Pest/PHPUnit, Pint, no global suppressions, comments citing the exact RFC + section in
every cryptographic function (RFC, section, inputs, outputs, lengths, possible errors). No comments claiming the code is
"secure" or "production-ready".

---

## 22. Acceptance criteria

The implementation is complete only when:

- [ ] There is no Node.js dependency in production.
- [ ] The only non-standard requirement is `ext-sodium`.
- [ ] The four endpoints work with `@serenity-kit/opaque`.
- [ ] The official RFC 9497 vectors pass.
- [ ] The official RFC 9807 vectors pass.
- [ ] The session key matches in PHP and JavaScript.
- [ ] The KSF is passed explicitly in `finish*` and the `exportKey` regression test passes (§20.5).
- [ ] `npm audit signatures` passes as a blocking step.
- [ ] The four routes are in the `web` middleware group, with session and CSRF.
- [ ] The `credential_identifier` is deterministic and stable across a password change (§20.8).
- [ ] Login normalization is the same one for the database lookup and for the HMAC.
- [ ] Handshake consumption is atomic under real concurrency, not just sequentially.
- [ ] Scheduled pruning of expired handshakes exists.
- [ ] The export key stays stable on the client across logins.
- [ ] A wrong password creates no session.
- [ ] A non-existent user gets a structurally valid OPAQUE response.
- [ ] Handshakes are single-use.
- [ ] The password is neither stored nor logged.
- [ ] The export key is neither stored nor transmitted.
- [ ] Filament does not receive the password through Livewire.
- [ ] Documentation for rotating and backing up the server setup exists.
- [ ] A manual line-by-line review against the RFCs has been done.
- [ ] An independent security review before production.

Hidden failing tests are not accepted, and neither are official vectors replaced by self-referential tests generated by
the PHP implementation itself.

---

## 23. Rotation, backup and known limitations

### 23.1 Rotating and backing up the setup

- `oprf_seed`, `server_private_key` and `OPAQUE_ENUMERATION_KEY` must be backed up with the same level of protection as
  the application's master keys.
- **Losing any of those three invalidates every OPAQUE registration**: users would have to register again (the envelopes
  authenticate `server_public_key`, the per-user OPRF key derives from `oprf_seed`, and the `credential_identifier`
  derives from the enumeration key).
- `fake_registration_record` **can** be regenerated with no consequences: the `masking_nonce` is fresh on every
  response, so a new fake record is indistinguishable from the old one. It does not need the same backup care.
- **The KSF parameters are the fourth element whose modification requires every user to register again**, just like
  rotating the server key. That is why they go in the profile name (§2) and are set explicitly on the client (§16).
- Rotating `server_private_key` or `oprf_seed` ⇒ a re-registration campaign: the old profile is marked and a new OPAQUE
  registration is forced on the next successful login (only possible with a transitional double-registration strategy).
- Changing `OPAQUE_SERVER_IDENTITY` breaks the MACs of every envelope: treat it as a full rotation. That is why it is
  versioned (`.../opaque-v1`).

### 23.2 Known limitations

- PHP does not guarantee complete memory zeroization; `sodium_memzero()` reduces exposure, it does not guarantee
  anything.
- Database query timing between the real and the fake flow: a documented residual risk, mitigated with the materialized
  fake record and rate limiting.
- A compromised server can mount an offline dictionary attack against the records (inherent to every single-server
  aPAKE; only mitigable with a threshold OPRF, out of scope — RFC 9807 §10.11).
- The registration flow reveals account existence by design (RFC §10.9); it is mitigated at the application layer, not
  cryptographically.
- The security analysis in [JKX18] covers a single-key instance; there is no published analysis for multi-key/batching
  (RFC §10.2).

### 23.3 Deliberate divergences from the RFC

- `context = ""` (the RFC recommends a non-empty context for domain separation; here separation is done via
  `server_identity` because the `@serenity-kit/opaque` client does not expose the `context` parameter). Revisit if the
  client allows it in future versions.
- `client_identity`/`server_identity` as OPRF input (§9.1 of the RFC, SHOULD/RECOMMENDED): **not applied**, because the
  `@serenity-kit/opaque` client only passes the password to the OPRF. Interoperability beats the recommendation.
- The KSF runs entirely on the client; the server is agnostic to it. It is set explicitly (Argon2id v0x13, m=65536 KiB,
  t=3, p=4, 16-byte zero salt) instead of trusting the package default, which has already changed once between minor
  versions. `p=4` affects the result but does not parallelize: the client's Argon2 is compiled without the `parallel`
  feature.

---

## Appendix A — Quick table of labels and DSTs

| Use | Exact value |
|---|---|
| OPRF contextString | `"OPRFV1-" \|\| 0x00 \|\| "-" \|\| "ristretto255-SHA512"` |
| HashToGroup DST | `"HashToGroup-" \|\| contextString` |
| HashToScalar DST (DeriveKeyPair) | `"DeriveKeyPair" \|\| contextString` |
| OPRF DeriveKeyPair info | `"OPAQUE-DeriveKeyPair"` |
| AKE/DH DeriveKeyPair info | `"OPAQUE-DeriveDiffieHellmanKeyPair"` |
| OPRF Finalize hash | `"Finalize"` suffix |
| Expand masking key | `"MaskingKey"` |
| Expand auth key | `nonce \|\| "AuthKey"` |
| Expand export key | `nonce \|\| "ExportKey"` |
| Expand client key seed | `nonce \|\| "PrivateKey"` |
| Expand per-user OPRF key | `credential_identifier \|\| "OprfKey"` |
| Expand masking pad | `masking_nonce \|\| "CredentialResponsePad"` |
| Preamble prefix | `"OPAQUEv1-"` |
| Expand-Label prefix | `"OPAQUE-"` |
| Derive-Secret labels | `"HandshakeSecret"`, `"SessionKey"`, `"ServerMAC"`, `"ClientMAC"` |

## Appendix B — Reference vectors (RFC 9807, Appendix C)

For this profile's suite these apply directly:

- **C.1.1** — Real, ristretto255-SHA512, no explicit identities.
- **C.1.2** — Real, with `client_identity = "alice"`, `server_identity = "bob"`.
- **C.2.1** — Fake, ristretto255-SHA512 (non-existent user flow).

**Not applicable**: C.1.3, C.1.4 and C.2.2 use `Group: curve25519` for the AKE, and C.1.5, C.1.6 and C.2.3 use P-256.
Even where their OPRF is ristretto255 in some cases, the AKE group differs and the MACs will not match.

The vectors use KSF = Identity and `Context = 0x4f50415155452d504f43` ("OPAQUE-POC"): the test suite has to parameterize
KSF and context to reproduce them, even though production uses Argon2id (client) and an empty context. Every
intermediate value (`auth_key`, `randomized_password`, `handshake_secret`, `server_mac_key`, `client_mac_key`,
`oprf_key`) must be compared, not just the final outputs.
