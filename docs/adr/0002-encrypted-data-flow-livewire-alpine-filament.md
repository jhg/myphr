# ADR 0002: Flujo de datos cifrados entre Livewire, Alpine y Filament

* **Status**: Accepted
* **Date**: 2026-07-25
* **Decider**: Development Team

## Context

El ADR 0001 fijó el stack y dejó una regla: el dato en claro y las claves no entran en el estado de
Livewire, el ciphertext sí. Falta decidir cómo circula ese ciphertext en la práctica, por dónde baja del
servidor, por dónde sube, dónde se descifra sin que el re-render lo borre, y qué hacemos con Filament,
que da por hecho que puede buscar y ordenar en SQL.

Investigamos el código de Livewire 4 y Filament 5 instalados en `vendor/`, no la documentación.
Tres hallazgos condicionan la decisión.

El morph del DOM sobrescribe el texto que Alpine haya escrito, y el efecto de Alpine no se vuelve a
ejecutar, así que el dato descifrado desaparece sin error. Un `@island` no se re-renderiza por defecto:
el servidor emite un fragmento vacío y el morph salta la región entera.

El snapshot del componente sube y baja completo en cada petición, y Livewire le calcula el HMAC dos
veces. En cambio, los parámetros de método y los valores de retorno viajan fuera del snapshot.

Cualquier escritura sobre el estado desde el cliente llega al servidor en la siguiente petición, venga de
donde venga esa petición. Eso incluye `$entangle` y todas las variantes de `wire:model`, cuyo modificador
`live` solo retrasa la llamada de red, no la escritura en el estado.

## Decision

El ciphertext baja como valor de retorno de un método del componente y sube como parámetro de otro. No
vive en propiedades públicas. En el snapshot solo quedan identificadores y metadatos no sensibles.

La región descifrada se envuelve en un `@island` y lleva `wire:ignore` dentro, con un `wire:key` estable
derivado del id del registro. Las acciones que disparan peticiones van fuera del island, porque una
acción lanzada desde dentro se asocia a ese island y lo vuelve a renderizar, lo que borraría el dato
descifrado. El campo de entrada no lleva `wire:model`: Alpine lo lee del DOM y cifra antes de llamar al
componente.

La clave maestra en uso vive en el scope de un módulo ES, nunca en `x-data`. Sobrevive a `wire:navigate`,
que solo sustituye el body, y los redirects dentro del área autenticada usan `navigate: true` para no
provocar una recarga. Cómo sobrevive a una carga de página completa, que el `navigate` no siempre puede
evitar, se decide en el ADR 0003 (`docs/adr/0003-master-key-survival-in-browser.md`).

La frontera con Filament queda así: Filament se ocupa del panel, la navegación, las políticas, las
acciones y el CRUD de las columnas en claro. Las vistas que muestran datos cifrados son componentes
Livewire propios. Dentro de Filament solo usamos campos y columnas propios cuando el registro mezcla
datos en claro y cifrados y separar la pantalla saldría peor.

El servidor valida la envoltura y la autorización, nunca el contenido: formato del sobre, tamaño máximo,
codificación y permisos. La validación de contenido pasa a ser ayuda de interfaz en el cliente, sin
garantía de integridad.

Para la primera versión no hay búsqueda sobre datos cifrados, y el buscador global del panel queda
desactivado desde el principio.

## Rationale

Sacar el ciphertext del snapshot no es una optimización, es lo que hace estructuralmente imposible que un
descuido lo persista en el estado. Además el coste era real: con cuatro campos de 50 KB, el snapshot
mueve del orden de medio megabyte por interacción contra un techo de 1 MB por petición, y el HMAC se
recalcula sobre todo el blob dos veces.

Consideramos tres alternativas. Guardar el ciphertext en propiedades públicas es la opción más directa y
la que primero se nos ocurrió, pero paga ese coste en cada viaje y deja el ciphertext expuesto a que
alguien lo confunda con estado normal. Usar campos custom de Filament con `$entangle` funciona, porque lo
que se entangla es ciphertext y el ciphertext está destinado a ir al servidor, pero el estado de un campo
Filament son propiedades públicas, así que hereda el mismo coste; lo reservamos para pantallas mixtas.
Sacar los datos por un endpoint HTTP propio, fuera de Livewire, es lo más eficiente para blobs grandes y
lo dejamos para adjuntos, no para el flujo general.

Sobre la búsqueda, descartamos hacerla en cliente sobre una tabla paginada: Filament pagina en SQL, así
que solo se buscaría dentro de la página visible y el resultado sería una mentira de interfaz. Un índice
ciego permitiría igualdad exacta en servidor, pero filtra el histograma de frecuencias de la columna, que
en datos clínicos es justo lo que hay que proteger. Prescindir de la búsqueda en la primera versión deja
el sistema con la propiedad de privacidad más fuerte y no cierra ninguna puerta.

* **Pros**: el snapshot queda en unos cientos de bytes; el dato en claro no puede persistirse por
  descuido; Filament conserva el panel, las políticas, las acciones y el CRUD en claro; el servidor sigue
  siendo la autoridad en autorización.
* **Cons**: hay que escribir componentes propios para cada vista con datos cifrados; la validación de
  contenido deja de ser una garantía; se pierden búsqueda, ordenación, agregados, exportación y cualquier
  render de contenido en servidor; y recargar la página obliga a re-autenticarse.

## Consequences

Añadimos dos guardarraíles, porque las formas de romper esto no fallan a la vista. En el cliente, un
interceptor de peticiones de Livewire revisa lo que sale y aborta si encuentra un valor largo que no
lleve el prefijo del sobre cifrado. En el servidor, un listener sobre la actualización de propiedades
rechaza lo mismo. Los dos se acompañan de un test que comprueba que ninguna propiedad pública del
snapshot contiene algo que no sea metadato o sobre cifrado.

Quedan prohibidos en componentes que manejan datos cifrados: `wire:model` en cualquier variante,
`$entangle` sobre datos en claro, `$persist` de Alpine, `wire:replace`, los islands con `always`, y las
propiedades expuestas en la URL.

Esa última prohibición no basta con cumplirla en lo nuestro: las páginas de Filament traen de serie seis
propiedades que publican en la barra de direcciones la acción abierta y sus argumentos, y un identificador
de evento ahí ya es metadato clínico. La página base de la que heredan nuestras pantallas las redeclara sin
ese comportamiento, con un test que falla si alguna vuelve a aparecer.

La subida de adjuntos no puede usar `wire:model` en el input de fichero,
que enviaría el fichero original, y el nombre del fichero se sustituye por uno opaco antes de subirlo
porque el nombre es dato clínico.

Los recursos de Filament con contenido cifrado no definen atributo de título, para que los breadcrumbs y
los modales de borrado no muestren ciphertext. Las exportaciones e importaciones del panel se retiran:
corren en cola, sin navegador y sin clave.

Dos cosas que esta decisión asume y que siguen sin resolver. La clave se deriva por usuario, así que hoy
el titular no puede compartir un registro con un profesional, y compartir es la razón de ser de un PHR. Y
si un usuario pierde la contraseña, sus datos son irrecuperables mientras no exista un mecanismo de
escrow.
Ambas condicionan el esquema de claves y conviene cerrarlas antes de escribir los primeros componentes.
