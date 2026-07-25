# ADR 0006: Modelo de eventos cifrados

* **Status**: Accepted
* **Date**: 2026-07-25
* **Decider**: Development Team

## Context

El primer MVP registra el seguimiento de una persona diabética: glucemias varias veces al día, insulina
inyectada con su tipo y dosis, tensión arterial de tensiómetro de brazo y comidas. Más adelante, sin
rehacer el modelo, ritmo cardiaco, temperatura y notas del paciente sobre síntomas.

Los ADR 0002 y 0005 dejaron a cada funcionalidad decidir qué se cifra. Esta es la primera que lo pide, y
el problema no es el valor de una glucemia sino el metadato: si existe una tabla de lecturas de glucosa, o
una columna de tipo en claro, el servidor sabe que esa persona es diabética sin descifrar nada. Y si
registra seis veces al día, sabe más todavía.

Los cuatro registros tampoco son independientes. El valor clínico está en su relación: comió, se puso seis
unidades de rápida, dos horas después tenía 180. Es una secuencia de eventos en el tiempo, no cuatro
listados paralelos.

## Decision

Una sola tabla de eventos, con el tipo cifrado junto al resto del contenido:

```
events
  id           uuid       primary
  user_id      uuid       not null, fk
  occurred_at  datetime   not null, precision 6, UTC    cuándo ocurrió de verdad
  payload      text       not null                       sobre cifrado, prefijo v1.
  created_at   datetime                                  cuándo se apuntó
  updated_at   datetime
  deleted_at   datetime   nullable

  índice (user_id, occurred_at)
```

Cada columna en claro se gana el sitio demostrando que el servidor la necesita para consultar: `user_id`
para autorizar y acotar, `occurred_at` para rango, orden y paginación, `id` como asa para editar o releer
un evento. Nada más. Se acepta que el patrón temporal quede visible, que es el precio de poder paginar y
limitar en servidor en lugar de descargarlo todo.

Las claves primarias son UUID en todas nuestras tablas, para evitar enumeración y por compatibilidad con
el registro de actividad. Preferimos UUIDv7 por localidad de índice, salvo donde el momento de creación
sea sensible.

El contenido descifrado es JSON con versión, tipo, desfase horario y datos:

```json
{"v": 1, "type": "glucose", "tz": "+02:00",
 "data": {"value": "142", "unit": "mg/dL", "loinc": "41653-7"}}
```

No usamos una columna JSON de base de datos: el servidor no puede consultar lo que no puede descifrar, así
que un tipo `json` no aporta nada sobre `text` y sí invita a que alguien intente indexarlo dentro de un
año. El texto con prefijo `v1.` encaja además con el guardarraíl del ADR 0002, que comprueba ese prefijo.

El formato del sobre, el relleno a tamaños fijos, el identificador de clave, el versionado, los decimales
como cadena, los tokens estables y el formato canónico de fecha son reglas generales del dato en reposo y
viven en el ADR 0004 (`docs/adr/0004-client-crypto-and-data-format.md`). Aquí solo se fija lo propio de
los eventos.

Un evento no equivale a un recurso del formato destino: la tensión arterial, que aquí es un solo evento
porque es lo que da el aparato y lo que vive el paciente, se exporta como dos observaciones separadas,
porque el perfil de tensión no admite el pulso como componente. La asimetría la resuelve el exportador.

**Un evento es un solo sobre**, no un sobre por campo: sus campos no tienen sentido por separado y
cifrarlos uno a uno los multiplicaría sin ganar nada.

**Lo que identifica a un evento** para el dato asociado del AEAD y para la derivación de su clave es
`user_id` y `occurred_at`. Atan el sobre a su fila, de modo que mover un ciphertext a otra fecha o a otro
usuario hace fallar el descifrado en lugar de mostrar un dato correcto atribuido al día equivocado.
`user_id` es redundante hoy, porque la clave maestra por usuario ya impide leer sobres ajenos, pero cubre
el día que existan claves compartidas. Se usa el instante y no el `id` de la fila porque es lo que define
al evento y el cliente ya lo conoce antes de insertar.

Consecuencia que conviene dejar escrita: el tipo clínico **no puede** entrar en el dato asociado, porque
está cifrado dentro del propio sobre y no puede participar en su propia autenticación. Si alguien mete
`glucose` ahí, rompe justo la propiedad que se buscaba.

Los cinco tipos del MVP y su futuro inmediato: `glucose` (ver abajo), `insulin` (tipo `rapid|long|mixed`, dosis, y
código del producto si procede, porque es una
administración de medicación y no una observación), `bloodPressure` (un solo evento con sistólica,
diastólica y pulso, como lo da el aparato), `meal` (`mealType` explícito más una lista de alimentos con
texto libre, cantidad y unidad) y `note` (texto y hallazgos codificados opcionales).

La glucemia no es un solo tipo de medición: el sensor mide en líquido intersticial, el medidor capilar mide
sangre y las tiras de orina dan una presencia, no un número. Cada una tiene su código y no son
intercambiables. El método de medición como parte del dato, y sus consecuencias para las estadísticas, se
deciden en el ADR 0008 (`docs/adr/0008-measurement-method.md`), porque afectan a toda magnitud y no solo a
la glucemia.

El servidor valida el formato del sobre, la codificación y el tamaño, que con el relleno a tamaños fijos
solo puede ser uno de los valores permitidos más la cabecera del sobre. Nunca el contenido.

**La unidad de medida es una preferencia del usuario**, no una elección por registro: se fija una vez
(mg/dL o mmol/L para la glucemia) y determina qué código LOINC se guarda, porque son códigos distintos
según el ADR 0005. Vive en la configuración cifrada del usuario, que decide el ADR 0007
(`docs/adr/0007-encrypted-user-configuration.md`), y el cliente la necesita antes de poder registrar el
primer dato.

**Campos que se capturan aunque hoy no se usen**, porque el usuario o el aparato los conocen en ese
momento y después son irrecuperables. Comunes a todo evento: si el dato es manual o viene de un aparato,
el aparato si lo hay, si lo registra la propia persona o alguien que la cuida, y una nota libre opcional
que sirve de válvula de escape para lo que no encaje. Por tipo: en la glucemia, el tipo de medición y el contexto
respecto a la comida (ayunas, antes, después, al acostarse), que es el campo con más valor clínico de la
lista y solo se sabe al registrarlo; en la insulina, el producto concreto en texto libre, porque rápida, lenta o
mixta no
es un código de medicamento y el destino exige uno, más la zona de inyección; en la tensión, el brazo; en
las comidas, el orden de los alimentos y una cantidad con dos ranuras, código de unidad cuando exista y
texto cuando sea doméstica; y en las notas, inicio, duración y severidad.

No se guarda el estado del registro: es obligatorio en el formato destino pero se deriva al exportar, y lo
mismo con el sujeto, la categoría y los perfiles.

## Rationale

Descartamos una tabla por tipo y una columna de tipo en claro por el mismo motivo: el esquema revelaría la
enfermedad sin descifrar nada, que es justo lo que el diseño quiere evitar.

Sobre los datos asociados, la primera propuesta fue atar el sobre al identificador de la fila, lo que
obligaba a generar el UUID en el navegador para poder cifrar antes de insertar. `occurred_at` resultó
mejor: es lo que define el evento, el cliente ya lo conoce antes de enviar, y el identificador vuelve a
ser un accidente de almacenamiento que puede generar el servidor.

En las comidas descartamos pedir los hidratos de carbono. Si el paciente no los sabe, pedirlos produce
campos vacíos o números inventados, y un número inventado es peor que ninguno. El médico estima mejor a
partir del alimento y la cantidad. Añadirlos después es un campo opcional, que por las reglas de
versionado no rompe nada.

* **Pros**: el servidor no sabe qué registra el usuario, solo cuándo; el modelo admite tipos nuevos sin
  tocar el esquema; el formato en reposo queda cerrado con margen para rotación de claves y cambios de
  esquema; y las consultas que el servidor sí necesita (rango, orden, límite) están cubiertas por un solo
  índice.
* **Cons**: no existe filtrar por tipo en servidor, así que pintar tres meses de glucemias obliga a
  descargar también las comidas y la insulina de ese rango; la paginación de servidor solo sirve para la
  vista cronológica mezclada; y editar la fecha de un evento obliga a re-cifrar su sobre.

## Consequences

Dos ajustes concretos, porque el formato por defecto de fechas de Laravel es `Y-m-d H:i:s` y trunca los
microsegundos en cualquier motor, no solo en MySQL: el modelo declara
`protected $dateFormat = 'Y-m-d H:i:s.u'` y la migración pide `dateTime('occurred_at', precision: 6)`. Sin
ambos, el cliente cifra con una fecha y relee otra, y todos los sobres de esa fila quedan indescifrables.

De ahí sale un test obligatorio: guardar un evento con microsegundos distintos de cero, releerlo por la
API y comprobar que la cadena canónica de datos asociados es idéntica byte a byte. Este fallo aparece en
producción como corrupción de datos sin causa aparente.

El cliente mantiene un lector por cada combinación de tipo y versión que haya existido, y no se borra
ninguno. Por cada una hay un payload cifrado de prueba congelado en el repositorio que integración
continua descifra y valida, igual que el vector del `exportKey` del ADR 0004.

El volumen es asumible: del orden de 5.000 eventos al año, entre 2 y 3,5 MB, y descifrarlos son decenas de
milisegundos. Lo que no es gratis es que sin persistencia en el navegador cada sesión vuelve a descargar
el rango, así que las vistas por defecto llegan acotadas a un rango desde el primer día y la descarga va
por lotes con cursor, fuera del snapshot de Livewire como fija el ADR 0002.

Queda un vector que este diseño no cubre y conviene no darlo por cubierto: restaurar una versión anterior
del mismo sobre en la misma fila. Los datos asociados no protegen contra retroceder un registro a un
estado previo.

Cuando llegue la funcionalidad sin conexión, `deleted_at` pasa a hacer de lápida para que el borrado se
propague entre dispositivos, que es la razón de reservarlo ya aunque el MVP no sincronice.

**El registro de actividad del servidor solo anota lo que el servidor ya ve.** Alta y baja de registros,
modificación de usuarios (sabiendo únicamente que hubo cambio, nunca qué cambió ni qué configuración
tienen, porque va cifrada), inicio de sesión y cierre de sesión cuando se produce, sabiendo que mucha
gente no cierra sesión y simplemente deja que caduque. Sirve para auditar el servidor y nada más: no anota
contenido clínico, ni
nada procedente de los sobres cifrados, ni actividad del cliente como abrir o consultar un registro. Un
log de accesos detallado acabaría revelando más patrón de uso que la propia tabla de eventos, que es justo
lo que el diseño evita. Hay que revisar la configuración por defecto del paquete que se use, porque suelen
registrar de más.

**Al añadir un tipo de evento hay que comprobar qué exige el formato de exportación**, aunque la
exportación no esté implementada, porque **los campos que no se capturan en origen no se recuperan
después**: no hay migración posible sobre datos cifrados.

Hoy **ningún formato es obligatorio para nosotros**. El RGPD solo pide estructurado y legible por máquina,
sin nombrar ninguno. El reglamento del Espacio Europeo de Datos Sanitarios obliga a los Estados y a los
sistemas de historia clínica, no a una aplicación de bienestar como esta, cuya interoperabilidad declarada
es voluntaria; y sus especificaciones técnicas ni siquiera existen todavía. El objetivo, por tanto, es
formato propio en JSON documentado, diseñado para que el mapeo a FHIR R4 compatible con el resumen
internacional de paciente sea mecánico el día que haga falta.

Hay una frontera que conviene no cruzar sin analizarla: si algún día la aplicación importa el resumen de
paciente del sistema público, pasa a almacenar datos de categoría prioritaria y deja de estar claramente
fuera de la definición de sistema de historia clínica del reglamento. Es una decisión de alcance de
producto, no de campos.
