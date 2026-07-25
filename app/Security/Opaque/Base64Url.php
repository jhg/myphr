<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * Base64 URL-safe **sin padding** con decodificación estricta
 * (`docs/OPAQUE.md` §5).
 *
 * Es el único formato de transporte HTTP de los mensajes OPAQUE. La
 * estrictez no es una preferencia: `@serenity-kit/opaque` codifica con
 * `URL_SAFE_NO_PAD` y decodifica con `DecodePaddingMode::RequireNone`, así
 * que aceptar variantes rompería la interoperabilidad además de admitir
 * múltiples representaciones del mismo mensaje.
 *
 * Reglas aplicadas al decodificar:
 *
 * 1. Alfabeto `A-Z a-z 0-9 - _` únicamente: se rechazan `=`, espacios,
 *    saltos de línea y el alfabeto Base64 estándar (`+`, `/`).
 * 2. Longitud congruente: `strlen % 4 === 1` es imposible en Base64 y se
 *    rechaza.
 * 3. Canonicidad: se vuelve a codificar el resultado y se exige igualdad
 *    exacta con la entrada, lo que rechaza los bits sobrantes distintos de
 *    cero en el último carácter.
 *
 * `base64_decode(..., strict: true)` de PHP no cubre ninguna de las tres:
 * acepta padding, ignora espacios en blanco y admite bits sobrantes.
 */
final class Base64Url
{
    /**
     * Alfabeto Base64 URL-safe (RFC 4648 §5).
     */
    private const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

    /**
     * Codifica bytes binarios en base64url sin padding.
     *
     * @param  string  $binary  Cadena binaria de cualquier longitud (puede ser vacía).
     * @return string Sólo caracteres del alfabeto base64url, sin `=`.
     */
    public static function encode(string $binary): string
    {
        return rtrim(strtr(base64_encode($binary), '+/', '-_'), '=');
    }

    /**
     * Decodifica base64url sin padding de forma estricta y canónica.
     *
     * @param  string  $encoded  Cadena recibida por HTTP.
     * @param  string  $field  Nombre del campo, sólo para el mensaje de error.
     * @return string Bytes decodificados.
     *
     * @throws InvalidMessageException Si hay caracteres fuera del alfabeto,
     *                                 padding, espacios, longitud imposible o
     *                                 la codificación no es canónica.
     */
    public static function decode(string $encoded, string $field = 'value'): string
    {
        if (strspn($encoded, self::ALPHABET) !== strlen($encoded)) {
            throw new InvalidMessageException("Field {$field} is not valid base64url.");
        }

        if (strlen($encoded) % 4 === 1) {
            throw new InvalidMessageException("Field {$field} has an impossible base64url length.");
        }

        $decoded = base64_decode(strtr($encoded, '-_', '+/'), true);

        if ($decoded === false) {
            throw new InvalidMessageException("Field {$field} is not valid base64url.");
        }

        if (self::encode($decoded) !== $encoded) {
            throw new InvalidMessageException("Field {$field} is not canonical base64url.");
        }

        return $decoded;
    }

    /**
     * Decodifica y exige una longitud binaria exacta.
     *
     * Aplica la regla de `docs/OPAQUE.md` §5 de rechazar cualquier longitud
     * inesperada **antes** de tocar criptografía: los tamaños de los mensajes
     * están fijados en §6 y no hay ninguno de longitud variable.
     *
     * @param  string  $encoded  Cadena recibida por HTTP.
     * @param  int<0, max>  $expectedLength  Longitud binaria exigida, en bytes.
     * @param  string  $field  Nombre del campo, sólo para el mensaje de error.
     * @return string Bytes decodificados, de longitud exactamente `$expectedLength`.
     *
     * @throws InvalidMessageException Si la codificación es inválida o la
     *                                 longitud no coincide.
     */
    public static function decodeExactly(string $encoded, int $expectedLength, string $field = 'value'): string
    {
        $decoded = self::decode($encoded, $field);

        BinaryCodec::ensureLength($decoded, $expectedLength, $field);

        return $decoded;
    }
}
