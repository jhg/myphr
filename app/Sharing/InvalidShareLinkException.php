<?php

declare(strict_types=1);

namespace App\Sharing;

use RuntimeException;

/**
 * The **single generic** error of reading a clipping (ADR 0011).
 *
 * There is exactly one possible instance, with no variants and no internal codes, so there is no
 * temptation to let the cause escape. The four causes —the link does not exist, expired, was
 * revoked, or the PIN is wrong— have to produce the same response byte for byte: if they differ,
 * anyone with a list of identifiers can work out which ones are still alive, and anyone trying PINs
 * knows when they have hit a real link.
 *
 * That is why this class has no constructor with a message: any detail somebody added here would
 * end up in the response body.
 */
final class InvalidShareLinkException extends RuntimeException
{
    /** Code that reaches the client. Just one, and deliberately silent about what failed. */
    public const string CODE = 'invalid_link_or_pin';

    public static function generic(): self
    {
        return new self('The link does not exist, expired, was revoked, or the PIN is wrong.');
    }
}
