<?php

declare(strict_types=1);

namespace App\Sharing;

/**
 * Closed list of clipping expiries (ADR 0011): 24 hours by default, 7 days at most and one hour for
 * in-person use.
 *
 * The server does not choose it. The exact expiry goes into the `wrapKey` derivation and into the
 * wrapper's associated data (`canonicalDate(expiresAt)`), so the client has to know it **before**
 * encrypting and therefore before sending anything. What the server can do, and does, is check that
 * the instant it received corresponds to one of these three options.
 *
 * That check allows a tolerance because between the client fixing `expiresAt` and the request
 * arriving there is the Argon2id of the PIN, which on a slow machine is several seconds, plus the
 * package upload. Requiring equality to the second would turn an old laptop into a validation error.
 */
enum ShareTtl: string
{
    /** In-person use: you show the screen during the consultation and that is it. */
    case Hour = '1h';

    /** Por defecto. */
    case Day = '24h';

    /** Maximum. */
    case Week = '7d';

    /**
     * Slack allowed when checking `expiresAt` against the list, in minutes.
     *
     * Fifteen minutes comfortably cover the Argon2id of the PIN on a slow machine plus the upload of
     * a large package, and are still negligible next to the shortest TTL.
     */
    public const int TOLERANCE_MINUTES = 15;

    public function hours(): int
    {
        return match ($this) {
            self::Hour => 1,
            self::Day => 24,
            self::Week => 24 * 7,
        };
    }
}
