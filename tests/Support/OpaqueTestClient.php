<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Security\Opaque\AkeKeySchedule;
use App\Security\Opaque\Base64Url;
use App\Security\Opaque\BinaryCodec;
use App\Security\Opaque\HkdfSha512;
use App\Security\Opaque\Ke1;
use App\Security\Opaque\Ke2;
use App\Security\Opaque\Oprf;
use App\Security\Opaque\Preamble;
use App\Security\Opaque\RegistrationRecord;
use App\Security\Opaque\RegistrationResponse;
use App\Security\Opaque\Ristretto255;
use RuntimeException;

/**
 * Minimal OPAQUE client, **for tests only** (RFC 9807 §5.2.1, §5.2.3, §6.2 and §6.4.3).
 *
 * In production the client is `@serenity-kit/opaque` running in the browser; here we reimplement
 * just enough to exercise the four endpoints against the real server in an integration test, with
 * no recorded fixtures and with no way to fool itself with precomputed values.
 *
 * `Stretch` is the identity, just as in the official Appendix C vectors: the KSF lives entirely on
 * the client and the server is agnostic to it, so a 64 MiB Argon2id per test would cost seconds
 * without checking anything on the server. A KSF mismatch has its own regression test
 * (`docs/OPAQUE.md` §20.5), which is not this one.
 */
final class OpaqueTestClient
{
    private function __construct() {}

    /**
     * `CreateRegistrationRequest` (RFC 9807 §5.2.1).
     *
     * @return array{blind: string, registrationRequest: string} `blind` binary, request as base64url.
     */
    public static function startRegistration(string $password): array
    {
        $blind = Ristretto255::scalarReduce(random_bytes(64));

        return [
            'blind' => $blind,
            'registrationRequest' => Base64Url::encode(Oprf::blind($password, $blind)),
        ];
    }

    /**
     * `FinalizeRegistrationRequest` + `Store` (RFC 9807 §5.2.3 y §4.1.2).
     *
     * @return array{registrationRecord: string, exportKey: string, serverPublicKey: string}
     */
    public static function finishRegistration(
        string $password,
        string $blind,
        string $registrationResponse,
        string $serverIdentity,
    ): array {
        $decoded = Base64Url::decodeExactly($registrationResponse, 64, 'registrationResponse');
        $response = new RegistrationResponse(substr($decoded, 0, 32), substr($decoded, 32, 32));

        $randomizedPassword = self::randomizedPassword($password, $blind, $response->evaluatedMessage);
        $envelopeNonce = random_bytes(32);

        $credentials = self::recoverCredentials(
            $randomizedPassword,
            $envelopeNonce,
            $response->serverPublicKey,
            $serverIdentity
        );

        $record = new RegistrationRecord(
            $credentials['clientPublicKey'],
            HkdfSha512::expand($randomizedPassword, 'MaskingKey', 64),
            $envelopeNonce.$credentials['authTag'],
        );

        return [
            'registrationRecord' => $record->toBase64Url(),
            'exportKey' => $credentials['exportKey'],
            'serverPublicKey' => $response->serverPublicKey,
        ];
    }

    /**
     * `GenerateKE1` (RFC 9807 §6.4.3).
     *
     * @return array{blind: string, ephemeralPrivateKey: string, ke1: Ke1, startLoginRequest: string}
     */
    public static function startLogin(string $password): array
    {
        $blind = Ristretto255::scalarReduce(random_bytes(64));
        [$ephemeralPrivateKey, $ephemeralPublicKey] = Oprf::deriveDiffieHellmanKeyPair(random_bytes(32));

        $ke1 = new Ke1(Oprf::blind($password, $blind), random_bytes(32), $ephemeralPublicKey);

        return [
            'blind' => $blind,
            'ephemeralPrivateKey' => $ephemeralPrivateKey,
            'ke1' => $ke1,
            'startLoginRequest' => $ke1->toBase64Url(),
        ];
    }

    /**
     * `GenerateKE3` (RFC 9807 §6.4.3): unmasks, recovers the envelope, does the three
     * Diffie-Hellman operations in the mirror order of the server, verifies `server_mac` and
     * produces `KE3`.
     *
     * @param  array{blind: string, ephemeralPrivateKey: string, ke1: Ke1, startLoginRequest: string}  $started
     * @return array{finishLoginRequest: string, exportKey: string, sessionKey: string}
     *
     * @throws RuntimeException If the envelope or the `server_mac` do not verify, which is what the
     *                          real client turns into "wrong password".
     */
    public static function finishLogin(
        string $password,
        array $started,
        string $loginResponse,
        string $serverIdentity,
        string $context = '',
    ): array {
        $ke2 = Ke2::fromBase64Url($loginResponse);
        $credentialResponse = $ke2->credentialResponse;

        $randomizedPassword = self::randomizedPassword(
            $password,
            $started['blind'],
            $credentialResponse->evaluatedMessage
        );

        $pad = HkdfSha512::expand(
            HkdfSha512::expand($randomizedPassword, 'MaskingKey', 64),
            $credentialResponse->maskingNonce.'CredentialResponsePad',
            128
        );

        $unmasked = BinaryCodec::xorStrings($pad, $credentialResponse->maskedResponse);
        $serverPublicKey = substr($unmasked, 0, 32);
        $envelopeNonce = substr($unmasked, 32, 32);
        $authTag = substr($unmasked, 64, 64);

        $credentials = self::recoverCredentials(
            $randomizedPassword,
            $envelopeNonce,
            $serverPublicKey,
            $serverIdentity
        );

        if (! hash_equals($credentials['authTag'], $authTag)) {
            throw new RuntimeException('The envelope does not verify: wrong password or a different server.');
        }

        $authResponse = $ke2->authResponse;

        $ikm = BinaryCodec::concat(
            Ristretto255::scalarMultiply($started['ephemeralPrivateKey'], $authResponse->serverPublicKeyshare),
            Ristretto255::scalarMultiply($started['ephemeralPrivateKey'], $serverPublicKey),
            Ristretto255::scalarMultiply($credentials['clientPrivateKey'], $authResponse->serverPublicKeyshare),
        );

        $preamble = Preamble::build(
            $context,
            $credentials['clientPublicKey'],
            $started['ke1'],
            $serverIdentity,
            $credentialResponse,
            $authResponse->serverNonce,
            $authResponse->serverPublicKeyshare,
        );

        $keys = AkeKeySchedule::deriveKeys($ikm, $preamble);
        $serverMac = AkeKeySchedule::serverMac($keys->serverMacKey, $preamble);

        if (! hash_equals($serverMac, $authResponse->serverMac)) {
            throw new RuntimeException('Invalid server_mac: wrong password.');
        }

        return [
            'finishLoginRequest' => Base64Url::encode(
                AkeKeySchedule::clientMac($keys->clientMacKey, $preamble, $serverMac)
            ),
            'exportKey' => $credentials['exportKey'],
            'sessionKey' => $keys->sessionKey,
        ];
    }

    /**
     * `randomized_password = Extract("", oprf_output || Stretch(oprf_output))` (RFC 9807 §5.2.3),
     * con `Stretch` = identidad.
     */
    private static function randomizedPassword(string $password, string $blind, string $evaluatedMessage): string
    {
        $oprfOutput = Oprf::finalize($password, $blind, $evaluatedMessage);

        return HkdfSha512::extract('', $oprfOutput.$oprfOutput);
    }

    /**
     * `Store` / `Recover` (RFC 9807 §4.1.2 and §4.1.3): from `randomized_password` and the nonce
     * come the client key, the `export_key` and the `auth_tag` over the plaintext credentials.
     *
     * @return array{clientPrivateKey: string, clientPublicKey: string, exportKey: string, authTag: string}
     */
    private static function recoverCredentials(
        string $randomizedPassword,
        string $envelopeNonce,
        string $serverPublicKey,
        string $serverIdentity,
    ): array {
        $authKey = HkdfSha512::expand($randomizedPassword, $envelopeNonce.'AuthKey', 64);
        $exportKey = HkdfSha512::expand($randomizedPassword, $envelopeNonce.'ExportKey', 64);
        $seed = HkdfSha512::expand($randomizedPassword, $envelopeNonce.'PrivateKey', 32);

        [$clientPrivateKey, $clientPublicKey] = Oprf::deriveDiffieHellmanKeyPair($seed);

        /** `CreateCleartextCredentials` (RFC 9807 §4): `client_identity` toma su default. */
        $cleartextCredentials = BinaryCodec::concat(
            $serverPublicKey,
            BinaryCodec::lengthPrefixed($serverIdentity),
            BinaryCodec::lengthPrefixed($clientPublicKey),
        );

        return [
            'clientPrivateKey' => $clientPrivateKey,
            'clientPublicKey' => $clientPublicKey,
            'exportKey' => $exportKey,
            'authTag' => hash_hmac('sha512', $envelopeNonce.$cleartextCredentials, $authKey, true),
        ];
    }
}
