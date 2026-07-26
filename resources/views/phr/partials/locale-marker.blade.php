{{--
    Idioma en vigor para esta petición, puesto donde el cliente pueda releerlo tras cada navegación.

    El `lang` del `<html>` sirve para la primera carga y para los lectores de pantalla, pero Livewire
    navega sin recargar y **no reemplaza los atributos del `<html>`**: el `<body>` sí. Así que un
    idioma leído solo de ahí se queda congelado en el que hubiera al abrir la pestaña, y basta con
    entrar por una pantalla sin sesión —donde el idioma sale de `Accept-Language`— para que todo lo
    que pinta JavaScript se quede en ese idioma mientras Blade ya renderiza en el de la cuenta.

    Va con el nombre de Laravel (`zh_CN`), no con la etiqueta BCP 47 del atributo `lang` (`zh-CN`);
    `resolveLocale()` admite las dos, pero aquí no hay motivo para transformar nada.
--}}
<div data-phr-locale="{{ app()->getLocale() }}" hidden></div>
