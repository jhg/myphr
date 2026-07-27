<?php

declare(strict_types=1);

namespace App\Crypto;

use App\Security\Opaque\Base64Url;
use App\Security\Opaque\InvalidMessageException;

/**
 * Validation of the **wrapper** of an ADR 0004 encrypted envelope (Spec 0001 §10).
 *
 * It checks three things and nothing else: the `v1.` prefix, canonical base64url and an allowed
 * size. **Never** the content: the server has no key, so any further check would be a claim it
 * cannot back.
 *
 * The size is one of the three combinations `resources/js/crypto/envelope.js` produces: header
 * (64 bytes) + Poly1305 tag (16) + one of the fixed padding sizes (256, 1024, 4096). Rejecting any
 * other size avoids storing as an envelope something the client will never be able to open.
 */
final class EnvelopeValidator
{
    /** ADR 0004 transport prefix, also checked by the client-side guardrail. */
    public const string PREFIX = 'v1.';

    /** Header: version, algorithm, KDF, flags, key identifier, salt and nonce. */
    public const int HEADER_BYTES = 64;

    /** Tag del AEAD. */
    public const int TAG_BYTES = 16;

    /**
     * Accepted full binary sizes: header + tag + fixed padding size.
     *
     * @var list<int>
     */
    public const array SIZES = [
        self::HEADER_BYTES + self::TAG_BYTES + 256,
        self::HEADER_BYTES + self::TAG_BYTES + 1024,
        self::HEADER_BYTES + self::TAG_BYTES + 4096,
    ];

    private function __construct() {}

    /**
     * @param  mixed  $envelope  Value received from the client, with no assumption about its type.
     */
    public static function isValid(mixed $envelope): bool
    {
        if (! is_string($envelope) || ! str_starts_with($envelope, self::PREFIX)) {
            return false;
        }

        try {
            $decoded = Base64Url::decode(substr($envelope, strlen(self::PREFIX)), 'envelope');
        } catch (InvalidMessageException) {
            return false;
        }

        return in_array(strlen($decoded), self::SIZES, true);
    }
}
