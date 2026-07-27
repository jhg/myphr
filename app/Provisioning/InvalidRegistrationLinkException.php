<?php

declare(strict_types=1);

namespace App\Provisioning;

use RuntimeException;

/**
 * Registration link that does not exist, has expired or was already consumed
 * (`docs/OPAQUE.md` §13.3, Spec 0001 §7).
 *
 * The three cases share this exception and this message on purpose:
 * telling them apart reveals whether a token ever existed and what state it ended in.
 */
final class InvalidRegistrationLinkException extends RuntimeException
{
    /** A single message for all three cases. */
    public const MESSAGE = 'The registration link is not valid.';

    public static function generic(): self
    {
        return new self(self::MESSAGE);
    }
}
