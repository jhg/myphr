<?php

declare(strict_types=1);

namespace App\Security\Opaque;

use InvalidArgumentException;

/**
 * Expand-Label y Derive-Secret de OPAQUE (RFC 9807 §6.4.2.1).
 *
 * Reutiliza la codificación del struct `HkdfLabel` de TLS 1.3
 * (RFC 8446 §7.1) pero con el prefijo de etiqueta `"OPAQUE-"` en lugar de
 * `"tls13 "`, y sin ningún terminador nulo.
 *
 *   Expand-Label(Secret, Label, Context, Length) =
 *       Expand(Secret, CustomLabel, Length)
 *
 *   struct {
 *     uint16 length = Length;
 *     opaque label<8..255> = "OPAQUE-" + Label;
 *     opaque context<0..255> = Context;
 *   } CustomLabel;
 *
 *   Derive-Secret(Secret, Label, Transcript-Hash) =
 *       Expand-Label(Secret, Label, Transcript-Hash, Nx)
 *
 * Nx es la longitud de salida de la función hash del suite; con
 * ristretto255-SHA512 vale 64 bytes.
 *
 * Los enteros se serializan en big-endian con `pack('n', ...)` para uint16 y
 * `chr()` para uint8, nunca con `pack('L', ...)`, cuyo orden de bytes depende
 * de la plataforma.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9807#section-6.4.2.1 RFC 9807 §6.4.2.1
 * @see https://www.rfc-editor.org/rfc/rfc8446#section-7.1 RFC 8446 §7.1
 */
final class ExpandLabel
{
    /**
     * Prefijo que RFC 9807 §6.4.2.1 antepone a toda etiqueta.
     */
    public const string LABEL_PREFIX = 'OPAQUE-';

    /**
     * Nx del suite ristretto255-SHA512: longitud de salida de Derive-Secret.
     */
    public const int SECRET_LENGTH = 64;

    /**
     * Máximo que cabe en el uint8 de longitud de los campos `label` y `context`.
     */
    private const int MAX_VECTOR_LENGTH = 255;

    /**
     * Máximo que cabe en el uint16 del campo `length`.
     */
    private const int MAX_LENGTH_FIELD = 65535;

    private function __construct() {}

    /**
     * Expand-Label (RFC 9807 §6.4.2.1).
     *
     * Construye `CustomLabel` y lo pasa como `info` a HKDF-Expand-SHA-512.
     *
     * El contexto vacío se codifica exactamente como el RFC indica: un uint8
     * con valor cero y ningún byte más. No se sustituye ni se rellena.
     *
     * @param  string  $secret  Secreto binario usado como PRK de HKDF-Expand;
     *                          al menos 64 bytes.
     * @param  string  $label  Etiqueta ASCII sin el prefijo `"OPAQUE-"`.
     *                         `strlen("OPAQUE-" . $label)` debe ser <= 255.
     * @param  string  $context  Contexto binario, posiblemente vacío. Longitud <= 255.
     * @param  int  $length  Longitud de salida en bytes. 1 <= length <= 65535 y
     *                       <= 255 * 64 por el límite de HKDF-Expand.
     * @return string Material derivado binario de exactamente `$length` bytes.
     *
     * @throws InvalidArgumentException Si alguna longitud excede lo que admite
     *                                  su codificación, o si HKDF-Expand rechaza
     *                                  los parámetros.
     */
    public static function expandLabel(string $secret, string $label, string $context, int $length): string
    {
        if ($length < 1 || $length > self::MAX_LENGTH_FIELD) {
            throw new InvalidArgumentException(
                'Expand-Label: la longitud debe caber en un uint16 y ser positiva, recibida '.$length.'.'
            );
        }

        $prefixedLabel = self::LABEL_PREFIX.$label;
        $prefixedLabelLength = strlen($prefixedLabel);

        if ($prefixedLabelLength > self::MAX_VECTOR_LENGTH) {
            throw new InvalidArgumentException(
                'Expand-Label: la etiqueta con prefijo mide '.$prefixedLabelLength.' bytes y no cabe en un uint8.'
            );
        }

        $contextLength = strlen($context);

        if ($contextLength > self::MAX_VECTOR_LENGTH) {
            throw new InvalidArgumentException(
                'Expand-Label: el contexto mide '.$contextLength.' bytes y no cabe en un uint8.'
            );
        }

        $customLabel = pack('n', $length)
            .chr($prefixedLabelLength)
            .$prefixedLabel
            .chr($contextLength)
            .$context;

        return HkdfSha512::expand($secret, $customLabel, $length);
    }

    /**
     * Derive-Secret (RFC 9807 §6.4.2.1).
     *
     * Equivale a Expand-Label con el hash del transcript como contexto y
     * longitud fija Nx = 64.
     *
     * @param  string  $secret  Secreto binario usado como PRK; al menos 64 bytes.
     * @param  string  $label  Etiqueta ASCII sin prefijo, p. ej. `"HandshakeSecret"`,
     *                         `"SessionKey"`, `"ServerMAC"`, `"ClientMAC"`.
     * @param  string  $transcriptHash  Hash del transcript, o cadena vacía cuando
     *                                  el RFC pasa contexto vacío (Km2 y Km3).
     * @return string Secreto derivado binario de exactamente 64 bytes.
     *
     * @throws InvalidArgumentException Si alguna longitud excede su codificación.
     */
    public static function deriveSecret(string $secret, string $label, string $transcriptHash): string
    {
        return self::expandLabel($secret, $label, $transcriptHash, self::SECRET_LENGTH);
    }
}
