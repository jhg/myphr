<?php

declare(strict_types=1);

namespace App\Crypto;

use App\Security\Opaque\Base64Url;
use App\Security\Opaque\InvalidMessageException;

/**
 * Validation of the wrapper of the ADR 0011 **sharing package**.
 *
 * It is the sibling of {@see EnvelopeValidator} and lives apart on purpose. Extending that one with
 * these sizes would stop it from bounding individual events: its three steps (256, 1024, 4096 bytes)
 * are what stops anyone classifying an event by its length, and allowing 4 MiB as well would make
 * them decorative. That is why ADR 0004 records this exception and ADR 0011 asks for a separate
 * validator.
 *
 * Three differences from the events one, and no more:
 *
 * 1. **The `s1.` transport prefix** instead of `v1.`. It is not cosmetic: it stops a package being
 *    slipped into the `payload` column of an event, or the other way round, because each validator
 *    demands its own. As an intended side effect, the two ADR 0002 guardrails
 *    (`livewirePayloadGuard.js` and `EncryptedPayloadGuardHook`) abort on any long string that does
 *    not start with `v1.`, so a package trying to travel over Livewire would die at both ends. The
 *    package is uploaded through its own HTTP endpoint, which is the route ADR 0002 itself reserves
 *    for large blobs.
 * 2. **Its own padding ladder**: 64 KiB, 256 KiB, 1 MiB and 4 MiB. The high floor does the work:
 *    almost every real clipping compresses to under 64 KiB and they are indistinguishable from one
 *    another, so the server cannot subtract two deliveries of the same range to isolate the weight
 *    of one type.
 * 3. Everything else is identical: the same 64-byte header, the same 16-byte tag, canonical
 *    base64url.
 *
 * And like there, it **never** validates the content: the server has no `CK`, so any further check
 * would be a claim it cannot back.
 */
final class ShareEnvelopeValidator
{
    /** Transport prefix of the package. Different from the `v1.` of events by design. */
    public const string PREFIX = 's1.';

    /** Same header as the ADR 0004 envelope: version, algorithm, KDF, flags, key id, salt and nonce. */
    public const int HEADER_BYTES = EnvelopeValidator::HEADER_BYTES;

    /** Tag del AEAD. */
    public const int TAG_BYTES = EnvelopeValidator::TAG_BYTES;

    /**
     * Escalones de relleno del ADR 0011, en bytes de contenido rellenado.
     *
     * @var list<int>
     */
    public const array PADDED_SIZES = [
        65536,     // 64 KiB
        262144,    // 256 KiB
        1048576,   // 1 MiB
        4194304,   // 4 MiB
    ];

    private function __construct() {}

    /**
     * Accepted full binary sizes: header + tag + padding step.
     *
     * @return list<int>
     */
    public static function sizes(): array
    {
        return array_map(
            static fn (int $padded): int => self::HEADER_BYTES + self::TAG_BYTES + $padded,
            self::PADDED_SIZES,
        );
    }

    /**
     * Maximum length of the transport string, to bound the request body **before** decoding
     * anything.
     *
     * It is the per-package size cap ADR 0011 requires: without it, the endpoint is free anonymous
     * hosting. It comes from the largest step of the ladder, so raising the cap means adding a step
     * first, and not the other way round.
     */
    public static function maxTransportLength(): int
    {
        $largest = self::HEADER_BYTES + self::TAG_BYTES + self::PADDED_SIZES[count(self::PADDED_SIZES) - 1];

        return strlen(self::PREFIX) + (int) ceil($largest / 3) * 4;
    }

    /**
     * @param  mixed  $envelope  Value received from the client, with no assumption about its type.
     */
    public static function isValid(mixed $envelope): bool
    {
        if (! is_string($envelope) || ! str_starts_with($envelope, self::PREFIX)) {
            return false;
        }

        if (strlen($envelope) > self::maxTransportLength()) {
            return false;
        }

        try {
            $decoded = Base64Url::decode(substr($envelope, strlen(self::PREFIX)), 'share package');
        } catch (InvalidMessageException) {
            return false;
        }

        return in_array(strlen($decoded), self::sizes(), true);
    }
}
