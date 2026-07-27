<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * `DeriveKeys` and the two MACs of the 3DH AKE
 * (RFC 9807 §6.4.2.2 / `docs/OPAQUE.md` §11.6).
 *
 * ```
 * prk              = Extract("", ikm)
 * preamble_hash    = SHA512(preamble)
 * handshake_secret = Derive-Secret(prk, "HandshakeSecret", preamble_hash)
 * session_key      = Derive-Secret(prk, "SessionKey",      preamble_hash)
 * Km2              = Derive-Secret(handshake_secret, "ServerMAC", "")
 * Km3              = Derive-Secret(handshake_secret, "ClientMAC", "")
 *
 * server_mac          = HMAC-SHA-512(Km2, SHA512(preamble))
 * expected_client_mac = HMAC-SHA-512(Km3, SHA512(preamble || server_mac))
 * ```
 *
 * The preamble hash goes in as the `Context` of `Expand-Label` in
 * `HandshakeSecret` and `SessionKey`; `Km2` and `Km3` carry an empty context.
 * This reading comes from the pseudocode in `docs/OPAQUE.md` §11.6, which
 * demands checking it against the RFC 9807 Appendix C vectors before taking it
 * as correct.
 *
 * Note that `expected_client_mac` hashes `preamble || server_mac`, not
 * `SHA512(preamble) || server_mac`: that is why the MAC functions take the
 * whole preamble and not its hash.
 */
final class AkeKeySchedule
{
    /** `Derive-Secret` label for the handshake secret. */
    public const string LABEL_HANDSHAKE_SECRET = 'HandshakeSecret';

    /** `Derive-Secret` label for the session key. */
    public const string LABEL_SESSION_KEY = 'SessionKey';

    /** `Derive-Secret` label for `Km2`. */
    public const string LABEL_SERVER_MAC = 'ServerMAC';

    /** `Derive-Secret` label for `Km3`. */
    public const string LABEL_CLIENT_MAC = 'ClientMAC';

    /** Hash and HMAC algorithm of the profile (`docs/OPAQUE.md` §2). */
    private const string HASH_ALGORITHM = 'sha512';

    /**
     * `DeriveKeys(ikm, preamble)` (RFC 9807 §6.4.2.2).
     *
     * `prk` and `handshake_secret` are zeroized before returning: they are not
     * part of the result. PHP does not guarantee that every internal copy of a
     * string is wiped, so zeroization is best effort
     * (`docs/OPAQUE.md` §11.6).
     *
     * @param  string  $ikm  `dh1 || dh2 || dh3`, 96 bytes in this profile.
     * @param  string  $preamble  Full preamble (§11.5), variable length.
     * @return AkeKeys Session key, `Km2` and `Km3`, 64 bytes each.
     */
    public static function deriveKeys(string $ikm, string $preamble): AkeKeys
    {
        $prk = HkdfSha512::extract('', $ikm);
        $preambleHash = self::hash($preamble);

        $handshakeSecret = ExpandLabel::deriveSecret($prk, self::LABEL_HANDSHAKE_SECRET, $preambleHash);
        $sessionKey = ExpandLabel::deriveSecret($prk, self::LABEL_SESSION_KEY, $preambleHash);

        $serverMacKey = ExpandLabel::deriveSecret($handshakeSecret, self::LABEL_SERVER_MAC, '');
        $clientMacKey = ExpandLabel::deriveSecret($handshakeSecret, self::LABEL_CLIENT_MAC, '');

        sodium_memzero($prk);
        sodium_memzero($handshakeSecret);

        return new AkeKeys($sessionKey, $serverMacKey, $clientMacKey);
    }

    /**
     * `server_mac = HMAC-SHA-512(Km2, SHA512(preamble))` (RFC 9807 §6.4.4).
     *
     * @param  string  $serverMacKey  `Km2`, 64 bytes.
     * @param  string  $preamble  Full preamble, variable length.
     * @return string 64-byte tag (`Nm`).
     */
    public static function serverMac(string $serverMacKey, string $preamble): string
    {
        return hash_hmac(self::HASH_ALGORITHM, self::hash($preamble), $serverMacKey, true);
    }

    /**
     * `client_mac = HMAC-SHA-512(Km3, SHA512(preamble || server_mac))`
     * (RFC 9807 §6.4.3 / §6.4.4).
     *
     * On the server this is the `expected_client_mac` the received `KE3` is
     * compared against.
     *
     * @param  string  $clientMacKey  `Km3`, 64 bytes.
     * @param  string  $preamble  Full preamble, variable length.
     * @param  string  $serverMac  Server tag, 64 bytes.
     * @return string 64-byte tag (`Nm`).
     *
     * @throws InvalidMessageException If `$serverMac` is not 64 bytes long.
     */
    public static function clientMac(string $clientMacKey, string $preamble, string $serverMac): string
    {
        BinaryCodec::ensureLength($serverMac, AuthResponse::MAC_LENGTH, 'server_mac');

        return hash_hmac(self::HASH_ALGORITHM, self::hash($preamble.$serverMac), $clientMacKey, true);
    }

    /**
     * The profile `Hash`: SHA-512 in binary (`docs/OPAQUE.md` §2).
     *
     * @param  string  $data  Binary input of arbitrary length.
     * @return string 64-byte digest (`Nh`).
     */
    public static function hash(string $data): string
    {
        return hash(self::HASH_ALGORITHM, $data, true);
    }
}
