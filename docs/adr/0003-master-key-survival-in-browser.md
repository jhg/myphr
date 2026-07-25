# ADR 0003: Supervivencia de la clave maestra en el navegador

* **Status**: Accepted
* **Date**: 2026-07-25
* **Decider**: Development Team

## Context

El ADR 0002 dejó la clave maestra viviendo en el scope de un módulo ES, y con ella una consecuencia
incómoda: cualquier carga de página completa la destruye y obliga a volver a autenticarse. La propuesta
inicial era convertir el panel entero en SPA para que esa carga no llegue a producirse nunca.

El modo SPA de Filament existe, está desactivado por defecto y cubre bien el panel, pero el redirect
posterior al login es una carga dura, verificado ejecutando el flujo contra el código instalado. La clave
moriría justo después de derivarla.

Y el SPA no resuelve el problema que parecía resolver. Quedan fuera de su alcance el F5 manual, el error
419 por sesión caducada, el redirect duro de un middleware, el crash de pestaña, la pestaña nueva y,
sobre todo, el despliegue a mitad de sesión: Filament marca todos sus assets para forzar recarga cuando
cambia de versión, así que actualizar el paquete expulsa a todo el personal conectado.

Sobre las primitivas del navegador, probadas en Safari 26.5 y Chromium 145, el hallazgo que decide:
ninguna permite recuperar una clave tras una recarga sin dar esa misma capacidad a un XSS del mismo
origen. Lo que sí se elige es contra qué otros adversarios se protege.

## Decision

Activamos el modo SPA del panel, sin prefetching, con excepciones para las URL del mismo dominio que no
sirven HTML (descargas, PDF, exports), porque Filament marca para navegación cualquier enlace del mismo
host y un binario pasado por el parser de HTML rompe la interfaz. El SPA es una decisión de interfaz y no
es lo que sostiene la clave: el módulo criptográfico se carga en la cabecera del documento, que la
navegación de Livewire conserva sin volver a ejecutar, con SPA o sin él.

Sustituimos la página de login por una propia, que ya necesitábamos para OPAQUE. Al hacerlo dejamos de
pasar por el flujo de respuesta de Filament, así que el destino que el usuario intentaba abrir hay que
devolverlo nosotros en la respuesta del login en lugar de darlo por hecho.

La supervivencia de la clave, sin embargo, no se apoya en el SPA. Al autenticarse, el servidor genera un
secreto aleatorio ligado a la sesión de Laravel y lo entrega al cliente. El navegador guarda en
`sessionStorage` la clave maestra envuelta bajo una clave derivada de ese secreto. Tras una carga de
página, el cliente pide el secreto a un endpoint autenticado con la cookie de sesión, abre el paquete y
recupera la clave sin pedir contraseña. Así sobrevive al F5, al 419, al redirect duro y al despliegue, y
muere al cerrar la pestaña. La mitad del servidor caduca y se puede revocar, de modo que el material que
quede huérfano en el navegador no abre nada.

El ámbito por pestaña de `sessionStorage` es una propiedad de visibilidad, no de borrado: los navegadores
lo persisten en el perfil para restaurar la sesión tras un cierre inesperado. Lo que hace inútil ese
material no es su volatilidad, es que el secreto que lo abre vive en el servidor y se puede revocar.

**La sesión de Laravel tiene que vivir en el servidor**, con almacén de base de datos o Redis, nunca con
el driver de cookie. Con cookie, el contenido de la sesión viaja al navegador en cada petición y el
cliente pasaría a tener las dos mitades a la vez, con lo que la propiedad se cae entera por un cambio de
una línea en la configuración y sin ningún síntoma visible.

El secreto de sesión no tiene tabla ni columna propia: se guarda dentro de la propia carga útil de la
sesión de Laravel. Con almacén de servidor y sin driver de cookie, la revocación sigue funcionando igual,
porque destruir la sesión destruye su carga útil y con ella el secreto, sin ningún mecanismo adicional que
mantener. Lo que se pierde es poder inspeccionar o revocar de forma selectiva la sesión criptográfica de
alguien sin deserializar su carga útil; se acepta a cambio de no mantener un esquema propio para un único
valor.

Quedan por tanto dos envoltorios independientes de la misma clave maestra: el permanente bajo la KEK que
sale de `export_key`, que vive en el servidor y se abre al iniciar sesión con la contraseña, y el de
recuperación bajo el secreto de sesión, que vive en el navegador. La regla que sostiene el diseño es que
el paquete y el secreto nunca pueden estar en el mismo sitio: si el paquete se guardase en el servidor,
el servidor tendría las dos mitades y podría abrir la clave maestra por su cuenta.

No usamos almacenamiento persistente del navegador para material de clave. Una clave de dispositivo en
IndexedDB añadiría protección solo frente a quien obtuviese a la vez una copia del perfil del navegador y
el secreto de sesión, y a cambio dejaría material de clave que sobrevive al cierre de sesión y al cambio
de usuario en un puesto compartido, sin ninguna garantía de borrado.

Tres momentos usan recarga dura de forma deliberada: el cierre de sesión, el bloqueo por inactividad y
aterrizar en la página de login con la clave todavía en memoria. Livewire mantiene en memoria hasta diez
instantáneas del DOM de páginas ya visitadas, con datos clínicos descifrados, y no expone forma de
purgarlas: solo destruir el contexto de JavaScript las elimina.

Asumimos que perder la clave es un estado normal y frecuente, no un error. La interfaz degrada a pedir
autenticación, nunca a una pantalla rota.

## Rationale

Hacer solo SPA costaba una reescritura del panel a cambio de reducir la frecuencia del problema, sin
ninguna ganancia de seguridad, y ataba la arquitectura entera de la aplicación a una propiedad
criptográfica. Persistir la clave envuelta resuelve más casos por mucho menos código. Las dos cosas se
complementan: el SPA evita las recargas por navegación, que son las más frecuentes, y la persistencia
cubre las que el SPA no puede evitar.

Descartamos tres alternativas. Persistir una clave no exportable de WebCrypto en IndexedDB no aporta
revocación desde el servidor y, con la biblioteca de cifrado que elegimos en el ADR 0004, tampoco protege
contra XSS, porque la clave maestra tiene que materializarse como bytes para poder usarla. Una cadena
enteramente de WebCrypto sí evitaría eso, y por eso el ADR 0004 la deja como ensayo pendiente, pero es
una decisión sobre el algoritmo de cifrado, no sobre dónde se guarda la clave. Un Service Worker como
custodio no sirve: el navegador lo termina a los
treinta segundos de inactividad y un despliegue lo reinicia con memoria vacía, así que pierde la clave
más veces que las recargas que pretendía evitar, y además añade superficie de ataque. `localStorage`
queda descartado sin matices porque persiste indefinidamente y se comparte entre pestañas y sesiones, que
es justo lo contrario de lo que queremos en un puesto compartido.

* **Pros**: el F5, el 419 y el despliegue dejan de expulsar al usuario; el material persistido es inútil
  sin la sesión de servidor, así que no depende de que nadie limpie nada; ganamos revocación de sesión
  sobre datos ya descifrables, que hoy no existe; el ámbito por pestaña de `sessionStorage` encaja con un
  puesto clínico compartido.
* **Cons**: abrir una pestaña nueva sigue exigiendo autenticarse, porque `sessionStorage` no se hereda;
  el modo SPA duplica la superficie de pruebas de interfaz, ya que cada pantalla hay que probarla también
  llegando por navegación; y seguimos sin defensa real frente a XSS.

## Consequences

El despliegue pasa a ser una operación con impacto clínico: no es solo actualizar Filament, es reconstruir
cualquier asset propio, y ocurre igual con el modo SPA desactivado. Cualquiera de los dos casos expulsa a
todos los usuarios conectados en su siguiente navegación, con pérdida del trabajo en curso. Necesita
ventana de mantenimiento o aviso previo, y hay que tratarlo como requisito operativo, no como detalle de
infraestructura.

Ante un 419, Livewire pide confirmación y recarga, lo que para alguien con una nota a medio escribir es
pérdida de datos. Hace falta interceptarlo con un aviso propio que permita conservar el borrador antes de
recargar.

Queda prohibido activar el prefetching del modo SPA: precarga al pasar el ratón por encima, lo que genera
accesos no solicitados a historias clínicas en el registro de auditoría. Cualquier redirect propio lleva
navegación explícita, y añadimos una red de seguridad en cliente para los redirects de terceros que no
la lleven.

`APP_DEBUG` queda desactivado en todo entorno con datos reales, incluido preproducción: ante un error
500, Livewire abre el trace en un diálogo sin recargar, y ese trace puede contener datos clínicos en los
argumentos.

Describimos el sistema con precisión: es zero-knowledge frente al almacenamiento, es decir base de datos,
copias de seguridad, personal con acceso a SQL y proveedor de hosting, y no lo es frente a la entrega,
porque quien controla el servidor que sirve el JavaScript puede servir una versión que capture la clave.
La formulación "el servidor nunca ve nada" es falsa y no debe usarse ante auditoría.

Tres decisiones quedan pendientes y no se toman aquí. El desbloqueo con gesto biométrico mediante la
extensión PRF de WebAuthn resolvería la pestaña nueva sin persistir material de clave, pero su soporte
todavía es desigual. Sacar la criptografía a un origen separado es la única medida con efecto real contra
XSS y sale más barata que reescribir el panel. Y migrar el cifrado de datos a WebCrypto solo tiene
sentido antes de que existan datos en producción.
