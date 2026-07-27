<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * Parsing, Base64url, length or structure error in a protocol message
 * (`docs/OPAQUE.md` §18).
 *
 * Not `final`: {@see InvalidPointException} extends it.
 */
class InvalidMessageException extends OpaqueException {}
