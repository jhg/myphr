<?php

declare(strict_types=1);

namespace App\Sharing;

use RuntimeException;

/**
 * One of the ADR 0011 caps was hit: active clippings per user, or live links per clipping.
 *
 * The caps are not cosmetic. Without them, the endpoint that stores the package is free anonymous
 * hosting of up to 4 MiB per request for anyone with an account, and the storage cost of an account
 * stops being bounded.
 *
 * This error is explicit, unlike {@see InvalidShareLinkException}: the person who owns the data
 * receives it, in their own session, and they need to understand that they have to revoke something
 * before sharing again. There is nothing to hide from anyone here.
 */
final class ShareLimitExceededException extends RuntimeException
{
    public const string CODE = 'share_limit_reached';

    public static function tooManyShares(int $limit): self
    {
        return new self("No se pueden tener más de {$limit} recortes activos a la vez.");
    }

    public static function tooManyLinks(int $limit): self
    {
        return new self("No se pueden tener más de {$limit} enlaces vivos sobre el mismo recorte.");
    }
}
