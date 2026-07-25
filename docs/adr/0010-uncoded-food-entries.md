# ADR 0010: Alimentos en texto libre, con cantidad y unidad codificada

* **Status**: Accepted
* **Date**: 2026-07-25
* **Decider**: Development Team

## Context

El tipo de evento `meal` del ADR 0006 (`docs/adr/0006-encrypted-event-model.md`) guarda qué comió la
persona. La regla general del vocabulario clínico, en el ADR 0005
(`docs/adr/0005-clinical-vocabulary-loinc-snomed.md`), es que todo lo que se registra lleva su código
estándar desde el primer dato, porque codificar texto libre histórico exige recodificación manual y
pierde el contexto de captura. Guardar solo la etiqueta es la única opción irreversible, y por eso el
0005 la descarta.

Con los alimentos esa regla no se puede cumplir hoy y conviene decirlo en voz alta en lugar de dejar el
hueco sin explicar. El ADR 0005 impone a toda fuente del catálogo dos requisitos a la vez: licencia libre
y alcance mundial, verificados contra la fuente primaria. Para alimentos no tenemos ninguna fuente
elegida que los cumpla, y las candidatas habituales son bases nacionales o de composición nutricional,
con un catálogo pensado para el análisis dietético y no para lo que una persona escribe después de comer.

Hay además un problema de uso, no de licencia. Codificar el alimento en el momento de registrarlo obliga
a buscar en una lista y elegir una entrada, y esa fricción se paga siempre en el mismo sitio: la gente
deja de registrar. Un diario de comidas incompleto no vale para nada, por muy bien codificado que esté lo
poco que contiene.

## Decision

Los alimentos de una comida se guardan como texto libre, sin codificar contra ningún vocabulario. Cada
elemento de la comida lleva tres campos: el texto que escribe la persona, una cantidad numérica y una
unidad elegida de una lista cerrada. El texto no se normaliza ni se intenta casar con ninguna tabla, ni
al registrar ni después.

La unidad sí va codificada en UCUM, que es lo que exige el ADR 0005 y lo que evita una conversión
imposible más adelante. La lista cerrada tiene siete valores y su código es este: gramos `g`, miligramos
`mg`, kilos `kg`, centilitros `cL`, litros `L`, mililitros `mL` y unidades entendidas como recuento de
piezas `{each}`. Ninguna otra unidad es válida, y en particular no hay ranura de texto libre para la
cantidad: nada de "un plato" ni "dos cucharadas".

La cantidad viaja como cadena, no como número, por la regla de decimales del ADR 0004
(`docs/adr/0004-client-crypto-and-data-format.md`), igual que el valor de una glucemia. El contenido
descifrado de una comida queda así:

```json
{"v": 1, "type": "meal", "tz": "+02:00", "origin": "manual", "recordedBy": "self",
 "data": {"mealType": "lunch",
          "foods": [{"name": "lentejas con chorizo", "quantity": "250", "unit": "g"}]}}
```

El orden de los alimentos que el ADR 0006 pide capturar es el orden de `foods`, sin campo aparte: una lista
JSON ya lo conserva y numerarlo a mano solo abriría la puerta a que los dos discrepen.

Esto refina lo que el ADR 0006 decía de las comidas: allí la cantidad tenía dos ranuras, código de unidad
cuando existiera y texto cuando la medida fuera doméstica. La ranura de texto desaparece y la unidad sale
siempre de la lista.

Los seis primeros códigos son directos: `g` es la unidad base de masa en UCUM y `mg` y `kg` son esa misma
unidad con prefijo, y `L`, `mL` y `cL` son el litro con y sin prefijo. Preferimos la ele mayúscula, que es
la forma habitual en clínica y la que recoge el conjunto "Common UCUM units" de HL7 Terminology 7.0.0,
aunque UCUM admite igualmente `l`, `ml` y `cl` (comprobado el 2026-07-25 contra el fichero normativo
`ucum-essence.xml` del repositorio oficial, https://github.com/ucum-org/ucum, y contra
https://terminology.hl7.org/7.0.0/ValueSet-ucum-common.html).

El séptimo no es directo, porque UCUM no tiene ningún átomo para "unidad", "pieza" o "each": lo que tiene
es la unidad adimensional `1` y la posibilidad de anotarla entre llaves. `{each}` es exactamente `1` con
una etiqueta pegada, porque las anotaciones no aportan semántica.

## Rationale

Elegimos `{each}` y no `1` a secas por una asimetría: de `{each}` se llega a `1` ignorando la anotación,
que es lo que hace cualquier motor UCUM, mientras que de `1` no se recupera que lo que se contaban eran
piezas. Como el código viaja dentro del sobre cifrado, cambiarlo después obligaría a descifrar y volver a
cifrar todos los eventos en el navegador de cada usuario, uno a uno, así que conviene guardar la forma más
informativa desde el principio. LOINC usa anotaciones en sus propias unidades de ejemplo (`{beats}/min`
para la frecuencia cardiaca, `{score}` en escalas), luego el precedente existe. La contrapartida es que
ninguna anotación figura en el conjunto común de HL7, porque las llaves admiten texto libre y no se
enumeran, y un validador que solo acepte esa lista rechazaría `{each}`.

Sobre no codificar el alimento, la alternativa era retrasar las comidas hasta tener una fuente que cumpla
el ADR 0005. La descartamos porque el ADR 0006 ya resolvió un caso emparentado en la dirección contraria:
allí decidimos no pedir los hidratos de carbono, porque si el paciente no los sabe el campo se rellena con
números inventados y un número inventado es peor que ninguno, y porque el médico estima mejor a partir del
alimento y la cantidad. El mismo argumento vale aquí: obligar a elegir una entrada de un catálogo produce
la entrada más parecida, no la correcta, y el resultado es un dato codificado que dice algo falso con
apariencia de rigor.

Esta es una excepción consciente y acotada al ADR 0005, no un descuido. Se limita al texto del
alimento dentro de un evento `meal`. Todo lo demás del evento sigue la regla: la unidad es UCUM y el tipo
de comida es un token estable del catálogo. Si alguien lee esto dentro de un año, lo que tiene que
comprobar antes de "arreglarlo" es si ya existe una fuente de alimentos con licencia libre y alcance
mundial, no si el texto libre le parece poco riguroso.

* **Pros**: registrar una comida cuesta escribir una frase y un número, que es la única forma de que el
  diario esté completo; no añadimos una fuente de terminología con su licencia, su tamaño y su
  mantenimiento por una funcionalidad que todavía no la necesita; y la parte que sí es interoperable, la
  cantidad con su unidad UCUM, queda bien desde el primer registro.
* **Cons**: no hay agregación posible sobre los alimentos, ni contar cuántas veces aparece uno, porque
  "arroz", "arroz blanco" y "arrocito" son cadenas distintas; el mapeo a FHIR de un `meal` llevará el
  alimento en `text` sin `coding`, que es válido pero pobre; y codificar el histórico el día que exista
  una fuente será manual y perderá el contexto de captura, exactamente el coste que el ADR 0005 advierte.

## Consequences

El catálogo público en claro gana las siete unidades de comidas, con su código UCUM y su etiqueta por
idioma, y ninguna entrada de alimentos. Viven en su propio enum (`App\Catalog\FoodQuantityUnit`) y no
dentro de `UcumUnit`, que enumera las unidades de las magnitudes clínicas: son listas con vidas distintas
aunque compartan estándar. La lista es cerrada en los dos lados, y la unidad recibida en el formulario se
valida contra ella antes de construir el contenido que se va a cifrar.

No hay conversión entre unidades, por el mismo motivo que en la glucemia: exigiría fijar precisión y
redondeo. Un resumen de comidas que mezcle gramos y mililitros no suma, agrupa por unidad o no agrupa.

Como el texto del alimento lo escribe la persona, es dato clínico en el sentido más literal (puede
contener cualquier cosa que se le ocurra escribir) y viaja cifrado dentro del sobre del evento como todo
lo demás, sin índice ciego ni búsqueda en servidor.

Cuando aparezca una fuente de alimentos que cumpla el ADR 0005, el camino es añadir un campo opcional de
código junto al texto, nunca sustituirlo. El texto original se conserva siempre: es lo que la persona
declaró, y una codificación posterior es una interpretación nuestra que no debe borrarla.
