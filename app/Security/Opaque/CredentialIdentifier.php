<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * `credential_identifier` de `docs/OPAQUE.md` §13.1.
 *
 * ```
 * credential_identifier = HMAC-SHA-256(OPAQUE_ENUMERATION_KEY, normalize(login))   // 32 bytes
 * ```
 *
 * Determinista y **el mismo valor para cuentas reales e inexistentes**: es lo que hace que un
 * atacante que reenvía el mismo `blinded_message` antes y después de un alta reciba el mismo
 * `evaluated_message` (RFC 9807 §10.9). Por eso no puede ser aleatorio por registro ni regenerarse
 * en un cambio de contraseña.
 *
 * La normalización viene de {@see LoginNormalizer} y de ningún otro sitio (§13.1.1): si la búsqueda
 * en base de datos y este HMAC divergen, aparece un oráculo de enumeración en dos peticiones.
 */
final readonly class CredentialIdentifier
{
    /** Longitud de la salida, en bytes (§13.1). */
    public const int LENGTH = OpaqueProfile::CREDENTIAL_IDENTIFIER_BYTES;

    /** Longitud exigida a `OPAQUE_ENUMERATION_KEY`, en bytes. */
    public const int KEY_LENGTH = 32;

    /**
     * @param  string  $enumerationKey  `OPAQUE_ENUMERATION_KEY` en binario, 32 bytes. Debe ser
     *                                  distinto de `APP_KEY`, del `oprf_seed` y de la clave estática.
     *
     * @throws InvalidConfigurationException Si la clave no mide 32 bytes.
     */
    public function __construct(private string $enumerationKey)
    {
        if (strlen($this->enumerationKey) !== self::KEY_LENGTH) {
            throw new InvalidConfigurationException(
                'OPAQUE_ENUMERATION_KEY must be '.self::KEY_LENGTH.' bytes, got '
                .strlen($this->enumerationKey).'.'
            );
        }
    }

    /**
     * Construye el derivador desde `config('opaque')`.
     *
     * @param  array<string, mixed>  $config
     *
     * @throws InvalidConfigurationException Si falta la clave, no es base64url canónico o no mide 32 bytes.
     */
    public static function fromConfig(array $config): self
    {
        $key = $config['enumeration_key'] ?? null;

        if (! is_string($key) || $key === '') {
            throw new InvalidConfigurationException('OPAQUE_ENUMERATION_KEY is missing.');
        }

        try {
            $decoded = Base64Url::decodeExactly($key, self::KEY_LENGTH, 'OPAQUE_ENUMERATION_KEY');
        } catch (InvalidMessageException $exception) {
            throw new InvalidConfigurationException(
                'OPAQUE_ENUMERATION_KEY is not canonical base64url of '.self::KEY_LENGTH.' bytes.',
                0,
                $exception
            );
        }

        return new self($decoded);
    }

    /**
     * Deriva el identificador de un login cualquiera, exista o no la cuenta (§13.1).
     *
     * @param  string  $login  Identificador tal y como lo tecleó la persona; se normaliza aquí.
     * @return string 32 bytes crudos. Nunca pasa por funciones `mb_*`.
     */
    public function for(string $login): string
    {
        return hash_hmac('sha256', LoginNormalizer::normalize($login), $this->enumerationKey, true);
    }
}
