<?php

declare(strict_types=1);

namespace App\Sharing;

use Illuminate\Support\Str;

/**
 * Identifier generated on the client for a clipping or a link (ADR 0011).
 *
 * It has to be a UUID**v4** and the version is checked, not just the shape. This is not fussiness:
 * the ADR rules out v7 for these identifiers because it carries the creation instant in the clear
 * inside itself, and these end up in the URL the person shows and in the photo of the QR code the
 * professional keeps in their camera roll. If the server only checked "looks like a UUID", a
 * careless client —or a future version of `HasUuids`, which in Laravel 12 already generates v7 by
 * default— would be enough to reintroduce that leak with nothing failing.
 */
final class ClientUuid
{
    private function __construct() {}

    public static function isValid(mixed $value): bool
    {
        /** Position 14 of the canonical `8-4-4-4-12` form: the version digit. */
        return is_string($value) && Str::isUuid($value) && $value[14] === '4';
    }
}
