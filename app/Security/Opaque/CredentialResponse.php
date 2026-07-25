<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * `CredentialResponse` — primera mitad de `KE2`
 * (RFC 9807 §6.1 / `docs/OPAQUE.md` §6.2 y §11.3).
 *
 * ```
 * CredentialResponse (192 bytes)
 *   [0..31]    evaluated_message[Noe=32]
 *   [32..63]   masking_nonce[Nn=32]
 *   [64..191]  masked_response[Npk+Nn+Nm = 128]
 * ```
 *
 * `masked_response` es `credential_response_pad XOR (server_public_key ||
 * envelope)`, de forma que un usuario inexistente produce una respuesta
 * indistinguible de una real (RFC 9807 §6.3.2.2, `docs/OPAQUE.md` §13.3).
 * Por eso `masked_response` no se valida más allá de su longitud: sus bytes
 * son pseudoaleatorios y no deben inspeccionarse.
 */
final class CredentialResponse
{
    /** Longitud total de la estructura serializada, en bytes. */
    public const int LENGTH = 192;

    /** `Noe` — elemento OPRF evaluado, en bytes. */
    public const int EVALUATED_MESSAGE_LENGTH = 32;

    /** `Nn` — longitud del nonce de enmascarado, en bytes. */
    public const int MASKING_NONCE_LENGTH = 32;

    /** `Npk + Nn + Nm` — longitud de la respuesta enmascarada, en bytes. */
    public const int MASKED_RESPONSE_LENGTH = 128;

    /**
     * @param  string  $evaluatedMessage  Elemento OPRF evaluado, 32 bytes.
     * @param  string  $maskingNonce  Nonce de enmascarado, 32 bytes.
     * @param  string  $maskedResponse  `pad XOR (server_public_key || envelope)`, 128 bytes.
     *
     * @throws InvalidMessageException Si alguna longitud no es la exacta.
     */
    public function __construct(
        public readonly string $evaluatedMessage,
        public readonly string $maskingNonce,
        public readonly string $maskedResponse,
    ) {
        BinaryCodec::ensureLength($evaluatedMessage, self::EVALUATED_MESSAGE_LENGTH, 'credential_response.evaluated_message');
        BinaryCodec::ensureLength($maskingNonce, self::MASKING_NONCE_LENGTH, 'credential_response.masking_nonce');
        BinaryCodec::ensureLength($maskedResponse, self::MASKED_RESPONSE_LENGTH, 'credential_response.masked_response');
    }

    /**
     * Parsea los 192 bytes de `CredentialResponse` con los offsets de §6.2.
     *
     * @param  string  $bytes  Estructura serializada, exactamente 192 bytes.
     *
     * @throws InvalidMessageException Si la longitud total no es 192.
     */
    public static function parse(string $bytes): self
    {
        BinaryCodec::ensureLength($bytes, self::LENGTH, 'credential_response');

        return new self(
            BinaryCodec::slice($bytes, 0, self::EVALUATED_MESSAGE_LENGTH, 'credential_response.evaluated_message'),
            BinaryCodec::slice($bytes, 32, self::MASKING_NONCE_LENGTH, 'credential_response.masking_nonce'),
            BinaryCodec::slice($bytes, 64, self::MASKED_RESPONSE_LENGTH, 'credential_response.masked_response'),
        );
    }

    /**
     * @return string Estructura serializada, exactamente 192 bytes. Entra tal
     *                cual en el preamble (`docs/OPAQUE.md` §11.5).
     */
    public function serialize(): string
    {
        return BinaryCodec::concat($this->evaluatedMessage, $this->maskingNonce, $this->maskedResponse);
    }
}
