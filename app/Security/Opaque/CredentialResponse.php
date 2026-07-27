<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * `CredentialResponse` — first half of `KE2`
 * (RFC 9807 §6.1 / `docs/OPAQUE.md` §6.2 and §11.3).
 *
 * ```
 * CredentialResponse (192 bytes)
 *   [0..31]    evaluated_message[Noe=32]
 *   [32..63]   masking_nonce[Nn=32]
 *   [64..191]  masked_response[Npk+Nn+Nm = 128]
 * ```
 *
 * `masked_response` is `credential_response_pad XOR (server_public_key ||
 * envelope)`, so that a non-existent user produces a response you cannot tell
 * apart from a real one (RFC 9807 §6.3.2.2, `docs/OPAQUE.md` §13.3). That is
 * why `masked_response` is not validated beyond its length: its bytes are
 * pseudorandom and must not be inspected.
 */
final class CredentialResponse
{
    /** Total length of the serialized structure, in bytes. */
    public const int LENGTH = 192;

    /** `Noe` — evaluated OPRF element, in bytes. */
    public const int EVALUATED_MESSAGE_LENGTH = 32;

    /** `Nn` — length of the masking nonce, in bytes. */
    public const int MASKING_NONCE_LENGTH = 32;

    /** `Npk + Nn + Nm` — length of the masked response, in bytes. */
    public const int MASKED_RESPONSE_LENGTH = 128;

    /**
     * @param  string  $evaluatedMessage  Evaluated OPRF element, 32 bytes.
     * @param  string  $maskingNonce  Masking nonce, 32 bytes.
     * @param  string  $maskedResponse  `pad XOR (server_public_key || envelope)`, 128 bytes.
     *
     * @throws InvalidMessageException If any length is not exact.
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
     * Parses the 192 bytes of `CredentialResponse` with the offsets from §6.2.
     *
     * @param  string  $bytes  Serialized structure, exactly 192 bytes.
     *
     * @throws InvalidMessageException If the total length is not 192.
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
     * @return string Serialized structure, exactly 192 bytes. It goes into the
     *                preamble verbatim (`docs/OPAQUE.md` §11.5).
     */
    public function serialize(): string
    {
        return BinaryCodec::concat($this->evaluatedMessage, $this->maskingNonce, $this->maskedResponse);
    }
}
