<?php

declare(strict_types=1);

use App\Crypto\EnvelopeValidator;
use App\Crypto\ShareEnvelopeValidator;

/**
 * ADR 0011: el paquete tiene su propio validador, hermano y separado del de los eventos.
 */
function sharePackageOfSize(int $paddedSize): string
{
    $bytes = ShareEnvelopeValidator::HEADER_BYTES + ShareEnvelopeValidator::TAG_BYTES + $paddedSize;

    return ShareEnvelopeValidator::PREFIX.rtrim(strtr(base64_encode(random_bytes($bytes)), '+/', '-_'), '=');
}

it('acepta los cuatro escalones de la escalera propia', function (int $paddedSize): void {
    expect(ShareEnvelopeValidator::isValid(sharePackageOfSize($paddedSize)))->toBeTrue();
})->with([
    '64 KiB' => 65536,
    '256 KiB' => 262144,
    '1 MiB' => 1048576,
    '4 MiB' => 4194304,
]);

it('rechaza cualquier tamaño que no sea un escalón', function (): void {
    expect(ShareEnvelopeValidator::isValid(sharePackageOfSize(65535)))->toBeFalse()
        ->and(ShareEnvelopeValidator::isValid(sharePackageOfSize(65537)))->toBeFalse();
});

/**
 * El prefijo distinto es lo que impide colar un paquete en la columna `payload` de un evento, o al
 * revés. Los dos validadores tienen que rechazarse mutuamente, o el guardarraíl no sirve de nada.
 */
it('no cruza formatos con el validador de eventos', function (): void {
    $package = sharePackageOfSize(65536);
    $event = 'v1.'.rtrim(strtr(base64_encode(random_bytes(64 + 16 + 256)), '+/', '-_'), '=');

    expect(EnvelopeValidator::isValid($package))->toBeFalse()
        ->and(ShareEnvelopeValidator::isValid($event))->toBeFalse();
});

/**
 * La escalera de los eventos no se amplía: si lo hiciera, dejaría de acotar un registro suelto, que
 * es justamente para lo que existe (ADR 0004).
 */
it('deja intacta la escalera de los eventos', function (): void {
    expect(EnvelopeValidator::SIZES)->toBe([
        64 + 16 + 256,
        64 + 16 + 1024,
        64 + 16 + 4096,
    ]);
});

it('rechaza base64url no canónico y cadenas que no son cadenas', function (mixed $value): void {
    expect(ShareEnvelopeValidator::isValid($value))->toBeFalse();
})->with([
    'sin prefijo' => fn (): string => substr(sharePackageOfSize(65536), 3),
    'prefijo de evento' => fn (): string => 'v1.'.substr(sharePackageOfSize(65536), 3),
    'alfabeto estándar' => fn (): string => 's1.'.base64_encode(random_bytes(65536 + 80)),
    'vacío' => '',
    'nulo' => null,
    'entero' => 42,
    'array' => [[]],
]);

/**
 * El tope de tamaño existe para que el endpoint no sea alojamiento anónimo gratuito, y sale del
 * escalón mayor: subirlo obliga a añadir antes un escalón, y no al revés.
 */
it('acota la longitud de transporte al mayor escalón', function (): void {
    $largest = ShareEnvelopeValidator::HEADER_BYTES + ShareEnvelopeValidator::TAG_BYTES + 4194304;
    $expected = 3 + (int) ceil($largest / 3) * 4;

    expect(ShareEnvelopeValidator::maxTransportLength())->toBe($expected)
        ->and(ShareEnvelopeValidator::isValid('s1.'.str_repeat('A', $expected)))->toBeFalse();
});
