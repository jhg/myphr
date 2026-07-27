<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * The 3DH AKE `Preamble` (RFC 9807 §6.4.2.1 / `docs/OPAQUE.md` §11.5).
 *
 * It serializes the transcript the keys are derived from and the two MACs are
 * computed over:
 *
 * ```
 * preamble =
 *     "OPAQUEv1-"
 *  || uint16_be(len(context))          || context
 *  || uint16_be(len(client_identity))  || client_identity
 *  || KE1                                                    // 96 bytes
 *  || uint16_be(len(server_identity))  || server_identity
 *  || credential_response                                    // 192 bytes
 *  || server_nonce                                           // 32 bytes
 *  || server_public_keyshare                                 // 32 bytes
 * ```
 *
 * `KE1`, `credential_response`, `server_nonce` and `server_public_keyshare`
 * go in **without** a length prefix: their sizes are fixed by the profile. The
 * three variable fields carry a big-endian uint16 (`pack('n')`), never a
 * platform integer.
 *
 * Default identities (RFC 9807 §4): if `client_identity` is `nil` we use
 * `client_public_key`, and if `server_identity` is `nil` we use
 * `server_public_key`. In this deployment `server_identity` is always the
 * `OPAQUE_SERVER_IDENTITY` string and `client_identity` is always the RFC
 * default (`docs/OPAQUE.md` §6.4).
 */
final class Preamble
{
    /** Protocol version prefix (RFC 9807 §6.4.2.1). */
    public const string PREFIX = 'OPAQUEv1-';

    /** `Nn` — length of the server nonce, in bytes. */
    private const int NONCE_LENGTH = 32;

    /** `Npk` — length of the server ephemeral public key, in bytes. */
    private const int PUBLIC_KEYSHARE_LENGTH = 32;

    /**
     * Builds the preamble byte by byte.
     *
     * @param  string  $context  Application context, 0 to 65535 bytes. The empty
     *                           string in the production profile
     *                           (`docs/OPAQUE.md` §2, §11.5).
     * @param  string  $clientIdentity  Already resolved client identity, 0 to 65535 bytes.
     * @param  Ke1  $ke1  Received `KE1` message; serialized to its 96 bytes.
     * @param  string  $serverIdentity  Already resolved server identity, 0 to 65535 bytes.
     * @param  CredentialResponse  $credentialResponse  Serialized to its 192 bytes.
     * @param  string  $serverNonce  Server nonce, 32 bytes.
     * @param  string  $serverPublicKeyshare  Server ephemeral public key, 32 bytes.
     * @return string Binary preamble of variable length.
     *
     * @throws InvalidMessageException If `$serverNonce` or `$serverPublicKeyshare`
     *                                 are not exactly their required length.
     * @throws InvalidConfigurationException If an identity or the context
     *                                       exceeds 65535 bytes.
     */
    public static function build(
        string $context,
        string $clientIdentity,
        Ke1 $ke1,
        string $serverIdentity,
        CredentialResponse $credentialResponse,
        string $serverNonce,
        string $serverPublicKeyshare,
    ): string {
        BinaryCodec::ensureLength($serverNonce, self::NONCE_LENGTH, 'preamble.server_nonce');
        BinaryCodec::ensureLength($serverPublicKeyshare, self::PUBLIC_KEYSHARE_LENGTH, 'preamble.server_public_keyshare');

        return BinaryCodec::concat(
            self::PREFIX,
            BinaryCodec::lengthPrefixed($context),
            BinaryCodec::lengthPrefixed($clientIdentity),
            $ke1->serialize(),
            BinaryCodec::lengthPrefixed($serverIdentity),
            $credentialResponse->serialize(),
            $serverNonce,
            $serverPublicKeyshare,
        );
    }

    /**
     * Resolves an optional identity by applying the RFC 9807 §4 default.
     *
     * @param  string|null  $identity  Explicit identity, or `null` for `nil`.
     * @param  string  $publicKey  Public key acting as the default.
     * @return string Effective identity.
     */
    public static function resolveIdentity(?string $identity, string $publicKey): string
    {
        return $identity ?? $publicKey;
    }
}
