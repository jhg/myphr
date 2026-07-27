# ADR 0009: Alta de usuarios, nacimiento de la clave y fin de sesión

* **Status**: Accepted
* **Date**: 2026-07-25
* **Updated**: 2026-07-26
* **Decider**: Development Team

## Context

Faltaba escribir tres momentos del ciclo de vida que hasta ahora estaban implícitos: cómo aparece un
usuario en el sistema, dónde nace su clave maestra y cómo termina su sesión. Los tres tocan a la vez la
autenticación, la configuración cifrada y el modelo de datos, así que conviene decidirlos juntos.

La clave maestra es aleatoria, cifra todos los datos del usuario y el servidor no puede verla nunca. Eso
condiciona por completo el alta: no hay forma de crear una cuenta con datos utilizables sin que una
persona escriba su contraseña en un navegador.

## Decision

Hay tres vías para crear una cuenta. La persona puede registrarse ella misma desde la pantalla de acceso,
sin código de invitación: escribe su nombre, su correo y su contraseña, y el navegador ejecuta el registro
OPAQUE en el acto, sin ningún enlace de por medio. Un usuario existente puede dar de alta a otro desde el
panel, o el primer usuario se crea con un comando de consola; en estas dos vías lo único que se crea es la
fila del usuario y un enlace de un solo uso con caducidad de 24 horas, como parámetro explícito del comando
y no un valor por defecto oculto.

**El registro público revela si una cuenta existe.** Si el correo ya tiene cuenta, el formulario lo dice
para que la persona pueda ir a iniciar sesión en vez de creer que su alta se ha perdido. Todo el diseño
OPAQUE de este proyecto está construido para lo contrario: el login tiene una rama falsa que responde igual
en forma y en coste cuando la cuenta no existe, precisamente para no delatar cuentas (`docs/OPAQUE.md` lo
razona con detalle). El formulario de alta abre esa puerta por otro lado, y es una decisión consciente y
acotada, no un descuido: sin decirlo, quien se equivoca de correo no tiene forma de saber qué le ha pasado
ni qué hacer a continuación. Se mitiga con un límite de intentos por IP, más estricto que el del registro
por invitación porque aquí no hay token de enlace que reparta el abuso entre varios cubos.

**En la vía de invitación y en la del primer usuario, el enlace se muestra en pantalla una sola vez y nunca
se envía por correo.** La aplicación lo entrega al administrador que lo emite, y es él quien lo hace llegar
a la persona por el canal que elija. Enviarlo por correo serializaría la URL en la tabla de trabajos y la
haría pasar por el proveedor de correo, que puede registrarla, y eso añade una superficie que hoy no
existe. El coste aceptado es que esa vía lleva siempre un paso manual de comunicación.

**La clave maestra nace siempre en el navegador, tanto si la persona usa un enlace como si se registra por
sí misma.** La persona elige contraseña, se ejecuta el registro OPAQUE, de ahí sale la clave de cifrado de
claves, el navegador genera una clave maestra aleatoria, la envuelve con ella y envía al servidor
únicamente la versión envuelta. El servidor no ve la clave en ningún momento, ni siquiera transitoriamente.

El primer usuario se crea con un comando de Artisan que **solo emite el enlace**, sin generar ninguna
clave. El administrador lo abre en su navegador y su clave nace exactamente igual que la de cualquier
otro. A partir de ahí, ese usuario da de alta a los demás con el mismo mecanismo, y cualquiera puede además
darse de alta él mismo por la vía pública.

Lo que no cambia: la clave maestra sigue naciendo en el navegador y la contraseña sigue sin llegar nunca al
servidor, en las tres vías. El enlace de invitación sigue existiendo para dar de alta a alguien desde el
panel, y el comando de consola sigue siendo la vía del primer usuario: el registro público es una vía más,
no un reemplazo de ninguna de las dos. Tampoco cambia la falta de verificación de correo: ni un enlace
consumido ni un registro público demuestran que la persona controla el buzón, así que la consecuencia de
siempre sigue en pie, si se olvida la contraseña, los datos no se recuperan.

La sesión se bloquea a los quince minutos de inactividad y exige la contraseña de nuevo. El bloqueo es
recarga dura, no una pantalla superpuesta, porque hay que destruir el contexto de JavaScript para vaciar
las instantáneas del DOM que Livewire retiene con datos descifrados, según fija el ADR 0003.

**Bloquear implica destruir el secreto de sesión en el servidor**, no solo vaciar la memoria del
navegador. El mecanismo de recuperación del ADR 0003 existe precisamente para que una recarga no eche al
usuario: el paquete cifrado sigue en `sessionStorage` y el cliente puede volver a pedir el secreto y
abrirlo sin contraseña. Si el bloqueo no mata ese secreto, la recarga del bloqueo es justo el caso que la
recuperación resuelve y el bloqueo no bloquea nada. Y tiene que hacerlo el servidor: borrar el paquete en
el cliente no basta, porque quien tenga la máquina delante puede impedir que ese código llegue a
ejecutarse.

El bloqueo cierra la sesión entera, no solo el secreto. Dejar la sesión de Laravel viva mantiene al
usuario dentro del panel, con acceso a los datos en claro del resto de personas y a acciones destructivas
como reemitir un enlace, que es justo el riesgo del puesto compartido que motiva los quince minutos. Y la
caducidad la cuenta el servidor sobre la última petición autenticada: un temporizador en el navegador no
se ejecuta en una pestaña descartada por el sistema ni en una que nunca se abrió.

Volver a entrar es entonces una autenticación completa: la clave se deriva de la contraseña y no hay
atajo.

## Rationale

La alternativa era que el comando de consola generase la clave maestra del primer usuario en el servidor,
que es lo cómodo. Rompe el zero-knowledge para esa cuenta, porque el servidor tendría la clave en claro
aunque fuese un instante, y sobre todo sienta un precedente que alguien copiará para el siguiente caso que
parezca inofensivo. Que el comando emita un enlace cuesta lo mismo y deja un solo mecanismo sin
excepciones que explicar.

Quince minutos es un equilibrio entre un puesto compartido, donde el riesgo es que alguien se levante y
deje la sesión abierta, y el uso real de alguien que registra una glucemia, se distrae y vuelve. Es un
parámetro y se puede revisar con uso real, pero conviene que sea explícito y no lo que traiga por defecto
el framework.

* **Pros**: no existe ninguna ruta por la que el servidor toque una clave maestra; el registro público, la
  invitación y el primer usuario comparten el mismo nacimiento de la clave; el bloqueo por inactividad no
  deja datos descifrados retenidos en memoria; y el registro público permite que cualquiera empiece a usar
  la aplicación sin depender de que otra persona la invite.
* **Cons**: no se puede automatizar el alta masiva sin que cada persona pase por un navegador; el primer
  arranque exige un paso manual; quince minutos de inactividad obligan a teclear la contraseña, que con
  Argon2id no es instantáneo en un dispositivo lento; y el registro público confirma si un correo ya tiene
  cuenta, un oráculo de existencia que el resto del diseño evita a propósito.

El tiempo de vida de la sesión de Laravel deja de ser un parámetro suelto: si es mayor que el bloqueo, no
pasa nada mientras el bloqueo destruya el secreto, pero conviene revisarlos juntos y no dejar que uno
cambie sin mirar el otro.

## Consequences

**El enlace sirve para establecer la contraseña inicial, no para recuperarla.** Si se emite sobre una
cuenta que ya tiene datos, la persona podrá entrar con una contraseña nueva y **no podrá abrir nada de lo
anterior**, porque la clave maestra estaba envuelta bajo la clave derivada de la contraseña antigua. No es
un fallo, es la consecuencia directa de que no haya recuperación en esta versión, pero la interfaz tiene
que impedir que alguien lo use creyendo que ayuda: un administrador reseteando la contraseña de un usuario
le destruye el historial.

Por eso el sobre de la clave maestra es de solo añadir: emitir un enlace nunca sobrescribe el que existe,
se guarda uno nuevo y el anterior queda retirado con su fecha. Sin esa regla la reemisión destruye el
único criptograma que la contraseña antigua sabía abrir, y una pérdida que era recuperable para quien la
recordase deja de serlo. Emitir sobre una cuenta ya registrada exige confirmación explícita, y esa guardia
vive en el servicio que emite enlaces, no en cada interfaz que lo llama.

El cambio de contraseña de alguien que sí recuerda la actual es otra cosa y sí funciona: se abre la clave
maestra con la contraseña vieja y se vuelve a envolver con la nueva, sin tocar los datos. **Ese flujo está
implementado**, así que ante una contraseña comprometida o que se quiere rotar la vía correcta es el cambio
de contraseña, no la reemisión del enlace: el enlace solo queda para quien la ha olvidado del todo, con la
pérdida que describe el párrafo anterior.

El flujo son cuatro rutas bajo el prefijo `password` del panel (`reauth/start`, `reauth/finish`,
`registration/start` y `change`, en `PhrPanelProvider`), servidas por los controladores
`app/Http/Controllers/Auth/Opaque/PasswordChange*`: la reautenticación es un login OPAQUE completo contra
la contraseña actual —que además devuelve el sobre para abrir la clave maestra— y el registro rehace la
credencial con la nueva. La clave maestra no cambia, solo se reenvuelve, así que el historial se conserva
entero. Va con su propio limitador `opaque-password-change` (5/min por usuario, 30/min por IP), más
estricto que el de login porque cada intento cuesta un handshake completo, y lo cubre
`tests/Feature/PasswordChangeTest.php`.

El registro de actividad anota el alta de usuarios y el uso del enlace, sin contenido, como fija el
ADR 0006.

El bloqueo a los quince minutos tiene un efecto incómodo en la compartición con profesionales
(`docs/adr/0011-shared-clipping-for-professionals.md`): destruye la pantalla que muestra el enlace, el QR y
el PIN mientras la persona espera en la sala. No cambiamos el plazo por eso, se resuelve avisando de que
hay que anotar el PIN en el momento y recomendando generar el recorte antes de entrar en consulta.

El login normalizado queda fijo una vez la cuenta está registrada: el identificador de credencial se
derivó de él, cambiarlo dejaría el envelope irrecuperable y reintroduciría el oráculo de enumeración que
describe `docs/OPAQUE.md`. Ni consumir un enlace ni completar el registro público verifican el correo: el
primero lo entrega un administrador por el canal que sea, y el segundo lo escribe la propia persona sin que
nadie demuestre control del buzón, así que en ningún caso se marca nada como verificado. Y entrar al panel
exige únicamente tener el registro OPAQUE completo sobre una cuenta activa: cualquier criterio que dependa
de que otro usuario apruebe deja al primero sin quien lo apruebe.

El comando de Artisan no recibe ni pide contraseñas, y por tanto no hay riesgo de que queden en el
historial del intérprete de comandos ni en los registros del servidor.

**El nombre del usuario se guarda en claro.** El identificador de login ya está en claro por necesidad, así
que cifrar el nombre añade poca privacidad real y a cambio rompería el menú de usuario, los breadcrumbs y
el listado de administración de Filament, que los resuelven en servidor. Es una excepción consciente y
acotada a la regla general de cifrar, y no se extiende a ningún otro campo.

La otra excepción, con el mismo razonamiento y decidida después, es el idioma de la interfaz en
`users.locale`: el ADR 0007 (`docs/adr/0007-encrypted-user-configuration.md`) la documenta con su coste.

## Decision History

### 2026-07-26 — Se añade el registro público, sin invitación
Previamente decidido: no había registro público. Solo un usuario existente podía dar de alta a otro desde
el panel, o el primer usuario se creaba con el comando de consola; en ambos casos con un enlace de un solo
uso.
Cambió porque: se decidió abrir el registro directamente desde la pantalla de acceso, sin código de
invitación, para que cualquiera pueda crear su cuenta sin depender de que otra persona la invite. Esto
introduce un compromiso que no existía antes, el registro público revela si un correo ya tiene cuenta, y se
acepta de forma consciente porque sin decirlo la persona que se equivoca de correo no tiene forma de saber
qué hacer. Se mitiga con un límite de intentos por IP. Las dos vías anteriores, la invitación y el comando
de consola, siguen existiendo tal cual.
