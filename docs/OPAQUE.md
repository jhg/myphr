# OPAQUE-3DH (RFC 9807) — Especificación de implementación cliente y servidor

Documento de referencia para la implementación de autenticación por contraseña
mediante el protocolo OPAQUE en esta aplicación.

- **Protocolo**: OPAQUE aPAKE, RFC 9807 (julio 2025), instanciación 3DH.
- **OPRF**: RFC 9497 (`ristretto255-SHA512`, `modeOPRF = 0x00`).
- **Hash-to-curve**: RFC 9380 (`expand_message_xmd` con SHA-512).
- **Grupo**: ristretto255, RFC 9496.
- **Cliente**: [`@serenity-kit/opaque`](https://github.com/serenity-kit/opaque)
  **1.1.0 exacta** (WASM sobre `opaque-ke` 4.0.1, que implementa RFC 9807 final,
  no un draft), suite Ristretto255.
- **Servidor**: PHP puro ≥ 8.3 + `ext-sodium`, integrado en Laravel.
- **Referencia normativa**: <https://www.rfc-editor.org/rfc/rfc9807.txt>

> La prioridad absoluta es la **interoperabilidad byte a byte** con RFC 9807,
> RFC 9497 y `opaque-ke`. No se crea ninguna API criptográfica propia ni se
> negocian algoritmos.

---

## Índice

1. [Visión general del protocolo](#1-visión-general-del-protocolo)
2. [Perfil criptográfico obligatorio](#2-perfil-criptográfico-obligatorio)
3. [Restricciones tecnológicas](#3-restricciones-tecnológicas)
4. [Notación y funciones auxiliares](#4-notación-y-funciones-auxiliares)
5. [Formatos binarios y codificación en HTTP](#5-formatos-binarios-y-codificación-en-http)
6. [Estructuras de mensajes con offsets](#6-estructuras-de-mensajes-con-offsets)
7. [Primitivas criptográficas del servidor](#7-primitivas-criptográficas-del-servidor)
8. [OPRF ristretto255-SHA512](#8-oprf-ristretto255-sha512)
9. [Credenciales del cliente y Envelope (lado cliente)](#9-credenciales-del-cliente-y-envelope-lado-cliente)
10. [Fase de registro](#10-fase-de-registro)
11. [Fase de login (AKE 3DH)](#11-fase-de-login-ake-3dh)
12. [Setup persistente del servidor](#12-setup-persistente-del-servidor)
13. [Identificador de credencial y anti-enumeración](#13-identificador-de-credencial-y-anti-enumeración)
14. [Persistencia Laravel](#14-persistencia-laravel)
15. [Endpoints HTTP](#15-endpoints-http)
16. [Integración con Filament y Livewire](#16-integración-con-filament-y-livewire)
17. [Cifrado del lado cliente con export_key](#17-cifrado-del-lado-cliente-con-export_key)
18. [Errores y logging](#18-errores-y-logging)
19. [Consideraciones de seguridad](#19-consideraciones-de-seguridad)
20. [Plan de pruebas obligatorio](#20-plan-de-pruebas-obligatorio)
21. [Orden de implementación](#21-orden-de-implementación)
22. [Criterios de aceptación](#22-criterios-de-aceptación)
23. [Rotación, backup y limitaciones conocidas](#23-rotación-backup-y-limitaciones-conocidas)

---

## 1. Visión general del protocolo

OPAQUE es un aPAKE (Augmented Password-Authenticated Key Exchange) con
autenticación mutua, sin dependencia de PKI (salvo en el registro), resistente
a ataques de precomputación y con forward secrecy. El servidor **nunca ve la
contraseña**, ni siquiera durante el registro.

Se compone de tres funcionalidades (RFC 9807 §1):

1. **OPRF** — función pseudoaleatoria oblivious: el servidor tiene la clave, el
   cliente aporta la contraseña; ninguno aprende nada del otro.
2. **Recuperación de claves** — el `Envelope` que sólo la contraseña correcta
   puede abrir.
3. **AKE** — intercambio de claves autenticado (3DH) que produce una
   `session_key` compartida.

### 1.1 Fases

**Registro** (requiere canal autenticado con confidencialidad, p. ej. TLS —
RFC 9807 §3.2):

```
Cliente                                        Servidor
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
export_key (sólo cliente)                      record (almacenado)
```

**Login / AKE** (RFC 9807 §3.3):

```
Cliente                                        Servidor
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
- `KE3` = client_mac (autenticación explícita del cliente; imprescindible
  para forward secrecy total — RFC 9807 §6).
- El servidor **NO** debe liberar `session_key` hasta verificar `KE3`
  (RFC 9807 §6.2.4).

### 1.2 Reparto de responsabilidades en esta aplicación

| Operación | Dónde se ejecuta |
|---|---|
| Blind / Finalize del OPRF | Cliente (`@serenity-kit/opaque`) |
| KSF (Argon2id) | **Sólo cliente** |
| Store / Recover del Envelope | Cliente |
| BlindEvaluate, DeriveKeyPair OPRF | Servidor (PHP) |
| Masked CredentialResponse | Servidor |
| 3DH + key schedule | Ambos (cada lado su mitad) |
| Verificación server_mac | Cliente |
| Verificación client_mac | Servidor |
| `export_key` | Sólo cliente. **Nunca llega al servidor.** |
| Sesión Laravel | Servidor, tras `ServerFinish` correcto |

---

## 2. Perfil criptográfico obligatorio

Se implementa **un único perfil versionado**, sin negociación:

| Parámetro | Valor |
|---|---|
| Nombre | `OPAQUE-R255-SHA512-A2ID-m65536-t3-p4-ctx0-v1` |
| OPAQUE | RFC 9807 |
| OPRF | RFC 9497, suite `ristretto255-SHA512`, `modeOPRF = 0x00` |
| Grupo AKE | ristretto255 (igual que el OPRF, según recomendación §7) |
| Hash | SHA-512 |
| KDF | HKDF-SHA-512 (RFC 5869) |
| MAC | HMAC-SHA-512 (RFC 2104) |
| AKE | 3DH |
| KSF | Argon2id v0x13, m=65536 KiB, t=3, p=4, sal 16 bytes cero. **Sólo cliente** |
| Context (preamble) | cadena vacía en este perfil (ver §11.5) |

El nombre del perfil incluye los parámetros del KSF y el contexto porque RFC 9807
§7 define la configuración como la tupla (OPRF, KDF, MAC, Hash, **KSF**, Group,
Context). Dos despliegues con el mismo nombre corto y distinto KSF son
incompatibles y el fallo se manifiesta como "contraseña incorrecta".

Tamaños en bytes (RFC 9807 §2 y §7):

```
Nh    = 64   salida de Hash (SHA-512)
Nx    = 64   salida de Extract (HKDF-SHA-512)
Nm    = 64   salida de MAC (HMAC-SHA-512)
Nn    = 32   nonces
Nseed = 32   seeds
Npk   = 32   clave pública ristretto255
Nsk   = 32   clave privada (escalar)
Noe   = 32   elemento OPRF serializado
Nok   = 32   clave privada OPRF
```

Reglas:

- No se aceptan identificadores de suite enviados por el cliente.
- La versión del perfil se guarda junto al registro de cada usuario
  (`opaque_profile`) para permitir migraciones futuras (RFC 9807 §8,
  "Configuration and envelope updates": cualquier cambio exige re-registro).
- El KSF no afecta a la interoperabilidad del servidor: `Stretch()` ocurre
  dentro de `FinalizeRegistrationRequest` y `RecoverCredentials`, ambos en el
  cliente. El servidor nunca ejecuta Argon2id en este protocolo.
- **El KSF se fija explícitamente en el cliente**, nunca se deja al valor por
  defecto de la biblioteca: ese valor ya cambió entre versiones menores de
  `@serenity-kit/opaque` (0.8.4 usaba `Argon2::default()`, desde 0.9.0 usa
  `MemoryConstrained`). Un cambio del KSF invalida todos los registros
  existentes igual que rotar la clave del servidor, y deja la User Master Key
  irrecuperable. Ver §16 para dónde se pasa el parámetro y §20.5 para la prueba
  de regresión que lo protege.

---

## 3. Restricciones tecnológicas

**Permitido en el servidor:**

- PHP ≥ 8.3 con `ext-sodium` (el `composer.json` del proyecto exige `^8.3`, y
  hay que añadir `"ext-sodium": "*"` a `require`, hoy no está declarada).
- `hash()`, `hash_hmac()`, `random_bytes()`, `hash_equals()` /
  `sodium_memcmp()`.
- Componentes normales de Laravel para persistencia, sesiones, configuración
  y HTTP.

**Prohibido:**

- Node.js en producción (sólo permitido en desarrollo/CI para pruebas de
  interoperabilidad).
- Procesos auxiliares/sidecars, PHP FFI, extensiones PHP personalizadas.
- Implementaciones propias de Ristretto255 (usar exclusivamente
  `sodium_crypto_core_ristretto255_*` / `sodium_crypto_scalarmult_ristretto255*`).
- OpenSSL para las primitivas de OPAQUE.
- Paquetes Composer criptográficos no auditados.
- Implementación PHP del lado cliente.

**Estructura de código** (implementación dentro de la app, no como paquete):

```
app/
├── Security/Opaque/                 # criptografía pura, sin Laravel
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
│   ├── RandomSource.php             # interfaz, ver §20.3
│   ├── OpaqueHandshakeStore.php     # interfaz, ver §14.3
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

Separación estricta entre: criptografía independiente de Laravel,
persistencia temporal, búsqueda de usuarios, creación de sesión y
controladores HTTP.

---

## 4. Notación y funciones auxiliares

Según RFC 9807 §1.2:

- `I2OSP(n, w)` / `OS2IP` — entero ↔ byte string big-endian (RFC 8017 §4).
  En PHP: `pack('n', $v)` para uint16, `chr($v)` para uint8. **Nunca**
  `pack('L')` ni enteros dependientes de plataforma.
- `concat(...)` — concatenación binaria de strings.
- `random(n)` — `random_bytes(n)` (inyectable en tests, ver §20.3).
- `zeroes(n)` — `str_repeat("\0", n)`.
- `xor(a, b)` — XOR byte a byte; error si las longitudes difieren.
  Comprobar `strlen($a) === strlen($b)` **antes** de operar.
- `ct_equal(a, b)` — comparación en tiempo constante:
  `sodium_memcmp()` o `hash_equals()` tras verificar longitudes.
- `nil` — ausencia de valor.

Reglas PHP para datos binarios:

- `declare(strict_types=1);` en todos los archivos.
- `strlen()` / `substr()` (nunca `mb_*`) sobre strings binarios.
- Sin conversiones implícitas binario↔texto; sin hex intermedio en cálculos.
- Longitudes comprobadas antes de cualquier slice.
- Objetos de mensaje inmutables (`final`, propiedades `readonly`,
  constructores que validan tamaños exactos).

---

## 5. Formatos binarios y codificación en HTTP

Todos los formatos internos son **binarios puros**: concatenación de strings
con offsets exactos. Prohibido serializar estructuras criptográficas con JSON
interno, `serialize()`, MessagePack, objetos o enteros de plataforma.

En HTTP se usa **Base64 URL-safe sin padding** con decodificación estricta:

- Alfabeto permitido: `A-Z a-z 0-9 - _` únicamente.
- Rechazar `=`, espacios, saltos de línea y Base64 estándar (`+`, `/`).
- **Canonicidad**: tras decodificar, volver a codificar y exigir igualdad
  exacta con la entrada (rechaza bits sobrantes en el último carácter).
- Rechazar cualquier longitud inesperada **antes** de tocar criptografía.

Esto coincide con lo que hace el cliente: `@serenity-kit/opaque` codifica todas
sus cadenas con `URL_SAFE_NO_PAD` y su decodificador **rechaza** el padding
(`DecodePaddingMode::RequireNone`), así que la estrictez no es una preferencia
nuestra sino una condición de interoperabilidad.

Tamaños esperados:

| Mensaje | Binario | Base64url sin padding |
|---|---|---|
| RegistrationRequest | 32 bytes | 43 caracteres |
| RegistrationResponse | 64 bytes | 86 caracteres |
| RegistrationRecord | 192 bytes | 256 caracteres |
| KE1 / startLoginRequest | 96 bytes | 128 caracteres |
| KE2 / loginResponse | 320 bytes | 427 caracteres |
| KE3 / finishLoginRequest | 64 bytes | 86 caracteres |
| ServerLoginState | 128 bytes | 171 caracteres |

---

## 6. Estructuras de mensajes con offsets

Todas las longitudes derivan del perfil (§2). Formato según RFC 9807 §5.1,
§6.1 y §6.3.1.

### 6.1 Registro

```
RegistrationRequest (32 bytes)
  [0..31]    blinded_message[Noe=32]      elemento OPRF serializado

RegistrationResponse (64 bytes)
  [0..31]    evaluated_message[Noe=32]    elemento OPRF serializado
  [32..63]   server_public_key[Npk=32]    clave pública estática AKE del servidor

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
  [32..63]   client_public_keyshare[Npk=32]   clave efímera del cliente

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
  [32..63]   server_public_keyshare[Npk=32]   clave efímera del servidor
  [64..127]  server_mac[Nm=64]

KE2 (320 bytes)
  [0..191]   credential_response
  [192..319] auth_response

KE3 (64 bytes)
  [0..63]    client_mac[Nm=64]
```

### 6.3 Estado interno del servidor

```
ServerLoginState (128 bytes)             — cifrado antes de persistir
  [0..63]    expected_client_mac[Nm=64]
  [64..127]  session_key[Nx=64]
```

### 6.4 CleartextCredentials

No viaja por el cable como tal; es la serialización usada en el MAC del
Envelope (RFC 9807 §4):

```
struct {
  uint8 server_public_key[Npk];
  uint8 server_identity<1..2^16-1>;    // uint16_be(len) || bytes
  uint8 client_identity<1..2^16-1>;    // uint16_be(len) || bytes
} CleartextCredentials;
```

`CreateCleartextCredentials` (RFC 9807 §4):

```
si server_identity == nil: server_identity = server_public_key
si client_identity == nil: client_identity = client_public_key
```

En este despliegue: `server_identity` = string UTF-8 de
`OPAQUE_SERVER_IDENTITY`; `client_identity` = **default del RFC**, es decir,
`client_public_key` (no se usa email: puede cambiar).

---

## 7. Primitivas criptográficas del servidor

### 7.1 `Ristretto255.php` — wrapper estricto de ext-sodium

```php
public static function validatePoint(string $point): void;
public static function scalarMultiply(string $scalar, string $point): string;   // sodium_crypto_scalarmult_ristretto255
public static function scalarMultiplyBase(string $scalar): string;              // sodium_crypto_scalarmult_ristretto255_base
public static function scalarReduce(string $wideScalar): string;                // sodium_crypto_core_ristretto255_scalar_reduce (entrada 64 bytes)
public static function scalarInvert(string $scalar): string;                    // sodium_crypto_core_ristretto255_scalar_invert
public static function pointFromHash(string $uniformBytes): string;             // sodium_crypto_core_ristretto255_from_hash (entrada 64 bytes)
```

Validación de punto (RFC 9807 §10.7 — obligatoria para toda entrada remota):

1. Longitud exactamente 32.
2. `sodium_crypto_core_ristretto255_is_valid_point($point)`.
3. Rechazar explícitamente la identidad (32 bytes cero).
4. Capturar `SodiumException` y convertir todo error en
   `InvalidMessageException`.

Validación de escalar:

1. Longitud exactamente 32.
2. Rechazar el escalar cero.
3. **Canonicidad**: exigir que el escalar sea menor que el orden del grupo,
   comprobándolo con `scalarReduce($sk . zeroes(32)) === $sk`.
   `sodium_crypto_scalarmult_ristretto255_base()` **no reduce** su entrada y
   aceptaría en silencio un escalar no canónico, produciendo una clave pública
   incompatible con `curve25519-dalek`, que sí lo rechaza.
4. La **generación** de escalares sigue el RFC (reducción de 64 bytes
   uniformes o `DeriveKeyPair`), nunca truncado directo de `random_bytes()`.

Los escalares externos sí se aceptan, siempre que pasen esa validación: la
clave privada estática llega en `.env` y los vectores del RFC la proporcionan
directamente (ver §12.2 y §20.2).

Nota: `sodium_crypto_scalarmult_ristretto255()` lanza excepción si el
resultado es la identidad — esto cubre el requisito de §10.7 de que el
secreto DH compartido no sea el elemento neutro. Tratarlo como
`InvalidMessageException`.

### 7.2 `HkdfSha512.php` — HKDF manual (RFC 5869)

Implementación propia para evitar diferencias de interpretación:

```
Extract(salt, ikm) = HMAC-SHA-512(key = salt, data = ikm)
  // si salt es vacío: salt = 64 bytes cero (RFC 5869 §2.2)

Expand(prk, info, L):
  T(0) = ""
  T(i) = HMAC-SHA-512(key = prk, data = T(i-1) || info || I2OSP(i, 1))
  output = primeros L bytes de T(1) || T(2) || ...
```

- `L <= 255 * 64`. Contador de **un byte**.
- Entradas y salidas binarias (usar `hash_hmac('sha512', $data, $key, true)`).
- Tests con vectores HKDF-SHA-512.

### 7.3 Expand-Label y Derive-Secret (RFC 9807 §6.4.2.1)

Repurposed de TLS 1.3 (RFC 8446 §3.4 para la codificación del struct):

```
Expand-Label(Secret, Label, Context, Length) = Expand(Secret, CustomLabel, Length)

CustomLabel =
    uint16_be(Length)                          // pack('n', $length)
 || uint8(len("OPAQUE-" || Label))
 || "OPAQUE-" || Label                         // sin terminador NULL
 || uint8(len(Context))
 || Context

Derive-Secret(Secret, Label, TranscriptHash) =
    Expand-Label(Secret, Label, TranscriptHash, Nx=64)
```

- Sin delimitadores textuales; sin `pack('L')`.
- Cuando el RFC pasa contexto vacío (`""` en Km2/Km3), respetarlo exactamente
  (`uint8(0)` y cero bytes de contexto).

### 7.4 `ExpandMessageXmdSha512.php` (RFC 9380 §5.3.1)

Parámetros: Hash = SHA-512, `b_in_bytes = 64`, `s_in_bytes = 128` (block size).

```
DST_prime  = DST || I2OSP(len(DST), 1)
Z_pad      = zeroes(128)
l_i_b_str  = I2OSP(len_in_bytes, 2)
ell        = ceil(len_in_bytes / 64)           // exigir ell <= 255, len_in_bytes <= 65535, len(DST) <= 255

b0 = SHA512(Z_pad || msg || l_i_b_str || I2OSP(0,1) || DST_prime)
b1 = SHA512(b0 || I2OSP(1,1) || DST_prime)
bi = SHA512(xor(b0, b_(i-1)) || I2OSP(i,1) || DST_prime)     // i = 2..ell

uniform_bytes = primeros len_in_bytes bytes de b1 || b2 || ...
```

Si `len(DST) > 255`, RFC 9380 §5.3.3 obliga a sustituirlo por
`H("H2C-OVERSIZE-DST-" || DST)`. Ningún DST de OPAQUE se acerca a ese límite,
pero la implementación debe contemplarlo para ser conforme.

Soporta longitud de salida variable, aunque OPAQUE usa principalmente 64
bytes para `HashToScalar`. XOR sólo tras verificar longitudes iguales.

---

## 8. OPRF ristretto255-SHA512

RFC 9497, `modeOPRF = 0x00`, suite `ristretto255-SHA512`.

```
contextString = "OPRFV1-" || I2OSP(0x00, 1) || "-" || "ristretto255-SHA512"
```

### 8.1 Funciones del cliente (las ejecuta @serenity-kit/opaque — documentadas para interop y fixtures)

```
Blind(input):
  blind = RandomScalar()                                  // escalar aleatorio no cero
  inputElement = HashToGroup(input)                       // DST = "HashToGroup-" || contextString
       // HashToGroup = pointFromHash(expand_message_xmd(input, DST, 64))
  si inputElement == identidad: error InvalidInputError
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

### 8.2 Funciones del servidor (PHP)

**HashToScalar** (RFC 9497 §4.1; el DST se recibe como parámetro explícito):

```
uniform_bytes = expand_message_xmd(msg, DST, 64)
scalar        = scalarReduce(uniform_bytes)     // mod L
```

RFC 9497 §4.1 especifica para ristretto255 que los 64 bytes se interpretan como
entero **little-endian** antes de reducir.
`sodium_crypto_core_ristretto255_scalar_reduce()` ya es little-endian, así que
el mapeo es directo: no hay que invertir nada. Se documenta porque un
implementador que "arregle" el endianismo rompe la interoperabilidad entera.

**DeriveKeyPair** (RFC 9497 §3.2):

```
DeriveKeyPair(seed, info):
  deriveInput = seed || I2OSP(len(info), 2) || info
  counter = 0
  repetir hasta skS != 0:
    si counter > 255: error DeriveKeyPairError (fatal interno)
    skS = HashToScalar(deriveInput || I2OSP(counter, 1),
                       DST = "DeriveKeyPair" || contextString)
    counter += 1
  pkS = scalarMultiplyBase(skS)
  return (skS, pkS)
```

**BlindEvaluate** (RFC 9497 §3.3.1):

```
BlindEvaluate(oprf_key, blindedElement):
  validatePoint(blindedElement)          // antes de operar
  evaluatedElement = scalarMultiply(oprf_key, blindedElement)
```

### 8.3 Derivación de la clave OPRF por usuario (RFC 9807 §5.2.2 / §6.3.2.2)

Para cada respuesta de registro o login:

```
seed = HKDF-Expand-SHA512(
    PRK  = oprf_seed,                              // directamente Expand, SIN Extract previo
    info = credential_identifier || "OprfKey",
    L    = Nok = 32)

(oprf_key, _) = DeriveKeyPair(seed, "OPAQUE-DeriveKeyPair")
```

- **No** almacenar una clave OPRF por usuario: se deriva en cada operación.
- El mismo `oprf_seed` se usa para todos los clientes (necesario para la
  respuesta falsa indistinguible — RFC 9807 §10.9).
- El RFC concatena `credential_identifier || "OprfKey"` **sin prefijo de
  longitud**, así que el identificador debe tener longitud fija en todo el
  sistema. Con los 32 bytes que fija §13.1 queda garantizado; mezclar
  longitudes abriría colisiones de dominio (`"ab" || "cOprfKey"` frente a
  `"abc" || "OprfKey"`).

### 8.4 DeriveDiffieHellmanKeyPair (RFC 9807 §6.4.1.1)

Para las claves DH del AKE (estáticas del cliente derivadas del envelope,
efímeras de ambos lados, clave del servidor en `opaque:setup`):

```
DeriveDiffieHellmanKeyPair(seed) =
    DeriveKeyPair(seed, "OPAQUE-DeriveDiffieHellmanKeyPair")
```

> ⚠️ Distinguir los dos `info`: la clave **OPRF** usa
> `"OPAQUE-DeriveKeyPair"`; las claves **DH del AKE** usan
> `"OPAQUE-DeriveDiffieHellmanKeyPair"`. Confundirlos rompe los vectores de
> test y la interoperabilidad con `opaque-ke`. Verificar siempre contra los
> vectores oficiales (Apéndice C del RFC), no contra pseudocódigo resumido.

---

## 9. Credenciales del cliente y Envelope (lado cliente)

Ejecutado por `@serenity-kit/opaque`; se documenta porque define los bytes
que el servidor almacena y enmascara, y porque los fixtures de interop lo
reproducen.

### 9.1 Randomized password (RFC 9807 §5.2.3 / §6.3.2.3)

```
oprf_output           = Finalize(password, blind, evaluated_element)
stretched_oprf_output = Stretch(oprf_output)                 // Argon2id en el cliente
randomized_password   = Extract("", oprf_output || stretched_oprf_output)
```

### 9.2 Store — creación del Envelope en el registro (RFC 9807 §4.1.2)

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

La clave privada del cliente **no se cifra ni se guarda**: se rederiva de la
contraseña en cada login. Si `DeriveDiffieHellmanKeyPair` fallara
(probabilidad negligible), se repite con nuevo `envelope_nonce`.

### 9.3 Recover — apertura del Envelope en el login (RFC 9807 §4.1.3)

```
auth_key   = Expand(randomized_password, envelope.nonce || "AuthKey", 64)
export_key = Expand(randomized_password, envelope.nonce || "ExportKey", 64)
seed       = Expand(randomized_password, envelope.nonce || "PrivateKey", 32)
(client_private_key, client_public_key) = DeriveDiffieHellmanKeyPair(seed)

cleartext_credentials = CreateCleartextCredentials(...)
expected_tag = HMAC-SHA-512(auth_key, envelope.nonce || cleartext_credentials)

si !ct_equal(envelope.auth_tag, expected_tag):
    EnvelopeRecoveryError    // borrar todos los intermedios (RFC §4.1.3)
```

El MAC del envelope exige un MAC **random-key robust** — HMAC-SHA-512 lo es
(RFC 9807 §10.6, Apéndice A).

---

## 10. Fase de registro

### 10.1 Cliente — CreateRegistrationRequest (RFC 9807 §5.2.1)

```
(blind, blinded_element) = Blind(password)     // InvalidInputError con prob. negligible
request = SerializeElement(blinded_element)    // 32 bytes
```

### 10.2 Servidor — CreateRegistrationResponse (RFC 9807 §5.2.2)

```
seed = Expand(oprf_seed, credential_identifier || "OprfKey", 32)
(oprf_key, _) = DeriveKeyPair(seed, "OPAQUE-DeriveKeyPair")

blinded_element   = DeserializeElement(request)          // valida el punto
evaluated_element = BlindEvaluate(oprf_key, blinded_element)

response = SerializeElement(evaluated_element) || server_public_key    // 64 bytes
```

Si `DeriveKeyPair` fallara (negligible), elegir otro `credential_identifier`
y repetir.

### 10.3 Cliente — FinalizeRegistrationRequest (RFC 9807 §5.2.3)

```
evaluated_element = DeserializeElement(response.evaluated_message)
oprf_output = Finalize(password, blind, evaluated_element)
randomized_password = Extract("", oprf_output || Stretch(oprf_output))

(envelope, client_public_key, masking_key, export_key) =
    Store(randomized_password, response.server_public_key,
          server_identity, client_identity)

record = client_public_key || masking_key || envelope    // 192 bytes
```

El cliente conserva `export_key` para el cifrado E2E (§17). El servidor
jamás lo recibe.

### 10.4 Servidor — recepción del record

1. Decodificar exactamente 192 bytes.
2. Separar `client_public_key[32] || masking_key[64] || envelope[96]`.
3. **Validar** el punto `client_public_key` (§10.7 del RFC).
4. **No** intentar abrir ni verificar el envelope: sólo el cliente puede.
5. Persistir (`§14`) de forma atómica junto con el consumo del registro
   pendiente.

---

## 11. Fase de login (AKE 3DH)

### 11.1 Cliente — GenerateKE1 (RFC 9807 §6.2.1 / §6.4.3)

```
(request, blind) = CreateCredentialRequest(password)      // Blind, igual que registro
client_nonce = random(32)
client_keyshare_seed = random(32)
(client_secret, client_public_keyshare) =
    DeriveDiffieHellmanKeyPair(client_keyshare_seed)

KE1 = blinded_message || client_nonce || client_public_keyshare
estado cliente: {password, blind, client_secret, ke1}
```

### 11.2 Servidor — parseo de KE1

```
[0..31]   blinded_message          → validatePoint
[32..63]  client_nonce
[64..95]  client_public_keyshare   → validatePoint
```

Validar los dos puntos Ristretto **antes** de cualquier otra operación.

### 11.3 Servidor — CreateCredentialResponse (RFC 9807 §6.3.2.2)

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
    // server_public_key || envelope = 32 + 96 = 128 bytes exactos

CredentialResponse = evaluated_message || masking_nonce || masked_response
```

### 11.4 Servidor — AuthServerRespond, 3DH (RFC 9807 §6.4.4)

```
server_nonce = random(32)
server_keyshare_seed = random(32)
(server_ephemeral_private_key, server_public_keyshare) =
    DeriveDiffieHellmanKeyPair(server_keyshare_seed)      // NUNCA reutilizar efímeras

dh1 = scalarMultiply(server_ephemeral_private_key, client_public_keyshare)
dh2 = scalarMultiply(server_private_key,           client_public_keyshare)
dh3 = scalarMultiply(server_ephemeral_private_key, record.client_public_key)
ikm = dh1 || dh2 || dh3
```

El cliente calcula el espejo (RFC 9807 §6.4.3):

```
dh1 = DH(client_secret,       server_public_keyshare)
dh2 = DH(client_secret,       server_public_key)          // del envelope recuperado
dh3 = DH(client_private_key,  server_public_keyshare)
```

### 11.5 Preamble (RFC 9807 §6.4.2.1)

```
preamble =
    "OPAQUEv1-"
 || uint16_be(len(context))          || context            // "" en este perfil
 || uint16_be(len(client_identity))  || client_identity    // = client_public_key
 || KE1                                                    // 96 bytes tal cual
 || uint16_be(len(server_identity))  || server_identity    // OPAQUE_SERVER_IDENTITY
 || credential_response                                    // 192 bytes
 || server_nonce                                           // 32 bytes
 || server_public_keyshare                                 // 32 bytes
```

- `context = ""` mientras el cliente `@serenity-kit/opaque` no permita
  configurarlo. El aislamiento de aplicación se logra con `server_identity`
  estable y específico del despliegue.
- El mismo `identifiers.server` debe pasarse al cliente JS en registro y
  login; si difiere un byte, los MAC no cuadran.

### 11.6 DeriveKeys (RFC 9807 §6.4.2.2)

```
prk              = Extract("", ikm)
preamble_hash    = SHA512(preamble)
handshake_secret = Derive-Secret(prk, "HandshakeSecret", preamble_hash)
session_key      = Derive-Secret(prk, "SessionKey",      preamble_hash)
Km2              = Derive-Secret(handshake_secret, "ServerMAC", "")
Km3              = Derive-Secret(handshake_secret, "ClientMAC", "")
```

> El hash del preamble entra como `Context` del `Expand-Label` en
> `HandshakeSecret` y `SessionKey`; `Km2`/`Km3` llevan contexto vacío.
> **Verificación obligatoria contra los vectores del Apéndice C** —
> no fiarse sólo del pseudocódigo.

MACs:

```
server_mac          = HMAC-SHA-512(Km2, SHA512(preamble))
expected_client_mac = HMAC-SHA-512(Km3, SHA512(preamble || server_mac))
```

Respuesta:

```
AuthResponse = server_nonce || server_public_keyshare || server_mac
KE2          = CredentialResponse || AuthResponse       // 320 bytes
```

Persistir sólo:

```
ServerLoginState = expected_client_mac || session_key    // 128 bytes, cifrado
```

Zeroizar tras uso (best effort con `sodium_memzero()`, documentando que PHP
no garantiza el borrado de todas las copias): `server_ephemeral_private_key`,
`dh1..dh3`, `ikm`, `prk`, `handshake_secret`, `Km2`, `Km3`.

### 11.7 Cliente — GenerateKE3 (RFC 9807 §6.2.3 / §6.4.3)

```
RecoverCredentials:
  oprf_output = Finalize(password, blind, evaluated_message)
  randomized_password = Extract("", oprf_output || Stretch(oprf_output))
  masking_key = Expand(randomized_password, "MaskingKey", 64)
  pad = Expand(masking_key, masking_nonce || "CredentialResponsePad", 128)
  server_public_key || envelope = pad XOR masked_response
  (client_private_key, cleartext_credentials, export_key) = Recover(...)

AuthClientFinalize:
  dh1..dh3, ikm, preamble, DeriveKeys — como en §11.4-11.6
  verificar ct_equal(ke2.server_mac, HMAC(Km2, SHA512(preamble)))
      → si falla: ServerAuthenticationError (password incorrecta o servidor falso)
  client_mac = HMAC(Km3, SHA512(preamble || server_mac))
  KE3 = client_mac
```

El cliente **no debe usar `export_key`** antes de verificar el `server_mac`
(RFC 9807 §6, Apéndice A).

### 11.8 Servidor — ServerFinish (RFC 9807 §6.2.4 / §6.4.4)

```
si !ct_equal(ke3.client_mac, state.expected_client_mac):
    ClientAuthenticationError      // NO devolver session_key
return state.session_key
```

Todo cliente que no envíe un KE3 válido cuenta como intento fallido
(RFC 9807 §9.2): asumir fallo por defecto hasta que `ServerFinish` pase.

---

## 12. Setup persistente del servidor

Estado necesario:

```
oprf_seed[64]                  // Nh bytes, random_bytes(64)
server_private_key[32]         // el ESCALAR ya derivado, no la semilla
server_public_key[32]          // derivada de la privada en arranque
fake_registration_record[192]  // §13.2
profile_version                // ver §2
server_identity                // string estable y versionado
context                        // cadena vacía en este perfil
```

`OPAQUE_SERVER_PRIVATE_KEY` guarda **el escalar**, no la semilla de 32 bytes de
la que se derivó. Ambos son "32 bytes en base64url" y confundirlos produce una
clave pública distinta de la que los clientes ya tienen firmada en sus
envelopes, sin ningún error visible hasta que fallan todos los logins. Guardar
el escalar es además lo que permite cargar directamente los vectores del RFC
(§20.2), que lo proporcionan en esa forma.

### 12.1 Comando `php artisan opaque:setup`

1. Genera `oprf_seed = random_bytes(64)`.
2. Genera la clave estática:
   `DeriveDiffieHellmanKeyPair(random_bytes(32))` (procedimiento DeriveKeyPair
   del RFC, nunca 32 bytes aleatorios usados directamente como escalar).
3. Deriva y muestra la clave pública.
4. Genera un `fake_registration_record` válido (§13.2).
5. **Imprime** los valores en Base64url por pantalla, listos para copiar al
   `.env`; nunca escribe el fichero `.env` por sí mismo.
6. **Nunca** escribe secretos en el repositorio.
7. Advierte de forma explícita: *perder o cambiar el setup inutiliza todos
   los registros OPAQUE existentes* (los envelopes están ligados a
   `server_public_key`).
8. Ejecutarlo por segunda vez sobre un despliegue con usuarios ya registrados
   inutiliza todos los registros existentes sin dar ningún error visible: debe
   avisarlo explícitamente y pedir confirmación antes de continuar.

### 12.2 Configuración `.env`

```
OPAQUE_PROFILE=OPAQUE-R255-SHA512-A2ID-m65536-t3-p4-ctx0-v1
OPAQUE_OPRF_SEED=<base64url 64 bytes>
OPAQUE_SERVER_PRIVATE_KEY=<base64url 32 bytes, el escalar>
OPAQUE_FAKE_REGISTRATION_RECORD=<base64url 192 bytes>
OPAQUE_SERVER_IDENTITY=my-application.example/opaque-v1
OPAQUE_ENUMERATION_KEY=<base64url 32 bytes>
OPAQUE_CONTEXT=
```

- La clave pública se deriva de la privada en el arranque; opcionalmente se
  verifica contra una copia configurada.
- **Validación en el arranque**: cada variable debe decodificar como base64url
  canónico y tener su longitud exacta (64, 32, 192, 32). El escalar privado debe
  pasar además la comprobación de canonicidad de §7.1.
- Si falta configuración o no valida: **fallar en el arranque** con error
  explícito. Prohibido autogenerar secretos silenciosamente.
- `OPAQUE_SERVER_IDENTITY` debe coincidir **exactamente** con
  `identifiers.server` que se pasa a `@serenity-kit/opaque`.
- `OPAQUE_CONTEXT` existe vacía desde el principio para no tener que migrar el
  día que el cliente exponga el parámetro. Hoy `@serenity-kit/opaque` lo fija a
  `None` internamente (ver §23.3).

---

## 13. Identificador de credencial y anti-enumeración

### 13.1 credential_identifier

El identificador **debe derivarse de forma determinista del login normalizado**,
con el mismo valor para cuentas reales e inexistentes:

```
credential_identifier = HMAC-SHA-256(
    key  = OPAQUE_ENUMERATION_KEY,
    data = normalize(login))                   // 32 bytes
```

En el registro se calcula así y **se persiste** junto al usuario. En el login,
si la cuenta existe se usa el identificador **almacenado**; si no existe se
calcula el HMAC. Ambas ramas coinciden.

En un cambio de contraseña se **reutiliza** el identificador existente, nunca se
regenera.

`OPAQUE_ENUMERATION_KEY` debe ser distinto de `APP_KEY`, del `oprf_seed` y de
la clave estática OPAQUE.

**Por qué no un valor aleatorio por registro.** La evaluación OPRF es
determinista dado el mismo punto cegado. Con un identificador aleatorio, un
atacante que envía el *mismo* `blinded_message` antes y después de que alguien
se registre observa cambiar el `evaluated_message`, porque la clave OPRF pasa de
derivarse del identificador falso a derivarse del aleatorio. Eso revela el alta
de la cuenta, y como cada cambio de contraseña regeneraría el identificador,
también revela cada cambio de contraseña. RFC 9807 §10.9 define exactamente eso
como el ataque a evitar: *"whether a given user identity is registered with a
server or whether a reregistration or change of password was performed"*.

**Nota sobre el RFC.** El RFC no prohíbe usar email o username como
identificador. RFC 9807 §8 dice lo contrario: *"this identifier can be set to
those alternate values"*. El único requisito normativo es la unicidad entre
clientes (`MUST NOT use the same credential identifier for multiple clients`).
Se usa el HMAC en lugar del email directamente para no exponer el identificador
de login en la derivación de claves y para tener longitud fija de 32 bytes
(ver §8.3).

**Riesgo residual documentado.** Si el usuario cambia de email, el identificador
almacenado deja de coincidir con `HMAC(normalize(email nuevo))`. Probar el email
antiguo, ahora inexistente, delata el cambio. Es el precio de la separación
entre `credential_identifier` y `client_identity` que plantea el RFC §8, y se
acepta de forma explícita.

### 13.1.1 `normalize(login)`

La normalización debe estar definida en un solo sitio y ser **la única fuente**
tanto para buscar el usuario en la base de datos como para calcular el HMAC:

```
normalize(login) = mb_strtolower(NFKC(trim(login)), 'UTF-8')
```

Si difieren, aparece un oráculo de enumeración en dos peticiones. La búsqueda en
base de datos es en la práctica insensible a mayúsculas (colación
`utf8mb4_unicode_ci` en MySQL, comparación aplicativa en SQLite), así que con el
HMAC calculado sobre la cadena cruda `alice@x.com` y `Alice@x.com` darían el
**mismo** `evaluated_message` si la cuenta existe y **distinto** si no existe.
Dos peticiones con el mismo punto cegado y dos capitalizaciones responden con
certeza a "¿existe esta cuenta?" sin conocer la contraseña.

Por eso la columna de login se almacena ya normalizada e indexada, y no se
confía en la colación de la base de datos. Cada eje de normalización (espacios,
mayúsculas, formas Unicode) necesita su test negativo (ver §20.6).

### 13.2 Registro ficticio (RFC 9807 §6.3.2.2)

Generado una vez en `opaque:setup` y reutilizado (recomendación del RFC de
tener el fake record materializado para tiempos comparables):

```
(fake_sk, fake_client_public_key) = DeriveDiffieHellmanKeyPair(random(32))
fake_masking_key                  = random_bytes(64)
fake_envelope                     = zeroes(96)          // Nn + Nm, según el RFC

fake_registration_record =
    fake_client_public_key || fake_masking_key || fake_envelope
```

- Nunca usar 32 bytes aleatorios directamente como "clave pública".
- `DeriveDiffieHellmanKeyPair` ya devuelve el par: no recalcular la pública
  aparte, que invita a usar la semilla en lugar del escalar.
- `fake_envelope` son **ceros**, no bytes aleatorios: RFC 9807 §6.3.2.2 dice
  *"the byte string consisting only of zeros of length Nn + Nm"*, y el vector
  C.2.1 no lista el envelope entre sus entradas precisamente por eso. El XOR con
  el pad los hace indistinguibles igualmente, pero reproducir el vector oficial
  exige los ceros.
- La clave privada falsa se descarta tras generar el par.
- `opaque-ke` genera un `masking_key` fresco en cada respuesta falsa. Nosotros
  usamos uno fijo, que es la opción RECOMMENDED del RFC (registro falso
  materializado una vez, para que el tiempo de consulta sea comparable al de un
  registro real). Divergencia consciente.

El flujo falso ejecuta **todo**: derivación OPRF, evaluación, masking, tres
DH, DeriveKeys, MACs y persistencia temporal del handshake. Las diferencias
de timing por consultas de BD se mitigan con rate limiting y pruebas de
tiempos, sin retrasos artificiales frágiles.

### 13.3 Reglas de indistinguibilidad

Login start, para usuario existente e inexistente:

- Mismo código HTTP (200), misma estructura JSON, mismo tamaño de
  `loginResponse` (320 bytes), sin nombre/ID/estado del usuario.

Se recorre la **rama falsa** siempre que `opaque_registration_record IS NULL` o
que `opaque_profile` no coincida con el perfil actual, no sólo cuando el usuario
no existe. Un usuario en migración o con un perfil antiguo debe ser
indistinguible de uno inexistente; darle un camino propio lo delata por forma o
por tiempo de respuesta.

Login finish — error genérico único para: credenciales incorrectas, usuario
inexistente, MAC inválido, handshake caducado, handshake reutilizado.

Rate limiting: por IP, por hash del identificador normalizado y por
combinación IP+identificador. Nunca el email en claro como clave de rate
limiting.

El registro y la recuperación de contraseña revelan existencia de cuenta por
naturaleza (RFC 9807 §10.9): protegerlos en capa de aplicación con
invitaciones, emails verificados o respuestas genéricas.

---

## 14. Persistencia Laravel

### 14.1 Columnas del usuario

```
opaque_credential_identifier  BINARY(32)   nullable unique
opaque_registration_record    BINARY(192)  nullable
opaque_profile                VARCHAR(96)  nullable
opaque_registered_at          TIMESTAMP    nullable
```

- Blobs en columnas binarias; si el despliegue exige texto, Base64url
  canónico (nunca `serialize()`).
- `BINARY(n)` no existe en SQLite, que es el driver por defecto aquí: el
  `->binary()` de Laravel genera `BLOB` sin longitud. **Las longitudes exactas
  se validan en la capa de aplicación**, nunca se dan por garantizadas por el
  esquema.
- `opaque_profile` es de 96 caracteres porque el nombre del perfil incluye los
  parámetros del KSF (§2).
- **No** reutilizar el campo `password` (puede quedar nullable durante la
  migración; OPAQUE no genera hashes ficticios).

### 14.2 Registro pendiente (`opaque_registrations`)

```
id UUID primary
user_id / invitation_ref
credential_identifier BINARY(32)
profile VARCHAR(64)
expires_at TIMESTAMP
created_at TIMESTAMP
```

Consumo atómico en `registration/finish` junto con la actualización del
usuario (una transacción).

### 14.3 Handshake de login (`opaque_login_handshakes`)

```
id UUID primary
user_id nullable            // null en flujo falso
state_ciphertext TEXT       // ServerLoginState cifrado con Laravel Crypt
expires_at TIMESTAMP        // TTL 180 segundos
created_at TIMESTAMP
```

El TTL es de 180 segundos, no 90: el KSF del cliente corre entre `login/start` y
`login/finish`, y Argon2id con 64 MiB en un dispositivo lento puede consumir una
fracción apreciable de la ventana.

En producción se persiste **sólo `expected_client_mac`**. La `session_key` no se
devuelve al navegador (§15.4) y guardarla escribiría un secreto de 64 bytes por
cada intento de login, incluidos los falsos, cifrado bajo `APP_KEY`. Se habilita
su almacenamiento únicamente bajo una bandera de test para las pruebas de
interoperabilidad.

Hace falta un comando programado que purgue los handshakes caducados
(`opaque:prune-handshakes`). Cada `login/start` no autenticado crea una fila, así
que sin purga es crecimiento ilimitado dirigible por un atacante.

Abstracción:

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

`consume()` debe ser atómico y de un solo uso. **No usar
`SELECT ... FOR UPDATE`**: el grammar de SQLite en Laravel ignora
`lockForUpdate()` y devuelve cadena vacía, y SQLite es el driver por defecto de
este proyecto. El patrón `SELECT` → comprobar → `DELETE` queda entonces expuesto
a una carrera y dos peticiones concurrentes pueden consumir el mismo handshake.

El patrón correcto, atómico en cualquier driver, es una escritura condicional
comprobando las filas afectadas:

```php
$state = /* leer la fila dentro de la misma transacción */;

$deleted = DB::table('opaque_login_handshakes')
    ->where('id', $id)
    ->where('expires_at', '>', now())
    ->delete();

if ($deleted !== 1) {
    throw new ExpiredHandshakeException();
}
```

Con SQLite ≥ 3.35 o PostgreSQL se puede usar directamente `DELETE ... RETURNING`
y ahorrar la lectura previa. Tampoco confiar en que `Cache::pull()` sea atómico
en todos los drivers.

Prohibido guardar en el estado: IP, contraseña, `exportKey`, KE1/KE2
completos, claves efímeras ya usadas. IP y user-agent sólo para auditoría o
antiabuso, jamás dentro del transcript OPAQUE.

---

## 15. Endpoints HTTP

Las cuatro rutas se registran a través de las rutas del panel de Filament, que
ya las monta con sesión y CSRF; por eso no hacen falta en `routes/web.php`.
**No pueden ir en un grupo `api`**: ese grupo no incluye `StartSession` ni
`VerifyCsrfToken`, así que `$request->session()->regenerate()` lanzaría
`RuntimeException: Session store not set on request` y `Auth::guard('web')->login()`
no persistiría nada. Este proyecto además no registra hoy ningún grupo `api` en
`bootstrap/app.php`.

Como consecuencia, el JavaScript del navegador debe enviar el token CSRF y usar
`credentials: 'same-origin'`.

Las cuatro respuestas llevan `Cache-Control: no-store`.

### 15.1 `POST /phr/auth/opaque/registration/start`

```json
{ "registrationRequest": "<base64url 32B>", "registrationToken": "<token>" }
```

1. Validar token de registro/invitación (la aplicación autoriza **antes** de
   crear la respuesta OPAQUE). Existe además una segunda vía sin token, el alta pública del
   ADR 0009, que llega por `registration/public/start`: ahí lo que autoriza antes de crear la
   respuesta OPAQUE no es un token sino la creación de la fila del usuario, y el abuso se acota
   con limitación de intentos por IP en lugar de con invitación.
2. Decodificar estrictamente y validar el punto cegado.
3. Calcular `credential_identifier = HMAC-SHA-256(ENUM_KEY, normalize(login))` (§13.1).
4. Derivar clave OPRF (§8.3) y evaluar.
5. Crear registro pendiente (UUID, referencia, identifier, perfil, TTL).
6. Responder:

```json
{
  "registrationId": "<uuid>",
  "registrationResponse": "<base64url 64B>",
  "serverPublicKey": "<base64url 32B>",
  "userId": "<uuid>",
  "profile": "OPAQUE-R255-SHA512-A2ID-m65536-t3-p4-ctx0-v1"
}
```

(`serverPublicKey` es redundante para el protocolo; se expone para pinning y
diagnóstico. El cliente necesita `userId` porque el identificador del usuario
entra en el dato asociado del cifrado, así que debe conocerlo antes de cifrar
nada.)

### 15.2 `POST /phr/auth/opaque/registration/finish`

```json
{ "registrationId": "<uuid>", "registrationRecord": "<base64url 192B>" }
```

Consumo atómico del pendiente → decodificar 192 bytes exactos → separar y
validar `client_public_key` → guardar columnas del usuario → marcar cuenta
registrada. No abrir el envelope; no guardar la RegistrationResponse; no
guardar contraseñas.

### 15.3 `POST /phr/auth/opaque/login/start`

```json
{ "login": "user@example.com", "startLoginRequest": "<base64url 96B>" }
```

`login` sólo localiza la cuenta; jamás entra en la criptografía ni en el
envelope. Flujo real o falso según §13, **idéntico en forma y coste**.
Respuesta (HTTP 200 siempre para mensajes estructuralmente válidos):

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

1. Consumir atómicamente el handshake **antes** de validar el MAC.
2. Si no existe/consumido/expirado: ejecutar comparación falsa de 64 bytes y
   responder error genérico.
3. Decodificar y verificar 64 bytes exactos.
4. Comparar con `expected_client_mac` vía `sodium_memcmp()` o
   `hash_equals()` (longitudes ya verificadas).
5. Fallo → error genérico sin distinguir causa; sin sesión.
6. Éxito con usuario real:

```php
Auth::guard('web')->login($user, remember: false);
$request->session()->regenerate();
```

7. Éxito en flujo falso → tratar como error genérico.
8. Zeroizar el estado recuperado.

La `session_key` **no se devuelve al navegador** (el cliente ya tiene su
copia). No sustituye a cookie de sesión, CSRF, TLS, sesión Laravel ni
autorización; sólo se conserva durante el handshake y para pruebas de
interoperabilidad.

---

## 16. Integración con Filament y Livewire

- La contraseña **nunca** se enlaza a `wire:model` ni se almacena en
  propiedades públicas de Livewire.
- El formulario tiene un `<input type="password">` controlado por
  JavaScript; se intercepta el submit y `@serenity-kit/opaque` corre en el
  navegador.
- Sólo viajan al servidor: `registrationRequest`, `registrationRecord`,
  `startLoginRequest`, `finishLoginRequest`.
- Tras `login/finish` correcto, redirección al panel: Filament recibe
  únicamente una sesión Laravel normal ya autenticada.

Uso de referencia del cliente JS, `@serenity-kit/opaque` **1.1.0 exacta**
(empaqueta `opaque-ke` 4.0.1, RFC 9807 final):

```js
import * as opaque from "@serenity-kit/opaque";

/** KSF explícito. Coincide con el default actual, pero fijarlo nos inmuniza
 *  contra un cambio de default en una versión futura. Ver §2. */
const KSF = Object.freeze({
  "argon2id-custom": { iterations: 3, memory: 65536, parallelism: 4 },
});

await opaque.ready;

// Registro
const { clientRegistrationState, registrationRequest } =
  opaque.client.startRegistration({ password });        // sin keyStretching aquí
// → POST registration/start → { registrationResponse }
const { registrationRecord, exportKey, serverStaticPublicKey } =
  opaque.client.finishRegistration({
    clientRegistrationState,
    registrationResponse,
    password,
    identifiers: { server: OPAQUE_SERVER_IDENTITY },
    keyStretching: KSF,                                 // obligatorio AQUÍ
  });
// → POST registration/finish

// Login
const { clientLoginState, startLoginRequest } =
  opaque.client.startLogin({ password });               // sin keyStretching aquí
// → POST login/start → { loginResponse }
const result = opaque.client.finishLogin({
  clientLoginState,
  loginResponse,
  password,
  identifiers: { server: OPAQUE_SERVER_IDENTITY },
  keyStretching: KSF,                                   // el mismo valor
});
if (!result) {
  // undefined => contraseña incorrecta (server_mac no verifica). NUNCA es null.
  return showGenericAuthError();
}
const { finishLoginRequest, sessionKey, exportKey } = result;
// → POST login/finish
```

Cuatro cosas que hay que respetar al pie de la letra:

- **`keyStretching` va en las funciones `finish*`, no en las `start*`.** La
  documentación del paquete dice lo contrario; el código y los tipos publicados
  dicen `finish*`. Pasarlo en `start*` se ignora **en silencio** y se aplica el
  default: crees que has configurado Argon2 y no lo has hecho.
- **Una contraseña incorrecta devuelve `undefined`, no `null`.** Comparar con
  `=== null` sería siempre falso y el código intentaría desestructurar
  `undefined`. Usar `if (!result)`.
- Una configuración de KSF inválida **lanza excepción**, no devuelve `undefined`.
  Hay que distinguir los dos casos.
- `identifiers.server` debe ser exactamente `OPAQUE_SERVER_IDENTITY` en registro
  y login. No se pasa `identifiers.client` (default del RFC: la clave pública
  del cliente).

`serverStaticPublicKey` devuelve la clave pública estática del servidor y
permite pinning en el cliente. Es opcional y no forma parte del protocolo.

---

## 17. Cifrado del lado cliente con export_key

No se implementa en PHP. Las dependencias y el formato se deciden en el
ADR 0004 (`docs/adr/0004-client-crypto-and-data-format.md`); aquí se recoge lo que
afecta a la interoperabilidad con este documento.

```
password
   ↓ OPAQUE
export_key                      (sólo cliente, estable entre logins)
   ↓ HKDF-SHA-512 con etiqueta versionada
Key Encryption Key (KEK)
   ↓ desenvuelve
User Master Key (UMK aleatoria)
   ↓ deriva clave por registro y descifra
claves y datos
```

El navegador usa `@noble/ciphers` para XChaCha20-Poly1305-IETF y `@noble/hashes`
para HKDF-SHA-512, ambos en versión exacta.

**No se usa `libsodium-wrappers`.** Ese paquete no expone las funciones de HKDF
(publica sus constantes, pero no `crypto_kdf_hkdf_sha512_extract` ni `_expand`,
ni en el build estándar ni en el `sumo`), y su build estándar tampoco trae
SHA-512 ni HMAC-SHA-512. Con él la KEK no se puede derivar. Además pesa unas
diecisiete veces más y no publica atestaciones de procedencia en npm.

El HKDF de `@noble/hashes` produce byte a byte lo mismo que el `HkdfSha512.php`
de §7.2: ambos son RFC 5869, así que los vectores cruzados son directos.

Cada campo se cifra con una clave derivada por registro, y el sobre va versionado
desde el primer dato (versión, identificador de algoritmo, identificador de KDF,
banderas, sal, nonce, ciphertext y tag), transportado como `v1.` más base64url.
El dato asociado del AEAD y el `info` de la derivación incluyen usuario, tipo de
registro e identificador; el nombre del campo sólo entra cuando el cifrado es
por campo. Cuando el sobre cubre un registro entero no existe tal campo (ver
ADR 0004 y ADR 0006 para el detalle de qué identifica a cada registro). Sin esa
atadura, un servidor comprometido puede mover un ciphertext del campo de
alergias de un paciente al campo de diagnóstico de otro y el cliente lo
descifraría sin error.

Laravel almacena sólo: `encrypted_user_master_key`, el sobre de cada campo y la
versión del formato. Laravel **nunca** recibe: contraseña, `export_key`, KEK ni
UMK en claro.

Cambio de contraseña = nuevo registro OPAQUE (valores aleatorios frescos,
RFC 9807 §8) + re-envolver únicamente la UMK con la nueva KEK. El
`export_key` cambia con cada re-registro; la UMK persiste, y por eso los datos no
se re-cifran.

---

## 18. Errores y logging

Excepciones internas diferenciadas:

```
InvalidMessageException        // parseo, base64, longitudes, puntos inválidos
InvalidPointException          // punto/escalar rechazado (subtipo de la anterior)
InvalidConfigurationException  // setup ausente o corrupto (falla el arranque)
AuthenticationFailedException  // MAC incorrecto
ExpiredHandshakeException      // TTL vencido o consumido
```

Los controladores colapsan todos los errores sensibles de autenticación en
una única respuesta pública:

```json
{ "message": "Authentication failed." }
```

Errores explícitos del RFC (§9.3): `EnvelopeRecoveryError` (cliente),
`ServerAuthenticationError` (cliente), `ClientAuthenticationError`
(servidor). Los implícitos (tamaños, deserialización) también deben
producir error controlado, nunca un 500.

**Prohibido registrar en logs**: cuerpos completos de endpoints OPAQUE,
RegistrationRecord, KE1/KE2/KE3, ServerLoginState, claves, MACs, nonces
criptográficos.

**Permitido**: ID de handshake, código interno no sensible, fecha, IP
anonimizada/hasheada según política de privacidad, perfil OPAQUE, duración
total.

---

## 19. Consideraciones de seguridad

Resumen aplicado de RFC 9807 §9–§10:

- **Validación de entrada (§10.7)**: validar toda clave pública y elemento
  OPRF recibido (rango, en curva, no identidad); el secreto DH nunca puede
  ser el elemento neutro. Cubierto por el wrapper de §7.1.
- **Constant-time (§9.1)**: comparaciones de secretos con
  `sodium_memcmp`/`hash_equals`; sin branching dependiente de secretos,
  incluida la construcción de la respuesta falsa.
- **MAC random-key robust (§10.6)**: HMAC-SHA-512 cumple. Nunca GMAC/GCM
  para el `auth_tag` del envelope.
- **Key stretching (§10.8)**: Argon2id en el cliente encarece el ataque
  offline tras compromiso del servidor. Trade-off en dispositivos lentos.
- **Enumeración (§10.9)**: respuesta falsa indistinguible + `oprf_seed`
  global + masking key. El registro queda expuesto por diseño → rate limit.
- **masking_key (§10.10)**: requiere canal confidencial en el registro
  (TLS).
- **Sin salt adicional (§10.11)**: la clave OPRF es el salt secreto. Un
  servidor corrupto puede montar diccionario offline — inherente a
  cualquier aPAKE de servidor único. Si el `oprf_seed` se filtra o tiene
  poca entropía, los derivados de la contraseña quedan atacables.
- **Reglas de contraseña en servidor**: imposibles por diseño (el servidor
  no ve la contraseña). Aplicarlas en el cliente.
- **HSM (§10.12)**: opcionalmente la clave AKE privada puede vivir en un
  HSM (sólo se necesitan las operaciones DH). Fuera de alcance inicial.
- **Guessing online (§9.2)**: KE2 sin KE3 posterior cuenta como fallo;
  rate limiting en todos los endpoints.
- **export_key (§10.4, Apéndice A)**: usar sólo tras autenticar al peer
  (server_mac verificado).
- **Estados efímeros (§6)**: `ClientState`/`ServerState` se borran al
  terminar; en PHP, `sodium_memzero()` como best effort documentado.

---

## 20. Plan de pruebas obligatorio

La implementación no está terminada hasta superar **todas** las categorías.

### 20.1 Vectores RFC 9497

- `expand_message_xmd` (vectores RFC 9380 para SHA-512).
- `HashToScalar`, `DeriveKeyPair`, blind evaluation, serialización
  Ristretto255.

### 20.2 Vectores RFC 9807 (Apéndice C)

Suite `ristretto255, SHA-512, HKDF-SHA-512, HMAC-SHA-512`, KSF = Identity
según el vector. El servidor debe reproducir exactamente:
`RegistrationResponse`, `CredentialResponse`, preamble, `server_mac`,
`expected_client_mac`, `session_key`.

Usar los **Real Test Vectors** C.1.1 (sin identidades) y C.1.2 (con
`client_identity`/`server_identity`) y los **Fake Test Vectors** C.2.1 para
el flujo de usuario inexistente. Los vectores traen `envelope_nonce`,
`masking_nonce`, `server_nonce`, `client_nonce`, seeds y blinds fijos → se
inyectan vía `RandomSource`.

**No mezclar con los demás vectores del apéndice**: C.1.3, C.1.4 y C.2.2 usan
`Group: curve25519`, y C.1.5, C.1.6 y C.2.3 usan P-256. No son aplicables a este
perfil y compararse contra ellos produce fallos desconcertantes.

### 20.3 Aleatoriedad inyectable

```php
interface RandomSource
{
    public function bytes(int $length): string;
}
```

Producción: `random_bytes()`. Tests: fuente determinista con los bytes
exactos del vector. Sin mocks parciales de funciones globales.

### 20.4 Fixtures de referencia

No se generan fixtures compilando `opaque-ke` en Rust: exigiría una cadena de
herramientas que este proyecto no tiene y que §3 no autoriza, y sería redundante.
`@serenity-kit/opaque` **empaqueta `opaque-ke` 4.0.1** e incluye la
implementación de servidor en JavaScript, así que sirve de oráculo de referencia
en CI cubriendo lo mismo. Los fixtures se guardan versionados en
`tests/Fixtures`.

### 20.5 Interoperabilidad con @serenity-kit/opaque

Node.js sólo en desarrollo y CI. Flujo completo:

1. JS genera `registrationRequest` → 2. PHP `registrationResponse` →
3. JS `registrationRecord` + `exportKey` → 4. PHP guarda →
5. JS `startLoginRequest` → 6. PHP `loginResponse` →
7. JS `finishLoginRequest` + `sessionKey` + `exportKey` →
8. PHP valida → 9. session keys iguales → 10. `exportKey` idéntico al del
registro en logins posteriores.

Versión del cliente fijada exacta (`1.1.0`, sin rango) en `package.json`, e
instalación con `npm ci`.

**Prueba de regresión del KSF** (bloqueante). Un fixture fijo y versionado con
`password`, `serverSetup`, `registrationRecord` y el `exportKey` esperado. En CI:
ejecutar el login contra ese record y comprobar que el `exportKey` sigue siendo
el mismo. Detecta cualquier cambio de KSF, de suite, de key schedule o de
codificación. Añadir un centinela que compruebe que **omitir** `keyStretching`
produce el mismo `exportKey`: el día que falle, el default del paquete ha
cambiado.

Sin esta prueba, un cambio de KSF se manifiesta en producción como "todos los
usuarios tienen mal la contraseña" y, peor, como pérdida de acceso a la User
Master Key.

Añadir también `npm audit signatures` como paso bloqueante: `@serenity-kit/opaque`
publica atestaciones SLSA verificables.

### 20.6 Casos negativos

Password incorrecta · usuario inexistente · punto inválido · punto identidad
· punto no canónico · escalar cero · Base64 no canónico · padding Base64 ·
mensaje truncado · bytes adicionales · KE1/KE3 de longitud incorrecta · MAC
incorrecto · handshake expirado · handshake consumido dos veces ·
RegistrationRecord con clave pública inválida · cambio de perfil · cambio de
identidad del servidor · setup incorrecto · usuario existente sin registro
OPAQUE · escalar no canónico en el setup.

Normalización del login, un test por eje: mayúsculas y minúsculas, espacios al
principio y al final, y formas Unicode equivalentes (NFC frente a NFD). Todas
deben producir el mismo `credential_identifier` y por tanto el mismo
`evaluated_message`.

Concurrencia: dos peticiones simultáneas de `login/finish` con el mismo
`handshakeId` y el mismo `client_mac` válido deben resultar en exactamente una
sesión. El caso secuencial no basta para detectar la carrera de §14.3.

### 20.7 Fuzzing ligero

Entradas aleatorias de 0–512 bytes contra cada parser. Exigencias: ningún
warning PHP, ningún acceso fuera de rango, ningún error de tipo no
controlado, ningún HTTP 500 por entrada remota, sólo excepciones de
protocolo controladas.

### 20.8 Pruebas de enumeración

Para usuario existente vs inexistente: mismo código HTTP en login/start,
JSON idéntico en estructura, `loginResponse` siempre de 320 bytes, flujo
criptográfico completo ejecutado, sin datos del usuario en la respuesta, sin
sesión antes de login/finish. Documentar el riesgo residual de timing de BD
(no demostrable ausencia total desde PHPUnit) + rate limiting.

**Estabilidad del `evaluated_message`** (la prueba que faltaba). Con un
`blinded_message` fijo y el mismo login, la respuesta debe ser idéntica antes y
después de registrar la cuenta, y también antes y después de un cambio de
contraseña. Si cambia, el `credential_identifier` no es determinista y la
anti-enumeración de §13 no funciona, por mucho que los códigos HTTP y las
longitudes coincidan.

---

## 21. Orden de implementación

No empezar por los controladores. Primero demostrar interoperabilidad de la
biblioteca criptográfica independiente:

1. Inspeccionar PHP, Laravel, BD y estructura del proyecto.
2. Verificar disponibilidad de todas las funciones Ristretto255 de
   `ext-sodium`.
3. Base64url y codecs binarios.
4. HKDF-SHA-512.
5. Expand-Label y Derive-Secret.
6. `expand_message_xmd`.
7. Wrapper Ristretto255.
8. OPRF.
9. Vectores RFC 9497.
10. ServerSetup.
11. Registro OPAQUE.
12. Vectores de registro RFC 9807.
13. Masked credential response.
14. AKE 3DH.
15. Vectores de login RFC 9807.
16. Fixtures de referencia (§20.4).
17. Interop `@serenity-kit/opaque` y prueba de regresión del KSF.
18. Persistencia Laravel.
19. Endpoints.
20. Autenticación Laravel.
21. Rate limiting.
22. Página de login compatible con Filament.
23. Análisis estático y casos negativos.
24. Documentar riesgos y límites.

Calidad exigida: `declare(strict_types=1)`, tipos explícitos, clases `final`,
propiedades `readonly`, PHPStan/Larastan al máximo razonable, Pest/PHPUnit,
Pint, sin supresiones globales, comentarios que citen RFC+sección exacta en
cada función criptográfica (RFC, sección, entradas, salidas, longitudes,
errores posibles). Sin comentarios que afirmen que el código es "seguro" o
"production-ready".

---

## 22. Criterios de aceptación

La implementación sólo está completa cuando:

- [ ] No hay dependencia de Node.js en producción.
- [ ] El único requisito no estándar es `ext-sodium`.
- [ ] Los cuatro endpoints funcionan con `@serenity-kit/opaque`.
- [ ] Los vectores oficiales RFC 9497 pasan.
- [ ] Los vectores oficiales RFC 9807 pasan.
- [ ] La session key coincide en PHP y JavaScript.
- [ ] El KSF se pasa explícito en `finish*` y la prueba de regresión del
      `exportKey` pasa (§20.5).
- [ ] `npm audit signatures` pasa como paso bloqueante.
- [ ] Las cuatro rutas están en el grupo de middleware `web`, con sesión y CSRF.
- [ ] El `credential_identifier` es determinista y estable ante cambio de
      contraseña (§20.8).
- [ ] La normalización del login es única para búsqueda en BD y para el HMAC.
- [ ] El consumo de handshake es atómico bajo concurrencia real, no sólo
      secuencial.
- [ ] Existe purga programada de handshakes caducados.
- [ ] La export key permanece estable en el cliente entre logins.
- [ ] Una contraseña incorrecta no crea sesión.
- [ ] Un usuario inexistente recibe respuesta OPAQUE estructuralmente válida.
- [ ] Los handshakes son de un solo uso.
- [ ] No se almacena ni registra la contraseña.
- [ ] No se almacena ni transmite la export key.
- [ ] Filament no recibe la contraseña mediante Livewire.
- [ ] Existe documentación de rotación y backup del server setup.
- [ ] Revisión manual línea a línea contra los RFC realizada.
- [ ] Revisión de seguridad independiente antes de producción.

No se aceptan pruebas fallidas ocultas ni vectores oficiales sustituidos por
pruebas autorreferenciales generadas por la propia implementación PHP.

---

## 23. Rotación, backup y limitaciones conocidas

### 23.1 Rotación y backup del setup

- `oprf_seed`, `server_private_key` y `OPAQUE_ENUMERATION_KEY` deben
  respaldarse con el mismo nivel de protección que las claves maestras de la
  aplicación.
- **Perder cualquiera de esos tres invalida todos los registros OPAQUE**: los
  usuarios tendrían que re-registrarse (los envelopes autentican
  `server_public_key`, la clave OPRF por usuario deriva de `oprf_seed`, y el
  `credential_identifier` deriva de la clave de enumeración).
- `fake_registration_record` **sí es regenerable** sin consecuencias: el
  `masking_nonce` es fresco en cada respuesta, así que un registro falso nuevo
  es indistinguible del anterior. No requiere el mismo cuidado de backup.
- **Los parámetros del KSF son el cuarto elemento cuya modificación exige
  re-registro de todos los usuarios**, igual que rotar la clave del servidor.
  Por eso van en el nombre del perfil (§2) y se fijan explícitamente en el
  cliente (§16).
- Rotación de `server_private_key` u `oprf_seed` ⇒ campaña de re-registro:
  se marca el perfil antiguo y se fuerza nuevo registro OPAQUE en el próximo
  login exitoso (posible sólo con estrategia de doble registro transitorio).
- Cambiar `OPAQUE_SERVER_IDENTITY` rompe los MAC de todos los envelopes:
  tratarlo como rotación completa. Por eso está versionado
  (`.../opaque-v1`).

### 23.2 Limitaciones conocidas

- PHP no garantiza zeroización completa de memoria; `sodium_memzero()` es
  esfuerzo de reducción de exposición, no garantía.
- Timing de consultas de BD entre flujo real y falso: riesgo residual
  documentado, mitigado con fake record materializado y rate limiting.
- Un servidor comprometido puede montar un ataque de diccionario offline
  contra los registros (inherente a todo aPAKE de servidor único;
  mitigable sólo con OPRF umbral, fuera de alcance — RFC 9807 §10.11).
- El flujo de registro revela existencia de cuenta por diseño (RFC §10.9);
  se mitiga en capa de aplicación, no criptográficamente.
- El análisis de seguridad de [JKX18] cubre una instancia de clave única;
  no hay análisis publicado para multi-key/batching (RFC §10.2).

### 23.3 Divergencias deliberadas respecto al RFC

- `context = ""` (el RFC lo recomienda no vacío para separación de dominios;
  aquí la separación se hace vía `server_identity` porque el cliente
  `@serenity-kit/opaque` no expone el parámetro `context`). Revisar si el
  cliente lo permite en versiones futuras.
- `client_identity`/`server_identity` como entrada del OPRF (§9.1 del RFC,
  SHOULD/RECOMMENDED): **no aplicado**, porque el cliente
  `@serenity-kit/opaque` sólo pasa la contraseña al OPRF. Interoperabilidad
  gana a la recomendación.
- KSF ejecutado íntegramente en el cliente; el servidor es agnóstico a él. Se
  fija de forma explícita (Argon2id v0x13, m=65536 KiB, t=3, p=4, sal de 16
  bytes a cero) en lugar de confiar en el valor por defecto del paquete, que ya
  cambió una vez entre versiones menores. `p=4` afecta al resultado pero no
  paraleliza: el Argon2 del cliente se compila sin la feature `parallel`.

---

## Apéndice A — Tabla rápida de etiquetas y DSTs

| Uso | Valor exacto |
|---|---|
| contextString OPRF | `"OPRFV1-" \|\| 0x00 \|\| "-" \|\| "ristretto255-SHA512"` |
| DST HashToGroup | `"HashToGroup-" \|\| contextString` |
| DST HashToScalar (DeriveKeyPair) | `"DeriveKeyPair" \|\| contextString` |
| info DeriveKeyPair OPRF | `"OPAQUE-DeriveKeyPair"` |
| info DeriveKeyPair AKE/DH | `"OPAQUE-DeriveDiffieHellmanKeyPair"` |
| Hash Finalize OPRF | sufijo `"Finalize"` |
| Expand masking key | `"MaskingKey"` |
| Expand auth key | `nonce \|\| "AuthKey"` |
| Expand export key | `nonce \|\| "ExportKey"` |
| Expand seed clave cliente | `nonce \|\| "PrivateKey"` |
| Expand clave OPRF por usuario | `credential_identifier \|\| "OprfKey"` |
| Expand pad de masking | `masking_nonce \|\| "CredentialResponsePad"` |
| Prefijo preamble | `"OPAQUEv1-"` |
| Prefijo Expand-Label | `"OPAQUE-"` |
| Labels Derive-Secret | `"HandshakeSecret"`, `"SessionKey"`, `"ServerMAC"`, `"ClientMAC"` |

## Apéndice B — Vectores de referencia (RFC 9807, Apéndice C)

Para la suite de este perfil son directamente aplicables:

- **C.1.1** — Real, ristretto255-SHA512, sin identidades explícitas.
- **C.1.2** — Real, con `client_identity = "alice"`, `server_identity = "bob"`.
- **C.2.1** — Fake, ristretto255-SHA512 (flujo de usuario inexistente).

**No aplicables**: C.1.3, C.1.4 y C.2.2 usan `Group: curve25519` para el AKE, y
C.1.5, C.1.6 y C.2.3 usan P-256. Aunque su OPRF sea ristretto255 en algunos
casos, el grupo del AKE difiere y los MAC no cuadrarán.

Los vectores usan KSF = Identity y `Context = 0x4f50415155452d504f43`
("OPAQUE-POC"): la suite de tests debe parametrizar KSF y context para
reproducirlos, aunque producción use Argon2id (cliente) y context vacío.
Todos los valores intermedios (`auth_key`, `randomized_password`,
`handshake_secret`, `server_mac_key`, `client_mac_key`, `oprf_key`) deben
compararse, no sólo las salidas finales.
