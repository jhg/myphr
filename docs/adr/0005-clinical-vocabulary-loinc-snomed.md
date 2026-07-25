# ADR 0005: Vocabulario clínico: capa propia respaldada por códigos LOINC y SNOMED CT

* **Status**: Accepted
* **Date**: 2026-07-25
* **Decider**: Development Team

## Context

El paciente registra datos que su médico le pide (tensión, glucosa, peso, síntomas, adherencia) y los
enseña luego en consulta. Para que ambos hablen de lo mismo hace falta un vocabulario clínico. La
propuesta inicial era SNOMED CT, y se estudiaron tres formas de usarlo: la edición completa, solo sus
nombres en inglés sin los códigos, y que la aplicación consultara un servicio de terminología en tiempo
de ejecución en lugar de importar nada.

La investigación (contrato de afiliado descargado y leído íntegro, endpoints probados, perfiles FHIR
verificados) descartó dos de las tres y reordenó la tercera.

La consulta en tiempo de ejecución no es viable: las condiciones de la instancia pública dicen
"non-production use only", el bloqueo de clientes programáticos está activo (verificado con peticiones
reales), y cada búsqueda del paciente se enviaría a un tercero. El servicio del Ministerio existe pero es
para entidades autorizadas. Nada de esto afecta a consultar el browser de SNOMED **durante el
desarrollo** para decidir qué conceptos incluir: eso es uso normal de una web pública y es como se
confecciona el vocabulario.

Usar los nombres sin los códigos no evita la licencia: el contrato define "SNOMED CT Content" como
conceptos, descripciones y relaciones, prohíbe traducir (una prohibición que solo puede recaer sobre el
texto), e incluye los "database rights" europeos, que protegen la extracción sustancial con independencia
de qué columna se extraiga. La prueba más contundente es a contrario: SNOMED International creó el Global
Patient Set precisamente para liberar identificadores y términos preferidos sin licencia de afiliado; si
los textos fueran libres, ese producto no tendría razón de existir. Y técnicamente, sin código se pierde
el identificador estable, la sinonimia y la jerarquía: queda un diccionario en inglés con carga legal.

Dos hechos más condicionan la decisión. SNOMED no tiene términos para pacientes y ha decidido
oficialmente no tenerlos; su recomendación es que cada implementación mantenga su propia capa amigable, y
la traducción española del core es español americano. Y la regla asentada en FHIR es LOINC para "qué se
midió" y SNOMED para "qué se encontró": las mediciones del MVP llevan códigos LOINC, que es gratuito y
libre de royalties incluso en uso comercial.

## Decision

Definimos un catálogo de conceptos que crece con cada funcionalidad: se añaden los que esa funcionalidad
necesita y no antes. Cada concepto guarda su código estándar, el término oficial de la terminología y una
etiqueta propia por idioma soportado. Los conceptos se declaran como enum en el código, de modo que la
correspondencia entre nombre y código queda fijada y revisable en el propio repositorio.

La etiqueta propia no sustituye al término correcto, convive con él. Los términos de SNOMED son los
correctos, pero su término preferido está definido como la forma "clínicamente más apropiada" de expresar
un concepto: es el término del médico. En un PHR quien lee es el paciente, y "cefalea" y "dolor de
cabeza" son el mismo concepto dicho para dos audiencias. Guardamos ambos, y así la vista del paciente usa
su registro y la que se enseña en consulta puede usar el oficial. SNOMED rechazó añadir términos para
pacientes a la edición internacional y recomienda que cada implementación los aporte; Nueva Zelanda lo
formalizó como refset nacional para portales de paciente.

Idiomas por orden: inglés primero, castellano después y chino simplificado de China cuando sea viable. El
término oficial de SNOMED existe en inglés para todos los conceptos; su traducción española es español
americano, así que para España hay que revisarla, y para chino no la hay en la IPS Terminology. Es otra
razón para que la etiqueta al paciente sea nuestra: es la única capa que podemos ofrecer completa en los
tres idiomas.

Los códigos son LOINC para mediciones (peso `29463-7`, sistólica `8480-6`, diastólica `8462-4`, frecuencia
cardiaca `8867-4`, temperatura `8310-5`, todos validados contra la fuente) y SNOMED CT para síntomas y
hallazgos.

**Las unidades se guardan como código UCUM** (`http://unitsofmeasure.org`), no como texto libre, porque es
lo que exige FHIR y lo que evita una conversión imposible después. Algunos coinciden con lo que uno
escribiría (`mg/dL`, `mmol/L`, `g`, `mL`), pero otros no: la unidad internacional de insulina es `[iU]`,
los milímetros de mercurio son `mm[Hg]` y los latidos por minuto son `/min`. Nadie escribe eso
espontáneamente, y corregirlo más adelante obligaría a re-cifrar todos los sobres en el navegador de cada
usuario, uno a uno. Lo que se muestra en pantalla sale del catálogo y es otra cosa.

**Un código LOINC incluye la unidad de medida y también qué se midió y dónde**, y eso condiciona el
catálogo por partida doble. La glucemia capilar medida
con glucómetro es `41653-7` en mg/dL y `14743-9` en mmol/L: son conceptos LOINC distintos, no el mismo
dato en otra unidad. Como España y Estados Unidos usan mg/dL mientras Reino Unido y China usan mmol/L, un
mismo concepto de nuestro catálogo puede necesitar más de un código según el país del usuario. La entrada
del catálogo es el concepto que ve la persona; el código se elige al registrar el dato, en función de la
unidad y del método de medición, que decide el ADR 0008 (`docs/adr/0008-measurement-method.md`). Conviene
tenerlo presente al diseñar la tabla: la relación entre concepto y código no es uno a uno. Se almacenan desde el
primer dato registrado: añadir
FHIR sobre datos codificados es mecánico, mientras que codificar texto libre histórico exige
recodificación manual y pierde el contexto de captura. Guardar solo la etiqueta es la única opción
irreversible y por eso se descarta ahora.

**Nos limitamos a terminología de licencia libre y de alcance mundial.** No es solo para evitarnos
trámites: como el proyecto se publica en abierto, cualquiera que lo despliegue en cualquier país debe
poder hacerlo sin exposición legal propia. Toda fuente que entre en el catálogo tiene que cumplirlo, y su
licencia queda referenciada aquí con enlace a la fuente primaria, verificada y no tomada de resúmenes:

- LOINC: licencia abierta propia de Regenstrief Institute, no Creative Commons, pero concede lo que
  necesitamos. URL canónica https://loinc.org/license (comprobada el 2026-07-25, con fecha de última
  actualización 21-07-2026). Literal de la propia página: "LOINC is available freely under an open
  license. It is free for use in both commercial and non-commercial systems", y de la licencia:
  "Permission is hereby granted in perpetuity, without payment of license fees or royalties, to use,
  copy, or distribute the Licensed Materials for any commercial or non-commercial purpose". Los códigos
  y la tabla, que es lo que usamos, son "Group 1 Artifacts". No exige registro.

  Obligación concreta: incluir este aviso literal en el producto, y en un fichero de texto si se
  distribuye en un medio de almacenamiento (que es nuestro caso al publicar el repositorio):

  > This material contains content from LOINC (http://loinc.org). LOINC is copyright © Regenstrief
  > Institute, Inc. and the Logical Observation Identifiers Names and Codes (LOINC) Committee and is
  > available at no cost under the license at http://loinc.org/license. LOINC® is a registered United
  > States trademark of Regenstrief Institute, Inc.

  La única prohibición relevante es usar el material para desarrollar o promover un estándar competidor
  de identificación de observaciones, que no es nuestro caso.

  **Nos quedamos solo en la parte de uso libre, y es comprobable.** Algunos códigos LOINC incorporan
  contenido de terceros con copyright propio, señalado en el campo `EXTERNAL_COPYRIGHT_NOTICE` de la
  tabla, que puede exigir atribución adicional o imponer restricciones. Regla dura: **no se admite en el
  catálogo ningún código con ese campo no vacío**, verificado en la importación y en un test, no confiado
  a que alguien lo recuerde. Afecta sobre todo a ítems de cuestionarios validados (escalas de adherencia
  tipo Morisky-Green, cuestionarios de actividad física tipo IPAQ o GPAQ); las mediciones y constantes no
  lo llevan. Si algún día un instrumento concreto compensa, se revisa su aviso y se decide para ese caso.
- Los códigos SNOMED del MVP salen de la **IPS Terminology**, que SNOMED International publica como
  producto abierto bajo **Creative Commons Attribution 4.0**. La declaración está en su página oficial de
  descarga, literal: "This work is licensed under the Creative Commons Attribution 4.0 International
  License" (https://www.snomed.org/international-patient-summary-terminology, comprobado el 2026-07-25).
  El texto de la licencia, que es lo que fija las obligaciones, está en
  https://creativecommons.org/licenses/by/4.0/ y su versión legal completa en
  https://creativecommons.org/licenses/by/4.0/legalcode. CC BY permite copiar, redistribuir, adaptar y
  usar comercialmente, incluso a terceros que desplieguen este software, a cambio de citar la fuente,
  enlazar la licencia e indicar si se hicieron cambios. En la práctica: el catálogo publicado en el
  repositorio lleva esa atribución junto a los datos, no solo en este documento. A diferencia del Global
  Patient Set,
  que es una lista plana de identificador y término, la IPS Terminology incluye jerarquías para su
  alcance. Su refset (`816080008`) tiene del orden de trece mil conceptos, medidos por expansión, sobre
  los ocho mil que cita la guía de implementación
  (https://docs.snomed.org/implementation-guides/snomed-ips-terminology-implementation-guide/2-ips-terminology-overview).
  Se descarga como paquete propio con su módulo, previo registro: no viene dentro del RF2 internacional,
  cuyos ficheros de refset no traen estos miembros. Al descargar se confirma el fichero de licencia.

La licencia de afiliado española, que es gratuita, se tramitará ante el Centro Nacional de Referencia
cuando llegue la compartición con profesionales o si la IPS Terminology se queda corta.

Para construir y auditar el catálogo durante el desarrollo usamos servidores de terminología públicos de
consulta (LOINC vía las tablas clínicas de la NLM, ICD-11 vía la API de la OMS). Es una herramienta de
desarrollo, no una dependencia en tiempo de ejecución: la aplicación desplegada nunca consulta servicios
externos, según lo ya decidido arriba.

El catálogo vive en claro en el servidor y es buscable con SQL normal: es dato público de referencia,
idéntico para todos los usuarios y sin relación con ningún paciente.

Qué se cifra de los registros de cada paciente lo decide cada funcionalidad, no este ADR. A veces bastará
con cifrar el valor y a veces habrá que cifrar también qué concepto se registró, porque el propio hecho
de registrar algo puede asociar a la persona con una condición estigmatizada. La regla general del
ADR 0002 sigue vigente y el criterio por defecto es cifrar; apartarse de él exige justificarlo en la
funcionalidad concreta. La primera que lo aplica es el registro de eventos de seguimiento, en el
ADR 0006 (`docs/adr/0006-encrypted-event-model.md`), que cifra también el tipo de evento.

Sobre los códigos que se cifren no se construye índice ciego. La regla ya estaba en el ADR 0002 y aquí
tiene respaldo publicado: Naveed, Kamara y Wright (CCS 2015) recuperaron atributos cifrados de más del 80%
de los
registros en el 95% de doscientos hospitales estadounidenses explotando frecuencias
(https://cs.brown.edu/people/seny/pubs/edb.pdf). En un PHR el ataque es más fácil que en ese estudio, no
menos: cada usuario tiene un puñado de códigos en lugar de miles que promedien las frecuencias, la
co-ocurrencia delata más que cada código por separado (ver juntos metformina y control de HbA1c
identifica diabetes aunque ninguno lo hiciera solo), y hasta el número de códigos filtra cuántas
condiciones tiene alguien.

No hay consulta a servicios de terminología externos en tiempo de ejecución.

## Rationale

La opción intermedia (nombres sin códigos) era la peor de las tres: carga con la exposición legal de usar
el dataset de SNOMED sin obtener a cambio la interoperabilidad, que vive en los códigos. SNOMED completo
con licencia de afiliado es gratuito en España pero impone obligaciones con coste real (aviso de
copyright literal, registro de sublicencias, y actualización en 180 días desde cada release, que desde
2022 se publica mensualmente), y para treinta conceptos es desproporcionado hoy. El vocabulario propio
respaldado por códigos da la búsqueda y la visualización que el MVP necesita, en el idioma correcto, con
la puerta a FHIR abierta y sin trámites.

La IPS Terminology como fuente resuelve el corto plazo, y la asimetría juega a favor: si mañana hiciera
falta la edición completa, los códigos ya almacenados son los mismos.

Queda una alternativa sin evaluar a fondo que merece revisarse antes de cerrar el vocabulario: ICPC, la
clasificación de atención primaria, es la única que modela formalmente el motivo de consulta **tal como
lo expresa el paciente**, que es literalmente nuestro caso de uso. Su tercera versión pasó a licencia
Creative Commons en 2023, aunque no pudimos confirmar qué variante concreta.

* **Pros**: etiquetas en castellano pensadas para pacientes; sin dependencia de servicios externos ni
  fugas de búsquedas; sin trámite de licencia para salir; códigos estándar desde el primer dato, así que
  el puente a FHIR y a la compartición no exige migrar nada.
* **Cons**: el vocabulario propio hay que mantenerlo y traducirlo bien nosotros; la IPS Terminology cubre
  solo el alcance del resumen de paciente, sin el aparato completo de sinónimos ni la traducción española
  oficial, que exigen la edición completa; consultar la jerarquía con ECL requiere un servidor de
  terminología o precalcular el cierre transitivo, porque el RF2 solo trae relaciones directas, así que el
  MVP no se apoya en agrupación por familias; y dos sistemas de codificación en lugar de uno.

## Consequences

El modelo de datos del catálogo tiene cuatro piezas por concepto: código, sistema
(`http://snomed.info/sct` o LOINC), término oficial, y nuestras etiquetas por idioma. Encaja en
`CodeableConcept` de FHIR sin transformación: el código y el sistema van en `coding`, el término oficial
en `coding.display`, y nuestra etiqueta en `text`, que es exactamente para lo que existe ese campo. La
especificación advierte de que `display` debe llevar el término publicado por la terminología y no una
redacción propia, así que respetar ese reparto no es cosmético.

Sobre el software libre: este repositorio puede publicarse con el catálogo dentro, porque sus dos fuentes
lo permiten con atribución, y quien lo despliegue hereda ese mismo permiso sin trámite alguno. La
atribución de ambas (aviso literal de LOINC y crédito con enlace a CC BY 4.0 de la IPS Terminology) va en
un fichero junto a los datos del catálogo, no solo en este ADR, porque la obligación acompaña a los datos
allá donde se copien. Lo que nunca podrá incluir el repositorio es contenido de la edición completa de SNOMED CT:
esa se obtiene con licencia de afiliado, que es individual por organización y territorio (gratuita en los
países miembros, con tarifas en el resto), así que si algún día la adoptamos, el patrón es el habitual en
software sanitario libre: el código se distribuye sin la terminología y cada implantador descarga la suya
con su propia licencia. Esa responsabilidad es del implantador y se documentará en el README llegado el
momento.

Los promedios, valores extremos y tendencias que el paciente enseña en consulta se calculan en el
navegador, con la clave en memoria. Es lo coherente con el ADR 0002, que descarta agregados en servidor,
pero es trabajo real de JavaScript que hay que dimensionar y no sale gratis por usar códigos estándar.

Mientras nos mantengamos en fuentes de licencia libre no hay trámite ni consulta legal pendiente, que es
el objetivo. Las tres cuestiones que quedan solo se activan si algún día se tramita la licencia de
afiliado: si un PHR de pago para público general choca con la cláusula 2.2.4 del contrato, que impone
gratuidad a sistemas públicos que acceden a datos codificados con SNOMED; si nuestras etiquetas propias
podrían considerarse una traducción de las descripciones, que la cláusula 2.4 prohíbe sin consentimiento
escrito; y las condiciones nacionales del centro nacional correspondiente. Contactos:
`semanticaSNS@sanidad.gob.es` e `info@snomed.org`.

Cuando llegue la compartición con profesionales o la exportación, el orden es: tramitar la licencia de
afiliado (gratuita), adoptar la Edición en Español del SNS para sinónimos y jerarquía, y cumplir las
obligaciones del contrato. Los datos ya registrados no se tocan: los códigos son los mismos.

Cada funcionalidad nueva trae consigo dos decisiones que este ADR no puede anticipar: qué conceptos añade
al catálogo, que es criterio clínico y no de desarrollo, y qué parte de sus registros va cifrada.
