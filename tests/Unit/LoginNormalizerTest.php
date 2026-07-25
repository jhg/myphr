<?php

declare(strict_types=1);

use App\Security\Opaque\LoginNormalizer;

/**
 * `normalize(login)` = `mb_strtolower(NFKC(trim(login)), 'UTF-8')`
 * (`docs/OPAQUE.md` §13.1.1).
 *
 * Cada eje de normalización (espacios, mayúsculas, forma Unicode) tiene su caso:
 * si dos de ellos difieren entre la búsqueda y el HMAC aparece un oráculo de
 * enumeración en dos peticiones.
 */
it('recorta, pasa a NFKC y baja a minúsculas', function (string $raw, string $expected): void {
    expect(LoginNormalizer::normalize($raw))->toBe($expected);
})->with([
    'espacios exteriores' => ["  alice@example.com\t\n", 'alice@example.com'],
    'mayúsculas' => ['Alice@Example.COM', 'alice@example.com'],
    'acento con mayúscula' => ['ÁLVARO@example.com', 'álvaro@example.com'],
    'formas anchas (NFKC)' => ['ＡＬＩＣＥ@example.com', 'alice@example.com'],
    'ligadura (NFKC)' => ['ﬁnn@example.com', 'finn@example.com'],
    'ya canónico' => ['alice@example.com', 'alice@example.com'],
]);

/** El resultado es idempotente: normalizar dos veces no cambia nada. */
it('es idempotente', function (): void {
    $once = LoginNormalizer::normalize('  ÁLVARO@Example.COM ');

    expect(LoginNormalizer::normalize($once))->toBe($once);
});
