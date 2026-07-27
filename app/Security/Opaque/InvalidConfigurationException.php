<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * Server configuration missing, corrupt or out of range
 * (`docs/OPAQUE.md` §18, §12.2).
 *
 * This is a deployment fault or misuse of the library internally, not an error
 * you can blame on remote input: it must abort boot instead of being turned
 * into an authentication response.
 */
final class InvalidConfigurationException extends OpaqueException {}
