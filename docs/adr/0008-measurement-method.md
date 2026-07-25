# ADR 0008: El método de medición forma parte del dato

* **Status**: Accepted
* **Date**: 2026-07-25
* **Decider**: Development Team

## Context

La misma magnitud medida de dos formas distintas no es el mismo dato. La glucemia lo deja claro: un sensor
de los que se llevan puestos mide en líquido intersticial y va con un retardo fisiológico de varios
minutos respecto a la sangre, un medidor capilar mide sangre tras el pinchazo, y una tira de orina no da
un número sino una presencia. Y no es exclusivo de la glucemia: la temperatura corporal cambia hasta medio
grado entre la vía oral, la axilar y la timpánica, y la tensión arterial no da lo mismo en un brazo que en
el otro.

LOINC ya lo reconoce y publica un código distinto para cada combinación de magnitud, unidad y método:
`99504-3` y `105272-9` para glucosa en líquido intersticial según la unidad, `41653-7` y `14743-9` para
capilar, `25428-4` para presencia en orina.

El ADR 0006 introdujo un campo para distinguir si un dato se tecleó a mano o vino de un aparato. Es
insuficiente: alguien puede mirar su sensor y teclear el número, y eso no lo convierte en una medición
capilar. Lo que distingue no es cómo entró el dato sino qué se midió y dónde.

## Decision

Todo evento de medición guarda un token explícito del método, además del código de la magnitud. No se
deduce del código ni del campo de origen manual o de aparato, que responden a otra pregunta.

Al añadir una magnitud nueva al catálogo hay que enumerar antes sus métodos y decidir cuáles se soportan.
Es parte del diseño del tipo de evento, no un detalle posterior, porque el método es de los campos que
solo se conocen en el momento de registrar y después no se recuperan.

**Las estadísticas no mezclan métodos en silencio.** Por defecto se calculan por método, y el usuario
puede elegir combinarlos cuando tenga sentido. La vista indica siempre qué métodos están incluidos en el
número que muestra, de modo que un promedio nunca sea ambiguo.

Los resultados cualitativos no entran en estadísticas de rango. Una tira de orina no tiene promedio ni
porcentaje en rango, y su payload tiene otra forma: en lugar de valor con unidad lleva un resultado
ordinal.

## Rationale

Se puede argumentar que el método ya está implícito en el código LOINC y que guardarlo aparte es
redundante. Lo guardamos igual por dos motivos. El primero es de lectura: el cliente tiene que saber cómo
representar y agrupar un evento sin resolver antes el código contra el catálogo, y con miles de eventos en
pantalla eso importa. El segundo es de robustez: si algún día hay que corregir la asignación de un código,
el método sigue siendo correcto, mientras que si el método solo vive dentro del código, un error de
asignación lo pierde.

Sobre no mezclar por defecto, la alternativa era promediarlo todo. En el caso concreto de sensor y capilar
el error sería pequeño, porque el capilar se usa precisamente para calibrar el sensor y ambos deberían dar
valores muy próximos, pero no idénticos: divergen justo cuando la glucosa cambia deprisa, que es cuando el
dato importa. Y el argumento general no depende de ese caso: mezclar temperatura axilar con timpánica
produce una media que no significa nada.

La alternativa opuesta, prohibir la combinación, la descartamos por el mismo criterio del ADR 0007: la
aplicación presenta y el usuario decide. Prohibirlo sería imponer un juicio clínico, y el usuario con un
sensor calibrado tiene motivos legítimos para querer verlo todo junto.

* **Pros**: ningún promedio mezcla cosas incomparables sin que se vea; el modelo admite magnitudes nuevas
  sin rehacer nada; y el dato queda completo para exportar, donde el método es parte del código destino.
* **Cons**: un campo más por evento; la capa de estadísticas necesita el método como dimensión de
  agrupación desde el principio, no como añadido; y la interfaz tiene que explicar una distinción que
  algunos usuarios no esperan encontrar.

## Consequences

El catálogo del ADR 0005 pasa a resolver el código a partir de tres cosas y no de dos: magnitud, unidad y
método. La relación entre lo que ve el usuario y el código guardado deja de ser uno a uno por partida
doble.

La capa de estadísticas agrupa por método antes de calcular nada, y el selector de qué métodos incluir
forma parte de la vista desde la primera versión, no de una mejora posterior.

Cuando se añada la temperatura corporal habrá que capturar el sitio de medición, y cuando se añada
cualquier magnitud nueva, la pregunta es siempre la misma: de cuántas formas se mide esto, y cambian el
significado del número.
