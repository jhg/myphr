<?php

declare(strict_types=1);

namespace App\Security\Opaque;

use RuntimeException;

/**
 * Base exception of the OPAQUE-3DH implementation (RFC 9807).
 *
 * Every exception in the subsystem extends this one, so controllers can
 * collapse them into a single public response (`docs/OPAQUE.md` §18) without
 * letting an unhandled error escape.
 *
 * Not `final`: the §18 hierarchy relies on inheritance.
 */
class OpaqueException extends RuntimeException {}
