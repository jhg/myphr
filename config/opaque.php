<?php

declare(strict_types=1);

use App\Security\Opaque\OpaqueProfile;

/**
 * OPAQUE server configuration (`docs/OPAQUE.md` §12.2).
 *
 * Every binary value is stored as base64url without padding and validated at
 * boot by `App\Security\Opaque\ServerSetup::fromConfig()`: exact lengths
 * (64, 32, 192), canonical encoding and a canonical private scalar. The
 * secrets have no defaults: if they are missing, boot fails. Generate them
 * with `php artisan opaque:setup`.
 */
return [

    'profile' => env('OPAQUE_PROFILE', OpaqueProfile::NAME),

    /** `oprf_seed`, 64 bytes as base64url. */
    'oprf_seed' => env('OPAQUE_OPRF_SEED'),

    /** Server static scalar, 32 bytes as base64url. Never the seed. */
    'server_private_key' => env('OPAQUE_SERVER_PRIVATE_KEY'),

    /** Optional: copy of the public key, to check it against the derived one. */
    'server_public_key' => env('OPAQUE_SERVER_PUBLIC_KEY'),

    /** Fake registration record from §13.2, 192 bytes as base64url. */
    'fake_registration_record' => env('OPAQUE_FAKE_REGISTRATION_RECORD'),

    /** Must match the client's `identifiers.server` exactly. */
    'server_identity' => env('OPAQUE_SERVER_IDENTITY'),

    /** HMAC key for the `credential_identifier` (§13.1), 32 bytes as base64url. */
    'enumeration_key' => env('OPAQUE_ENUMERATION_KEY'),

    /** Preamble `context`; empty in this profile (§2, §11.5). */
    'context' => env('OPAQUE_CONTEXT', ''),

];
