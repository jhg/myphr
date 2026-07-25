<?php

declare(strict_types=1);

/**
 * La raíz del sitio ya no sirve la página de bienvenida de fábrica de Laravel (inglés sin `__()` y
 * peldaños de rampa que DESIGN.md prohíbe): redirige al panel, que es toda la aplicación. Ver el
 * comentario de `routes/web.php`.
 */
test('the site root redirects to the panel', function () {
    $this->get('/')->assertRedirect('/phr');
});
