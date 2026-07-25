<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * `ClientAuthenticationError` de RFC 9807 §9.3: el `client_mac` recibido en
 * KE3 no coincide con el `expected_client_mac` calculado por el servidor.
 *
 * Se lanza tras una comparación en tiempo constante
 * (`docs/OPAQUE.md` §11.8, §19).
 */
final class AuthenticationFailedException extends OpaqueException {}
