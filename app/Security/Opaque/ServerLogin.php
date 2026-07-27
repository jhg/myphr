<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * Server side of the OPAQUE-3DH login: `CreateCredentialResponse`,
 * `AuthServerRespond` and `ServerFinish`
 * (RFC 9807 §6.3.2.2, §6.4.4 and §6.2.4 / `docs/OPAQUE.md` §11.3, §11.4 and §11.8).
 *
 * The source of randomness is injected so we can reproduce the official
 * vectors (`docs/OPAQUE.md` §20.3); in production it is
 * {@see SystemRandomSource}.
 */
final class ServerLogin
{
    /** Label of the `Expand` that generates the masking pad (Appendix A). */
    public const string MASKING_PAD_LABEL = 'CredentialResponsePad';

    /** `Nn` — length of the protocol nonces, in bytes. */
    private const int NONCE_LENGTH = 32;

    /** `Nseed` — length of the ephemeral key seed, in bytes. */
    private const int KEYSHARE_SEED_LENGTH = 32;

    /** `Npk` — length of the ristretto255 public key, in bytes. */
    private const int PUBLIC_KEY_LENGTH = 32;

    /** `Npk + Nn + Nm` — length of the masking pad, in bytes. */
    private const int MASKING_PAD_LENGTH = 128;

    /** `Nsk` — length of the server static private key, in bytes. */
    private const int PRIVATE_KEY_LENGTH = 32;

    public function __construct(
        private readonly RandomSource $randomSource,
    ) {}

    /**
     * `CreateCredentialResponse` (RFC 9807 §6.3.2.2 / `docs/OPAQUE.md` §11.3).
     *
     * ```
     * oprf_key          = DeriveKeyPair(Expand(oprf_seed, credential_identifier || "OprfKey", 32))
     * evaluated_message = BlindEvaluate(oprf_key, blinded_message)
     * masking_nonce     = random(32)
     * pad               = Expand(record.masking_key, masking_nonce || "CredentialResponsePad", 128)
     * masked_response   = pad XOR (server_public_key || record.envelope)
     * ```
     *
     * The XOR runs over exactly 128 bytes: 32 from `server_public_key` plus 96
     * from the envelope. A non-existent user is served with the
     * `fake_registration_record` from `docs/OPAQUE.md` §13.2 and this very
     * function, so the output is indistinguishable.
     *
     * @param  Ke1  $ke1  Client message, already parsed and with its points validated.
     * @param  RegistrationRecord  $record  Real or fake record for the user.
     * @param  string  $oprfSeed  Server `oprf_seed`, 64 bytes (`Nh`).
     * @param  string  $credentialIdentifier  Fixed-length binary identifier (§13.1).
     * @param  string  $serverPublicKey  Server static public key, 32 bytes.
     * @return CredentialResponse 192-byte structure.
     *
     * @throws InvalidMessageException If `$serverPublicKey` is not 32 bytes long
     *                                 or the XOR gets different lengths.
     * @throws InvalidPointException If `blinded_message` does not validate or the
     *                               evaluation yields the identity.
     * @throws OpaqueException If `DeriveKeyPair` exhausts its counter.
     */
    public function createCredentialResponse(
        Ke1 $ke1,
        RegistrationRecord $record,
        string $oprfSeed,
        string $credentialIdentifier,
        string $serverPublicKey,
    ): CredentialResponse {
        BinaryCodec::ensureLength($serverPublicKey, self::PUBLIC_KEY_LENGTH, 'server_public_key');

        $oprfKey = Oprf::deriveOprfKey($oprfSeed, $credentialIdentifier);
        $evaluatedMessage = Oprf::blindEvaluate($oprfKey, $ke1->blindedMessage);
        sodium_memzero($oprfKey);

        $maskingNonce = $this->randomSource->bytes(self::NONCE_LENGTH);

        $pad = HkdfSha512::expand(
            $record->maskingKey,
            $maskingNonce.self::MASKING_PAD_LABEL,
            self::MASKING_PAD_LENGTH
        );

        $maskedResponse = BinaryCodec::xorStrings(
            $pad,
            BinaryCodec::concat($serverPublicKey, $record->envelope)
        );

        sodium_memzero($pad);

        return new CredentialResponse($evaluatedMessage, $maskingNonce, $maskedResponse);
    }

    /**
     * `AuthServerRespond` with 3DH (RFC 9807 §6.4.4 / `docs/OPAQUE.md` §11.4).
     *
     * ```
     * server_nonce = random(32)
     * (sk_e, pk_e)  = DeriveDiffieHellmanKeyPair(random(32))   // never reused
     * dh1 = DH(sk_e,               client_public_keyshare)
     * dh2 = DH(server_private_key, client_public_keyshare)
     * dh3 = DH(sk_e,               record.client_public_key)
     * ikm = dh1 || dh2 || dh3
     * ```
     *
     * The order of the three Diffie-Hellman operations is normative: swapping
     * it produces a different `ikm` and the client sees a wrong `server_mac`.
     *
     * @param  Ke1  $ke1  Client message, already parsed.
     * @param  CredentialResponse  $credentialResponse  Output of {@see self::createCredentialResponse()}.
     * @param  RegistrationRecord  $record  Real or fake record for the user.
     * @param  string  $serverPrivateKey  Server static scalar, 32 bytes.
     * @param  string  $serverIdentity  `OPAQUE_SERVER_IDENTITY`, 0 to 65535 bytes.
     * @param  string  $context  Profile context; the empty string in production (§2).
     * @param  string|null  $clientIdentity  Explicit client identity, or `null`
     *                                       for the RFC default (`client_public_key`).
     * @return ServerLoginResult 320-byte `KE2` and 128-byte `ServerLoginState`.
     *
     * @throws InvalidMessageException If `$serverPrivateKey` is not 32 bytes long.
     * @throws InvalidPointException If a Diffie-Hellman gets an invalid input or
     *                               yields the identity.
     * @throws InvalidConfigurationException If the context or an identity
     *                                       exceeds 65535 bytes.
     * @throws OpaqueException If `DeriveKeyPair` exhausts its counter.
     */
    public function authServerRespond(
        Ke1 $ke1,
        CredentialResponse $credentialResponse,
        RegistrationRecord $record,
        string $serverPrivateKey,
        string $serverIdentity,
        string $context = '',
        ?string $clientIdentity = null,
    ): ServerLoginResult {
        BinaryCodec::ensureLength($serverPrivateKey, self::PRIVATE_KEY_LENGTH, 'server_private_key');

        $serverNonce = $this->randomSource->bytes(self::NONCE_LENGTH);

        $keyshareSeed = $this->randomSource->bytes(self::KEYSHARE_SEED_LENGTH);
        [$ephemeralPrivateKey, $serverPublicKeyshare] = Oprf::deriveDiffieHellmanKeyPair($keyshareSeed);
        sodium_memzero($keyshareSeed);

        $dh1 = Ristretto255::scalarMultiply($ephemeralPrivateKey, $ke1->clientPublicKeyshare);
        $dh2 = Ristretto255::scalarMultiply($serverPrivateKey, $ke1->clientPublicKeyshare);
        $dh3 = Ristretto255::scalarMultiply($ephemeralPrivateKey, $record->clientPublicKey);
        sodium_memzero($ephemeralPrivateKey);

        $ikm = BinaryCodec::concat($dh1, $dh2, $dh3);
        sodium_memzero($dh1);
        sodium_memzero($dh2);
        sodium_memzero($dh3);

        $preamble = Preamble::build(
            $context,
            Preamble::resolveIdentity($clientIdentity, $record->clientPublicKey),
            $ke1,
            $serverIdentity,
            $credentialResponse,
            $serverNonce,
            $serverPublicKeyshare,
        );

        $keys = AkeKeySchedule::deriveKeys($ikm, $preamble);
        sodium_memzero($ikm);

        $serverMac = AkeKeySchedule::serverMac($keys->serverMacKey, $preamble);
        $expectedClientMac = AkeKeySchedule::clientMac($keys->clientMacKey, $preamble, $serverMac);

        return new ServerLoginResult(
            new Ke2(
                $credentialResponse,
                new AuthResponse($serverNonce, $serverPublicKeyshare, $serverMac),
            ),
            new ServerLoginState($expectedClientMac, $keys->sessionKey),
        );
    }

    /**
     * `ServerFinish` (RFC 9807 §6.2.4 / `docs/OPAQUE.md` §11.8).
     *
     * ```
     * if !ct_equal(ke3.client_mac, state.expected_client_mac):
     *     ClientAuthenticationError      // do NOT return session_key
     * return state.session_key
     * ```
     *
     * The comparison is constant time (RFC 9807 §9.1). Every `KE3` that does
     * not match counts as a failed attempt (§9.2): the session key is only
     * returned when the MAC verifies.
     *
     * @param  Ke3  $ke3  Client message, 64 bytes.
     * @param  ServerLoginState  $state  Persisted handshake state.
     * @return string 64-byte session key (`Nx`).
     *
     * @throws AuthenticationFailedException If the client MAC does not match.
     */
    public static function serverFinish(Ke3 $ke3, ServerLoginState $state): string
    {
        if (! BinaryCodec::constantTimeEquals($ke3->clientMac, $state->expectedClientMac)) {
            throw new AuthenticationFailedException('Client authentication failed: KE3 MAC mismatch.');
        }

        return $state->sessionKey;
    }
}
