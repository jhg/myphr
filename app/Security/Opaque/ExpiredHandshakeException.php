<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * Handshake de login caducado por TTL o ya consumido
 * (`docs/OPAQUE.md` §14.3, §18).
 *
 * Los handshakes son de un solo uso; un segundo intento sobre el mismo
 * identificador produce esta excepción.
 */
final class ExpiredHandshakeException extends OpaqueException {}
