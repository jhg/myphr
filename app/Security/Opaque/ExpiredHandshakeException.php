<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * Login handshake expired by TTL or already consumed
 * (`docs/OPAQUE.md` §14.3, §18).
 *
 * Handshakes are single use; a second attempt on the same identifier raises
 * this exception.
 */
final class ExpiredHandshakeException extends OpaqueException {}
