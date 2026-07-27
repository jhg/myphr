<?php

declare(strict_types=1);

namespace App\Sharing;

use App\Crypto\EnvelopeValidator;
use App\Models\ShareLink;
use App\Security\Opaque\Base64Url;
use App\Security\Opaque\InvalidMessageException;

/**
 * Reading and validating the `link` block that arrives in the body of the two routes that create
 * links (ADR 0011).
 *
 * It lives apart because both creating a clipping and re-arming a link need it, and a duplicated
 * validity criterion ends up drifting exactly in the half that gets tested least.
 *
 * Everything it validates is **shape**: that the identifier is a UUID, that the salt and the proof
 * are the right length and come in canonical base64url, and that the wrapper has the shape of a
 * `v1.` envelope. The content cannot be checked: `wrapper` is encrypted with a key derived from `S`,
 * which never reaches the server, and `pin_tag` is indistinguishable from 32 random bytes without
 * knowing the PIN, which is exactly the point.
 */
final class ShareLinkInput
{
    private function __construct() {}

    /**
     * @param  mixed  $input  The value under the `link` key of the body, without assuming it is an array.
     * @return array{id: string, pinSalt: string, pinTag: string, wrapper: string}|null Already
     *                                                                                  decoded bytes, or `null` if something does not validate.
     */
    public static function parse(mixed $input): ?array
    {
        if (! is_array($input)) {
            return null;
        }

        $id = $input['id'] ?? null;

        if (! ClientUuid::isValid($id)) {
            return null;
        }

        $salt = self::decodeExactly($input['pinSalt'] ?? null, ShareLink::PIN_SALT_BYTES);
        $tag = self::decodeExactly($input['pinTag'] ?? null, ShareLink::PIN_TAG_BYTES);
        $wrapper = $input['wrapper'] ?? null;

        if ($salt === null || $tag === null || ! EnvelopeValidator::isValid($wrapper)) {
            return null;
        }

        return [
            'id' => (string) $id,
            'pinSalt' => $salt,
            'pinTag' => $tag,
            'wrapper' => (string) $wrapper,
        ];
    }

    private static function decodeExactly(mixed $value, int $bytes): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        try {
            return Base64Url::decodeExactly($value, $bytes, 'share link');
        } catch (InvalidMessageException) {
            return null;
        }
    }
}
