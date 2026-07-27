<?php

declare(strict_types=1);

use App\Crypto\EnvelopeValidator;
use App\Crypto\ShareEnvelopeValidator;

/**
 * ADR 0011: the package has its own validator, a sibling of and separate from the events one.
 */
function sharePackageOfSize(int $paddedSize): string
{
    $bytes = ShareEnvelopeValidator::HEADER_BYTES + ShareEnvelopeValidator::TAG_BYTES + $paddedSize;

    return ShareEnvelopeValidator::PREFIX.rtrim(strtr(base64_encode(random_bytes($bytes)), '+/', '-_'), '=');
}

it('accepts the four steps of its own ladder', function (int $paddedSize): void {
    expect(ShareEnvelopeValidator::isValid(sharePackageOfSize($paddedSize)))->toBeTrue();
})->with([
    '64 KiB' => 65536,
    '256 KiB' => 262144,
    '1 MiB' => 1048576,
    '4 MiB' => 4194304,
]);

it('rejects any size that is not a ladder step', function (): void {
    expect(ShareEnvelopeValidator::isValid(sharePackageOfSize(65535)))->toBeFalse()
        ->and(ShareEnvelopeValidator::isValid(sharePackageOfSize(65537)))->toBeFalse();
});

/**
 * The different prefix is what stops a package being slipped into the `payload` column of an event,
 * or the other way round. Both validators have to reject each other, or the guardrail is worthless.
 */
it('does not cross formats with the events validator', function (): void {
    $package = sharePackageOfSize(65536);
    $event = 'v1.'.rtrim(strtr(base64_encode(random_bytes(64 + 16 + 256)), '+/', '-_'), '=');

    expect(EnvelopeValidator::isValid($package))->toBeFalse()
        ->and(ShareEnvelopeValidator::isValid($event))->toBeFalse();
});

/**
 * The events ladder is not widened: if it were, it would stop bounding a single record, which is
 * exactly what it exists for (ADR 0004).
 */
it('leaves the events ladder untouched', function (): void {
    expect(EnvelopeValidator::SIZES)->toBe([
        64 + 16 + 256,
        64 + 16 + 1024,
        64 + 16 + 4096,
    ]);
});

it('rejects non-canonical base64url and values that are not strings', function (mixed $value): void {
    expect(ShareEnvelopeValidator::isValid($value))->toBeFalse();
})->with([
    'sin prefijo' => fn (): string => substr(sharePackageOfSize(65536), 3),
    'prefijo de evento' => fn (): string => 'v1.'.substr(sharePackageOfSize(65536), 3),
    'standard alphabet' => fn (): string => 's1.'.base64_encode(random_bytes(65536 + 80)),
    'empty' => '',
    'nulo' => null,
    'entero' => 42,
    'array' => [[]],
]);

/**
 * The size cap exists so the endpoint is not free anonymous hosting, and it comes from the largest
 * step: raising it means adding a step first, and not the other way round.
 */
it('bounds the transport length to the largest ladder step', function (): void {
    $largest = ShareEnvelopeValidator::HEADER_BYTES + ShareEnvelopeValidator::TAG_BYTES + 4194304;
    $expected = 3 + (int) ceil($largest / 3) * 4;

    expect(ShareEnvelopeValidator::maxTransportLength())->toBe($expected)
        ->and(ShareEnvelopeValidator::isValid('s1.'.str_repeat('A', $expected)))->toBeFalse();
});
