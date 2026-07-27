<?php

declare(strict_types=1);

namespace App\Sharing;

use App\Crypto\EnvelopeValidator;
use App\Models\ShareLink;
use App\Security\Opaque\Base64Url;
use App\Security\Opaque\InvalidMessageException;

/**
 * Lectura y validación del bloque `link` que llega en el cuerpo de las dos rutas que crean enlaces
 * (ADR 0011).
 *
 * Vive aparte porque lo necesitan crear un recorte y re-armar un enlace, y un criterio de validez
 * duplicado acaba divergiendo justo en la mitad que menos se prueba.
 *
 * Todo lo que valida es **forma**: que el identificador sea un UUID, que la sal y el comprobante
 * midan lo que tienen que medir y vengan en base64url canónico, y que el envoltorio tenga forma de
 * sobre `v1.`. El contenido no se puede comprobar: `wrapper` está cifrado con una clave derivada de
 * `S`, que nunca llega al servidor, y `pin_tag` es indistinguible de 32 bytes al azar sin conocer el
 * PIN, que es exactamente lo que se pretende.
 */
final class ShareLinkInput
{
    private function __construct() {}

    /**
     * @param  mixed  $input  El valor bajo la clave `link` del cuerpo, sin suponer que es un array.
     * @return array{id: string, pinSalt: string, pinTag: string, wrapper: string}|null Bytes ya
     *                                                                                  decodificados, o `null` si algo no valida.
     */
    public static function parse(mixed $input): ?array
    {
        if (! is_array($input)) {
            return null;
        }

        $id = $input['id'] ?? null;

        if (! ClientUuid::isValid($id)) {
            return null;
        }

        $salt = self::decodeExactly($input['pinSalt'] ?? null, ShareLink::PIN_SALT_BYTES);
        $tag = self::decodeExactly($input['pinTag'] ?? null, ShareLink::PIN_TAG_BYTES);
        $wrapper = $input['wrapper'] ?? null;

        if ($salt === null || $tag === null || ! EnvelopeValidator::isValid($wrapper)) {
            return null;
        }

        return [
            'id' => (string) $id,
            'pinSalt' => $salt,
            'pinTag' => $tag,
            'wrapper' => (string) $wrapper,
        ];
    }

    private static function decodeExactly(mixed $value, int $bytes): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        try {
            return Base64Url::decodeExactly($value, $bytes, 'share link');
        } catch (InvalidMessageException) {
            return null;
        }
    }
}
