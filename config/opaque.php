<?php

declare(strict_types=1);

use App\Security\Opaque\OpaqueProfile;

/**
 * Configuración del servidor OPAQUE (`docs/OPAQUE.md` §12.2).
 *
 * Todos los valores binarios se guardan en base64url sin padding y se validan
 * en el arranque con `App\Security\Opaque\ServerSetup::fromConfig()`:
 * longitudes exactas (64, 32, 192), canonicidad de la codificación y del
 * escalar privado. No hay valores por defecto para los secretos: si faltan, el
 * arranque falla. Se generan con `php artisan opaque:setup`.
 */
return [

    'profile' => env('OPAQUE_PROFILE', OpaqueProfile::NAME),

    /** `oprf_seed`, base64url de 64 bytes. */
    'oprf_seed' => env('OPAQUE_OPRF_SEED'),

    /** Escalar estático del servidor, base64url de 32 bytes. Nunca la semilla. */
    'server_private_key' => env('OPAQUE_SERVER_PRIVATE_KEY'),

    /** Opcional: copia de la clave pública para verificarla contra la derivada. */
    'server_public_key' => env('OPAQUE_SERVER_PUBLIC_KEY'),

    /** Registro ficticio de §13.2, base64url de 192 bytes. */
    'fake_registration_record' => env('OPAQUE_FAKE_REGISTRATION_RECORD'),

    /** Debe coincidir exactamente con `identifiers.server` del cliente. */
    'server_identity' => env('OPAQUE_SERVER_IDENTITY'),

    /** Clave del HMAC del `credential_identifier` (§13.1), base64url de 32 bytes. */
    'enumeration_key' => env('OPAQUE_ENUMERATION_KEY'),

    /** `context` del preamble; vacío en este perfil (§2, §11.5). */
    'context' => env('OPAQUE_CONTEXT', ''),

];
