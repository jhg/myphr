# Spec 0002: Registro de eventos de seguimiento

* Related ADR(s): `docs/adr/0002-encrypted-data-flow-livewire-alpine-filament.md`,
  `docs/adr/0004-client-crypto-and-data-format.md`, `docs/adr/0005-clinical-vocabulary-loinc-snomed.md`,
  `docs/adr/0006-encrypted-event-model.md`, `docs/adr/0007-encrypted-user-configuration.md`,
  `docs/adr/0008-measurement-method.md`, `docs/adr/0010-uncoded-food-entries.md`

Esta spec depende de esos ADR como lectura previa: no repite su justificación, solo la aplica. Si un punto
de esta spec y un ADR no coinciden, el ADR manda y esta spec tiene un error que corregir. La spec 0001
(`docs/specs/0001-account-provisioning-and-session-bootstrap.md`) cubre lo que ocurre antes: sin clave
maestra en memoria, nada de lo que sigue puede ejecutarse.

## 1. Alcance y por qué una sola spec

Cubre las cuatro pantallas de captura del MVP que ya tienen forma decidida: glucemia, insulina, tensión
arterial y comidas. Para cada una, qué se pregunta al usuario, qué JSON sale de esa pantalla, cómo se cifra
y cómo viaja. Deja fuera las notas, que son el único tipo del ADR 0006 todavía sin forma de dato cerrada:
no existe ni pantalla ni catálogo de hallazgos codificados, así que su JSON no está decidido. Deja fuera
también el panel de inicio con sus estadísticas por periodo, que tiene su propia spec
(`docs/specs/0003-health-dashboard-summaries.md`) porque consume estos eventos en vez de producirlos.

Es una sola spec para los cuatro tipos, y conviene dejar escrito por qué. Lo que comparten no es la
maquetación, que es distinta en cada pantalla, sino el contrato criptográfico: la cadena de contexto, la
forma canónica de la fecha, las etiquetas de derivación y el formato del sobre. Si eso vive repetido en
cuatro documentos, acaban divergiendo, y aquí divergir no produce una inconsistencia de documentación sino
un histórico entero indescifrable. Una sola fuente para la parte compartida, y una sección corta por tipo
para lo que de verdad cambia.

Las cuatro pantallas existen ya (`app/Filament/Pages/`, `resources/js/health/`), así que esta spec describe
código que corre. Donde algo siga pendiente, se dice.

## 2. Historias de usuario

Persona que apunta una glucemia. Acaba de pincharse el dedo, mira el número del medidor y lo teclea.
Elige el método (capilar o sensor), ajusta la fecha y la hora si no es el momento presente, y opcionalmente
indica si estaba en ayunas, antes de comer, después de comer o al acostarse. La unidad no la elige aquí:
sale de su configuración. Al guardar, el registro aparece en la lista y en la gráfica sin recargar la
página.

Persona que apunta su tensión. El tensiómetro le da tres números de una vez, sistólica, diastólica y
pulso, y los teclea juntos porque es una sola medición y así la vive. Indica en qué brazo se la tomó y en
qué postura, porque su médico le dijo que siempre en el mismo brazo y sentada.

Persona que apunta lo que ha comido. Escribe el plato o el alimento con sus palabras, sin buscar en ningún
catálogo, y añade cuánto: un número y una unidad de una lista corta. Puede añadir varias líneas a la misma
comida. Nadie le pregunta por los hidratos de carbono.

Persona que se pincha insulina. Prepara la dosis en su bolígrafo o su bomba, se la inyecta y la apunta en
el momento, o algo más tarde si se le olvidó al pincharse. Escribe la dosis tal cual la lee en el bolígrafo,
con medias unidades incluidas porque en niños son una dosis habitual. Elige el tipo, rápida, lenta o mixta,
sin que la pantalla le proponga ninguna por defecto, porque confundir una con otra es un error serio.
Si le interesa, anota el nombre comercial del producto y la zona donde se ha pinchado, para ir alternando y
no irritar siempre el mismo sitio.

Persona que revisa lo que lleva registrado. Entra en una de las cuatro pantallas y ve sus últimos registros
ordenados por el momento en que ocurrieron, no por cuándo los apuntó, y puede seguir tirando hacia atrás
por lotes.

Persona que registra con la sesión caducada. Han pasado quince minutos, la clave maestra ya no está en
memoria. La pantalla no se rompe ni pierde lo escrito de forma silenciosa: avisa de que hace falta volver a
entrar (`Necesitas iniciar sesión para ver tu historial.`).

## 3. Contrato criptográfico común

Esta sección es la razón de ser de la spec. Todas las cadenas literales que aparecen aquí entran a la vez
en la derivación de la clave del registro y en el dato asociado del AEAD, así que **quedan congeladas en
cuanto exista el primer dato real**: cambiar un separador, el orden de un segmento o un dígito de la
fracción de segundo deja indescifrable todo lo anterior. No hay forma de re-cifrar desde el servidor,
porque el servidor no tiene la clave; la única migración posible es abrir cada sobre en el navegador de
cada usuario, con su clave en memoria, y volver a sellarlo. Antes del primer usuario real esto es una línea
de código, después es un proyecto.

### 3.1 Contexto de un evento

El contexto de un evento se construye con la plantilla `${userId.toLowerCase()}/event/${canonicalDate(occurredAt)}`,
donde el segmento intermedio es `event`, en singular y en minúsculas, y el separador es una sola barra.
Resultado literal:

```
0f1c8a2e-...-uuid-en-minusculas/event/2026-07-25T09:30:00.000000Z
```

El identificador de usuario entra siempre en su forma textual canónica en minúsculas, nunca como bytes
crudos. El tipo clínico **no** entra en el contexto: solo `user_id` y `occurred_at` atan el sobre a su
fila, y el motivo está en el ADR 0006 (el tipo está cifrado dentro del propio sobre y no puede participar
en su propia autenticación). `eventContext` lanza `TypeError('userId must be a non-empty string.')` si el
identificador no es una cadena no vacía.

Los otros dos contextos del sistema comparten familia y conviene tenerlos a la vista para no confundirlos:
`${userId.toLowerCase()}/umk` para el sobre de la clave maestra y `${userId.toLowerCase()}/settings` para
el de configuración (`resources/js/auth/context.js`).

### 3.2 Forma canónica de la fecha

`YYYY-MM-DDTHH:MM:SS.ffffffZ`: siempre UTC, sufijo `Z`, separador `T` y **seis** dígitos de fracción
siempre. `Date` de JavaScript solo da milisegundos, así que se rellenan tres ceros a la derecha. La
fracción se **trunca** a seis dígitos, nunca se redondea.

`canonicalDate` acepta un `Date`, un epoch en milisegundos (número finito) o una cadena que case el patrón
ISO con desfase **obligatorio**. Una cadena sin desfase se rechaza a propósito: adivinar la zona local
produciría bytes distintos según el dispositivo, y con ello una clave distinta. Además se rechazan los
componentes de calendario imposibles (mes fuera de 1..12, día fuera de rango con año bisiesto calculado,
hora mayor que 23, minuto o segundo mayores que 59), porque `Date` desborda en silencio y convierte
`2026-02-30` en `2026-03-02`: dos cadenas distintas acabarían en la misma forma canónica y por tanto en la
misma clave. Los fallos son `CanonicalDateError`.

`canonicalDateBytes` es esa misma cadena codificada en UTF-8, y es la forma en que entra en el dato
asociado del AEAD y en el `info` de la derivación.

En servidor la contraparte es `CANONICAL_DATE_FORMAT = 'Y-m-d\TH:i:s.u\Z'` con
`CANONICAL_DATE_REGEX = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/'`.

### 3.3 Derivación de la clave del registro

Las etiquetas de derivación están congeladas con `Object.freeze` en `resources/js/crypto/kdf.js` y llevan
la versión dentro del propio texto: `myphr/kek/v1`, `myphr/session/v1`, `myphr/record/v1`,
`myphr/settings/v1`, `myphr/envelope/v1`. Cambiar el significado de una derivación obliga a subir su
versión, nunca a reutilizar la etiqueta.

El `info` de HKDF se construye como `label || 0x00 || context`: bytes UTF-8 de la etiqueta, un byte
separador `0x00`, y los bytes del contexto. El separador impide que dos pares distintos de etiqueta y
contexto produzcan el mismo `info` por concatenación. Sin contexto, el `info` es solo la etiqueta.

El KDF es HKDF-SHA-512 (RFC 5869) sobre `@noble/hashes` 2.2.0, byte a byte compatible con
`app/Security/Opaque/HkdfSha512.php`. `HASH_LENGTH` 64, `MAX_OUTPUT_LENGTH` 16320 (255 por 64),
`KEY_LENGTH` 32, que es la clave simétrica de XChaCha20-Poly1305. Salida por defecto de 32 bytes, `salt` e
`info` vacíos por defecto.

Un evento no se cifra nunca con la clave maestra directamente. Se deriva una clave por registro con la
etiqueta `myphr/record/v1` y el contexto del evento, ese mismo contexto viaja como dato asociado al sellar
y al abrir, y la clave derivada se borra con `zeroize` en un `finally`
(`resources/js/health/eventEnvelope.js`).

### 3.4 Formato del sobre

Transporte: prefijo literal `v1.` seguido de base64url **sin** padding del sobre binario. La constante vive
en los dos lados, `ENVELOPE_PREFIX` en el cliente y `EnvelopeValidator::PREFIX` en el servidor.

Cabecera binaria, 64 bytes:

```
offset  0   1 byte    versión del formato        0x01
offset  1   1 byte    algoritmo                  0x01  XChaCha20-Poly1305-IETF
offset  2   1 byte    KDF                        0x01  HKDF-SHA-512
offset  3   1 byte    banderas                   bit 0 = contenido rellenado (FLAG_PADDED 0x01)
offset  4   4 bytes   identificador de clave     reservado, hoy siempre cero
offset  8  32 bytes   sal de la derivación
offset 40  24 bytes   nonce
offset 64   n bytes   ciphertext || tag (16 bytes)
```

El dato asociado real del AEAD es la cabecera completa concatenada con el contexto que aporta quien llama,
es decir `header || associatedData`. Así, cambiar una bandera o el identificador de clave invalida el tag.
Ese mismo contexto entra además como contexto del `deriveKey` con la etiqueta `myphr/envelope/v1` y la sal
del propio sobre, que es una derivación distinta de la del apartado 3.3 y no debe confundirse con ella.

El contenido se rellena a tamaños fijos de 256, 1024 o 4096 bytes. Se prefija con su longitud en cuatro
bytes big-endian y se completa con ceros hasta el primer tamaño en que quepa, lo que deja el contenido
máximo en 4092 bytes. `unpad` rechaza un tamaño que no sea uno de los tres y una longitud declarada mayor
que el propio tamaño.

Al abrir, el cliente rechaza: prefijo distinto de `v1.`; longitud menor que 336 bytes (64 de cabecera, 16
de tag y el menor relleno); byte de versión, de algoritmo o de KDF distintos de `0x01`; la bandera de
relleno sin poner; y un tamaño de contenido que no esté entre los tres permitidos. Todos lanzan
`EnvelopeError`, que no distingue manipulación de corrupción y **nunca** debe silenciarse.

### 3.5 Qué comprueba el servidor

`EnvelopeValidator::isValid` comprueba tres cosas y ninguna más: el prefijo `v1.`, que el base64url sea
canónico, y que la longitud binaria sea exactamente 336, 1104 o 4176 bytes (`HEADER_BYTES` 64 más
`TAG_BYTES` 16 más cada tamaño de relleno). Nunca valida el contenido, porque no tiene la clave.

El mismo guardarraíl vive en el modelo: `Event::booted()` lanza
`LogicException('events.payload no tiene forma de sobre cifrado válido.')` en `saving()` si la validación
falla. Es un guardarraíl de formato, no de contenido. La columna `payload` no tiene cast ni mutador a
propósito: es una cadena opaca de extremo a extremo.

## 4. Contrato de transporte

Los dos métodos de transporte son comunes a todas las pantallas de eventos y viven una sola vez, en
`HealthEventPage`, de la que heredan glucemia, tensión, comidas e insulina. El ciphertext cruza siempre en
la misma dirección lógica: baja como valor de retorno y sube como parámetro. Nunca vive en una propiedad
pública del componente, según el ADR 0002.

`storeEvent(string $payload, string $occurredAt): array{id: string, occurredAt: string}` autoriza con
`Gate::authorize('create', Event::class)`, valida el sobre con `EnvelopeValidator::isValid` y, si
falla, lanza `ValidationException` con clave `payload` y el mensaje literal
`El sobre cifrado no tiene un formato válido.`; después valida la fecha. Las dos comprobaciones abortan
antes de tocar la base de datos. Crea el `Event` con `user_id` de `Auth::id()`, `occurred_at` y `payload`,
y devuelve el identificador más el `occurredAt` recanonicalizado **desde la fila guardada**, no desde el
parámetro: es lo que detecta un truncamiento de microsegundos en el momento, no un mes después.

`fetchEvents(?string $before = null, int $limit = 100): list<array{id, occurredAt, payload}>` autoriza con
`Gate::authorize('viewAny', Event::class)`. El techo duro es `MAX_FETCH_LIMIT = 500`, aplicado como
`min(max($limit, 1), 500)`: por defecto 100, mínimo 1, máximo 500. La consulta va acotada a
`where('user_id', Auth::id())`, `orderByDesc('occurred_at')` y `limit`, con un cursor opcional
`where('occurred_at', '<', ...)` sobre la fecha canónica recibida.

La validación de fecha en servidor es `parseCanonicalOccurredAt` y tiene tres pasos. Si el regex no casa,
`ValidationException` con clave `occurredAt` y el mensaje literal
`La fecha debe tener la forma canónica YYYY-MM-DDTHH:MM:SS.ffffffZ.`. Después
`CarbonImmutable::createFromFormat` en UTC. Y por último una comprobación de ida y vuelta: si reformatear
no devuelve exactamente la cadena recibida, `ValidationException` con
`La fecha no es una fecha canónica válida.`. Esa ida y vuelta es la que atrapa los desbordamientos tipo mes
13 o día 32, que `createFromFormat` acepta en silencio.

El servidor no puede filtrar por tipo. Devuelve todos los eventos del usuario en el rango pedido y es
el cliente quien descarta los que no le tocan, después de descifrar. Es el coste ya aceptado en los Cons
del ADR 0006, y tiene dos consecuencias prácticas: el límite de 100 registros por lote no equivale a 100
glucemias, y una pantalla que quiera pintar tres meses de un tipo tiene que pedir lotes hasta agotar el
rango, no hasta llenar su lista.

Un sobre que no abre no tumba la pantalla: se cuenta aparte (`failedToOpenCount`) y se avisa al usuario,
mientras el resto del histórico se sigue mostrando.

## 5. Campos comunes a todo evento

Los cuatro campos comunes que enumera el ADR 0006 los construye una función pura compartida,
`buildCommonEventFields` (`resources/js/health/eventCommonFields.js`), y van en el nivel superior del
contenido descifrado, junto a `v`, `type` y `tz`, nunca dentro de `data`, porque no son propios de ningún
tipo.

`origin` distingue cómo entró el dato en la aplicación, tecleado (`manual`) o importado de un aparato
(`device`), y no se pregunta en ningún formulario: hoy no existe ninguna importación automática, así que
queda fijo en `manual` y será la importación, el día que exista, quien construya el evento con `device`.
No responde a la misma pregunta que el método de medición (ADR 0008): mirar el sensor y teclear el número
sigue siendo una lectura intersticial introducida a mano.

`recordedBy` sí se pregunta, con `self` por defecto, y `device` (con qué aparato se hizo la lectura) y
`note` son texto libre. Los dos últimos se omiten del contenido cuando llegan vacíos, con el mismo criterio
que el contexto de comida: ausencia significa ausencia y nunca una cadena vacía guardada como si fuera un
dato.

## 6. Glucemia

El contenido en claro que produce `buildGlucoseContent`, con todos los campos opcionales presentes, es:

```json
{"v": 1, "type": "glucose", "tz": "+02:00", "origin": "manual", "recordedBy": "self",
 "device": "Accu-Chek Guide", "note": "después de andar",
 "data": {"value": "142", "unit": "mg/dL", "loinc": "41653-7", "method": "capillary",
          "mealContext": "after_meal"}}
```

`origin` y `recordedBy` están siempre, porque traen valor por defecto (sección 5); `device`, `note` y
`mealContext` solo aparecen cuando la persona los rellena, así que el contenido mínimo son las cinco claves
del nivel superior y `data` con sus cuatro campos obligatorios.

`v` es el número 1 y `type` la cadena literal `glucose`. `value` viaja siempre como cadena, tal cual la
escribió la persona, nunca como número (ADR 0004, decimales como cadena); si no es una cadena o queda vacía
tras recortar espacios, la pantalla responde `Introduce un valor.`. `unit` es un código UCUM y `loinc` se
resuelve contra la tabla del servidor, nunca se inventa: `GlucoseLoincCode::resolve()` es total sobre las
combinaciones soportadas y lanza `ValueError` ante una combinación sin código, en lugar de devolver un
código por defecto.

`tz` es el desfase `±HH:MM` del momento del registro, con convenio positivo cuando la hora local va por
delante de UTC, y se calcula con el desfase en vigor para **esa** fecha concreta, respetando el horario de
verano del día registrado y no el de hoy.

El método es un token estable de `GlucoseMeasurementMethod`: `capillary` (sangre capilar con glucómetro
tras punción digital) e `interstitial` (líquido intersticial con sensor continuo). Ese token se serializa
dentro del payload cifrado, así que no puede cambiar nunca una vez publicado; añadir un caso nuevo es
seguro, renombrar o eliminar uno existente no lo es.

Los cuatro códigos LOINC, resueltos por método y unidad, son `41653-7` y `14743-9` para capilar en mg/dL y
mmol/L, y `99504-3` y `105272-9` para intersticial en las mismas dos unidades. El intersticial en mmol/L
tiene seis dígitos antes del guion, que es un formato LOINC válido y que cualquier validación futura debe
aceptar.

### 6.1 El contexto respecto a la comida es opcional

Los tokens de `MealContext` son `fasting`, `before_meal`, `after_meal` y `bedtime`, en snake_case y con el
mismo pacto de inmutabilidad que los métodos.

El campo es opcional y sin valor preseleccionado. El desplegable arranca con una opción vacía
seleccionada (`Sin especificar`) y, cuando la persona no elige nada, la clave `mealContext` no entra en el
payload, en lugar de entrar con cadena vacía o con `null`. El lector del cliente trata la clave ausente
como "no consta" y las estadísticas que agrupen por contexto la cuentan aparte, nunca la reparten.

El motivo es el mismo que el ADR 0006 usa para no pedir los hidratos de carbono: un desplegable que llega
con "en ayunas" escrito convierte cualquier descuido en un dato falso, y a la hora de leer el histórico un
valor inventado no se distingue de uno real.

### 6.2 Unidad de presentación

La unidad es una preferencia de presentación que vive en la configuración cifrada (ADR 0007), bajo la clave
`glucoseUnit`, con `mg/dL` como valor cuando no hay preferencia guardada. El servidor no puede leerla.

No se convierte entre unidades. Los eventos cuya unidad no coincide con la de presentación quedan fuera de
la gráfica y se cuentan en `excludedByUnit`, porque convertir exigiría fijar precisión y redondeo. Las
series se agrupan por método, una por método, y el pie de la gráfica dice siempre qué métodos incluye
(ADR 0008).

### 6.3 Tira de orina, pendiente

El ADR 0008 contempla un tercer método de glucemia cuyo resultado es cualitativo (`25428-4`, presencia en
orina). Su payload tiene otra forma: en lugar de valor con unidad lleva un resultado ordinal, y no entra en
medias ni en porcentaje en rango. Hoy ni el catálogo ni el cliente lo soportan, y el vocabulario ordinal
concreto está sin decidir (sección 11). Mientras tanto, el catálogo expone solo `capillary` e
`interstitial`, y `units` solo `mg/dL` y `mmol/L`.

## 7. Tensión arterial

Un solo evento con los tres números que da el aparato, sistólica, diastólica y pulso, porque es lo que el
paciente vive como una sola medición (ADR 0006). La asimetría con el destino la resuelve el exportador: el
perfil de tensión de FHIR no admite el pulso como componente, así que un evento nuestro se exporta como dos
observaciones separadas. Esa asimetría es deliberada y no debe "arreglarse" partiendo el evento en dos al
capturarlo, porque perdería que ambas lecturas son del mismo instante y del mismo aparato.

Los tres códigos LOINC son `8480-6` para la sistólica (nombre oficial `Systolic blood pressure`), `8462-4`
para la diastólica (`Diastolic blood pressure`) y `8867-4` para el pulso (`Heart rate`). El nombre oficial
del tercero es frecuencia cardiaca, no pulso, así que la documentación y el catálogo usan ese término
cuando citan el código, aunque la etiqueta al paciente pueda seguir diciendo pulso. Los tres están en
estado activo y **ninguno lleva aviso de copyright de terceros**, comprobado el 2026-07-25 contra
`tx.fhir.org` con LOINC 2.82, que sí publica esa propiedad cuando existe. Cumplen la regla del ADR 0005.

Las unidades UCUM son `mm[Hg]` para las dos presiones, que coincide con las unidades de ejemplo que declara
el propio LOINC, y `/min` para la frecuencia cardiaca. Sobre esta última hay un matiz verificado: LOINC no
propone `/min` a secas para `8867-4` sino `{beats}/min`, que es la misma magnitud con una anotación que no
altera la semántica. `/min` es UCUM válido y figura en el conjunto común de HL7; ver la sección 11.

Brazo y postura son el método de medición de esta magnitud, no dos metadatos accesorios: los dos cambian el
valor de forma conocida y los dos solo se saben en el momento de medir, que es el criterio del ADR 0008.
Sus dos vocabularios son cerrados y quedan enumerados en ese ADR: `left` y `right` para el brazo
(`App\Catalog\BloodPressureArm`), y `sitting`, `lying` y `standing` para la postura
(`App\Catalog\BloodPressurePosture`).

Dentro del contenido viajan como dos tokens propios, `data.arm` y `data.posture`, porque la pantalla los
pregunta por separado y así se leen y se filtran por separado. El método con el que agrupan las
estadísticas es su combinación, `${arm}_${posture}`, de `left_sitting` a `right_standing`, y se calcula al
agrupar (`methodKey`) en lugar de guardarse: un dato derivado que se guarda es un dato que puede quedar
desincronizado del que lo genera.

El contenido de una lectura queda así. El pulso es opcional, porque no todos los tensiómetros lo miden, y
cuando falta no viajan ni `pulse` ni su unidad ni su código, en vez de viajar vacíos:

```json
{"v": 1, "type": "bloodPressure", "tz": "+02:00", "origin": "manual", "recordedBy": "self",
 "data": {"systolic": "128", "diastolic": "82", "unit": "mm[Hg]",
          "pulse": "71", "pulseUnit": "/min",
          "loinc": {"systolic": "8480-6", "diastolic": "8462-4", "pulse": "8867-4"},
          "arm": "left", "posture": "sitting"}}
```

## 8. Comidas

Una comida se registra con texto libre para el alimento, el plato o la preparación, más un número para la
cantidad, más un selector de unidad de una lista cerrada de siete valores: gramos, miligramos, kilos,
centilitros, litros, mililitros y unidades. La cantidad viaja como cadena, igual que cualquier decimal
(ADR 0004).

Los alimentos no se codifican contra ningún vocabulario. Es una excepción consciente y acotada a la regla
del ADR 0005 de no guardar solo la etiqueta, y la decide el ADR 0010
(`docs/adr/0010-uncoded-food-entries.md`): codificar comida casera contra un vocabulario de alimentos no
produce un dato mejor, produce un dato falso con aspecto de preciso. El médico estima a partir del alimento
y la cantidad, que es el mismo razonamiento por el que el ADR 0006 descarta pedir los hidratos de carbono.

Esto refina lo que el ADR 0006 decía sobre la forma de la cantidad. Ya no hay una cantidad con dos ranuras,
código de unidad cuando exista y texto libre cuando la medida sea doméstica: la unidad sale siempre de la
lista cerrada. Una ranura de texto libre para la unidad convierte cualquier estadística futura en imposible
y se acumula sin remedio, mientras que siete opciones cubren lo que la gente escribe de verdad y dejan el
dato comparable.

El mapeo a UCUM de seis de las siete es directo y está verificado contra el fichero normativo
`ucum-essence.xml` del repositorio oficial de UCUM: `g` para gramos, `mg` para miligramos, `kg` para kilos,
`cL` para centilitros, `L` para litros y `mL` para mililitros. UCUM admite tanto `l` como `L` para el
litro; se elige la mayúscula porque es la forma del uso clínico y del conjunto común de HL7, y porque la
ele minúscula se confunde con el uno.

La séptima, unidades entendidas como recuento de piezas, no tiene un átomo UCUM propio: no existe `each`,
`unit` ni `count` en el fichero normativo. El ADR 0010 elige la anotación `{each}`, que la especificación
define como exactamente `1` con una etiqueta que no aporta semántica, y no la unidad adimensional `1` a
secas: de `{each}` se llega a `1` ignorando la anotación, mientras que de `1` no se recupera que lo que se
contaban eran piezas. Las siete viven en `App\Catalog\FoodQuantityUnit`.

Una comida admite varias líneas de alimento en el mismo evento, con `mealType` explícito, como fija el
ADR 0006. El orden en que se registran es el orden de `data.foods`, sin campo aparte, y cada línea lleva
`name`, `quantity` y `unit`. Una fila a medias (con dos de los tres campos rellenos) se rechaza con un
mensaje claro en lugar de guardarse incompleta. Con el relleno a tamaños fijos del sobre, una comida larga
puede pasar de 256 a 1024 bytes de contenido, que es normal y no requiere ninguna acción: lo único que no
cabe es un contenido de más de 4092 bytes, y ese caso debe fallar con un mensaje claro al usuario y no con
un `EnvelopeError` genérico.

## 9. Insulina

A diferencia de la glucemia, un evento de insulina no es la observación de una magnitud sino el registro de
una administración de medicación, y por eso **no lleva código LOINC**. No hay una tabla (tipo, unidad) →
código que resolver, y no hace falta añadir una: es la diferencia deliberada con `Glucose::catalog()`
(ADR 0006).

El contenido en claro que produce `buildInsulinContent` (`resources/js/health/insulinPage.js`), con todos
los campos opcionales presentes, es:

```json
{"v": 1, "type": "insulin", "tz": "+02:00", "origin": "manual", "recordedBy": "self",
 "device": "Bolígrafo NovoPen", "note": "antes de comer",
 "data": {"insulinType": "rapid", "dose": "0.5", "unit": "[iU]",
          "product": "NovoRapid", "site": "abdomen"}}
```

`insulinType` y `dose` son obligatorios: sin dosis la pantalla responde `Introduce la dosis.` y sin tipo,
`Selecciona el tipo de insulina.`. `product` y `site` solo entran en `data` cuando la persona los rellena,
con el mismo criterio que `mealContext` en la glucemia: ausencia significa ausencia, nunca cadena vacía
guardada como si fuera un dato.

La dosis viaja siempre como cadena, con el punto como separador decimal (ADR 0004), y admite decimales
porque media unidad es una dosis real en pacientes pediátricos. La unidad es el código UCUM de la unidad
internacional de insulina, `[iU]`, verificado contra unitsofmeasure.org, y es hoy la única que expone el
catálogo: el desplegable de unidad se muestra pero no se deja editar, porque no existe otra opción entre
la que elegir.

El producto va en texto libre, y el motivo está en el ADR 0006: "rápida", "lenta" o "mixta" no es un código
de medicamento y el formato de exportación exige uno, así que el nombre comercial (`NovoRapid`, `Lantus`,
`Humalog Mix 25`) es lo único que permite resolverlo después.

El tipo es un token estable de `InsulinType` (`App\Catalog\InsulinType`): `rapid`, `long` y `mixed`, sin
opción preseleccionada en el desplegable, a diferencia del método de glucemia, porque confundir rápida con
lenta es un error clínico serio. La zona de inyección es un token estable de `InjectionSite`
(`App\Catalog\InjectionSite`): `abdomen`, `thigh`, `glute` y `arm`, opcional y sin valor preseleccionado,
con el mismo criterio que el contexto de comida de la glucemia. Los dos vocabularios quedan congelados en
cuanto exista el primer sobre real: añadir un caso nuevo es seguro, renombrar o eliminar uno existente no
lo es.

`origin` no se pregunta en el formulario, igual que en el resto de pantallas (sección 5): hoy no existe
ninguna integración con ningún aparato en esta pantalla, así que la entrada es siempre manual y
`buildCommonEventFields` lo fija a `manual` sin mostrar ningún control. `device`, en cambio, sí se
pregunta, y aquí es el bolígrafo o la bomba con la que se puso la dosis, información útil incluso con
entrada manual.

Una dosis no es una magnitud continua como la glucemia: no hay un valor "entre" dos inyecciones. Por eso el
historial se agrupa por día de calendario local y tipo de insulina, sumando la dosis total de cada tipo
(`groupInsulinByDay`), y se pinta con una gráfica de barras, nunca de líneas, que sugeriría una continuidad
que no existe. El día se calcula con el desfase `tz` con el que se registró cada evento, no con la zona
horaria del dispositivo que abre la pantalla.

El campo de dosis del formulario es hoy un `<input type="text" inputmode="decimal">`, y `buildInsulinContent`
solo comprueba que no esté vacío. Esto difiere del valor de glucemia y de sistólica, diastólica y pulso, que
sí usan `numericValue.js` (`type="number"`, `step="any"`, tope de dos decimales y normalización de la coma
a punto antes de cifrar). Con un campo de texto se puede teclear `7,8` o `7.8`, la misma ambigüedad de
separador decimal que `numericValue.js` existe para evitar en el resto de valores de medida, y aquí no hay
guardarraíl equivalente delante de la dosis. Es una discrepancia entre pantallas que esta spec se limita a
describir, no una decisión tomada; queda como pregunta abierta (sección 11).

## 10. Criterios de aceptación

* Guardar un evento con microsegundos distintos de cero, releerlo por el mismo método y comprobar que la
  cadena canónica de datos asociados es idéntica byte a byte. Es el test obligatorio del ADR 0006 y sin él
  el fallo aparece en producción como corrupción sin causa aparente.
* Por cada combinación de tipo y versión existe un payload cifrado de prueba congelado en el repositorio
  que integración continua descifra y valida. Ninguno se borra nunca, aunque el tipo evolucione.
* El contexto de un evento se compara contra su cadena literal esperada en un test, no solo contra el
  resultado de volver a llamar a la misma función. Un test que compara la función consigo misma no detecta
  un cambio de plantilla.
* `canonicalDate` trunca y no redondea: una entrada con nueve dígitos de fracción produce los seis primeros
  y no un redondeo. Una cadena sin desfase se rechaza. `2026-02-30` se rechaza en lugar de convertirse en
  marzo.
* Un sobre manipulado en cualquier byte de la cabecera (bandera, identificador de clave, sal, nonce) falla
  al abrirse. Un sobre válido movido a otra fecha o a otro usuario también falla.
* `EnvelopeValidator::isValid` acepta exactamente 336, 1104 y 4176 bytes y rechaza cualquier otro tamaño,
  el padding de base64 y un prefijo distinto de `v1.`.
* `storeEvent` rechaza un sobre inválido y una fecha no canónica sin escribir en la base de datos,
  comprobado contando filas después del intento.
* `fetchEvents` respeta el techo de 500 aunque se le pida más, y devuelve al menos 1 aunque se le pida 0 o
  un número negativo.
* El nombre del método que llama el cliente coincide con el que expone la página. Un renombrado en PHP sin
  su contraparte en JavaScript deja la pantalla guardando contra un método inexistente, y ningún test de
  PHP lo detecta.
* Guardar una glucemia sin tocar el desplegable de contexto de comida produce un payload sin la clave
  `mealContext`, no con `fasting` ni con cadena vacía.
* Guardar una glucemia con un método y una unidad sin código LOINC falla de forma explícita, sin caer en
  ningún código por defecto.
* Un evento cuyo sobre no abre no rompe la pantalla: el resto del histórico se sigue mostrando y el fallo
  se cuenta y se avisa.
* Un contenido de más de 4092 bytes produce un mensaje comprensible al usuario, no una excepción genérica.
* Guardar una insulina sin indicar producto ni zona de inyección produce un payload cuyo `data` no tiene las
  claves `product` ni `site`, no con cadena vacía.
* Guardar una insulina sin tipo o sin dosis falla con el mensaje correspondiente
  (`Selecciona el tipo de insulina.` o `Introduce la dosis.`) sin escribir en la base de datos.

## 11. Preguntas abiertas

1. `/min` o `{beats}/min` para la frecuencia cardiaca. El ADR 0005 declara `/min` y no es erróneo, es la
   forma sin anotar; `{beats}/min` es la unidad de ejemplo del propio LOINC. Decidir uno y que el ADR, el
   catálogo y esta spec digan lo mismo.
2. Vocabulario ordinal de la tira de orina (sección 6.3), y si el código `25428-4` entra ya en el catálogo
   o espera a que exista la pantalla.
3. Qué escribe `origin` el día que exista una importación desde un aparato, y si esa importación reutiliza
   estos mismos métodos de transporte o necesita los suyos. Mientras no exista, `origin` es `manual` en
   todos los eventos y el campo no aporta nada, pero se guarda porque después no se recupera.
4. Si la dosis de insulina debe validarse con el mismo guardarraíl que el resto de valores de medida
   (`numericValue.js`, tope de dos decimales y coma normalizada a punto) en vez de con un campo de texto sin
   más comprobación que "no vacío" (sección 9). Es el campo de mayor riesgo de toda la aplicación, una dosis
   mal leída es una dosis mal puesta, y hoy es el único valor numérico del MVP sin ese guardarraíl.
