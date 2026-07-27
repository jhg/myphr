<?php

declare(strict_types=1);

/**
 * Guardrail: `server_identity` is a fixed deployment identifier, not a URL. If anyone ever made it
 * depend on `APP_URL` (or on the request host), changing domain —from `localhost` to `127.0.0.1`, or
 * from a test environment to production— would break the OPAQUE handshake preamble for every already
 * registered account: the client would keep sending the old identity, the server would compute a
 * different one, and login would stop working with no visible error to explain it. This test ties
 * that property to the code instead of leaving it in a comment.
 */
it('the OPAQUE server identity does not depend on the application domain', function (): void {
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
 * The same guardrail but from the real configuration file: `config/opaque.php` must not read
 * `app.url`, `APP_URL` or the request host when building `server_identity`. It is checked by
 * inspecting the file, because the runtime value comes straight from `env()` and would not reveal a
 * dependency introduced through a default value.
 */
it('config/opaque.php reads neither app.url nor the host when defining server_identity', function (): void {
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
