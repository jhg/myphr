# ADR 0001: Stack de interfaz: Livewire, Filament y Alpine

* **Status**: Accepted
* **Date**: 2026-07-25
* **Decider**: Development Team

## Context

Construimos un PHR (Personal Health Record): una historia de salud que controla la propia persona, no un
centro sanitario. La distinción frente a EMR y EHR es deliberada y define el producto, porque en un PHR
el titular decide qué guarda y con quién lo comparte (ver
https://orionhealth.com/us/blog/emr-vs-ehr-vs-phr-whats-the-difference-and-why-does-it-matter/). Encaja
con el diseño zero-knowledge: la clave la tiene el titular, no el proveedor del servicio.

Dos fuerzas condicionan la interfaz y tiran en direcciones opuestas.

La primera es el volumen de CRUD. Un PHR es sobre todo formularios, tablas, filtros y permisos sobre
entidades de dominio: episodios, medicación, pruebas, profesionales con quien se comparte. Escribir eso a
mano, pantalla a pantalla, se come el tiempo que necesitamos para el dominio clínico.

La segunda es el zero-knowledge. Los datos clínicos se cifran en el navegador y el servidor almacena
solo ciphertext, sin ver nunca la contraseña ni las claves. La autenticación es OPAQUE (ver
`docs/OPAQUE.md`) y de ella el cliente deriva la clave con la que cifra. Eso exige JavaScript real, con
control fino sobre dónde vive cada secreto.

El equipo es pequeño y mayoritariamente PHP. Hoy no hay que dar servicio a un cliente móvil nativo ni a
terceros que consuman una API.

## Decision

Adoptamos el stack de interfaz de Laravel de primera parte: Livewire 4 para los componentes, con el
estado en el servidor y el render en Blade; Filament 5 para el panel y el CRUD de dominio, sobre el panel
`phr` que ya existe en `app/Providers/Filament/PhrPanelProvider.php`; Alpine para la interactividad de
cliente; y Tailwind con Vite para estilos y bundling.

Alpine no es una decisión independiente: Livewire lo incluye y Filament lo usa por dentro, así que elegir
Livewire y Filament ya es elegir Alpine. Lo que decidimos de verdad es no añadir un segundo framework de
cliente.

La excepción, acotada: escribimos JavaScript propio únicamente para la criptografía de cliente, con
`@serenity-kit/opaque` para la autenticación y las bibliotecas de cifrado que fija el ADR 0004
(`docs/adr/0004-client-crypto-and-data-format.md`). Es el único código JS que mantenemos y auditamos
nosotros.

Para dibujar gráficas reutilizamos **Chart.js**, que Filament ya empaqueta para sus propios widgets
(`vendor/filament/widgets/dist/components/chart.js`, versión 4.5.1). Usamos la biblioteca pero no los
widgets de Filament, porque los datos llegan cifrados y se descifran en cliente. Es un tercero que recibe
datos clínicos en claro y por tanto está dentro de la frontera de confianza, pero no añade superficie
nueva de cadena de suministro: ya venía con el panel.

## Rationale

Livewire mantiene el estado en el servidor, y eso elimina tres trabajos que un SPA obliga a hacer:
definir y versionar una API para la interfaz, duplicar el modelo de datos en el cliente y mantener
sincronizadas ambas copias. Validación y autorización se escriben una vez, en PHP. Para un PHR hay un
beneficio extra: si el estado no viaja al cliente, los datos clínicos no se replican en un store de
JavaScript, con menos sitios donde acaban apareciendo por accidente.

Filament nos da hecho el grueso del CRUD (tablas con búsqueda y paginación, formularios, filtros,
acciones con modal, relation managers, autorización por policies) y deja puntos de extensión limpios:
columnas y campos propios, vistas Blade a medida y páginas Livewire completas dentro del panel.

Consideramos tres alternativas. Inertia con Vue o React tiene mejor ergonomía para interfaces muy
interactivas y sería el camino natural hacia una app nativa, pero no aporta CRUD hecho, duplica el modelo
en el cliente y añade un segundo ecosistema de dependencias. Un SPA con API propia da máxima flexibilidad
y es requisito para móvil nativo, pero obliga a construir, versionar y proteger una API entera antes de
la primera pantalla útil. Blade puro con JavaScript a medida da el máximo control, a cambio de escribir a
mano justo lo que Filament elimina. Entre paneles alternativos (Nova, Backpack), Filament gana por ser el
más cercano al stack que ya usamos y por no añadir licencias.

* **Pros**: entrega rápida en la parte CRUD; un solo lenguaje para lógica, validación y autorización; sin
  API pública que diseñar ni defender; sin build ni dependencias que gestionar para el framework de
  cliente; el JS propio queda reducido a un módulo pequeño y auditable.
* **Cons**: cada interacción de Livewire es un viaje al servidor, lo que penaliza con red inestable;
  dependemos de un framework grande y opinionado, con coste real en las actualizaciones mayores; Alpine
  no sirve para estado de cliente complejo; y si algún día hace falta móvil nativo, habrá que construir
  la API que aquí evitamos y reescribir el cliente criptográfico.

## Consequences

La consecuencia que más condiciona el día a día es dónde vive cada secreto. Livewire mantiene el estado
en el servidor, así que el plaintext y las claves no pueden entrar nunca en el estado de un componente.
El ciphertext sí circula por Livewire, esa es la vía normal; lo que no circula jamás es el dato en claro.

De ahí salen cuatro reglas vinculantes. La contraseña, la export key y las claves derivadas nunca se
enlazan con `wire:model` ni se guardan en propiedades públicas. Los formularios que manejan secretos usan
un input gobernado por Alpine, aislado del re-render de Livewire, que cifra antes de enviar. Al servidor
solo salen los mensajes del protocolo OPAQUE, ciphertext y nonces. Y las rutas de OPAQUE viven en el
grupo de middleware `web`, porque necesitan sesión y CSRF para autenticar al usuario al terminar el
handshake.

Filament recibe únicamente una sesión Laravel ya autenticada y no participa en la criptografía. Las
vistas que muestren datos cifrados no podrán apoyarse en la búsqueda ni la ordenación en servidor, que
trabajan en SQL sobre un contenido que el servidor no entiende: esas pantallas serán componentes Livewire
propios. Cómo circula el ciphertext entre Livewire, Alpine y Filament se decide en el ADR 0002
(`docs/adr/0002-encrypted-data-flow-livewire-alpine-filament.md`).

Damos por aceptado el riesgo de que un `wire:model` puesto sin pensar rompa la propiedad principal del
sistema sin fallar de forma visible, y lo compensamos con revisión explícita en code review y un test que
verifique que ningún dato en claro aparece en el payload de Livewire.

Por último, `npm` sigue presente pese a que no gestionamos build del framework de interfaz: Vite y
Tailwind ya compilan CSS, y el módulo criptográfico añade dependencias JS que hay que fijar por versión
exacta, porque un cambio de sus valores por defecto puede invalidar todos los registros existentes.
