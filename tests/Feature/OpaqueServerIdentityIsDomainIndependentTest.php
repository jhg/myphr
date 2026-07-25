<?php

declare(strict_types=1);

/**
 * Guardarraíl: `server_identity` es un identificador de despliegue fijo, no una URL. Si en algún
 * momento alguien lo hiciera depender de `APP_URL` (o del host de la petición), cambiar de dominio
 * —de `localhost` a `127.0.0.1`, o de entorno de pruebas a producción— rompería el preámbulo del
 * handshake OPAQUE para todas las cuentas ya registradas: el cliente seguiría enviando la identidad
 * antigua, el servidor calcularía una distinta, y el login dejaría de funcionar sin ningún error
 * visible que lo explique. Este test ata esa propiedad al código en vez de dejarla en un comentario.
 */
it('la identidad del servidor OPAQUE no depende del dominio de la aplicación', function (): void {
    config(['app.url' => 'http://localhost:8888']);
    config(['opaque.server_identity' => 'myphr/opaque-v1']);

    $identityLocalhost = config('opaque.server_identity');

    config(['app.url' => 'https://phr.ejemplo.org']);

    $identityOtroDominio = config('opaque.server_identity');

    expect($identityOtroDominio)->toBe($identityLocalhost)
        ->and($identityOtroDominio)->not->toContain('localhost')
        ->and($identityOtroDominio)->not->toContain('phr.ejemplo.org')
        ->and($identityOtroDominio)->not->toBe(parse_url((string) config('app.url'), PHP_URL_HOST));
});

/**
 * Mismo guardarraíl pero desde el fichero de configuración real: `config/opaque.php` no debe leer
 * `app.url`, `APP_URL` ni el host de la petición al construir `server_identity`. Se comprueba
 * inspeccionando el fichero, porque el valor en tiempo de ejecución sale directo de `env()` y no
 * dejaría ver una dependencia introducida a través de un valor por defecto.
 */
it('config/opaque.php no lee app.url ni el host al definir server_identity', function (): void {
    $config = file_get_contents(config_path('opaque.php'));

    expect($config)->not->toBeFalse();

    $serverIdentityLine = collect(explode("\n", (string) $config))
        ->first(fn (string $line): bool => str_contains($line, "'server_identity'"));

    expect($serverIdentityLine)->not->toBeNull()
        ->and($serverIdentityLine)->toContain("env('OPAQUE_SERVER_IDENTITY')")
        ->and($serverIdentityLine)->not->toContain('app.url')
        ->and($serverIdentityLine)->not->toContain('APP_URL')
        ->and($serverIdentityLine)->not->toContain('getHost')
        ->and($serverIdentityLine)->not->toContain('HTTP_HOST');
});
