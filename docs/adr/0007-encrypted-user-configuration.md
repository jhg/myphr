# ADR 0007: Configuración de usuario cifrada

* **Status**: Accepted
* **Date**: 2026-07-25
* **Decider**: Development Team

## Context

La aplicación necesita ajustes por usuario desde la primera pantalla. El más inmediato es la unidad de
medida, que el ADR 0005 estableció como preferencia y no como elección por registro, porque determina qué
código LOINC se guarda. El siguiente es el rango objetivo de glucemia, que permite mostrar qué porcentaje
del tiempo se estuvo dentro de él.

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

* **Pros**: el servidor no sabe qué tiene configurado nadie; añadir un ajuste no toca el esquema; la
  estadística de porcentaje en rango es del usuario y no de la aplicación; y el modo de fallo por
  descuido desaparece porque no hay frontera que redibujar.
* **Cons**: no se puede consultar ni agregar ninguna configuración en servidor, ni siquiera para saber
  cuántos usuarios tienen algo activado; la configuración hay que descifrarla antes de pintar la primera
  pantalla útil; y el usuario tiene que configurar el rango objetivo antes de ver la estadística que
  probablemente esperaba encontrar hecha.

## Consequences

La configuración se descifra en el arranque de la sesión, junto con la clave maestra.

La unidad de medida guardada aquí es una **preferencia**, no un requisito para registrar: cada evento
lleva su propia unidad y su código correspondiente, así que se puede elegir y cambiar al introducir el
dato. La preferencia solo rellena el formulario por defecto y decide en qué unidad se muestra.

De ahí sale una obligación para la capa de estadísticas: si hay eventos en unidades distintas, hay que
**normalizar antes de calcular**. Promediar mg/dL con mmol/L sin convertir da un número sin sentido. Para
la glucosa la conversión es un factor fijo y por tanto determinista, pero con decimales como cadena hay
que fijar precisión y redondeo en lugar de dejarlo al azar de la implementación.

Cualquier ajuste que se añada más adelante entra en este sobre, y la pregunta a hacerse es siempre la
misma: si tiene contenido clínico, empieza vacío y sin valor sugerido.

El registro de actividad del servidor anota que un usuario fue modificado, sin saber qué cambió ni qué
configuración tiene, según fija el ADR 0006.

La interfaz tiene que resolver con elegancia el estado en que aún no hay rango configurado, que será el de
todos los usuarios nuevos. Es la parte de producto que más cuidado necesita, porque una pantalla que
enseña un hueco donde debería haber una estadística invita a rellenarlo con cualquier número.
