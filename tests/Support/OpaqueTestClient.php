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
 * Cliente OPAQUE mínimo, **solo para pruebas** (RFC 9807 §5.2.1, §5.2.3, §6.2 y §6.4.3).
 *
 * En producción el cliente es `@serenity-kit/opaque` corriendo en el navegador; aquí se reimplementa
 * lo justo para poder ejercitar los cuatro endpoints contra el servidor real en un test de
 * integración, sin fixtures grabados y sin poder engañarse a sí mismo con valores precalculados.
 *
 * `Stretch` es la identidad, igual que en los vectores oficiales del Apéndice C: el KSF vive
 * enteramente en el cliente y el servidor es agnóstico a él, así que un Argon2id de 64 MiB por test
 * costaría segundos sin comprobar nada del servidor. El desajuste de KSF tiene su propia prueba de
 * regresión (`docs/OPAQUE.md` §20.5), que no es esta.
 */
final class OpaqueTestClient
{
    private function __construct() {}

    /**
     * `CreateRegistrationRequest` (RFC 9807 §5.2.1).
     *
     * @return array{blind: string, registrationRequest: string} `blind` binario, petición en base64url.
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
     * `GenerateKE3` (RFC 9807 §6.4.3): desenmascara, recupera el envelope, hace los tres
     * Diffie-Hellman en el orden espejo del servidor, verifica `server_mac` y produce `KE3`.
     *
     * @param  array{blind: string, ephemeralPrivateKey: string, ke1: Ke1, startLoginRequest: string}  $started
     * @return array{finishLoginRequest: string, exportKey: string, sessionKey: string}
     *
     * @throws RuntimeException Si el envelope o el `server_mac` no verifican, que es lo que el
     *                          cliente real traduce a «contraseña incorrecta».
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
            throw new RuntimeException('El envelope no verifica: contraseña incorrecta o servidor distinto.');
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
            throw new RuntimeException('server_mac inválido: contraseña incorrecta.');
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
     * `Store` / `Recover` (RFC 9807 §4.1.2 y §4.1.3): de `randomized_password` y el nonce salen la
     * clave del cliente, la `export_key` y el `auth_tag` sobre las credenciales en claro.
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
