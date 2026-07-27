<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * `ClientAuthenticationError` from RFC 9807 §9.3: the `client_mac` received in
 * KE3 does not match the `expected_client_mac` the server computed.
 *
 * It is thrown after a constant-time comparison
 * (`docs/OPAQUE.md` §11.8, §19).
 */
final class AuthenticationFailedException extends OpaqueException {}
