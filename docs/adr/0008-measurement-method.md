# ADR 0008: El método de medición forma parte del dato

* **Status**: Accepted
* **Date**: 2026-07-25
* **Updated**: 2026-07-25
* **Decider**: Development Team

## Context

La misma magnitud medida de dos formas distintas no es el mismo dato. La glucemia lo deja claro: un sensor
de los que se llevan puestos mide en líquido intersticial y va con un retardo fisiológico de varios
minutos respecto a la sangre, un medidor capilar mide sangre tras el pinchazo, y una tira de orina no da
un número sino una presencia. Y no es exclusivo de la glucemia: la temperatura corporal cambia hasta medio
grado entre la vía oral, la axilar y la timpánica, y la tensión arterial no da lo mismo en un brazo que en
el otro, ni sentado que tumbado o de pie.

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

En la tensión arterial el método lo forman el brazo y la postura. Son las dos formas de medir que cambian
el número de manera conocida, ninguna de las dos se reconstruye después, y las dos son método y no
metadato accesorio. Los dos vocabularios quedan cerrados aquí, con las mismas garantías de inmutabilidad
que cualquier otro token del ADR 0004 (`docs/adr/0004-client-crypto-and-data-format.md`): brazo izquierdo
o derecho (`left`, `right`) y postura sentado, tumbado o de pie (`sitting`, `lying`, `standing`). En el
evento viajan como dos tokens propios y no como uno compuesto, porque la pantalla los pregunta por
separado y así se leen y se filtran por separado; el método con el que agrupan las estadísticas es su
combinación, de `left_sitting` a `right_standing`, y se calcula al agrupar en lugar de guardarse. Los
códigos LOINC de esta magnitud, `8480-6` para la sistólica y `8462-4` para la diastólica, nombran la
magnitud y nada más, así que esos dos tokens son el único sitio donde vive esta información. Con esto la
tensión queda enumerada y deja de ser el caso pendiente que este ADR exigía cerrar antes de soportarla.

Las estadísticas no mezclan métodos en silencio. Por defecto se calculan por método, y el usuario
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

En la tensión valoramos quedarnos solo con el brazo, que es lo que el ADR 0006 apuntaba al principio. Lo
descartamos porque pierde la postura, y la postura cambia el valor tanto como el brazo: la tensión de
alguien tumbado no es la misma que de pie, y esa diferencia es justo lo que un médico busca cuando
sospecha hipotensión ortostática. Es además un dato que solo existe en el momento de medir, así que
guardar el brazo y no la postura sería tirar la mitad del método.

También valoramos capturar el tamaño del manguito, que influye de verdad en la lectura. Lo dejamos fuera
por el mismo argumento que el ADR 0006 usa para no pedir los hidratos de carbono: en casa casi nadie sabe
qué manguito lleva su aparato, y preguntarlo produce campos vacíos o valores inventados, que es peor que
no tenerlo. Si más adelante hay demanda, entra como campo opcional sin romper nada.

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

La pantalla de tensión pide brazo y postura en el momento de registrar, ambos dentro del sobre cifrado, y
sus estadísticas se agrupan por su combinación igual que las de glucemia por su método. El
catálogo del ADR 0005 gana los dos vocabularios como enums (`BloodPressureArm` y `BloodPressurePosture`),
aunque el código LOINC no varíe con ellos.

Cuando se añada la temperatura corporal habrá que capturar el sitio de medición, y cuando se añada
cualquier magnitud nueva, la pregunta es siempre la misma: de cuántas formas se mide esto, y cambian el
significado del número.

## Decision History

### 2026-07-25: el método de la tensión arterial queda enumerado como brazo y postura
Previously decided: este ADR exigía enumerar los métodos de cada magnitud antes de soportarla, pero dejaba
la tensión sin enumerar, y el ADR 0006 la listaba con el brazo como único campo capturado.
Changed because: la postura cambia el valor tanto como el brazo y solo se conoce al medir, así que ambas
pasan a formar el método de esta magnitud, con sus dos vocabularios cerrados. El tamaño del manguito se
valoró y se dejó fuera para no producir campos vacíos o inventados.
