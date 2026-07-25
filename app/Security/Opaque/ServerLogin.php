<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * Lado servidor del login OPAQUE-3DH: `CreateCredentialResponse`,
 * `AuthServerRespond` y `ServerFinish`
 * (RFC 9807 §6.3.2.2, §6.4.4 y §6.2.4 / `docs/OPAQUE.md` §11.3, §11.4 y §11.8).
 *
 * La fuente de aleatoriedad se inyecta para poder reproducir los vectores
 * oficiales (`docs/OPAQUE.md` §20.3); en producción es
 * {@see SystemRandomSource}.
 */
final class ServerLogin
{
    /** Etiqueta del `Expand` que genera el pad de enmascarado (Apéndice A). */
    public const string MASKING_PAD_LABEL = 'CredentialResponsePad';

    /** `Nn` — longitud de los nonces del protocolo, en bytes. */
    private const int NONCE_LENGTH = 32;

    /** `Nseed` — longitud de la semilla de la clave efímera, en bytes. */
    private const int KEYSHARE_SEED_LENGTH = 32;

    /** `Npk` — longitud de la clave pública ristretto255, en bytes. */
    private const int PUBLIC_KEY_LENGTH = 32;

    /** `Npk + Nn + Nm` — longitud del pad de enmascarado, en bytes. */
    private const int MASKING_PAD_LENGTH = 128;

    /** `Nsk` — longitud de la clave privada estática del servidor, en bytes. */
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
     * El XOR opera sobre 128 bytes exactos: 32 de `server_public_key` más 96
     * de envelope. Un usuario inexistente se atiende con el
     * `fake_registration_record` de `docs/OPAQUE.md` §13.2 y esta misma
     * función, de modo que la salida es indistinguible.
     *
     * @param  Ke1  $ke1  Mensaje del cliente ya parseado y con puntos validados.
     * @param  RegistrationRecord  $record  Record real o ficticio del usuario.
     * @param  string  $oprfSeed  `oprf_seed` del servidor, 64 bytes (`Nh`).
     * @param  string  $credentialIdentifier  Identificador binario de longitud fija (§13.1).
     * @param  string  $serverPublicKey  Clave pública estática del servidor, 32 bytes.
     * @return CredentialResponse Estructura de 192 bytes.
     *
     * @throws InvalidMessageException Si `$serverPublicKey` no mide 32 bytes o
     *                                 si el XOR recibe longitudes distintas.
     * @throws InvalidPointException Si `blinded_message` no valida o la
     *                               evaluación produce la identidad.
     * @throws OpaqueException Si `DeriveKeyPair` agota su contador.
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
     * `AuthServerRespond` con 3DH (RFC 9807 §6.4.4 / `docs/OPAQUE.md` §11.4).
     *
     * ```
     * server_nonce = random(32)
     * (sk_e, pk_e)  = DeriveDiffieHellmanKeyPair(random(32))   // nunca reutilizada
     * dh1 = DH(sk_e,               client_public_keyshare)
     * dh2 = DH(server_private_key, client_public_keyshare)
     * dh3 = DH(sk_e,               record.client_public_key)
     * ikm = dh1 || dh2 || dh3
     * ```
     *
     * El orden de los tres Diffie-Hellman es normativo: invertirlo produce un
     * `ikm` distinto y el cliente ve un `server_mac` incorrecto.
     *
     * @param  Ke1  $ke1  Mensaje del cliente ya parseado.
     * @param  CredentialResponse  $credentialResponse  Salida de {@see self::createCredentialResponse()}.
     * @param  RegistrationRecord  $record  Record real o ficticio del usuario.
     * @param  string  $serverPrivateKey  Escalar estático del servidor, 32 bytes.
     * @param  string  $serverIdentity  `OPAQUE_SERVER_IDENTITY`, de 0 a 65535 bytes.
     * @param  string  $context  Contexto del perfil; cadena vacía en producción (§2).
     * @param  string|null  $clientIdentity  Identidad explícita del cliente, o `null`
     *                                       para el default del RFC (`client_public_key`).
     * @return ServerLoginResult `KE2` de 320 bytes y `ServerLoginState` de 128 bytes.
     *
     * @throws InvalidMessageException Si `$serverPrivateKey` no mide 32 bytes.
     * @throws InvalidPointException Si algún Diffie-Hellman recibe una entrada
     *                               inválida o produce la identidad.
     * @throws InvalidConfigurationException Si el contexto o alguna identidad
     *                                       excede 65535 bytes.
     * @throws OpaqueException Si `DeriveKeyPair` agota su contador.
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
     * si !ct_equal(ke3.client_mac, state.expected_client_mac):
     *     ClientAuthenticationError      // NO devolver session_key
     * return state.session_key
     * ```
     *
     * La comparación es en tiempo constante (RFC 9807 §9.1). Todo `KE3` que no
     * cuadre cuenta como intento fallido (§9.2): la session key sólo se
     * devuelve cuando el MAC verifica.
     *
     * @param  Ke3  $ke3  Mensaje del cliente, 64 bytes.
     * @param  ServerLoginState  $state  Estado persistido del handshake.
     * @return string Session key de 64 bytes (`Nx`).
     *
     * @throws AuthenticationFailedException Si el MAC del cliente no coincide.
     */
    public static function serverFinish(Ke3 $ke3, ServerLoginState $state): string
    {
        if (! BinaryCodec::constantTimeEquals($ke3->clientMac, $state->expectedClientMac)) {
            throw new AuthenticationFailedException('Client authentication failed: KE3 MAC mismatch.');
        }

        return $state->sessionKey;
    }
}
