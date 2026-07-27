<?php

declare(strict_types=1);

namespace App\Crypto;

use Carbon\CarbonImmutable;
use DateTimeInterface;
use Exception;

/**
 * Canonical date format from ADR 0004: `YYYY-MM-DDTHH:MM:SS.ffffffZ`, always UTC, `Z` suffix, six
 * fraction digits zero-padded.
 *
 * This is not presentation formatting: these dates go into the AEAD associated data and into the
 * `info` of the key derivation, so a different variant of the same date is different bytes and
 * produces an envelope that will not decrypt. Plain ISO 8601 is not enough, because it allows
 * several forms of the same instant, and the project's own tools produce three incompatible ones.
 *
 * It lives in a single place because a second date criterion would be a second place to get it
 * wrong: both the `occurred_at` of events (ADR 0006) and the `expiresAt` of shared clippings
 * (ADR 0011) use it, and whichever one drifted would be exactly the one taking part in an AEAD.
 */
final class CanonicalDate
{
    public const string FORMAT = 'Y-m-d\TH:i:s.u\Z';

    /** The exact accepted form. It is checked before parsing, because Carbon is too permissive. */
    public const string REGEX = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/';

    private function __construct() {}

    /**
     * Parses a canonical date, or returns `null` if it is not one.
     *
     * The check is a round trip: on top of the pattern, the result is formatted again and must equal
     * the input. Without that, Carbon accepts things like 31 February and silently shifts them to
     * 3 March, so the server would store a date different from the one the client encrypted with.
     */
    public static function parse(mixed $value): ?CarbonImmutable
    {
        if (! is_string($value) || preg_match(self::REGEX, $value) !== 1) {
            return null;
        }

        try {
            $date = CarbonImmutable::createFromFormat(self::FORMAT, $value, 'UTC');
        } catch (Exception) {
            return null;
        }

        if (! $date instanceof CarbonImmutable || self::format($date) !== $value) {
            return null;
        }

        return $date;
    }

    public static function format(DateTimeInterface $date): string
    {
        return CarbonImmutable::instance($date)->utc()->format(self::FORMAT);
    }
}
