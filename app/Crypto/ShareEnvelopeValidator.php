<?php

declare(strict_types=1);

namespace App\Crypto;

use App\Security\Opaque\Base64Url;
use App\Security\Opaque\InvalidMessageException;

/**
 * Validación del envoltorio del **paquete de compartición** del ADR 0011.
 *
 * Es el hermano de {@see EnvelopeValidator} y vive aparte a propósito. Ampliar aquel con estos
 * tamaños dejaría de acotar los eventos sueltos: sus tres escalones (256, 1024, 4096 bytes) son lo
 * que impide clasificar un evento por su longitud, y admitir además 4 MiB los volvería decorativos.
 * Por eso el ADR 0004 recoge esta excepción y el ADR 0011 pide un validador separado.
 *
 * Tres diferencias con el de los eventos, y ninguna más:
 *
 * 1. **Prefijo de transporte `s1.`** en lugar de `v1.`. No es cosmética: impide colar un paquete en
 *    la columna `payload` de un evento, o al revés, porque cada validador exige el suyo. Como efecto
 *    colateral buscado, los dos guardarraíles del ADR 0002 (`livewirePayloadGuard.js` y
 *    `EncryptedPayloadGuardHook`) abortan cualquier cadena larga que no empiece por `v1.`, así que
 *    un paquete que intentase viajar por Livewire moriría en los dos extremos. El paquete sube por
 *    un endpoint HTTP propio, que es la vía que el propio ADR 0002 reserva para los blobs grandes.
 * 2. **Escalera de relleno propia**: 64 KiB, 256 KiB, 1 MiB y 4 MiB. El suelo alto es lo que hace el
 *    trabajo: casi todos los recortes reales caen comprimidos dentro de 64 KiB y son indistinguibles
 *    entre sí, así que el servidor no puede restar dos envíos del mismo rango para aislar el peso de
 *    un tipo.
 * 3. Todo lo demás es idéntico: misma cabecera de 64 bytes, mismo tag de 16, base64url canónico.
 *
 * Y como allí, **nunca** valida el contenido: el servidor no tiene `CK`, así que cualquier
 * comprobación adicional sería una afirmación que no puede sostener.
 */
final class ShareEnvelopeValidator
{
    /** Prefijo de transporte del paquete. Distinto del `v1.` de los eventos por diseño. */
    public const string PREFIX = 's1.';

    /** Misma cabecera que el sobre del ADR 0004: versión, algoritmo, KDF, banderas, id de clave, sal y nonce. */
    public const int HEADER_BYTES = EnvelopeValidator::HEADER_BYTES;

    /** Tag del AEAD. */
    public const int TAG_BYTES = EnvelopeValidator::TAG_BYTES;

    /**
     * Escalones de relleno del ADR 0011, en bytes de contenido rellenado.
     *
     * @var list<int>
     */
    public const array PADDED_SIZES = [
        65536,     // 64 KiB
        262144,    // 256 KiB
        1048576,   // 1 MiB
        4194304,   // 4 MiB
    ];

    private function __construct() {}

    /**
     * Tamaños binarios completos admitidos: cabecera + tag + escalón de relleno.
     *
     * @return list<int>
     */
    public static function sizes(): array
    {
        return array_map(
            static fn (int $padded): int => self::HEADER_BYTES + self::TAG_BYTES + $padded,
            self::PADDED_SIZES,
        );
    }

    /**
     * Longitud máxima de la cadena de transporte, para acotar el cuerpo de la petición **antes** de
     * decodificar nada.
     *
     * Es el tope de tamaño por paquete que exige el ADR 0011: sin él, el endpoint es alojamiento
     * anónimo gratuito. Sale del mayor escalón de la escalera, así que subir el tope obliga a añadir
     * antes un escalón, y no al revés.
     */
    public static function maxTransportLength(): int
    {
        $largest = self::HEADER_BYTES + self::TAG_BYTES + self::PADDED_SIZES[count(self::PADDED_SIZES) - 1];

        return strlen(self::PREFIX) + (int) ceil($largest / 3) * 4;
    }

    /**
     * @param  mixed  $envelope  Valor recibido del cliente, sin ninguna suposición sobre su tipo.
     */
    public static function isValid(mixed $envelope): bool
    {
        if (! is_string($envelope) || ! str_starts_with($envelope, self::PREFIX)) {
            return false;
        }

        if (strlen($envelope) > self::maxTransportLength()) {
            return false;
        }

        try {
            $decoded = Base64Url::decode(substr($envelope, strlen(self::PREFIX)), 'share package');
        } catch (InvalidMessageException) {
            return false;
        }

        return in_array(strlen($decoded), self::sizes(), true);
    }
}
