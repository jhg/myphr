<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * A ristretto255 group element or scalar was rejected
 * (RFC 9807 §10.7, `docs/OPAQUE.md` §7.1).
 *
 * A subtype of {@see InvalidMessageException} per the hierarchy in
 * `docs/OPAQUE.md` §18.
 */
final class InvalidPointException extends InvalidMessageException {}
