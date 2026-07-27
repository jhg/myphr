<?php

declare(strict_types=1);

use App\Security\Opaque\LoginNormalizer;

/**
 * `normalize(login)` = `mb_strtolower(NFKC(trim(login)), 'UTF-8')`
 * (`docs/OPAQUE.md` §13.1.1).
 *
 * Each normalization axis (whitespace, capitals, Unicode form) has its own case:
 * if two of them differ between the lookup and the HMAC, an enumeration oracle
 * appears in two requests.
 */
it('trims, applies NFKC and lowercases', function (string $raw, string $expected): void {
    expect(LoginNormalizer::normalize($raw))->toBe($expected);
})->with([
    'espacios exteriores' => ["  alice@example.com\t\n", 'alice@example.com'],
    'capitals' => ['Alice@Example.COM', 'alice@example.com'],
    'accent with a capital' => ['ÁLVARO@example.com', 'álvaro@example.com'],
    'formas anchas (NFKC)' => ['ＡＬＩＣＥ@example.com', 'alice@example.com'],
    'ligadura (NFKC)' => ['ﬁnn@example.com', 'finn@example.com'],
    'already canonical' => ['alice@example.com', 'alice@example.com'],
]);

/** The result is idempotent: normalizing twice changes nothing. */
it('is idempotent', function (): void {
    $once = LoginNormalizer::normalize('  ÁLVARO@Example.COM ');

    expect(LoginNormalizer::normalize($once))->toBe($once);
});
