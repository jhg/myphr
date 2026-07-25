# ADR 0007: Configuración de usuario cifrada

* **Status**: Accepted
* **Date**: 2026-07-25
* **Updated**: 2026-07-26
* **Decider**: Development Team

## Context

La aplicación necesita ajustes por usuario desde la primera pantalla. El más inmediato es la unidad de
medida, que el ADR 0006 (`docs/adr/0006-encrypted-event-model.md`) estableció como preferencia y no como
elección por registro, porque determina qué código LOINC se guarda (ADR 0005). El siguiente es el rango
objetivo de glucemia, que permite mostrar qué porcentaje del tiempo se estuvo dentro de él.

Ese segundo caso tiene una carga que el primero no tiene. Un rango objetivo de glucemia es una indicación
clínica: si la aplicación trae uno por defecto, está diciéndole al usuario qué valores debería tener, y eso
es interpretación, no presentación. La normativa europea de productos sanitarios excluye el software de
bienestar mientras se limite a registrar y mostrar, y el ADR 0006 ya sitúa la exportación y las
estadísticas del lado descriptivo. Traer rangos por defecto cruzaría esa línea sin necesidad.

Además, la configuración es dato del usuario y el servidor no debe poder leerla: saber que alguien tiene
configurado un rango de glucemia dice lo mismo que saber que registra glucemias.

## Decision

La configuración vive en una sola columna `text` de la fila del usuario, que guarda el sobre cifrado con
las mismas reglas que cualquier otro dato en reposo (ADR 0004): prefijo de versión, relleno a tamaños
fijos, identificador de clave y versión del contenido dentro del sobre. Al descifrarlo se obtiene un JSON,
igual que en los eventos y por el mismo motivo: la columna no puede ser de tipo JSON porque el servidor no
puede consultar lo que no puede descifrar.

Lo que identifica a este sobre para el dato asociado del AEAD y para la derivación de su clave es el
`user_id` y un discriminante fijo de la columna. Así, mover el sobre a otra columna, a otra tabla o a otro
usuario hace fallar el descifrado, igual que en los eventos.

**Ningún ajuste de contenido clínico trae valor por defecto de la aplicación.** El rango objetivo de
glucemia empieza vacío, y mientras lo esté no se muestra el porcentaje en rango: la vista simplemente no
ofrece esa estadística. Cuando el usuario lo configura, con el criterio que le haya dado su médico, la
aplicación calcula y muestra, sin añadir juicio propio sobre si el resultado es bueno o malo.

Se distingue de los ajustes que no son clínicos, como el idioma o el formato de presentación, que sí
pueden tener un valor razonable por defecto porque no dicen nada sobre la salud de nadie.

**El idioma de la interfaz es la única excepción al sobre: vive en claro en `users.locale`.** La
aplicación habla inglés, castellano y chino simplificado, con el inglés de serie, y el servidor tiene que
saber cuál usar antes de que exista ninguna clave: Filament resuelve en servidor el menú de navegación, el
menú de usuario, las migas, el título de la página y, sobre todo, la pantalla de acceso, que se pinta
cuando la clave maestra todavía no ha nacido. Una preferencia guardada dentro del sobre no se podría leer
nunca en el momento en que hace falta.

La columna es nullable y `NULL` significa «no lo he elegido»: entonces el idioma se negocia con la
cabecera `Accept-Language`, restringida a los tres soportados, y el inglés es el último recurso. Cuando la
persona elige uno en su perfil, manda su elección. `PUT /phr/settings` acepta ese campo `locale` junto al
sobre cifrado, fuera de él, y lo escribe solo después de validar la envoltura y la precondición `If-Match`,
que protege el sobre y no la columna: así un 412 no deja el idioma cambiado y los ajustes sin cambiar. La
lista es cerrada porque el valor acaba en `App::setLocale()` y aceptar cualquier cadena sería dejar que el
cliente elija fichero de traducción.

El coste está aceptado a sabiendas: el servidor aprende qué idioma prefiere una cuenta, y en un despliegue
español elegir chino simplificado permite inferir origen o vínculo con China. Lo que lo hace asumible es
que el navegador ya manda `Accept-Language` en todas las peticiones, así que esa inferencia está hoy
disponible sin columna ninguna; guardarla añade persistencia, no revelación. Es la misma clase de excepción
acotada que el ADR 0009 (`docs/adr/0009-user-provisioning-and-session-lifecycle.md`) hace con el nombre del
usuario, y no se extiende a ningún otro ajuste: el idioma va en la columna y no en el sobre, porque
guardarlo en los dos sitios acabaría con el menú en un idioma y el cuerpo de la página en otro.

El cálculo del porcentaje en rango, como el resto de estadísticas, ocurre en el navegador sobre los
eventos ya descifrados, según fija el ADR 0002.

## Rationale

Descartamos una tabla de ajustes con una fila por clave. Habría obligado a dejar en claro el nombre de
cada ajuste para poder consultarlo, y el nombre ya filtra: una fila llamada `glucose_target_range` dice
que esa persona controla su glucemia. Con un solo sobre, el servidor ve que hay configuración y nada más.

Descartamos también repartir los ajustes entre columnas en claro y cifradas según su sensibilidad. Es una
frontera que hay que redibujar con cada ajuste nuevo, y la primera vez que alguien se equivoque el fallo
será silencioso. Una sola columna cifrada no tiene ese modo de fallo.

Sobre no traer valores por defecto, la alternativa era ofrecer los rangos habituales y dejar que el
usuario los cambiase. Habría sido más cómodo, y es lo que hace casi cualquier aplicación del sector, pero
convierte a la aplicación en fuente de criterio clínico justo en el punto donde queremos que sea un diario.
La incomodidad de configurarlo una vez es pequeña comparada con el cambio de naturaleza del producto.

Para el idioma descartamos tres alternativas. Guardarlo solo en el cliente deja el marco de Filament en
inglés y el cuerpo de las páginas traducido, una interfaz bilingüe permanente que es peor producto que no
traducir. Guardarlo dentro del sobre y retraducir el marco en el navegador tras abrirlo obliga a reescribir
el DOM que pinta Filament después de descifrar, que es justo lo que el `morph` de Livewire deshace según el
ADR 0002, y deja fuera igualmente el acceso y el alta de contraseña, donde no hay clave. Y negociar solo con
`Accept-Language`, sin preferencia guardada, no cuesta nada de privacidad pero impide elegir: quien tenga
el sistema en chino no puede usar la aplicación en castellano.

* **Pros**: el servidor no sabe qué tiene configurado nadie; añadir un ajuste no toca el esquema; la
  estadística de porcentaje en rango es del usuario y no de la aplicación; y el modo de fallo por
  descuido desaparece porque no hay frontera que redibujar.
* **Cons**: no se puede consultar ni agregar ninguna configuración en servidor, ni siquiera para saber
  cuántos usuarios tienen algo activado; la configuración hay que descifrarla antes de pintar la primera
  pantalla útil; y el usuario tiene que configurar el rango objetivo antes de ver la estadística que
  probablemente esperaba encontrar hecha.

## Consequences

La configuración se descifra en el arranque de la sesión, junto con la clave maestra.

El sobre se escribe vacío en el alta, aunque no haya nada configurado, para que el servidor no pueda
distinguir a quien tiene configuración de quien no.

La unidad de medida guardada aquí es la preferencia que fija el ADR 0006: se elige una vez y decide en qué
unidad se registra y se muestra. Cada evento guarda además la suya, porque el código LOINC depende de
ella, así que cambiar la preferencia deja un histórico con dos unidades mezcladas.

De ahí sale una obligación para la capa de estadísticas: promediar mg/dL con mmol/L sin convertir da un
número sin sentido. Y como convertir exige fijar precisión y redondeo, que es una decisión clínica que
ningún ADR ha tomado, no se convierte: cada resumen se calcula en una sola unidad de presentación y los
eventos en otra se cuentan aparte para poder decirlo en pantalla, en lugar de desaparecer sin más.

Cualquier ajuste que se añada más adelante entra en este sobre, y la pregunta a hacerse es siempre la
misma: si tiene contenido clínico, empieza vacío y sin valor sugerido.

El registro de actividad del servidor anota que un usuario fue modificado, sin saber qué cambió ni qué
configuración tiene, según fija el ADR 0006.

La interfaz tiene que resolver con elegancia el estado en que aún no hay rango configurado, que será el de
todos los usuarios nuevos. Es la parte de producto que más cuidado necesita, porque una pantalla que
enseña un hueco donde debería haber una estadística invita a rellenarlo con cualquier número.

Del idioma salen tres obligaciones. Las claves de traducción se escriben en inglés, que es el idioma de
serie, para que una traducción que falte caiga en inglés y no en castellano; los catálogos viven en
`lang/es.json` y `lang/zh_CN.json` y un test comprueba que tienen exactamente el mismo juego de claves,
que es la única forma de que un hueco falle en integración continua y no delante del usuario. Las
etiquetas al paciente de los enums de `app/Catalog` existen en los tres idiomas, y un idioma que no
reconocemos cae al inglés en vez de lanzar una excepción, porque alguien con una preferencia obsoleta es
alguien que no entiende la pantalla, no un error del que enterarse con un 500. El término oficial de la
terminología no se traduce nunca, ni siquiera al chino: el ADR 0005 lo reserva para `coding.display` y
LOINC no publica traducción china de esos términos, que es precisamente por lo que la etiqueta propia es la
única capa que podemos ofrecer completa en los tres idiomas.

## Decision History

### 2026-07-26 — El idioma de la interfaz sale del sobre y pasa a una columna en claro
Previously decided: toda la configuración de usuario vivía dentro del sobre cifrado, sin excepciones, y el
idioma se citaba solo como ejemplo de ajuste no clínico que sí puede tener valor por defecto.
Changed because: al añadir el chino simplificado hubo que resolver dónde vive la preferencia, y Filament
pinta el menú, las migas y la pantalla de acceso en servidor, antes de que exista ninguna clave. Dentro del
sobre esa preferencia no se puede leer cuando hace falta.
