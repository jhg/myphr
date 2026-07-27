<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * `RegistrationResponse` from RFC 9807 §5.1 (`docs/OPAQUE.md` §6.1, §10.2).
 *
 * ```
 * RegistrationResponse (64 bytes)
 *   [0..31]   evaluated_message[Noe=32]   evaluated OPRF element
 *   [32..63]  server_public_key[Npk=32]   server static AKE public key
 * ```
 *
 * The server produces it in `CreateRegistrationResponse` and it travels to the
 * client as base64url without padding (86 characters, §5).
 *
 * Both fields are ristretto255 elements and are validated when the object is
 * built (length, canonical encoding, group membership and rejection of the
 * identity, RFC 9807 §10.7).
 */
final class RegistrationResponse
{
    /**
     * @param  string  $evaluatedMessage  Evaluated OPRF element, `Noe` = 32 bytes.
     * @param  string  $serverPublicKey  Server static public key, `Npk` = 32 bytes.
     *
     * @throws InvalidMessageException If either length is not 32.
     * @throws InvalidPointException If either one is not a valid, canonical
     *                               ristretto255 point other than the
     *                               identity.
     */
    public function __construct(
        public readonly string $evaluatedMessage,
        public readonly string $serverPublicKey,
    ) {
        BinaryCodec::ensureLength(
            $this->evaluatedMessage,
            OpaqueProfile::NOE,
            'registrationResponse.evaluated_message'
        );
        BinaryCodec::ensureLength(
            $this->serverPublicKey,
            OpaqueProfile::NPK,
            'registrationResponse.server_public_key'
        );

        Ristretto255::validatePoint($this->evaluatedMessage);
        Ristretto255::validatePoint($this->serverPublicKey);
    }

    /**
     * Deserializes the 64 bytes of the message by exact offsets (§6.1).
     *
     * @param  string  $binary  Binary message of exactly 64 bytes.
     *
     * @throws InvalidMessageException If the length is not 64.
     * @throws InvalidPointException If either element does not validate.
     */
    public static function parse(string $binary): self
    {
        BinaryCodec::ensureLength(
            $binary,
            OpaqueProfile::REGISTRATION_RESPONSE_BYTES,
            'registrationResponse'
        );

        return new self(
            BinaryCodec::slice($binary, 0, OpaqueProfile::NOE, 'registrationResponse.evaluated_message'),
            BinaryCodec::slice(
                $binary,
                OpaqueProfile::NOE,
                OpaqueProfile::NPK,
                'registrationResponse.server_public_key'
            ),
        );
    }

    /**
     * Decodes the message exactly as it travels over HTTP: strict, canonical
     * base64url, no padding, 86 characters (§5).
     *
     * @param  string  $encoded  base64url string.
     *
     * @throws InvalidMessageException If the encoding is not canonical or the
     *                                 binary length is not 64.
     * @throws InvalidPointException If either element does not validate.
     */
    public static function fromBase64Url(string $encoded): self
    {
        return self::parse(Base64Url::decodeExactly(
            $encoded,
            OpaqueProfile::REGISTRATION_RESPONSE_BYTES,
            'registrationResponse'
        ));
    }

    /**
     * @return string Binary message of 64 bytes, `evaluated_message || server_public_key` (§6.1).
     */
    public function serialize(): string
    {
        return BinaryCodec::concat($this->evaluatedMessage, $this->serverPublicKey);
    }

    /**
     * @return string Message as base64url without padding, 86 characters (§5).
     */
    public function toBase64Url(): string
    {
        return Base64Url::encode($this->serialize());
    }
}
