# Spec 0001: Alta de cuentas y arranque de sesión

* Related ADR(s): `docs/adr/0002-encrypted-data-flow-livewire-alpine-filament.md`,
  `docs/adr/0003-master-key-survival-in-browser.md`, `docs/adr/0004-client-crypto-and-data-format.md`,
  `docs/adr/0007-encrypted-user-configuration.md`, `docs/adr/0009-user-provisioning-and-session-lifecycle.md`,
  `docs/OPAQUE.md`

Esta spec depende de los ADR anteriores y de `docs/OPAQUE.md` como lectura previa: no repite su
justificación, solo la aplica. Si un punto de esta spec y un ADR no coinciden, el ADR manda y esta spec
tiene un error que corregir.

## 1. Alcance

Cubre todo lo que ocurre desde que un administrador ejecuta el comando de Artisan que emite un enlace
hasta que la persona invitada está dentro del panel, con su clave maestra (User Master Key, UMK) en
memoria y lista para cifrar y descifrar datos.

Incluye: el arranque del servidor (`opaque:setup`), la emisión de enlaces de registro, el establecimiento
de la contraseña inicial y nacimiento de la UMK, el login posterior, la recuperación de la UMK tras una
recarga de página, el bloqueo por inactividad y el cierre de sesión.

Queda fuera, de forma explícita:

* **Cambio de contraseña** de alguien que recuerda la actual. El ADR 0009 lo deja apuntado como un flujo
  futuro (abrir la UMK con la contraseña vieja, reenvolverla con la nueva) y esta spec no lo desarrolla.
  Hasta que exista, la única vía para una contraseña olvidada es la reemisión del enlace, con la pérdida
  de historial que eso implica.
* **Recuperación de cuenta** sin contraseña ni enlace nuevo. No hay escrow en esta fase (ADR 0002).
* **Compartición** de datos con un profesional u otro usuario. El identificador de clave del ADR 0004
  reserva el hueco, pero no hay mecanismo que lo use todavía.
* El **patrón de pantalla con datos cifrados** una vez el usuario está dentro del panel (islands, lotes
  con cursor, componentes Alpine de una vista concreta). Eso es una spec propia, que se escribe cuando
  exista la primera pantalla real.

## 2. Historias de usuario

**Administrador que arranca el sistema.** Antes de que exista ningún usuario, alguien con acceso al
servidor ejecuta `php artisan opaque:setup` una sola vez. El comando genera el material criptográfico
estático del servidor y lo imprime por pantalla; la persona lo copia a la configuración del entorno. Sin
este paso no se puede registrar a nadie.

**Administrador que da de alta a otra persona.** Un usuario ya registrado (el primero se crea con un
comando de consola, los siguientes desde el panel) introduce el nombre y el email de una persona nueva.
El sistema crea la fila de usuario, sin contraseña ni clave, y genera un enlace de un solo uso. El enlace
se muestra en pantalla una sola vez; la aplicación nunca lo envía por correo. El administrador se lo hace
llegar a la persona por el canal que elija.

**Persona que establece su contraseña.** Abre el enlace en su navegador, escribe una contraseña y su
confirmación. El navegador ejecuta el registro OPAQUE, genera su UMK aleatoria, la envuelve y sube el
resultado al servidor en una única operación. Si todo va bien, queda autenticada y dentro del panel sin
un segundo formulario de login.

**Persona que vuelve a entrar.** Escribe su login y contraseña en la pantalla de login. El navegador
ejecuta el login OPAQUE completo, recupera su UMK ya existente y entra al panel.

**Persona que recarga la página.** Un F5, un error 419 o un despliegue a mitad de sesión no le piden la
contraseña de nuevo: el navegador recupera la UMK a partir de un secreto ligado a su sesión de servidor,
sin volver a derivar nada de la contraseña.

**Puesto que se queda desatendido.** Pasados quince minutos sin actividad, la sesión se cierra por
completo, en servidor y en cliente. La siguiente persona que toque el teclado ve la pantalla de login, no
un panel con datos de otra persona.

## 3. Esquema de datos

Todo lo que sigue asume que la clave primaria de `users` es **UUID (UUIDv7)**, decidido antes de escribir
la primera migración. Es una decisión de proyecto, no de esta funcionalidad en concreto, pero es
bloqueante para ella: el `user_id` entra en el dato asociado del AEAD y en la respuesta de
`registration/start`, así que cambiar el tipo de clave después de cifrar el primer sobre invalida el AAD
de todo el histórico. La forma que entra en la derivación y en el AAD es siempre la representación textual
canónica en minúsculas del UUID, nunca sus bytes crudos (ADR 0004).

### 3.1 Columnas nuevas de `users`

`id`, UUID (UUIDv7), clave primaria: sustituye el `bigint` autoincremental actual.

`password`, `string` nullable: no se usa para autenticar. Se mantiene nullable por compatibilidad de
framework; ver la limitación de `AuthenticateSession` en la sección 9.

`opaque_credential_identifier`, binario de 32 bytes, único, nullable:
`HMAC-SHA-256(ENUM_KEY, normalize(login))`, calculado en el registro y reutilizado siempre
(OPAQUE.md sección 13.1).

`opaque_registration_record`, binario de 192 bytes, nullable: `client_public_key || masking_key ||
envelope`, tal cual llega del cliente.

`opaque_profile`, `varchar(96)` nullable: nombre completo del perfil (incluye los parámetros del KSF,
ver ADR 0004 y OPAQUE.md sección 2).

`opaque_registered_at`, timestamp nullable: se rellena al completar `registration/finish`. `NULL` es
indistinguible de "cuenta inexistente" para efectos de la rama falsa del login (OPAQUE.md sección 13.3).

`encrypted_settings`, `text`, nullable en el esquema pero nunca vacío tras el alta: sobre cifrado único
de configuración (ADR 0007). Se escribe con contenido vacío `{"v":1}` en el mismo alta, para que ningún
usuario sea distinguible de otro por tener o no configuración.

No se añade `email_verified_at` en el alta: el enlace lo entrega un administrador por un canal que la
aplicación no controla, así que nadie ha demostrado control del buzón. Una columna que afirmara lo
contrario acabaría usándose como si fuera cierto.

La columna `name`, ya presente en el esquema base de Laravel y no nueva, se guarda en claro, sin cifrar.
El identificador de login ya está en claro por necesidad, así que cifrarlo añadiría poca privacidad real y
rompería el menú de usuario, los breadcrumbs y el listado de administración de Filament, que lo resuelven
en servidor. Es una excepción consciente y acotada a la regla general de cifrar (ADR 0009), y no se
extiende a ningún otro campo.

`SQLite`, el driver por defecto de este proyecto, no tiene un tipo `BINARY(n)` real: `->binary()` genera
un `BLOB` sin longitud. Las longitudes exactas (32, 192 bytes) se validan siempre en la capa de
aplicación, nunca se dan por garantizadas por el esquema.

### 3.2 Tablas de OPAQUE

**`opaque_registrations`** (registro pendiente, OPAQUE.md sección 14.2):

| Columna | Tipo |
|---|---|
| `id` | UUID, primaria |
| `user_id` | UUID, fk |
| `invitation_ref` | UUID, referencia al enlace de registro que lo originó |
| `credential_identifier` | binario, 32 bytes |
| `profile` | `varchar(96)` |
| `expires_at` | timestamp |
| `created_at` | timestamp |

**`opaque_login_handshakes`** (estado de login en curso, OPAQUE.md sección 14.3):

| Columna | Tipo |
|---|---|
| `id` | UUID, primaria |
| `user_id` | UUID, nullable (null en el flujo falso) |
| `state_ciphertext` | `text`, `ServerLoginState` cifrado con `Crypt` de Laravel |
| `expires_at` | timestamp, TTL de 180 segundos |
| `created_at` | timestamp |

Ambas tablas necesitan purga programada de filas caducadas (`opaque:prune-handshakes` o equivalente): cada
`login/start` sin autenticar crea una fila, así que sin purga el crecimiento lo dirige cualquiera desde
fuera.

### 3.3 Enlaces de registro

**`user_registration_links`**:

| Columna | Tipo |
|---|---|
| `id` | UUID, primaria |
| `user_id` | UUID, fk |
| `token_hash` | binario, 32 bytes, único (`sha256` del token en claro) |
| `expires_at` | timestamp |
| `consumed_at` | timestamp, nullable |
| `created_by` | UUID, nullable, fk a `users` (quién lo emitió, para auditoría) |
| `created_at` | timestamp |

El token en claro nunca se persiste, solo su hash. La TTL es de 24 horas, decisión ya tomada, pasada como
parámetro explícito del comando y no como valor por defecto oculto (ADR 0009).

### 3.4 Sobres de clave: la UMK es de solo añadir

El sobre que envuelve la UMK **no vive en una columna de `users`**. Vive en su propia tabla, de solo
añadir, porque reemitir un enlace nunca puede sobrescribir el sobre que la contraseña anterior sabía
abrir: si lo hiciera, una pérdida de contraseña que era recuperable para quien la recordase dejaría de
serlo (ADR 0009).

**`user_master_key_envelopes`**:

| Columna | Tipo |
|---|---|
| `id` | UUID, primaria |
| `user_id` | UUID, fk |
| `envelope` | `text`, sobre cifrado con prefijo `v1.` (ADR 0004) |
| `created_at` | timestamp |
| `retired_at` | timestamp, nullable |

Solo hay como mucho una fila con `retired_at IS NULL` por usuario: es el sobre vigente. Emitir un enlace
sobre una cuenta que ya tiene un sobre vigente exige confirmación explícita (no un "Sí" genérico, sino
teclear el email de la cuenta) y, al completarse el registro, inserta una fila nueva y marca la anterior
con `retired_at`. Esa guardia vive en el servicio que emite enlaces (`RegistrationLinks`), no en el
comando ni en la acción de Filament: si viviera en dos sitios, uno de los dos acabaría sin ella, y el flag
`--no-interaction` del comando se saltaría cualquier confirmación puesta solo en la interfaz.

### 3.5 Secretos de sesión

El secreto de sesión del ADR 0003 vive dentro de la propia carga útil de la sesión de Laravel, sin tabla
ni columna dedicada. Se acuña al iniciar sesión, se guarda como un valor más de la sesión y queda
protegido por el mismo almacén de servidor (base de datos o Redis) que protege el resto de su contenido.

Bloquear y cerrar sesión lo destruyen sin ningún mecanismo adicional: destruir la sesión de Laravel destruye
su carga útil y con ella el secreto (ADR 0003). Lo que se pierde frente a una tabla propia es poder
inspeccionar o revocar de forma selectiva la sesión criptográfica de alguien sin deserializar su carga
útil: no hay fila que listar ni borrar aparte de la sesión entera. Es una pérdida aceptada a cambio de no
mantener un esquema propio para un único valor.

### 3.6 Qué se decide antes del primer usuario

Tres cosas de esta sección son bloqueantes y no se pueden corregir después sin invalidar datos ya
cifrados: el tipo UUID de `id` en `users`, la forma canónica del identificador de usuario en el AAD
(minúsculas, textual), y la TTL de 24 horas del enlace de registro, ya decidida. Las tres deben quedar
cerradas antes de ejecutar `opaque:setup` en un entorno con datos reales.

## 4. Contrato HTTP

Todas las rutas se montan a través del panel de Filament, no de `routes/web.php`: el panel ya da sesión,
CSRF y el prefijo `/phr`. Las cuatro rutas de OPAQUE (registro y login) van en `$panel->routes()`, que se
ejecuta fuera del grupo de middleware de autenticación. Las dos rutas de sesión (`session-secret` y
`lock`) van en `$panel->authenticatedRoutes()`, que sí exige sesión autenticada: verificado que
`routes()` corre fuera del grupo `getAuthMiddleware()` y `authenticatedRoutes()` dentro.

Esto diverge del path que describe `docs/OPAQUE.md` sección 15 (que hablaba de `routes/web.php`), pero
cumple la sustancia del requisito: grupo `web`, sesión y CSRF disponibles. `OPAQUE.md` queda pendiente de
corrección en ese punto.

Todas las respuestas llevan `Cache-Control: no-store`. El JavaScript del navegador envía el token CSRF y
usa `credentials: 'same-origin'` en cada petición.

### 4.1 `POST /phr/auth/opaque/registration/start`

Sin autenticar. Petición:

```json
{ "registrationRequest": "<base64url 32B>", "registrationToken": "<token del enlace>" }
```

El token llega aquí y no antes: no hay una ruta de validación previa que lo consuma. La página de
establecimiento de contraseña se sirve genérica (sin path de token, ver sección 7) y el navegador lee el
token del fragmento de la URL (`#<token>`), que nunca viaja al servidor salvo dentro del cuerpo de esta
petición.

Respuesta 200:

```json
{
  "registrationId": "<uuid>",
  "registrationResponse": "<base64url 64B>",
  "serverPublicKey": "<base64url 32B>",
  "userId": "<uuid>",
  "profile": "OPAQUE-R255-SHA512-A2ID-m65536-t3-p4-ctx0-v1"
}
```

`userId` es necesario aquí, y no solo al final del flujo, porque el cliente lo necesita para construir el
dato asociado del AEAD antes de cifrar la UMK y la configuración en el paso 4 del orden criptográfico
(sección 5). `serverPublicKey` permite el pinning que describe la sección 5.

Token inválido, caducado o ya consumido: error genérico, mismo formato para los tres casos (evita
delatar cuál de las tres cosas ocurrió).

Rate limiting: por IP y por hash del token.

### 4.2 `POST /phr/auth/opaque/registration/finish`

Sin autenticar. Petición:

```json
{
  "registrationId": "<uuid>",
  "registrationRecord": "<base64url 192B>",
  "wrappedUserMasterKey": "<sobre v1.>",
  "encryptedSettings": "<sobre v1.>"
}
```

Una única transacción de base de datos: consume el `opaque_registrations` pendiente, consume el
`user_registration_links` correspondiente, inserta la fila vigente en `user_master_key_envelopes`,
escribe `encrypted_settings` y actualiza las columnas OPAQUE del usuario. No abre el sobre de la UMK, no
guarda la `RegistrationResponse`, no guarda contraseñas.

**Idempotente.** Si la respuesta se pierde en la red pero la transacción ya se ejecutó en servidor, un
reintento con el mismo `registrationId` no debe fallar de forma confusa ni duplicar filas: se detecta que
el pendiente ya no existe y, si el usuario ya quedó registrado con ese mismo `registrationRecord`,
responde éxito de nuevo en vez de un error genérico de "registro no encontrado". Ver sección 7 para el
detalle del modo de fallo que esto cubre.

Rate limiting: por IP.

### 4.3 `POST /phr/auth/opaque/login/start`

Sin autenticar. Petición:

```json
{ "login": "user@example.com", "startLoginRequest": "<base64url 96B>" }
```

`login` solo localiza la cuenta, nunca entra en la criptografía. Rama real o rama falsa según OPAQUE.md
sección 13, idénticas en forma y coste. Siempre HTTP 200 para mensajes estructuralmente válidos.

Respuesta:

```json
{
  "handshakeId": "<uuid>",
  "loginResponse": "<base64url 320B>",
  "profile": "OPAQUE-R255-SHA512-A2ID-m65536-t3-p4-ctx0-v1"
}
```

Rate limiting: por IP, por hash del login normalizado, y por la combinación de ambos. Nunca el email en
claro como clave de la limitación.

### 4.4 `POST /phr/auth/opaque/login/finish`

Sin autenticar hasta que termina. Petición:

```json
{ "handshakeId": "<uuid>", "finishLoginRequest": "<base64url 64B>" }
```

Consume el handshake **antes** de validar el MAC (invertir el orden abre un oráculo de reintento sobre el
mismo handshake). Fallo, en cualquiera de sus formas (MAC inválido, handshake caducado, handshake
reutilizado, usuario inexistente): un único error genérico, sin sesión creada.

Éxito con usuario real:

```php
Auth::guard('web')->login($user, remember: false);
$request->session()->regenerate();
```

seguido de la acuñación del secreto de sesión, después de regenerar el id de sesión, nunca antes (ver la
tabla de la sección 5: hacerlo antes lo liga a un id de sesión que desaparece en la regeneración).

Respuesta 200:

```json
{
  "userId": "<uuid del usuario>",
  "redirect": "<url intended o el panel>",
  "csrf": "<token nuevo>",
  "sessionSecret": "<base64url 32B>",
  "encryptedUserMasterKey": "<sobre v1. vigente>",
  "encryptedSettings": "<sobre v1.>"
}
```

`userId` es imprescindible, no informativo: entra en el dato asociado de los dos sobres que vienen en
esta misma respuesta (paso 9 de la sección 5), así que sin él el cliente no puede abrirlos. La sección 4.1
lo devuelve por la misma razón. No revela nada que quien recibe un 200 no sepa ya, porque la rama falsa
nunca llega hasta aquí: responde con el error genérico de credenciales.

`redirect` es `session()->pull('url.intended', $panelUrl)`, para no perder el destino que dejó
`redirect()->guest()` cuando un middleware sacó a alguien de una URL profunda. La `session_key` de OPAQUE
no se devuelve al navegador: el cliente ya tiene su copia y el servidor no la necesita después del
handshake.

Rate limiting: mismas tres claves que `login/start`.

### 4.5 `POST /phr/auth/session-secret`

Autenticada (cookie de sesión, dentro de `authenticatedRoutes()`). Sin cuerpo de petición.

Es `POST`, no `GET`: un `GET` es cacheable por diseño y un intermediario cacheando esta respuesta
escribiría el secreto en disco de terceros. Cabeceras: `Cache-Control: no-store`, `Vary: Cookie`.

Respuesta 200:

```json
{ "sessionSecret": "<base64url 32B>", "encryptedSettings": "<sobre v1.>" }
```

Incluye `encryptedSettings` porque la configuración no viaja dentro del paquete de `sessionStorage`, solo
la UMK envuelta lo hace: sin este campo aquí, cualquier pantalla que arranque por recuperación (sección 6,
apartado de recarga) no tendría unidad de medida ni rango objetivo hasta el próximo login completo.

Respuestas de error: `401` si la sesión de Laravel no existe o caducó, `410` si el secreto fue destruido
(bloqueo o logout, sección 8). Ambas llevan al cliente a la pantalla de login.

### 4.6 `POST /phr/auth/lock`

Autenticada. Sin cuerpo de petición relevante.

Destruye el secreto de sesión y la sesión de Laravel completa (sección 8), y responde 200. El cliente
hace una recarga dura después de recibir la respuesta, nunca antes: si recarga antes de que el servidor
confirme, una pérdida de red deja el secreto vivo en servidor con el cliente ya sin UMK en memoria, lo
que en la práctica es un bloqueo que no bloqueó nada del lado servidor.

## 5. Orden criptográfico del establecimiento de contraseña

Es la secuencia más delicada de todo el sistema: cualquier operación fuera de orden o cualquier paso
partido en dos peticiones puede dejar una cuenta que se autentica pero no tiene clave utilizable, y sin
recuperación posible en esta fase.

```
 1 [N] await opaque.ready
 2 [N] password <- input.value ; input.value = ''
 3 [N] {clientRegistrationState, registrationRequest} = startRegistration({password})
       sin keyStretching aquí
 4 [S] valida el token del enlace (no lo consume todavía) ; evalúa OPRF ;
       inserta el pendiente en opaque_registrations
 5 [N] assert(profile === PROFILE_PINNED)
       assert(serverPublicKey === SERVER_PUBLIC_KEY_PINNED)
 6 [N] {registrationRecord, exportKey} = finishRegistration({..., identifiers: {server},
       keyStretching: KSF})
       aquí corre Argon2id (t=3, m=64 MiB, p=4)
 7 [N] KEK = HKDF-SHA-512(exportKey, info = "myphr/kek/v1")
 8 [N] UMK = getRandomValues(32)                       <- la clave maestra nace aquí
 9 [N] wrappedUMK        = seal(KEK, UMK, aad = ctx(userId, "umk"))
10 [N] encryptedSettings = seal(deriveRecordKey(UMK, ctx(userId, "settings")), '{"v":1}')
11 [N] zeroize(exportKey, KEK)
12 [S] registration/finish: una transacción -> consume el pendiente + consume el enlace +
       escribe la fila vigente en user_master_key_envelopes + escribe encrypted_settings
       (idempotente, sección 4.2 y 7)
13 [N] login OPAQUE completo con la misma password, que sigue en memoria
14 [S] verifica el MAC -> Auth::login -> session()->regenerate() -> acuña sessionSecret
15 [N] KEK2 = HKDF(exportKey2) ; UMK' = open(KEK2, encryptedUserMasterKey)
16 [N] assert(UMK' === UMK)                            <- verificación del alta
17 [N] zeroize(password, exportKey2, KEK2)
18 [N] SK = HKDF(sessionSecret) ; sessionStorage['phr.rk'] = seal(SK, UMK) ;
       zeroize(SK, sessionSecret)
19 [N] descifra encryptedSettings ; actualiza <meta name="csrf-token">
20 [N] Alpine.navigate(redirect)
```

`[N]` es el navegador, `[S]` el servidor. Los pasos 13 a 20 son, deliberadamente, el mismo orden que un
login normal (sección 6): en vez de crear la sesión directamente al final del paso 12, el cliente hace un
login OPAQUE completo con la contraseña que acaba de fijar. Cuesta un Argon2id de más, pero descubre en el
momento (cuando todavía no hay datos que perder) cualquier desajuste entre el KSF o el `identifiers.server`
usados en el registro y los que usará todo login futuro, en vez de descubrirlo en el primer login real, ya
con datos cifrados de por medio.

### Qué se rompe si se altera el orden

`keyStretching` en el paso 3 (`startRegistration`) en vez del 6 (`finishRegistration`): se ignora en
silencio y se aplica el valor por defecto del paquete. El `registrationRecord` queda atado a un KSF
distinto del configurado, y todo login futuro que sí pase el `KSF` correcto falla como "contraseña
incorrecta".

UMK generada antes del paso 6: no rompe la criptografía en sí, pero invita a la variante en que la UMK se
deriva de la contraseña en vez de ser aleatoria, que es justo lo que el ADR 0009 descarta. Si el registro
falla después, queda una clave huérfana que hay que zeroizar en el manejo de error.

Comparar `profile` y `serverPublicKey` (paso 5) después del paso 6 en vez de antes: en el registro no
existe todavía `server_mac`, nada más autentica al servidor. Sin esta comparación antes de derivar la
KEK, un servidor suplantado puede completar un registro entero sin que el cliente lo note.

Consumir el enlace en el paso 4 en vez de en el 12: un fallo de red durante el Argon2id del paso 6 deja a
la persona sin enlace y sin cuenta usable, sin ninguna vía de recuperación salvo reemisión manual.

Separar el paso 12 en dos peticiones (`registrationRecord` primero, `wrappedUserMasterKey` después): un
fallo a mitad deja una cuenta que se autentica pero no tiene clave maestra utilizable. El enlace ya está
consumido, la cuenta queda rota de forma permanente. Es el peor modo de fallo del diseño completo, y es
la razón de que el paso 12 sea una única petición transaccional.

Zeroizar la contraseña antes del paso 13: el login inmediato del paso 13 se vuelve imposible, y el enlace
ya se consumió, así que no hay segunda oportunidad de escribir la contraseña sin reemitir el enlace.

Saltar los pasos 15 y 16 y crear la sesión directamente en `registration/finish`: ahorra un Argon2id, pero
abre una segunda ruta de creación de sesión que auditar aparte, y pierde la comprobación temprana de un
desajuste de KSF o de identidad de servidor.

Escribir `sessionStorage` (paso 18) antes del 14: el paquete queda cifrado bajo un secreto de sesión que
todavía no existe, material inútil que no abre nada.

Escribir `sessionStorage` (paso 18) antes del 16: se persiste una UMK que todavía no se ha verificado que
el servidor sepa devolver correctamente.

Acuñar `sessionSecret` (paso 14) antes de `session()->regenerate()`: el secreto queda ligado al id de
sesión anterior y se pierde en la regeneración, sin ningún síntoma hasta el primer F5 de esa persona.

Navegar (paso 20) antes del 19: `session()->regenerate()` también regeneró el token CSRF. El `<meta>` de
la página quedó desactualizado y el siguiente POST autenticado responde 419 de forma intermitente.

Navegar (paso 20) antes del 18: si esa navegación termina en una recarga dura (un asset con seguimiento
de versión cambiado), la UMK muere sin haber quedado ningún respaldo en `sessionStorage`.

## 6. Orden criptográfico del login y de la recuperación tras recarga

### 6.1 Login posterior

```
 1 [N] await opaque.ready
 2 [N] password <- input.value ; input.value = ''
 3 [N] {clientLoginState, startLoginRequest} = startLogin({password})     sin keyStretching
 4 [S] login/start: rama real o falsa, idénticas en forma y coste. 200 siempre.
 5 [N] result = finishLogin({..., identifiers: {server}, keyStretching: KSF})
       if (!result)  -> error genérico            (undefined, nunca null)
       catch (e)     -> error de configuración     (KSF inválido lanza excepción)
 6 [S] login/finish: consume el handshake antes de validar el MAC ; hash_equals ;
       Auth::login ; session()->regenerate() ; acuña sessionSecret ; zeroiza el estado
 7 [N] KEK = HKDF(exportKey) ; UMK = open(KEK, encryptedUserMasterKey)
       fallo -> error visible, nunca ocultar el registro (ADR 0004)
 8 [N] zeroize(password, exportKey, KEK)
 9 [N] SK = HKDF(sessionSecret) ; sessionStorage['phr.rk'] = seal(SK, UMK) ;
       zeroize(SK, sessionSecret)
10 [N] descifra encryptedSettings ; actualiza <meta name="csrf-token">
11 [N] Alpine.navigate(redirect)
```

Dos riesgos de orden propios del login, además de los ya cubiertos en la sección 5:

* Recorrer la rama real cuando `opaque_registration_record IS NULL` o el `opaque_profile` no coincide con
  el perfil vigente delata, por forma o por tiempo de respuesta, a un usuario en migración. La rama falsa
  se recorre siempre en esos dos casos, no solo cuando la cuenta no existe.
* Un `redirect` fijo al panel, en vez de `session()->pull('url.intended', ...)`, pierde el destino que un
  middleware de autorización dejó guardado al sacar a la persona de una URL profunda.

### 6.2 Recuperación tras recarga (F5, 419, despliegue)

```
1 [N] keyring vacío -> lee sessionStorage['phr.rk'] ; si no hay -> a login
2 [N] POST /phr/auth/session-secret   (cookie de sesión)
      401 -> sesión muerta -> a login
      410 -> secreto destruido por bloqueo o logout -> a login
3 [N] SK = HKDF(sessionSecret) ; UMK = open(SK, paquete) ; zeroize(SK, sessionSecret)
4 [N] descifra encryptedSettings ; continúa
```

Es el mismo orden reducido de la sección 6.1, y es el que ejecuta toda pantalla con datos cifrados antes
de pedir su primer lote de datos. Perder la UMK en memoria es un estado normal y frecuente, no un error:
la interfaz degrada a pedir autenticación, nunca a una pantalla rota (ADR 0003).

## 7. Modos de fallo

**Respuesta perdida en `registration/finish`.** La transacción del servidor se ejecuta igual, pero la
respuesta no llega al cliente por un corte de red. Sin idempotencia, un reintento automático fallaría con
"pendiente no encontrado" y dejaría a la persona atascada creyendo que el registro no funcionó cuando en
realidad sí se completó. Con el endpoint idempotente (sección 4.2), el cliente puede reintentar con el
mismo `registrationId` y, si detecta que la cuenta ya quedó registrada con ese mismo
`registrationRecord`, seguir el flujo como si hubiera tenido éxito la primera vez. Si el reintento nunca
llega (la pestaña se cerró), la persona ve el enlace como consumido si vuelve a abrirlo, y la salida es la
misma que para un enlace ya usado: pedirle a un administrador que reemita uno, con la confirmación
explícita que exige un sobre de UMK ya existente.

**Enlace consumido.** Abrir un enlace ya usado, caducado o inexistente muestra siempre la misma pantalla
genérica de "enlace no válido", sin distinguir el motivo (OPAQUE.md sección 13.3, aplicado también aquí
por consistencia). La salida es pedir un enlace nuevo a un administrador.

**Dos pestañas.** La UMK vive en el scope de un módulo ES por pestaña (ADR 0003), así que cada pestaña
necesita su propio login o su propia recuperación; no hay memoria compartida entre pestañas. Dos pestañas
completando un `registration/finish` para el mismo enlace en paralelo son el mismo caso que la
idempotencia de más arriba: una gana la transacción, la otra recibe la respuesta idempotente si llega a
tiempo, o ve el enlace como consumido si llega después.

**Desajuste de KSF o de perfil.** Si el KSF configurado en el cliente cambia sin que cambie el nombre del
perfil, o si `opaque_profile` de una cuenta no coincide con el perfil vigente del servidor, el login de
esa cuenta se comporta exactamente como una contraseña incorrecta: error genérico, sin ninguna pista de
que el problema es de configuración y no de la persona. Es indistinguible por diseño (evita delatar
cuentas en un estado especial), y por eso hace falta una métrica de servidor, no expuesta al cliente, que
cuente cuántas veces se recorre la rama falsa por esta causa concreta (record y perfil presentes pero
distintos del vigente) en vez de por ausencia de cuenta. Sin esa métrica, un cambio de KSF se manifiesta
en producción como "a todo el mundo se le olvidó la contraseña", sin ninguna señal previa.

**Qué ve el usuario en cada caso.** El principio es el mismo en los cuatro casos: nunca una pantalla rota,
nunca un error técnico, siempre una acción concreta a seguir (reintentar, pedir un enlace nuevo, volver a
entrar). El detalle técnico de cada fallo se registra en servidor, sin contenido clínico, para que quien
opera el sistema pueda diagnosticar lo que la persona nunca ve.

## 8. Bloqueo, cierre de sesión y caducidad

Pasados quince minutos de inactividad (ADR 0009), un temporizador en el navegador dispara
`POST /phr/auth/lock`. El bloqueo **cierra la sesión entera**, no solo el secreto: destruye el secreto de
sesión y la sesión de Laravel en la misma operación de servidor. Dejar viva la sesión de Laravel
mantendría a la persona dentro del panel, con acceso a datos en claro de otras personas y a acciones
destructivas como reemitir un enlace, que es justo el riesgo del puesto compartido que motiva el bloqueo.

Quien cuenta el tiempo es el **servidor**, sobre la última petición autenticada, no un temporizador en el
navegador: un temporizador de cliente no se ejecuta en una pestaña que el sistema operativo descartó por
memoria ni en una que nunca llegó a abrirse. El temporizador del navegador es solo lo que dispara la
recarga dura una vez que el servidor ya cerró la sesión, no lo que decide si debe cerrarla.

Filament monta su propio `POST /logout` por defecto. Ese endpoint no sabe nada del secreto de sesión, así
que el cierre de sesión normal (la persona pulsa "salir") tiene que pasar por el mismo camino de
destrucción que usa el bloqueo, no confiar en que el logout de Filament lo haga.

El cliente hace recarga dura después de cada uno de estos tres cierres (logout, bloqueo, aterrizar en
login con la UMK todavía en memoria), nunca antes de que el servidor confirme, porque solo una recarga
dura destruye el contexto de JavaScript y con él las instantáneas de DOM que Livewire retiene con datos
descifrados (ADR 0003).

`sessionStorage['phr.rk']` no se borra explícitamente en ninguno de estos caminos: al morir el secreto de
sesión en servidor, ese paquete queda cifrado bajo un secreto que ya no existe en ningún sitio, así que es
inútil sin que nadie tenga que limpiarlo. `session.lifetime` de Laravel es un parámetro relacionado, no el
mismo mecanismo: si es mayor que el bloqueo de quince minutos no pasa nada mientras el bloqueo siga
destruyendo el secreto, pero ambos deben revisarse juntos y no cambiar uno sin mirar el otro (ADR 0009).

## 9. Guardarraíles y prohibiciones

**Interceptor de cliente.** Un interceptor sobre las peticiones de Livewire revisa lo que sale del
navegador y aborta si encuentra un valor largo que no lleve el prefijo `v1.` del sobre cifrado (ADR 0002).

**Listener de servidor.** Un listener sobre la actualización de propiedades de Livewire rechaza lo mismo
en el lado servidor, para cubrir el caso de que alguien ponga un `wire:model` sin pensarlo: el interceptor
de cliente no protege contra ese descuido, porque el propio cliente es quien lo generó. Se acompaña de un
test de snapshot que falla si alguna propiedad pública de un componente que maneja datos cifrados contiene
algo que no sea metadato o sobre cifrado.

**Propiedades en URL.** `InteractsWithActions` trae de serie seis propiedades marcadas `#[Url]`
(`$defaultAction`, `$defaultActionArguments`, `$defaultActionContext`, `$defaultTableAction`,
`$defaultTableActionRecord`, `$defaultTableActionArguments`) que publican en la barra de direcciones la
acción abierta de Filament y sus argumentos. Un identificador de evento ahí ya es metadato clínico. Toda
página que maneje datos cifrados hereda de una página base propia que redeclara esas seis propiedades sin
el atributo `#[Url]`, acompañada de un test de arquitectura que falla si alguna vuelve a aparecer con el
atributo en cualquier página del panel.

**Comandos de Filament prohibidos.** `make:filament-user` y `filament:user` quedan deshabilitados (con
`Command::forget` o un override que aborte con un mensaje explicativo). Ambos piden `--password` y hacen
`Hash::make()` en servidor, lo que en este proyecto produciría una cuenta que parece válida y no lo es:
sin registro OPAQUE, sin UMK, imposible de usar para cifrar nada.

**Configuración obligatoria.** `session.driver` nunca puede ser `cookie`: con ese driver el contenido de
la sesión viaja al navegador en cada petición, y el navegador pasaría a tener las dos mitades de la UMK a
la vez (ADR 0003). Un test falla explícitamente si `config('session.driver') === 'cookie'`. `APP_DEBUG`
queda desactivado en todo entorno con datos reales, incluida preproducción, porque un error 500 con debug
activo abre el trace de Livewire en un diálogo sin recargar, y ese trace puede llevar datos clínicos en
los argumentos de una llamada (ADR 0003). `.npmrc` lleva `save-exact=true`, además de `ignore-scripts` y
`audit` que ya tenía: sin `save-exact`, instalar cualquiera de las dependencias criptográficas de cliente
escribe un rango de versión y un cambio de valores por defecto en una versión menor puede invalidar todos
los registros OPAQUE existentes (ADR 0004). Esa fijación exacta es propia de esas dependencias
criptográficas de JavaScript; `filament/filament` se mantiene en el rango `^5.0`, sin fijar a versión
exacta, y la mitigación del riesgo de expulsión por despliegue que describe el ADR 0003 es operativa:
ventana de mantenimiento o aviso previo, nunca fijación de versión.

## 10. Inventario de piezas

**Comandos de Artisan**

* `opaque:setup`: genera y muestra por pantalla (nunca escribe `.env`) el material estático del servidor:
  par de claves OPAQUE, `oprf_seed`, `OPAQUE_ENUMERATION_KEY`, `fake_registration_record`. Ejecutarlo dos
  veces sin cuidado inutiliza todos los registros existentes, así que no autogenera nada en silencio.
* `phr:issue-registration-link`: crea la fila de usuario si no existe y emite un enlace de un solo uso.
  Aborta si `STDOUT` no es un terminal. Nunca acepta ni imprime contraseñas.
* `opaque:prune-handshakes`: purga programada de `opaque_login_handshakes` y `opaque_registrations`
  caducados.

**Migraciones**

* Cambio de clave primaria de `users` a UUID, y columnas OPAQUE (`opaque_credential_identifier`,
  `opaque_registration_record`, `opaque_profile`, `opaque_registered_at`, `encrypted_settings`),
  `password` nullable.
* `user_registration_links`.
* `opaque_registrations`, `opaque_login_handshakes`.
* `user_master_key_envelopes`, de solo añadir.

**Modelos**

`User` (sin `password` en la lista de asignación masiva, sin cast `hashed`, `getAuthPassword()`
sobrescrito, implementa `FilamentUser::canAccessPanel()`), `UserRegistrationLink`, `OpaqueRegistration`,
`OpaqueLoginHandshake`, `UserMasterKeyEnvelope`.

**Servicios PHP**

* `App\Opaque\*`: `Ristretto255`, `HkdfSha512`, `ExpandMessageXmdSha512`, `Oprf`, `LoginNormalizer` (única
  fuente de `normalize(login)`), `CredentialIdentifier`, `ServerSetup`, `RegistrationFlow`, `LoginFlow`
  (incluida la rama falsa obligatoria). Detallados en `docs/OPAQUE.md`.
* `App\Provisioning\RegistrationLinks`: emite, valida y consume atómicamente enlaces; contiene la guardia
  de "cuenta ya registrada" descrita en la sección 3.4.
* `App\Auth\SessionSecrets`: acuña, entrega y destruye el secreto de sesión.
* `App\Crypto\EnvelopeValidator`: valida prefijo `v1.`, base64url canónico y tamaño permitido de un sobre.
  Nunca su contenido.

**Controladores** (invocables planos, sin Livewire)

`LoginController`, `SetPasswordController` (sirve la página genérica; la validación real del token ocurre
en `registration/start`), `RegistrationStartController`, `RegistrationFinishController`,
`LoginStartController`, `LoginFinishController`, `SessionSecretController`, `LockController`.

**Vistas Blade**

`resources/views/phr/auth/login.blade.php`, `set-password.blade.php`, `link-invalid.blade.php`. Las tres
replican a mano la estructura de `fi-simple-page` de Filament con
`<x-filament-panels::layout.simple>`, porque no hay componente Livewire detrás que resuelva
`$this->getHeading()`.

**Filament**

`PhrPanelProvider` (SPA sin prefetching, login propio, rutas propias, buscador global desactivado, módulo
de cripto emitido en el `<head>` del panel), `UserResource` con su acción de creación (usuario + enlace en
una transacción, modal informativo con la URL que nunca se envía por correo) y su acción de reemisión de
enlace (exige teclear el email si ya hay un sobre vigente), `UserPolicy`, la página base que redeclara las
propiedades `#[Url]` (sección 9).

**Módulos JS** (`resources/js/`)

`app.js` (entrada de Vite, importa el módulo de claves primero), `crypto/base64url.js`,
`crypto/envelope.js`, `crypto/kdf.js`, `crypto/zeroize.js`, `crypto/canonicalDate.js`,
`auth/opaqueClient.js` (único sitio que llama a `@serenity-kit/opaque`, con el KSF fijado como constante
congelada), `auth/keyring.js` (dueño de la UMK en memoria, nunca la expone fuera de su propio módulo),
`auth/recovery.js` (lee y escribe el paquete de `sessionStorage`, pide el secreto de sesión),
`auth/setPasswordPage.js`, `auth/loginPage.js`, `auth/lock.js` (temporizador de inactividad),
`guards/livewirePayloadGuard.js` (interceptor de la sección 9).

## 11. Criterios de aceptación y pruebas

* Los vectores oficiales de RFC 9497 y RFC 9807 pasan (OPAQUE.md sección 20.1 y 20.2), y las categorías de
  esa misma sección (aleatoriedad inyectable, fixtures de referencia, interoperabilidad con
  `@serenity-kit/opaque`, casos negativos, fuzzing ligero, pruebas de enumeración) están cubiertas.
* El vector fijo de regresión del KSF (OPAQUE.md sección 20.5) pasa en integración continua: un cambio del
  KSF o de sus valores por defecto se detecta ahí, no en producción.
* El sobre de la UMK es verificablemente de solo añadir: un test crea dos sobres para el mismo usuario y
  comprueba que el primero queda con `retired_at` no nulo y que su contenido no cambió.
* `registration/finish` es idempotente bajo un test que lo llama dos veces con el mismo `registrationId` y
  comprueba que la segunda llamada no falla ni duplica filas.
* El consumo de `opaque_login_handshakes` y de `opaque_registrations` es atómico bajo concurrencia real,
  no solo bajo el caso secuencial (OPAQUE.md sección 20.6, la carrera de dos peticiones simultáneas de
  `login/finish` con el mismo `handshakeId`).
* Existe el test que falla si `config('session.driver') === 'cookie'`, y el que falla si alguna página del
  panel expone una propiedad `#[Url]` (sección 9).
* El test de snapshot que falla si una propiedad pública de un componente cifrado contiene algo que no sea
  metadato o sobre cifrado (sección 9).
* Un usuario inexistente y uno existente producen la misma forma, el mismo código HTTP y el mismo tamaño
  de respuesta en `login/start` (OPAQUE.md sección 20.8), y esa igualdad se comprueba también antes y
  después de registrar la cuenta, no solo en un instante fijo.
* La rama falsa de login se recorre también cuando `opaque_registration_record` existe pero
  `opaque_profile` no coincide con el perfil vigente, no solo cuando la cuenta no existe.
* Existe purga programada de `opaque_login_handshakes` y `opaque_registrations` caducados, verificada con
  un test que crea filas caducadas y comprueba que el comando las elimina.
* El flujo completo de alta (secciones 5 y 6.1 encadenadas) se prueba de extremo a extremo: desde emitir
  el enlace hasta comprobar que la UMK recuperada tras un login posterior es la misma que nació en el
  registro.
* El flujo de recuperación tras recarga (sección 6.2) se prueba simulando la pérdida de la UMK en memoria
  y comprobando que se recupera sin pedir contraseña, y que un secreto de sesión destruido produce 410 y
  lleva a la pantalla de login.
* El bloqueo se prueba comprobando que, tras `POST /phr/auth/lock`, una petición posterior a
  `session-secret` responde 410, y que la sesión de Laravel ya no está autenticada.

## 12. Riesgos asumidos

La TTL del enlace de registro (24 horas) ya está decidida y fijada en el ADR 0009 y en la sección 3.3; no
queda como pregunta abierta.

1. **Argon2id (t=3, m=64 MiB, p=4) sin medir en el dispositivo más lento del personal.** Decisión tomada:
   los parámetros se mantienen y la medición se hace con usuarios y dispositivos reales, no antes de
   producción. Riesgo asumido de forma explícita: bajarlos después obliga a que todo el mundo se registre
   de nuevo, y con el orden de la sección 5 (login inmediato tras el registro) ese coste se paga dos veces
   en el alta. Mitigación barata: el primer usuario, que arranca el sistema, puede medirlo en el
   dispositivo más antiguo del que disponga antes de invitar a nadie más, y eso detecta el caso malo
   cuando todavía no cuesta nada (ADR 0004).
2. **Compartición con un profesional y escrow de recuperación siguen aplazados.** Es una decisión tomada y
   revisada, no un olvido: se aplaza a propósito porque el identificador de clave que reserva el ADR 0004
   hace barato el retraso, y porque el escrow se puede añadir a los usuarios existentes la próxima vez que
   inicien sesión, que es cuando tienen la clave en memoria. Fuera de alcance de esta spec (sección 1).

Un punto del diseño de origen que no se ha incorporado a esta spec: la posibilidad de escribir el enlace
de registro a un fichero con permisos restringidos (modo `0600`) como alternativa a imprimirlo solo por
terminal. Se descarta porque hoy no hay ningún despliegue automatizado que lo necesite; si aparece, es un
cambio pequeño y localizado en `phr:issue-registration-link`.
