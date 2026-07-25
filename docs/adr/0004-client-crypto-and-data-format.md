# ADR 0004: Criptografía de cliente: dependencias y formato del dato cifrado

* **Status**: Accepted
* **Date**: 2026-07-25
* **Decider**: Development Team

## Context

Los ADR 0002 y 0003 fijaron qué hace el cliente con la criptografía, pero no con qué. Toca elegir las
dependencias de JavaScript, que son el único código de terceros con acceso a material de clave y por
tanto lo que más conviene mantener pequeño y auditable.

Hay un hallazgo que obliga a decidir ahora. `docs/OPAQUE.md` especifica derivar la KEK con HKDF-SHA-512
usando `libsodium-wrappers`, y ese paquete **no expone esa función**: publica las constantes de HKDF pero
no las operaciones, ni en su build estándar ni en el `sumo`. El build estándar tampoco trae SHA-512 ni
HMAC-SHA-512. Comprobado ejecutándolo. La especificación no es implementable tal como está escrita.

Las restricciones que acotan la elección: sin Node en producción, funcionar en Safari e iPadOS porque el
personal clínico usa iPads, interoperar con el servidor PHP donde haga falta, y no crear material de
clave que quede persistido en el navegador sin que nadie lo limpie.

## Decision

Para el protocolo de login usamos `@serenity-kit/opaque` en la versión 1.1.0 exacta, que empaqueta
`opaque-ke` 4.0.1 y por tanto RFC 9807 final. Es la única opción viva: el resto de clientes OPAQUE en npm
siguen drafts de 2022, están abandonados o publican sin repositorio auditable. El parámetro del KSF se
fija de forma explícita (Argon2id, tres iteraciones, 64 MiB, paralelismo cuatro) y se pasa en
`finishRegistration` y `finishLogin`, nunca en las funciones `start`, donde se ignora en silencio pese a
lo que dice su documentación.

Para el cifrado de datos usamos `@noble/ciphers` y `@noble/hashes`, ambos en la versión 2.2.0 exacta.
Aportan XChaCha20-Poly1305-IETF y HKDF-SHA-512, no tienen ninguna dependencia transitiva, son JavaScript
puro sin WebAssembly y pesan nueve kilobytes comprimidos frente a los ciento cincuenta de libsodium.

Mantenemos XChaCha20-Poly1305 para los campos clínicos y reservamos AES-256-GCM de WebCrypto para los
trozos de adjuntos grandes, donde la aceleración por hardware multiplica por veinte el rendimiento y no
añade un solo byte al bundle. Las claves de WebCrypto son efímeras y viven solo en memoria: no se
persiste material de clave en ningún almacén del navegador.

El sobre cifrado es binario y versionado desde el primer registro: versión, identificador de algoritmo,
identificador de KDF, banderas, **identificador de clave**, sal, nonce y ciphertext con su tag,
transportado como `v1.` seguido de base64url. El identificador de clave se reserva aunque hoy no se use,
porque la rotación y la compartición futuras exigirían si no re-cifrar todo el histórico, y eso es
justamente lo que el servidor no puede hacer.

Cada sobre se cifra con una clave derivada, y el `info` de esa derivación y el dato asociado del AEAD
recogen el mismo contexto: quién es el usuario y qué identifica al registro dentro de su tabla. Qué
identifica al registro depende de la funcionalidad y lo fija cada ADR: para los eventos de seguimiento es
el instante en que ocurrieron (ADR 0006). El nombre del campo entra en ese contexto solo cuando se cifra
campo a campo; cuando el sobre cubre un registro entero, no existe tal campo.

Estas reglas del dato en reposo valen para cualquier funcionalidad que cifre, no solo para la primera:

**Relleno a tamaños fijos antes de cifrar** (256, 1024, 4096 bytes). La longitud del ciphertext delata el
contenido: si un tipo de registro ocupa 120 bytes y otro 2.000, el servidor los clasifica sin descifrar
nada y cifrar el tipo se queda en decoración. Rellenar cuesta unos bytes hoy; hacerlo después exigiría
re-cifrar el histórico.

**Versión dentro de cada sobre**, que no se quita nunca. Añadir un campo opcional no la sube; cambiar el
significado de uno existente, sí. La migración es perezosa y en cliente al reescribir el registro: no
existe el job de migración, porque el servidor no puede leer los datos. El cliente mantiene un lector por
cada versión que haya existido y no se borra ninguno.

**Decimales como cadena** (`"1.50"`), tratados como se trata el dinero: punto fijo en almacenamiento. En
dosis de medicación no queremos la conversación sobre coma flotante.

**Tokens estables, nunca etiquetas visibles** dentro del sobre: `"breakfast"`, no `"Desayuno"`. Las
etiquetas se traducen a los idiomas del ADR 0005; los tokens no.

**Formato canónico de fecha** cuando una fecha entre en el dato asociado o en la derivación:
`YYYY-MM-DDTHH:MM:SS.ffffffZ`, siempre UTC, sufijo `Z`, seis dígitos siempre, rellenando con ceros si la
fuente da menos precisión. El cliente canonicaliza al cifrar y al descifrar, sin fiarse del formato que
llegue por la red. ISO 8601 a secas no basta: admite variantes que son bytes distintos, y las propias
herramientas del proyecto producen tres formas incompatibles entre sí.

**Fallo de descifrado**: si el dato asociado no cuadra, el cliente no puede distinguir manipulación de
corrupción, pero en ambos casos debe tratarlo como error visible y nunca ocultar el registro en silencio.
Un registro clínico que desaparece sin avisar es peor que uno que se muestra como ilegible.

Escribimos a mano, en `resources/js/crypto/`, el códec base64url con la comprobación de canonicidad que
exige el proyecto, el formato de sobre, el borrado de memoria y el troceado de adjuntos. Son unas ciento
cincuenta líneas y ninguna biblioteca hace exactamente lo que necesitamos.

El estado en el navegador queda inventariado y cerrado: la clave maestra en uso vive en memoria, su
envoltura bajo el secreto de sesión vive en `sessionStorage`, y no hay nada más. Ni IndexedDB, ni
`localStorage`, ni service worker, ni claves persistidas.

Fijamos las versiones sin rango, con `save-exact` e `ignore-scripts` en `.npmrc`, instalación con
`npm ci`, y `npm audit signatures` como paso bloqueante de integración continua.

## Rationale

Descartamos `libsodium-wrappers` por tres motivos acumulativos, no por preferencia: no puede derivar la
KEK, pesa diecisiete veces más, y no publica atestaciones de procedencia en npm. Su WebAssembly va
incrustado en base64 y no se puede aprovechar parcialmente, así que usar una sola función cuesta el
paquete entero, y obliga a esperar a que compile antes de descifrar la primera pantalla.

Descartamos resolverlo solo con WebCrypto porque no implementa ChaCha en ningún navegador, y renunciar a
XChaCha20 significa perder el nonce de 192 bits que permite generarlo al azar sin llevar contadores. Con
un equipo pequeño, el diseño que tiene menos formas de romperse por descuido vale más que el que rinde
mejor en un microbenchmark, y para campos de texto la diferencia de rendimiento entre las tres vías es
irrelevante.

Descartamos copiar el código de las bibliotecas al repositorio. Parecía coherente con querer poco código
de terceros, pero perderíamos la verificación automática de firmas y las alertas de seguridad, que es
justo lo que hoy nos protege del compromiso de npm, y no defendería del vector más probable, que es el
compromiso de nuestro propio servidor.

* **Pros**: el stack criptográfico completo pesa unos diez kilobytes comprimidos y no tiene dependencias
  transitivas; no hay coste de arranque porque no hay WebAssembly que compilar antes del primer
  descifrado; las dos bibliotecas tienen auditoría de Cure53 y procedencia verificable; el sobre
  versionado permite migrar más adelante sin re-cifrar de golpe.
* **Cons**: dependemos de dos proyectos con un único mantenedor publicador cada uno; el WebAssembly de
  OPAQUE no es reproducible desde el fuente, así que su verificación se limita a la procedencia de la
  compilación; y mantener dos algoritmos añade una ruta de código más que auditar.

## Consequences

`docs/OPAQUE.md` necesita reescribir la sección de cifrado en cliente, que hoy describe algo que no se
puede implementar, y corregir que una contraseña incorrecta devuelve `undefined` y no `null`.

El dato asociado del AEAD no es un adorno. Si el sobre no queda atado a su contexto, un servidor
comprometido puede mover el ciphertext del campo de alergias de un paciente al campo de diagnóstico de
otro, y el cliente lo descifrará sin ningún error. Atarlo al usuario, al registro y al campo, en el AEAD
y en la derivación, hace que ese movimiento falle por partida doble.

Integración continua incorpora tres comprobaciones bloqueantes: la verificación de firmas y atestaciones,
un vector fijo de registro y login que debe seguir produciendo el mismo `exportKey`, y vectores cruzados
del formato de sobre entre PHP y JavaScript aunque el servidor nunca descifre. Sin la segunda, un cambio
del KSF se manifestaría en producción como pérdida de acceso a la clave maestra de todos los usuarios.

Las actualizaciones de estas dependencias no se automatizan: cuarentena de catorce días y lectura del
diff completo antes de subir versión. Son releases raros y pequeños, así que es viable.

Quedan dos cosas por medir o decidir antes de escribir el primer dato en producción. Cuánto tarda
Argon2id con estos parámetros en el iPad más antiguo del personal, porque bajarlos después obliga a que
todos se registren de nuevo. Y si conviene un ensayo con la clave maestra viviendo como objeto no
extraíble de WebCrypto, que no persiste nada y sacaría los bytes del heap de JavaScript.

La primera aplicación de estas reglas es el registro de eventos de seguimiento, en el ADR 0006
(`docs/adr/0006-encrypted-event-model.md`), que fija además qué identifica a un evento dentro de su tabla
y cómo queda el reparto entre columnas en claro y contenido cifrado.
