<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * Un elemento de grupo o un escalar ristretto255 ha sido rechazado
 * (RFC 9807 §10.7, `docs/OPAQUE.md` §7.1).
 *
 * Subtipo de {@see InvalidMessageException} según la jerarquía de
 * `docs/OPAQUE.md` §18.
 */
final class InvalidPointException extends InvalidMessageException {}
