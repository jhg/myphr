<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * `RegistrationRequest` from RFC 9807 §5.1 (`docs/OPAQUE.md` §6.1, §10.1).
 *
 * ```
 * RegistrationRequest (32 bytes)
 *   [0..31]  blinded_message[Noe=32]   serialized OPRF element
 * ```
 *
 * The client produces it with `Blind(password)` and it reaches the server
 * encoded as base64url without padding (43 characters, §5).
 *
 * The element is validated when the object is built, which is the
 * `DeserializeElement` §10.2 requires: exact length, canonical encoding, group
 * membership and rejection of the identity (RFC 9807 §10.7).
 */
final class RegistrationRequest
{
    /**
     * @param  string  $blindedMessage  Serialized OPRF element, `Noe` = 32 bytes.
     *
     * @throws InvalidMessageException If the length is not 32.
     * @throws InvalidPointException If the element is not a valid, canonical
     *                               ristretto255 point other than the identity.
     */
    public function __construct(public readonly string $blindedMessage)
    {
        BinaryCodec::ensureLength(
            $this->blindedMessage,
            OpaqueProfile::REGISTRATION_REQUEST_BYTES,
            'registrationRequest.blinded_message'
        );

        Ristretto255::validatePoint($this->blindedMessage);
    }

    /**
     * Deserializes the 32 bytes of the message by exact offsets (§6.1).
     *
     * It rejects both truncated messages and messages with extra bytes: there
     * are no variable-length fields in the protocol.
     *
     * @param  string  $binary  Binary message of exactly 32 bytes.
     *
     * @throws InvalidMessageException If the length is not 32.
     * @throws InvalidPointException If the element does not validate.
     */
    public static function parse(string $binary): self
    {
        BinaryCodec::ensureLength(
            $binary,
            OpaqueProfile::REGISTRATION_REQUEST_BYTES,
            'registrationRequest'
        );

        return new self(BinaryCodec::slice(
            $binary,
            0,
            OpaqueProfile::NOE,
            'registrationRequest.blinded_message'
        ));
    }

    /**
     * Decodes the message exactly as it travels over HTTP: strict, canonical
     * base64url, no padding, 43 characters (§5).
     *
     * @param  string  $encoded  String received from the client.
     *
     * @throws InvalidMessageException If the encoding is not canonical or the
     *                                 binary length is not 32.
     * @throws InvalidPointException If the element does not validate.
     */
    public static function fromBase64Url(string $encoded): self
    {
        return self::parse(Base64Url::decodeExactly(
            $encoded,
            OpaqueProfile::REGISTRATION_REQUEST_BYTES,
            'registrationRequest'
        ));
    }

    /**
     * @return string Binary message of 32 bytes (§6.1).
     */
    public function serialize(): string
    {
        return $this->blindedMessage;
    }

    /**
     * @return string Message as base64url without padding, 43 characters (§5).
     */
    public function toBase64Url(): string
    {
        return Base64Url::encode($this->serialize());
    }
}
