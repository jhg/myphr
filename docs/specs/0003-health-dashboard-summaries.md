# Spec 0003: Resúmenes del panel de inicio

* Related ADR(s): `docs/adr/0002-encrypted-data-flow-livewire-alpine-filament.md`,
  `docs/adr/0004-client-crypto-and-data-format.md`, `docs/adr/0006-encrypted-event-model.md`,
  `docs/adr/0007-encrypted-user-configuration.md`, `docs/adr/0008-measurement-method.md`

Esta spec depende de esos ADR como lectura previa: no repite su justificación, solo la aplica. Si un punto
de esta spec y un ADR no coinciden, el ADR manda y esta spec tiene un error que corregir. La spec 0002
(`docs/specs/0002-tracking-event-capture.md`) cubre la otra mitad: cómo se capturan y se cifran los eventos
que aquí se resumen. Todo lo que dice sobre el contrato criptográfico vale igual y no se repite.

## 1. Alcance

El panel de inicio resume glucemia y tensión arterial en dos ventanas, la última semana y el último mes.
Nada más: no hay comidas ni insulina, porque una media de comidas no significa nada mientras los alimentos
sean texto libre (ADR 0010), y la insulina todavía no tiene forma de dato cerrada.

Deja fuera la gráfica de una sola magnitud, que vive en su pantalla de captura, y deja fuera la pantalla de
ajustes donde el usuario configura su rango objetivo, que hoy no existe: el panel ya lee ese ajuste y se
comporta bien sin él.

## 2. Historias de usuario

Persona que abre la aplicación por la mañana. Ve de un vistazo cómo ha ido su semana y su mes: cuántas
lecturas lleva, por dónde se mueven y cuál fue la última, sin abrir ninguna pantalla ni tocar ningún
filtro.

Persona que lleva sensor y además se pincha el dedo. Ve dos bloques de estadísticas separados, uno por
método, cada uno con su etiqueta visible. Nadie le promedia una cosa con la otra a su espalda.

Persona a la que su médico le ha dado un rango objetivo. Lo configura una vez y a partir de ahí el panel le
dice qué porcentaje del tiempo estuvo dentro. Quien no lo ha configurado no ve esa estadística, ni vacía ni
con un rango sugerido: ve una invitación discreta a configurarla.

Persona que va a consulta. Enseña la pantalla tal cual, porque los números que muestra son los que el
médico pide: recuento, media, mediana, mínimo, máximo y última lectura.

## 3. Dónde se calcula, y por qué

En el navegador, sobre los eventos ya descifrados, con la clave en memoria. El servidor no puede sumar lo
que no puede leer (ADR 0002), así que la página de inicio no usa widgets de Filament: hereda de
`HealthEventPage` para reutilizar `fetchEvents` y descifra en el cliente igual que cualquier pantalla de
captura.

El cálculo vive en un módulo puro, `resources/js/health/statistics.js`, sin DOM ni Livewire, y el
componente Alpine del panel no reimplementa ninguna media ni mediana: solo descifra, llama y da forma al
resultado. Es lo que permite probar las estadísticas sin montar nada.

Como el servidor no puede filtrar por tipo (ADR 0006), el panel recibe todos los eventos del rango y es
`statistics.js` quien descarta los que no son del tipo que está resumiendo. Un sobre que no abre no tumba
el panel: se cuenta y se avisa.

## 4. Las dos ventanas

Última semana son siete días y último mes son treinta, ambas terminadas en el instante en que se abre el
panel, y con los dos extremos inclusivos: `[referencia - N días, referencia]`. Se fija así, y no con un
límite abierto, para que el resumen no cambie según la hora del día a la que se mire, y para que un evento
de hace exactamente N días cuente igual a las 00:00 que a las 23:59.

Nada posterior al instante de referencia entra, aunque exista en la lista, porque un reloj de dispositivo
adelantado no debe meter lecturas "del futuro" en el resumen.

## 5. Resumen de glucemia

Se calcula por método de medición (ADR 0008: las estadísticas no mezclan métodos en silencio) y dentro de
una sola unidad de presentación, la del ajuste `glucoseUnit` del usuario, con `mg/dL` cuando no hay
preferencia guardada. Para cada método:

```
count             cuántas lecturas
mean, median      media y mediana
min, max          el rango observado
last              la última lectura, con su valor y su instante
inRangePercent    solo si hay rango objetivo configurado
```

No se convierte entre mg/dL y mmol/L, por el mismo motivo que en la pantalla de captura: convertir exige
fijar precisión y redondeo, que es una decisión clínica que ningún ADR ha tomado. Los eventos en otra
unidad se cuentan aparte (`excludedByUnit`) y la vista lo dice, en lugar de desaparecer sin explicación.
Ese aviso se pinta también cuando ninguna lectura del periodo entra en la unidad de presentación: si no,
quien tiene treinta glucemias en mg/dL y cambia su preferencia a mmol/L lee un "todavía no hay registros"
que es falso.

La misma regla se aplica al rango objetivo, que guarda su propia unidad. Un rango en una unidad distinta
de la de presentación no se aplica, igual que uno mal formado, porque comparar 140 mg/dL contra un rango
de 3,9 a 10 mmol/L publicaría un "tiempo en rango: 0 %" que parece un dato clínico y no lo es. Ese estado
tiene su propio aviso, distinto del de "todavía no hay rango": el primero se resuelve cambiando una de las
dos unidades y el segundo configurando el rango, y ofrecer el mensaje equivocado manda a la persona al
sitio equivocado.

Se descartan sin tumbar el resumen los eventos que no traen un valor numérico, que son dos casos distintos
con el mismo efecto: un resultado cualitativo, como el de una tira de orina, que no tiene media ni rango
(ADR 0008), y un valor mal formado. Los dos suman al mismo contador `discarded`.

El porcentaje de tiempo en rango solo aparece cuando el usuario ha configurado su rango objetivo. Si no lo
ha hecho, la clave `inRangePercent` no existe: ni `null` ni cero. El ADR 0007 es explícito en que la
aplicación no trae rangos por defecto, porque un rango sugerido es una indicación clínica, y una
estadística con un cero donde debería haber un hueco invita a rellenarlo con cualquier número.

## 6. Resumen de tensión arterial

Se agrupa por el método de la magnitud, que en la tensión es la combinación de brazo y postura
(ADR 0008), de `left_sitting` a `right_standing`. La combinación se calcula al agrupar a partir de
`data.arm` y `data.posture`, no se guarda en el sobre.

Para cada grupo, y para cada una de las tres magnitudes por separado, sistólica, diastólica y frecuencia
cardiaca, se calculan media, mediana, mínimo, máximo y último valor, más el recuento del grupo y la última
lectura completa, con los tres números juntos y su instante. La lectura completa importa: enseñar
"la última sistólica" y "la última diastólica" por separado permitiría que fueran de dos días distintos.

Un evento de tensión es uno solo con los tres números (ADR 0006), así que el resumen no los reparte en tres
listas independientes. La frecuencia cardiaca es opcional en la captura, porque no todos los tensiómetros
la miden, de modo que un evento sin ella tiene que seguir contando para la sistólica y la diastólica, y no
debe desaparecer del resumen entero. Lo que sí se descarta, contándolo en `discarded`, es un evento al que
le falte una de las dos presiones o que traiga un valor no numérico.

## 7. Precisión de los números que se muestran

Los valores viajan como cadena (ADR 0004) y se convierten a número solo para calcular. Media y mediana se
redondean a dos decimales y el porcentaje en rango a uno, con redondeo hacia el entero más lejano del cero.
No es una decisión clínica, no interpreta si el número es bueno o malo: es solo fijar la precisión de la
presentación en un sitio, en lugar de dejarla al azar de cómo formatee cada navegador.

La mediana de un número par de muestras es el promedio de las dos centrales, con la lista ya ordenada, que
es la definición estándar.

## 8. Criterios de aceptación

* Un evento registrado hace exactamente siete días entra en la ventana de la semana, se abra el panel a la
  hora que se abra. Uno con fecha posterior al instante de referencia no entra en ninguna ventana.
* Dos lecturas de glucemia con métodos distintos producen dos grupos, nunca una sola media, y cada grupo
  muestra su etiqueta de método.
* Sin rango objetivo configurado, ningún grupo trae `inRangePercent` y la vista no dibuja ese hueco. Con un
  rango configurado, el porcentaje cuenta las lecturas con los dos extremos incluidos.
* Un rango objetivo mal formado (sin `low` o `high` numéricos, o con el mínimo por encima del máximo) se
  trata como si no existiera, no como un rango de cero.
* Un rango objetivo guardado en una unidad distinta de la de presentación tampoco produce `inRangePercent`,
  y la vista lo dice con un aviso propio en vez de invitar a configurar un rango que ya existe.
* Un periodo en el que todas las lecturas quedaron fuera por unidad sigue diciendo cuántas quedaron fuera,
  no solo que no hay registros.
* Una lectura en una unidad distinta de la de presentación no entra en ninguna media y se cuenta en
  `excludedByUnit`, y la vista dice cuántas quedaron fuera y en qué unidad se está mostrando.
* Un resultado cualitativo y un valor no numérico se cuentan en `discarded` y no tumban el resumen.
* Una lectura de tensión sin frecuencia cardiaca sigue contando para la sistólica y la diastólica.
* La mediana de cuatro valores es el promedio de los dos centrales, comprobado con un caso concreto y no
  solo contra la propia implementación.
* Un sobre que no abre se cuenta y se avisa, y el resto del panel se pinta igual.

## 9. Preguntas abiertas

1. Dónde configura el usuario su rango objetivo. El panel ya lee el ajuste `glucoseTargetRange` del sobre
   de configuración cifrado, pero no existe todavía la pantalla que lo escriba, así que hoy ese nombre es
   una convención de un solo módulo. La pantalla de ajustes tiene que fijarlo, y con él, si el rango es uno
   solo o depende del contexto respecto a la comida, que es como lo dan muchas guías clínicas.
2. Si el usuario puede combinar métodos a voluntad. El ADR 0008 dice que puede, y que la vista debe indicar
   siempre qué métodos incluye un número. Hoy el panel siempre separa, que es el valor por defecto correcto,
   pero falta el selector.
3. Cuántos eventos pide el panel. Hoy hace una sola llamada a `fetchEvents` con el límite por defecto de
   cien, y como el servidor no puede filtrar por tipo, cien eventos mezclados pueden no cubrir un mes de
   registros de alguien que apunta varias veces al día: el resumen del mes saldría corto sin decirlo. Lo
   coherente con la sección 4 de la spec 0002 es pedir lotes con cursor hasta agotar la ventana de treinta
   días, y avisar si aun así se topa con el techo.

## 10. Historial

### 2026-07-26 — El rango objetivo se compara por unidad y el aviso de excluidos deja de esconderse
Antes: la sección 5 solo decía que no se convierte entre unidades, y la implementación descartaba la unidad
del rango objetivo al leerlo, así que un rango en mmol/L se comparaba contra lecturas en mg/dL y el panel
publicaba un "tiempo en rango: 0 %". El aviso de registros excluidos por unidad, además, quedaba detrás del
estado sin datos y no llegaba a pintarse justo cuando todas las lecturas estaban excluidas.
Cambia porque las dos unidades (la de presentación y la del rango) se eligen por separado en el perfil, así
que el desajuste es un estado alcanzable y no un caso teórico.
