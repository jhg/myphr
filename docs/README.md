# myphr

Una historia de salud personal (PHR) cifrada de extremo a extremo.

## Qué es un PHR, y por qué no un EMR ni un EHR

Los tres guardan datos de salud, pero se diferencian en quién manda. Un EMR es
el registro de un centro concreto, y un EHR el que comparten varios
profesionales. Un **PHR lo gestiona la propia persona**. La distinción está bien
explicada en [Orion Health, "EMR vs EHR vs PHR"][orion-phr].

| | PHR |
|---|---|
| Propósito | Seguimiento de salud gestionado por el paciente |
| Titularidad | Del paciente |
| Alcance | Lo que el paciente decide incluir |
| Compartición | La controla el paciente |
| Mejor uso | Bienestar personal y poder explicar la propia salud |

Esas filas son la razón de las decisiones técnicas del proyecto, no una
declaración de intenciones.

Si los datos son del paciente, el servidor no tiene por qué poder leerlos. Por
eso todo se cifra en el navegador con una clave que se deriva de la contraseña
del usuario y que nunca llega al servidor: ni la contraseña, ni las claves, ni
los datos en claro. La autenticación usa OPAQUE (RFC 9807), que permite
autenticar sin enviar la contraseña. Ver [OPAQUE.md](OPAQUE.md).

La compartición con profesionales **no está en la primera versión**. Cuando
llegue, con quién y qué se comparte serán decisiones criptográficas y no
permisos en una tabla, porque el servidor no puede conceder acceso a algo que no
sabe leer. De momento el paciente registra y consulta sus propios datos.

## Para qué sirve en la práctica

El caso que perseguimos es el seguimiento que el médico pide y el paciente
sostiene: tensión, glucosa, síntomas, adherencia a un tratamiento. El paciente
lo recoge en su día a día y, en la consulta, lo enseña ya masticado: promedios,
valores extremos y tendencias señaladas, para que la conversación empiece donde
importa en lugar de gastarse en interpretar una lista de números.

En la primera versión eso se enseña desde la pantalla del propio paciente. El
envío de datos al profesional llegará después.

## Vocabulario clínico

La interfaz usa etiquetas propias escritas para pacientes, en inglés primero y
castellano después. Cada concepto lleva por debajo su código estándar: [LOINC][loinc]
para lo que se mide (tensión, glucosa, peso) y [SNOMED CT][snomed-docs] para lo
que se encuentra (síntomas, hallazgos), de forma que paciente y médico se
refieran a lo mismo aunque usen palabras distintas. El [glosario
oficial][snomed-glossary] define los términos del estándar, y la decisión con
su análisis de licencias está en el
[ADR 0005](adr/0005-clinical-vocabulary-loinc-snomed.md).

Todavía **no soportamos HL7 ni FHIR**. Son cosas distintas y compatibles: HL7 y
FHIR definen cómo viajan los datos entre sistemas, los vocabularios definen qué
significan ([Orion Health, "HL7 vs FHIR vs SNOMED CT"][orion-fhir]). Guardar
los códigos desde el primer dato es lo que hará viable el transporte después.

## Documentación

- [OPAQUE.md](OPAQUE.md): autenticación por contraseña sin enviar la contraseña.
- [adr/](adr/): decisiones de arquitectura, con su contexto y sus renuncias.

[orion-phr]: https://orionhealth.com/us/blog/emr-vs-ehr-vs-phr-whats-the-difference-and-why-does-it-matter/
[orion-fhir]: https://orionhealth.com/us/blog/hl7-vs-fhir-vs-snomed-ct/
[loinc]: https://loinc.org/kb/license/
[snomed-docs]: https://docs.snomed.org/
[snomed-glossary]: https://docs.snomed.org/snomed-international-documents/snomed-ct-glossary
