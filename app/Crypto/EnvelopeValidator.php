<?php

declare(strict_types=1);

namespace App\Crypto;

use App\Security\Opaque\Base64Url;
use App\Security\Opaque\InvalidMessageException;

/**
 * Validación del **envoltorio** de un sobre cifrado del ADR 0004 (Spec 0001 §10).
 *
 * Comprueba tres cosas y ninguna más: prefijo `v1.`, base64url canónico y tamaño permitido.
 * **Nunca** su contenido: el servidor no tiene la clave, así que cualquier comprobación adicional
 * sería una afirmación que no puede sostener.
 *
 * El tamaño es una de las tres combinaciones que produce `resources/js/crypto/envelope.js`:
 * cabecera (64 bytes) + tag Poly1305 (16) + uno de los tamaños fijos de relleno (256, 1024, 4096).
 * Rechazar cualquier otro tamaño evita almacenar como sobre algo que el cliente nunca podrá abrir.
 */
final class EnvelopeValidator
{
    /** Prefijo de transporte del ADR 0004, comprobado también por el guardarraíl del cliente. */
    public const string PREFIX = 'v1.';

    /** Cabecera: versión, algoritmo, KDF, banderas, identificador de clave, sal y nonce. */
    public const int HEADER_BYTES = 64;

    /** Tag del AEAD. */
    public const int TAG_BYTES = 16;

    /**
     * Tamaños binarios completos admitidos: cabecera + tag + tamaño fijo de relleno.
     *
     * @var list<int>
     */
    public const array SIZES = [
        self::HEADER_BYTES + self::TAG_BYTES + 256,
        self::HEADER_BYTES + self::TAG_BYTES + 1024,
        self::HEADER_BYTES + self::TAG_BYTES + 4096,
    ];

    private function __construct() {}

    /**
     * @param  mixed  $envelope  Valor recibido del cliente, sin ninguna suposición sobre su tipo.
     */
    public static function isValid(mixed $envelope): bool
    {
        if (! is_string($envelope) || ! str_starts_with($envelope, self::PREFIX)) {
            return false;
        }

        try {
            $decoded = Base64Url::decode(substr($envelope, strlen(self::PREFIX)), 'envelope');
        } catch (InvalidMessageException) {
            return false;
        }

        return in_array(strlen($decoded), self::SIZES, true);
    }
}
