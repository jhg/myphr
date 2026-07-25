<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * Error de parseo, Base64url, longitud o estructura en un mensaje del
 * protocolo (`docs/OPAQUE.md` §18).
 *
 * No es `final`: {@see InvalidPointException} deriva de ella.
 */
class InvalidMessageException extends OpaqueException {}
