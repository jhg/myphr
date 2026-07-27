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

La compartición con profesionales **no está implementada todavía**, pero ya está
diseñada en el
[ADR 0011](adr/0011-shared-clipping-for-professionals.md): un recorte cifrado en
el navegador, un enlace con la clave en el fragmento y un PIN corto que el
servidor verifica en línea con contador de intentos. Con quién y qué se comparte
son decisiones criptográficas y no permisos en una tabla, porque el servidor no
puede conceder acceso a algo que no sabe leer.

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

## Cómo está montado

Es una arquitectura invertida respecto a lo habitual, y entenderlo así aclara casi todo lo demás:
**Livewire no es el dueño del estado, es un transporte.** El estado real vive en Alpine, en el
navegador. El porqué de cada capa está en su ADR; aquí solo el mapa.

**Filament** pone la carcasa: navegación, tema, modo oscuro y las pantallas de acceso. El buscador
global está desactivado a propósito, porque resolvería en servidor sobre datos cifrados: no
encontraría nada y solo enviaría al servidor lo que la persona teclea. Todo se configura en
`PhrPanelProvider` (ADR [0001](adr/0001-ui-stack-livewire-filament-alpine.md)).

**Livewire** solo transporta. El texto cifrado entra como argumento de un método y sale como valor de
retorno, **nunca como propiedad del componente**: una propiedad pública acaba en el *snapshot*, que
viaja al servidor y se queda allí. Hay un guardarraíl que lo intercepta y tests de arquitectura que
fallan si alguien lo intenta (ADR [0002](adr/0002-encrypted-data-flow-livewire-alpine-filament.md)).

**Alpine** es el dueño de todo lo que importa: guarda los eventos descifrados en memoria, cifra antes
de subir, descifra al bajar y construye el DOM. Cada pantalla declara su componente en `x-data`, y
todos se registran en `resources/js/app.js`. Si uno falta ahí, la pantalla se pinta y no responde,
**sin ningún error visible**: es el fallo silencioso que más veces ha mordido a este proyecto.

**El servidor** hace tres cosas y ninguna implica leer datos clínicos: autentica, autoriza, y guarda
y pagina sobres opacos. De un evento solo ve `user_id`, `occurred_at` e `id` (ADR
[0006](adr/0006-encrypted-event-model.md)). De ahí salen dos consecuencias que explican media
aplicación: **puede filtrar por fecha, y no puede filtrar por tipo**.

### La frontera entre Livewire y Alpine

Es la parte delicada. Livewire hace *morph* del DOM en cada petición, así que borraría lo que Alpine
haya escrito. Hay dos defensas, y hacen falta las dos:

- `wire:ignore` con un `wire:key` **estable** en las regiones que escribe Alpine.
- Y la trampa: **un `@island` no basta**. El servidor lo reemite en cada petición y borra lo que
  hubiera dentro. Por eso los lienzos de las gráficas viven *fuera* de los islands. Si algún día una
  pantalla pierde su gráfica tras cargar, esto es lo primero que hay que mirar.

### La clave maestra y la navegación

`auth/keyring.js` se importa **el primero** en `app.js`, que se carga en el `<head>`. La clave vive en
el ámbito de ese módulo. Filament navega como SPA con `wire:navigate`, que sustituye el `<body>` pero
**no vuelve a evaluar los módulos ya cargados**: ese es el mecanismo entero por el que la clave
sobrevive al cambiar de pantalla y muere al cerrar la pestaña (ADR
[0003](adr/0003-master-key-survival-in-browser.md)).

El mismo mecanismo tiene una cara menos amable: `wire:navigate` tampoco actualiza los atributos del
`<html>`, así que el idioma se leía una vez y se quedaba congelado. Ahora se relee en cada navegación
de un marcador que va en el `<body>`.

### Cuándo un método de Livewire y cuándo un endpoint propio

Es la pregunta que aparece al añadir cualquier funcionalidad, y la regla es:

> **Livewire para el plano de datos dentro de una pantalla autenticada. Endpoint propio para el
> protocolo criptográfico, para lo que tenga semántica HTTP o límite de intentos propios, y para lo
> que no tenga sesión.**

Con `$wire` van `storeEvent` y `fetchEvents`: el componente ya está montado, la sesión existe y la
autorización se resolvió al entrar en la pantalla.

Con endpoint propio va todo lo demás, por cuatro motivos distintos. **Lo anterior a que haya sesión**,
como OPAQUE, que además exige errores deliberadamente indistinguibles entre contraseña incorrecta,
cuenta inexistente y handshake caducado. **Lo que necesita semántica HTTP**, como el guardado de
ajustes, que usa `If-Match` y responde 412 o 428. **Lo que vive fuera del panel**, como la pantalla
del profesional, que no tiene sesión ni cookies (ADR
[0011](adr/0011-shared-clipping-for-professionals.md)). Y **lo que necesita limitar intentos por su
cuenta**: todas las llamadas de Livewire pasan por un único endpoint, así que no se puede acotar el
login sin acotar también el guardado de una glucemia.

Una consecuencia de esto: el enrutador SPA de Filament intentaría meter en el `<body>` la respuesta de
cualquier URL del origen, y con un endpoint que devuelve JSON pintaría el JSON en pantalla. Por eso
`PhrPanelProvider` declara excepciones explícitas para `/phr/auth/*`, `/phr/logout` y `/phr/settings`.
La página de perfil no está en esa lista a propósito: sirve HTML y debe navegarse como el resto.

## Documentación

- [OPAQUE.md](OPAQUE.md): autenticación por contraseña sin enviar la contraseña.
- [adr/](adr/): decisiones de arquitectura, con su contexto y sus renuncias.
- [specs/](specs/): el detalle de implementación de cada funcionalidad, apoyado en esos ADR. Ahí
  vive el contrato criptográfico de la captura de eventos, que hay que respetar al pie de la letra
  porque se congela con el primer dato real.

[orion-phr]: https://orionhealth.com/us/blog/emr-vs-ehr-vs-phr-whats-the-difference-and-why-does-it-matter/
[orion-fhir]: https://orionhealth.com/us/blog/hl7-vs-fhir-vs-snomed-ct/
[loinc]: https://loinc.org/kb/license/
[snomed-docs]: https://docs.snomed.org/
[snomed-glossary]: https://docs.snomed.org/snomed-international-documents/snomed-ct-glossary
