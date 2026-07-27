# ADR 0011: Compartir un recorte del historial con un profesional

* **Status**: Proposed
* **Date**: 2026-07-27
* **Decider**: Development Team

## Context

`docs/README.md` promete que compartir será una decisión criptográfica y no un permiso en una tabla, porque el
servidor no puede conceder acceso a algo que no sabe leer. El caso real es la consulta: que el médico vea
las glucemias de los últimos tres meses, sin cuenta en esta aplicación y en cinco minutos. Se comparte una
foto fija de un rango y unos tipos elegidos, no una vista en vivo.

Ya estaba decidido que habría un enlace con un bloque cifrado en el servidor, que el enlace solo no
bastaría porque lleva además un PIN corto dado por otro canal, y que se mostraría un QR generado en el
cliente. Faltaba el diseño criptográfico, y el flujo inicial tenía ahí un fallo que lo invalidaba:
entregaba el bloque a cualquiera que conociese el identificador y pedía el PIN después, con lo que un PIN
de seis dígitos se adivina fuera de línea en minutos y no protege de nada.

## Decision

Dos capas y dos tablas. `shares` guarda el paquete grande, que es inmutable y nunca se actualiza en su
sitio: `id` (UUIDv4 generado en el cliente), `user_id`, `expires_at`, `payload` con el sobre del paquete,
`descriptor` con un sobre bajo la clave maestra del usuario, `opened_at` y `created_at`. `share_links`
guarda un envoltorio pequeño por enlace: `id` (UUIDv4 del cliente, el que viaja en la URL), `share_id`,
`pin_salt` de 16 bytes, `pin_tag` de 32, `attempts_remaining`, `wrapper`, `expires_at` y `created_at`.
Ninguna de las dos tablas lleva `updated_at`: nada se actualiza en su sitio salvo el decremento del
contador y la marca de primer acceso.

Ninguna columna nueva describe el contenido del recorte. El rango, los tipos incluidos y excluidos y la
clave de contenido viven en `descriptor`, que es un sobre normal del ADR 0004 bajo la clave maestra, con dato
asociado `user_id` más el `id` del share. La pantalla de comparticiones activas se pinta descifrando en el
navegador. Guardar `types` o `range_from` en claro devolvería al servidor justo el metadato que el ADR 0006
cifró: leer `["glucose","insulin"]` es saber que esa persona es diabética sin descifrar un byte.

La construcción de claves, cerrada. La clave de contenido `CK` son 32 bytes de `getRandomValues` y cifra el
paquete. La clave de envío `S` son otros 32 bytes de `getRandomValues`, jamás derivados de la clave maestra,
y viajan en el fragmento de la URL. El PIN lo genera la aplicación, seis dígitos de CSPRNG sin sesgo de
módulo, nunca elegido por la persona. Por enlace hay una `pin_salt` de 16 bytes aleatorios. Entonces:

```
stretched = Argon2id(v0x13, PIN en NFKC UTF-8, pin_salt, m=65536 KiB, t=3, p=4, dkLen=32)
pinTag    = HKDF-SHA-512(ikm=stretched, salt=pin_salt, info="myphr/share-pin-tag/v1" || 0x00 || linkId, L=32)
wrapKey   = HKDF-SHA-512(ikm=S || stretched, salt=pin_salt,
                         info="myphr/share-link/v1" || 0x00 || linkId || 0x00 || canonicalDate(expiresAt), L=32)
```

Los parámetros de Argon2id son los del KSF de OPAQUE, para no mantener dos perfiles. Medido con
`@noble/hashes` 2.2.0 en un portátil reciente: 1,47 s, y en un equipo lento de consulta serán varios
segundos, así que corre con `argon2idAsync` y barra de progreso, o en un Web Worker que recibe el PIN y la
sal y nunca la clave maestra. El PIN no puede entrar por HKDF, que no tiene coste ajustable.

El envoltorio es un sobre corriente del ADR 0004 (`v1.`) cifrado con `wrapKey`, que contiene `CK`, con dato
asociado `"myphr/share-link/v1" || 0x00 || linkId || 0x00 || canonicalDate(expiresAt) || 0x00 ||
sha512(paquete)`. Ese hash impide que el servidor empareje el envoltorio de un enlace con el paquete de
otro y le enseñe al profesional el historial de otra persona con un tag válido.

El paquete usa un formato hermano: prefijo de transporte `s1.` en lugar de `v1.`, misma cabecera de 64
bytes, cifrado con `CK` y dato asociado `"myphr/share/v1" || 0x00 || shareId || 0x00 ||
canonicalDate(generatedAt)`. El prefijo distinto impide colar un paquete en la columna `payload` de un
evento o al revés, porque `EnvelopeValidator` exige `v1.`. Ese dato asociado no lleva `user_id`, excepción
consciente al patrón del ADR 0004: lo construye el lector, y le regalaría un identificador estable del
paciente, correlacionable entre dos envíos.

El prefijo distinto tiene un precio que hay que decir. Los dos guardarraíles del ADR 0002
(`docs/adr/0002-encrypted-data-flow-livewire-alpine-filament.md`), `livewirePayloadGuard.js` y
`EncryptedPayloadGuardHook`, abortan cualquier cadena de más de 256 caracteres que no empiece por `v1.`,
así que un paquete `s1.` que viajase por Livewire lo abortarían los dos. No se tocan: el paquete sube por
un endpoint HTTP propio fuera de Livewire, que es la vía que el propio ADR 0002 reserva para los blobs
grandes, y ahí lo valida `ShareEnvelopeValidator`. El `descriptor` es un sobre `v1.` corriente y viaja
como cualquier otro.

Antes de rellenar, el paquete se comprime con `CompressionStream('gzip')`, nativo en Safari 16.4 y
Chromium, con una bandera de comprimido en la cabecera. El relleno va a una escalera propia de 64 KiB,
256 KiB, 1 MiB y 4 MiB, validada por un `ShareEnvelopeValidator` separado: la de los eventos corta en 4.092
bytes y tres meses de glucemias son unos 110 KB. El suelo alto es lo que hace el trabajo, porque casi todos
los recortes reales caen comprimidos en 64 KiB y son indistinguibles entre sí, así que el servidor no puede
restar dos envíos del mismo rango para aislar el peso de un tipo. Un solo sobre, sin trocear: con trozos,
entregar todos menos el último produce un historial coherente al que le falta la semana de las
hipoglucemias, sin que falle ningún tag.

El PIN se verifica en línea antes de servir un solo byte. Un `challenge` devuelve la `pin_salt`; si el
enlace no existe, caducó o se revocó, devuelve una sal señuelo determinista derivada de HMAC con una clave
del servidor sobre el `linkId`, para que la respuesta sea indistinguible. Un `open` recibe el `pinTag`, y
solo si cuadra devuelve el envoltorio y el paquete en la misma respuesta. Lo compara en tiempo constante y
decrementa `attempts_remaining` con la misma escritura condicional atómica de
`RegistrationLinks::consume()`, sin `lockForUpdate()`, que en SQLite es un no-op. Cinco intentos. Con PIN
de seis dígitos, la probabilidad de acierto es 5 entre un millón. El contador va en columna y nunca en el
`RateLimiter`, que vive en caché y un `cache:clear` operativo reiniciaría. Además hay un limitador por IP
en la ruta, hermano de los de `OpaqueServiceProvider`. En `challenge` no hay PIN que valorar todavía, así
que inexistente, caducado y revocado son indistinguibles de un enlace vivo: todos devuelven una sal con la
misma forma. En `open`, el PIN incorrecto sí devuelve los intentos restantes, porque el caso mayoritario es
un dedo y no un ataque, y a esas alturas quien pregunta ya demostró conocer un enlace vivo.

Quedan **pendientes de decisión** dos detalles de esas dos rutas, y hay que cerrarlos antes de
implementarlas. Uno, de qué clave del servidor cuelga el HMAC de la sal señuelo: `APP_KEY` la rota
cualquiera al reinstalar y con ella cambia la sal señuelo de un `linkId` dado, lo que vuelve a distinguir
enlaces muertos de vivos entre dos despliegues, así que probablemente pida entrada propia en
`config/`, como el material de OPAQUE. Dos, qué contesta `open` cuando el enlace no existe, caducó o se
revocó: la sal señuelo del `challenge` no sirve de nada si el `open` siguiente delata la diferencia, y
devolver «PIN incorrecto, te quedan 4» sobre un enlace inexistente exige inventarse un contador estable.

Agotar los intentos borra solo la fila de `share_links`, no el paquete. La persona re-arma un enlace nuevo,
con `S` y PIN nuevos, desde su sesión y sin rehacer el recorte, que es para lo que existen las dos capas.
También sirve para dar un enlace por destinatario, cada uno con su PIN y su contador.

La caducidad se aplica en la consulta que sirve el blob, con `where('expires_at','>',now())` como
`RegistrationLinks::validate()`, y la purga programada es solo higiene de almacenamiento: si el planificador
se cae, no se alarga la vida de nada. Revocar y purgar son borrado físico, sin `SoftDeletes` y sin
`deleted_at`, excepción consciente al patrón del ADR 0006. La respuesta lleva `Cache-Control: no-store`,
que ya pone el middleware `App\Http\Middleware\NoStore` de las rutas de OPAQUE, y
`Content-Type: application/octet-stream`, sin `ETag`, sin `Last-Modified` y sin `Content-Disposition`
descriptivo, y la ruta se excluye de cualquier CDN. El TTL sale de una lista cerrada, 24 horas por defecto,
7 días como máximo y una opción de una hora para el uso presencial. Hay tope de tamaño por paquete y de
enlaces activos por usuario, o el endpoint es alojamiento anónimo gratis; **pendientes de decisión** las
dos cifras, que no son cosmética: el tope de tamaño decide si el escalón de 4 MiB llega a existir, y el de
enlaces activos es lo que acota el coste de almacenamiento de una cuenta.

La página del lector es una vista Blade fuera del panel, con entrada propia de Vite, sin Livewire, sin
Filament, sin `chart.js`, sin cookie de sesión, sin CSRF y con CSP estricta sin recursos de terceros. Eso
la deja fuera del prefijo `phr`, que es el del panel de Filament (`PhrPanelProvider::path('phr')`): todo lo
que se monta ahí pasa por `routes()`, que Filament envuelve con el grupo `web` y por tanto con sesión y
CSRF, incluidas las rutas sin autenticar de OPAQUE. Las tres rutas del lector —la página, `challenge` y
`open`— viven en `routes/web.php` con su propia pila de middleware; **pendiente de decisión** bajo qué
prefijo, que es una elección de superficie pública y no técnica. Se pinta en el `Accept-Language` del
profesional y nunca en el idioma de la persona propietaria, que es columna en claro por el ADR 0007
(`docs/adr/0007-encrypted-user-configuration.md`) y no tiene por qué salir de casa. El cliente lee
`location.hash` una vez y llama a
`history.replaceState` de inmediato; si no hay fragmento, avisa antes de tocar el servidor de que el enlace
llegó incompleto y que pida el QR, porque los reescritores de URL del correo sanitario y los portales
cautivos se comen el fragmento.

El texto en claro del paquete lleva el rango exacto, el instante de generación, el número de eventos y la
lista de tipos incluidos y excluidos. La pantalla los muestra siempre, sin plegar, porque una ausencia se
lee como un cero clínico: si faltan las comidas, el médico concluye que no las hay. Los eventos que no
descifren se pintan como fila de error y nunca se omiten (ADR 0004). El QR se genera bajo pulsación
explícita, con corrección de errores M, lado mínimo de 400 px y fondo blanco incluso en tema oscuro, y el
PIN nunca aparece en la misma pantalla, para que una sola foto no contenga las dos mitades.

Queda **pendiente de aprobación** una dependencia de JavaScript para el QR: `uqr`, licencia MIT, cero
dependencias transitivas, ESM puro, unos 4,5 KB comprimidos, salida SVG. Se descartan `qrcode` de npm por
sus transitivas y `qrious` por ser GPL-3.0, incompatible con The Unlicense del repositorio. Incorporarla
exige el procedimiento del ADR 0004: versión exacta, `save-exact`, `ignore-scripts`, `npm ci`, `npm audit
signatures` bloqueante y cuarentena de catorce días. Si se rechaza, hay que escribir el codificador a mano,
unas 300 líneas, con pruebas contra un decodificador independiente en integración continua.

## Rationale

Descartamos verificar el PIN solo en el cliente, que era el flujo inicial: con el blob descargado son un
millón de pruebas fuera de línea, y ningún KDF lento lo arregla, porque aguantar solo con coste exigiría 40
bits, que ya no es un PIN.

Descartamos que el servidor guarde una tercera parte de la clave y la entregue tras el PIN correcto. Es más
simple, pero un volcado de la base de datos más el enlace daría el historial sin PIN. Con el PIN dentro de
la derivación, ese atacante todavía tiene que romperlo, y guardar `pinTag` no lo empeora: crackear el tag
cuesta lo mismo que crackear el blob. Descartamos también el OPRF ristretto255, que evitaría ese ataque del
servidor sobre el tag: el servidor no gana nada, porque le faltan los 256 bits de `S`, y exigiría un cegado
en cliente que hoy no existe.

Descartamos UUIDv7 para los identificadores: llevan el instante de creación en claro dentro del propio
enlace y de la foto que el profesional guarde. Es la excepción que el ADR 0006 ya prevé.

* **Pros**: el servidor ve un blob, un identificador y dos fechas, y nunca el rango ni los tipos; el enlace
  solo no basta y la fuerza bruta pasa a estar contada; revocar y caducar son borrado real; rotar el enlace
  no obliga a re-cifrar el paquete; y el profesional no necesita cuenta ni instalar nada.
* **Cons**: dos tablas, dos formatos de sobre y dos validadores que mantener; el Argon2id del PIN son varios
  segundos en un equipo lento, justo cuando hay alguien esperando; el suelo de relleno de 64 KiB hace que
  compartir tres eventos cueste lo mismo que compartir trescientos; y quien fotografíe el QR puede quemar los
  cinco intentos y obligar a re-armar el enlace.

## Consequences

Las renuncias, sin adornos. Revocar impide lecturas futuras y no borra lo que la otra persona ya descargó:
una foto fija entregada es suya para siempre. Las copias de seguridad conservan el blob más allá de la
caducidad, y lo que de verdad lo cierra es que `S` viva fuera del servidor. El servidor sabe quién comparte,
cuándo, qué escalón de relleno ocupa, cuándo caduca y que se abrió, y esa frecuencia dibuja el itinerario
asistencial; no sabe qué contiene ni qué rango cubre. Seguimos siendo zero-knowledge frente al
almacenamiento y no frente a la entrega (ADR 0003, `docs/adr/0003-master-key-survival-in-browser.md`), y
aquí es peor que en el panel, porque la página se abre en dispositivos ajenos con material de clave en la
propia URL. El fragmento no llega al servidor, pero sí al
historial del navegador del profesional, a su sincronización en la nube, al autocompletado, a las extensiones
con permiso de pestañas y a las capturas que la galería del móvil indexa por OCR; el QR evita los chats y a
cambio añade la cámara de la sala y el carrete del profesional. Y el dominio de la instalación, ya público
por Certificate Transparency, dice que quien enseña ese enlace usa una aplicación de salud.

La IP de quien descarga revela el centro sanitario y de ahí el diagnóstico, con una precisión que el modelo
de eventos cifrados nunca habría permitido. Decisión explícita: ninguna capa que operemos registra IP ni
agente de usuario en esta ruta, ni siquiera el log de acceso del servidor web, coherente con la exclusión
deliberada de ambos en `AuditEvent`. El proveedor de infraestructura y cualquier CDN interpuesto lo siguen
viendo, y eso este diseño no puede cerrarlo.

No hay contador de descargas ni historial de accesos: `shares.opened_at` es la marca del primer acceso
redondeada a la hora y se escribe una sola vez. Un histórico con marcas al segundo diría cuántas veces y
cuándo se consultó cada envío, que es lo que el ADR 0006 descarta al hablar del rastro de actividad.
`AuditEvent` gana dos casos, creación y revocación, que el servidor ya ve; ninguno para las descargas.

`KDF_LABELS` incorpora `SHARE`, `SHARE_LINK` y `SHARE_PIN_TAG`. El paquete necesita su propio módulo de
sobre y su propio validador en PHP, con vectores cruzados entre ambos en integración continua, igual que el
formato de eventos.

Re-armar un enlace exige la clave maestra, porque `CK` vive en el descriptor cifrado, así que tras el
bloqueo por inactividad del ADR 0009 (`docs/adr/0009-user-provisioning-and-session-lifecycle.md`) hay que
volver a autenticarse. Lo que de verdad acaba dentro de una historia clínica es texto, así que la pantalla
del lector necesita hoja de impresión y un botón de copiar resumen; ese detalle y el de la selección de
tipos van a su propio Spec.

El ADR 0004 (`docs/adr/0004-client-crypto-and-data-format.md`) recoge las excepciones que este ADR
introduce sobre sus reglas del dato en reposo, el ADR 0006 (`docs/adr/0006-encrypted-event-model.md`)
apunta aquí para la compartición, el ADR 0002 anota que el paquete `s1.` no viaja por Livewire y el
ADR 0003 que la mitad de la entrega empeora con esta página.
