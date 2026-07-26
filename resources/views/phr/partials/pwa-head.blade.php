{{--
    Etiquetas para poder instalar el panel en la pantalla de inicio y abrirlo como aplicación.

    El manifiesto y los iconos son ficheros estáticos de `public/`, sin plantilla ni ruta: no
    dependen del idioma ni del usuario, y así los sirve el servidor web sin pasar por PHP.

    Las rutas son **absolutas y sin dominio** a propósito. El proyecto garantiza que cambiar de
    dominio no rompe nada (docs/adr/0003), y una URL absoluta con host aquí ataría la aplicación
    instalada al dominio con el que se instaló.

    Las tres etiquetas `apple-*` existen porque iOS no lee el manifiesto: hasta Safari 17 el icono
    de la pantalla de inicio y el arranque a pantalla completa salen únicamente de aquí.
--}}
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0077B6">

<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="myphr">
{{--
    `black-translucent` haría que el contenido subiera por debajo de la barra de estado. Con
    `default`, la barra conserva su fondo y la cabecera del panel no queda tapada.
--}}
<meta name="apple-mobile-web-app-status-bar-style" content="default">
