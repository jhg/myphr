# myphr

> MVP presentado a la hackathon de CubePath.

Una historia de salud personal (PHR) cifrada de extremo a extremo, construida con Laravel, Filament y
Livewire.

El servidor nunca ve la contraseña ni los datos clínicos en claro. La autenticación usa
[OPAQUE](https://www.rfc-editor.org/rfc/rfc9807.txt) (aPAKE, sin enviar la contraseña), y todos los datos
se cifran en el navegador con una clave maestra que el servidor nunca puede leer. El porqué de cada
decisión está en `docs/`, no aquí: este README es solo la puerta de entrada.

## Documentación

- [`docs/README.md`](docs/README.md): qué es un PHR, para qué sirve este proyecto y el vocabulario
  clínico (LOINC/SNOMED CT) que usa.
- [`docs/OPAQUE.md`](docs/OPAQUE.md): especificación completa de la autenticación por contraseña sin
  enviar la contraseña.
- [`docs/adr/`](docs/adr/): decisiones de arquitectura, con su contexto y sus renuncias. Se actualizan en
  el mismo archivo cuando la decisión evoluciona; nunca se sustituyen por uno nuevo.
- [`docs/specs/`](docs/specs/): detalle de implementación de cada funcionalidad, apoyado en esos ADR.

## Stack

- PHP 8.4, Laravel 13, Filament 5, Livewire 4.
- Cliente OPAQUE: [`@serenity-kit/opaque`](https://github.com/serenity-kit/opaque) (versión exacta,
  ver `docs/OPAQUE.md` §3).
- Pest 4 para tests (PHP y `arch()`), Vitest para los módulos JS de criptografía.
- Pint para formato de PHP.

## Puesta en marcha

```bash
composer setup
```

Esto instala dependencias PHP y JS, copia `.env`, genera la `APP_KEY`, migra la base de datos y compila
los assets. Después, antes de dar de alta a nadie, hace falta generar el material criptográfico estático
del servidor:

```bash
php artisan opaque:setup
```

El comando imprime por pantalla el par de claves OPAQUE y el resto de secretos estáticos; se copian a
mano a `.env`. No escribe el archivo por ti ni se puede ejecutar dos veces sin invalidar los registros
existentes.

Hay dos vías de alta (ADR 0009). Cualquiera puede registrarse desde `/phr/register`, y además se puede
emitir un enlace de un solo uso, que es la forma de dar de alta al primer usuario antes de que el panel
esté accesible:

```bash
php artisan phr:issue-registration-link correo@ejemplo.com --name="Nombre"
```

El enlace se muestra una sola vez en la terminal; la aplicación nunca lo envía por correo (ver
`docs/adr/0009-user-provisioning-and-session-lifecycle.md`). La persona lo abre, elige contraseña y su
clave maestra nace en ese momento en el navegador.

Para desarrollo local, con recarga de servidor, cola, logs y Vite en un solo proceso:

```bash
composer dev
```

## Tests

```bash
composer test
```

Ejecuta la suite de Pest completa, incluidos los vectores oficiales de RFC 9497/9807 y las pruebas de
arquitectura (sesión, propiedades `#[Url]`, payloads cifrados). Para los módulos JS de criptografía:

```bash
npm test
```

## Convenciones del proyecto

Las guías de código para agentes de IA (Laravel Boost, Pest, Filament, etc.) están en `CLAUDE.md` y
`.ai/`. Cualquier cambio de arquitectura, dominio o comportamiento que afecte a una decisión ya
documentada se refleja actualizando el ADR o la spec correspondiente, no creando uno nuevo que la
reemplace.

## Licencia

Este proyecto está liberado al dominio público bajo [The Unlicense](LICENSE). Puedes copiarlo,
modificarlo y usarlo para lo que quieras, con o sin ánimo de lucro, sin pedir permiso ni atribuir.

Con una salvedad que no es nuestra y que no podemos renunciar por ti: el vocabulario clínico del
catálogo procede de terceros con sus propias condiciones, y esas siguen en pie. Están recogidas en
[`NOTICE`](NOTICE) y razonadas en el
[ADR 0005](docs/adr/0005-clinical-vocabulary-loinc-snomed.md). LOINC, en concreto, exige mantener su
aviso de atribución.
