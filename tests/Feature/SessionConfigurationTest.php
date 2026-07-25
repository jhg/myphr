<?php

declare(strict_types=1);

/**
 * Guardarraíl de configuración de
 * `docs/specs/0001-account-provisioning-and-session-bootstrap.md` §9.
 *
 * Con el driver `cookie` el contenido de la sesión viaja al navegador en cada
 * petición, y el navegador pasaría a tener las dos mitades de la clave maestra
 * a la vez (ADR 0003). El secreto de sesión vive dentro de la carga útil de la
 * sesión, así que el driver no es un detalle de despliegue.
 */
it('never uses the cookie session driver', function (): void {
    expect(config('session.driver'))->not->toBe('cookie');
});

it('keeps the cookie driver out of the environment files', function (): void {
    foreach (['.env', '.env.example'] as $file) {
        $contents = @file_get_contents(base_path($file));

        if ($contents === false) {
            continue;
        }

        expect($contents)->not->toContain('SESSION_DRIVER=cookie');
    }
});
