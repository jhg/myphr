<?php

declare(strict_types=1);

namespace App\Sharing;

use App\Models\ShareLink;
use App\Security\Opaque\Base64Url;
use App\Security\Opaque\InvalidConfigurationException;
use App\Security\Opaque\InvalidMessageException;

/**
 * Sal señuelo del `challenge` (ADR 0011).
 *
 * `challenge` devuelve la `pin_salt` de un enlace vivo. Si devolviese un 404 cuando el enlace no
 * existe, caducó o se revocó, cualquiera con una lista de identificadores sabría cuáles siguen
 * abiertos, y de paso que esa persona compartió algo esa semana. Así que devuelve siempre una sal
 * con la misma forma: la real si el enlace vive, y si no una derivada por HMAC de una clave del
 * servidor sobre el `linkId`.
 *
 * Dos propiedades que la señuelo tiene que cumplir, y de ahí sale el diseño:
 *
 * * **Determinista**: preguntar dos veces por el mismo identificador muerto tiene que dar la misma
 *   sal. Una aleatoria distinta en cada petición delataría al muerto en el segundo intento.
 * * **Estable entre despliegues**: por eso la clave no cuelga de `APP_KEY`, que se regenera al
 *   reinstalar. Si cambiara, comparar la sal de hoy con la de ayer volvería a separar vivos de
 *   muertos.
 *
 * La clave sale de `config('share.decoy_salt_key')`; si no está configurada, de
 * `config('opaque.enumeration_key')`, que hace exactamente el mismo trabajo en el login —volver
 * indistinguible una cuenta que no existe— y es obligatoria en cualquier instalación que pueda
 * autenticar. Si no hay ninguna de las dos, esto falla en voz alta: una sal señuelo derivada de una
 * clave vacía sería la misma en todas las instalaciones del mundo y no protegería nada.
 */
final readonly class DecoySalt
{
    /** Etiqueta de dominio, para que este HMAC no colisione con ningún otro uso de la misma clave. */
    private const string LABEL = 'myphr/share-decoy-salt/v1';

    /**
     * Sal señuelo de 16 bytes para un identificador de enlace, del mismo tamaño que la real.
     *
     * @param  string  $linkId  Identificador tal y como llegó, sin suponer que es un UUID: también
     *                          hay que dar respuesta a una cadena con cualquier forma.
     */
    public function for(string $linkId): string
    {
        $mac = hash_hmac('sha256', self::LABEL."\0".$linkId, $this->key(), true);

        return substr($mac, 0, ShareLink::PIN_SALT_BYTES);
    }

    /**
     * @throws InvalidConfigurationException Si no hay ninguna clave utilizable.
     */
    private function key(): string
    {
        $configured = config('share.decoy_salt_key');
        $fallback = config('opaque.enumeration_key');

        foreach ([$configured, $fallback] as $candidate) {
            if (! is_string($candidate) || $candidate === '') {
                continue;
            }

            try {
                return Base64Url::decodeExactly($candidate, 32, 'decoy salt key');
            } catch (InvalidMessageException $error) {
                throw new InvalidConfigurationException($error->getMessage(), previous: $error);
            }
        }

        throw new InvalidConfigurationException(
            'Falta SHARE_DECOY_SALT_KEY (o, en su defecto, OPAQUE_ENUMERATION_KEY): sin ella la sal señuelo no protege nada.',
        );
    }
}
