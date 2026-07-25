<?php

declare(strict_types=1);

use App\Security\Opaque\AkeKeySchedule;
use App\Security\Opaque\BinaryCodec;
use App\Security\Opaque\ExpandLabel;
use App\Security\Opaque\HkdfSha512;
use App\Security\Opaque\Ke1;
use App\Security\Opaque\Ke3;
use App\Security\Opaque\Oprf;
use App\Security\Opaque\Preamble;
use App\Security\Opaque\RegistrationRecord;
use App\Security\Opaque\RegistrationRequest;
use App\Security\Opaque\RegistrationResponse;
use App\Security\Opaque\Ristretto255;
use App\Security\Opaque\ServerLogin;
use Tests\Unit\Security\Opaque\Support\QueuedRandomSource;
use Tests\Unit\Security\Opaque\Support\Rfc9807Vectors;

/**
 * Validación contra los vectores oficiales del Apéndice C de RFC 9807
 * (`docs/OPAQUE.md` §20.2).
 *
 * Sólo se usan los del perfil `ristretto255-SHA512`: C.1.1, C.1.2 y C.2.1.
 * Los vectores fijan `KSF: Identity` y `Context: "OPAQUE-POC"`, de modo que el
 * contexto se pasa explícitamente en lugar de tomarlo de `ServerSetup`, que en
 * este perfil lo obliga a ser vacío.
 *
 * La aleatoriedad del servidor (`masking_nonce`, `server_nonce`,
 * `server_keyshare_seed`, en ese orden de consumo) se inyecta con
 * {@see QueuedRandomSource}; no se mockea ninguna función global.
 */

/**
 * Compara dos cadenas binarias mostrando el diff en hexadecimal.
 */
function expectBytes(string $actual, string $expected, string $label): void
{
    expect(bin2hex($actual))->toBe(bin2hex($expected), $label);
}

/**
 * Reproduce la parte de cliente del registro que los vectores publican
 * (RFC 9807 §5.2.1 y §5.2.3), con `Stretch()` = identidad.
 *
 * Sirve para localizar una divergencia antes de llegar al AKE: si
 * `randomized_password` ya no cuadra, el fallo está en el OPRF o en HKDF, no
 * en el key schedule.
 *
 * @param  array<string, string>  $vector
 */
function assertRegistrationVector(array $vector): RegistrationRecord
{
    $blindedMessage = Oprf::blind($vector['password'], $vector['blind_registration']);
    expectBytes($blindedMessage, $vector['registration_request'], 'registration_request');

    $oprfKey = Oprf::deriveOprfKey($vector['oprf_seed'], $vector['credential_identifier']);
    expectBytes($oprfKey, $vector['oprf_key'], 'oprf_key');

    expectBytes(
        Ristretto255::scalarMultiplyBase($vector['server_private_key']),
        $vector['server_public_key'],
        'server_public_key'
    );

    $request = new RegistrationRequest($vector['registration_request']);
    $evaluatedMessage = Oprf::blindEvaluate($oprfKey, $request->blindedMessage);
    $response = new RegistrationResponse($evaluatedMessage, $vector['server_public_key']);
    expectBytes($response->serialize(), $vector['registration_response'], 'registration_response');

    // RFC 9807 §5.2.3: randomized_password = Extract("", oprf_output || Stretch(oprf_output)).
    // El vector usa KSF = Identity, así que Stretch(x) = x.
    $oprfOutput = Oprf::finalize(
        $vector['password'],
        $vector['blind_registration'],
        $response->evaluatedMessage
    );
    $randomizedPassword = HkdfSha512::extract('', $oprfOutput.$oprfOutput);
    expectBytes($randomizedPassword, $vector['randomized_password'], 'randomized_password');

    // RFC 9807 §4.1.2 (Store).
    $maskingKey = HkdfSha512::expand($randomizedPassword, 'MaskingKey', 64);
    expectBytes(
        HkdfSha512::expand($randomizedPassword, $vector['envelope_nonce'].'AuthKey', 64),
        $vector['auth_key'],
        'auth_key'
    );
    expectBytes(
        HkdfSha512::expand($randomizedPassword, $vector['envelope_nonce'].'ExportKey', 64),
        $vector['export_key'],
        'export_key'
    );

    $seed = HkdfSha512::expand($randomizedPassword, $vector['envelope_nonce'].'PrivateKey', 32);
    [, $clientPublicKey] = Oprf::deriveDiffieHellmanKeyPair($seed);
    expectBytes($clientPublicKey, $vector['client_public_key'], 'client_public_key');

    $record = RegistrationRecord::parse($vector['registration_upload']);
    expectBytes($record->clientPublicKey, $vector['client_public_key'], 'record.client_public_key');
    expectBytes($record->maskingKey, $maskingKey, 'record.masking_key');
    expectBytes($record->envelope, $vector['envelope'], 'record.envelope');

    return $record;
}

/**
 * Recorre el login del servidor contra un vector y comprueba, en orden,
 * los intermedios que el RFC publica antes de comparar `KE2`.
 *
 * @param  array<string, string>  $vector
 * @param  string|null  $clientIdentity  `null` aplica el default de RFC 9807 §4.
 */
function assertLoginVector(
    array $vector,
    RegistrationRecord $record,
    ?string $clientIdentity,
    string $serverIdentity,
): void {
    $ke1 = Ke1::parse($vector['KE1']);

    if (isset($vector['client_nonce'])) {
        expectBytes($ke1->clientNonce, $vector['client_nonce'], 'ke1.client_nonce');
    }

    if (isset($vector['blind_login'], $vector['password'])) {
        expectBytes(
            $ke1->blindedMessage,
            Oprf::blind($vector['password'], $vector['blind_login']),
            'ke1.blinded_message'
        );
    }

    [, $clientPublicKeyshare] = Oprf::deriveDiffieHellmanKeyPair($vector['client_keyshare_seed']);
    expectBytes($clientPublicKeyshare, $ke1->clientPublicKeyshare, 'ke1.client_public_keyshare');

    $randomSource = new QueuedRandomSource([
        $vector['masking_nonce'],
        $vector['server_nonce'],
        $vector['server_keyshare_seed'],
    ]);

    $login = new ServerLogin($randomSource);

    $credentialResponse = $login->createCredentialResponse(
        $ke1,
        $record,
        $vector['oprf_seed'],
        $vector['credential_identifier'],
        $vector['server_public_key'],
    );

    expectBytes(
        $credentialResponse->serialize(),
        BinaryCodec::slice($vector['KE2'], 0, 192, 'vector.credential_response'),
        'credential_response'
    );

    // 3DH del servidor (RFC 9807 §6.4.4) recalculado aparte para poder
    // comparar el preamble y las claves intermedias del vector.
    [$ephemeralPrivateKey, $serverPublicKeyshare] = Oprf::deriveDiffieHellmanKeyPair(
        $vector['server_keyshare_seed']
    );

    $ikm = BinaryCodec::concat(
        Ristretto255::scalarMultiply($ephemeralPrivateKey, $ke1->clientPublicKeyshare),
        Ristretto255::scalarMultiply($vector['server_private_key'], $ke1->clientPublicKeyshare),
        Ristretto255::scalarMultiply($ephemeralPrivateKey, $record->clientPublicKey),
    );

    $preamble = Preamble::build(
        $vector['context'],
        Preamble::resolveIdentity($clientIdentity, $record->clientPublicKey),
        $ke1,
        $serverIdentity,
        $credentialResponse,
        $vector['server_nonce'],
        $serverPublicKeyshare,
    );

    if (isset($vector['handshake_secret'])) {
        expectBytes(
            ExpandLabel::deriveSecret(
                HkdfSha512::extract('', $ikm),
                AkeKeySchedule::LABEL_HANDSHAKE_SECRET,
                AkeKeySchedule::hash($preamble)
            ),
            $vector['handshake_secret'],
            'handshake_secret'
        );

        $keys = AkeKeySchedule::deriveKeys($ikm, $preamble);
        expectBytes($keys->serverMacKey, $vector['server_mac_key'], 'server_mac_key');
        expectBytes($keys->clientMacKey, $vector['client_mac_key'], 'client_mac_key');
        expectBytes($keys->sessionKey, $vector['session_key'], 'session_key (DeriveKeys)');
        expectBytes(
            AkeKeySchedule::serverMac($keys->serverMacKey, $preamble),
            BinaryCodec::slice($vector['KE2'], 256, 64, 'vector.server_mac'),
            'server_mac'
        );
    }

    $result = $login->authServerRespond(
        $ke1,
        $credentialResponse,
        $record,
        $vector['server_private_key'],
        $serverIdentity,
        $vector['context'],
        $clientIdentity,
    );

    expectBytes($result->ke2->serialize(), $vector['KE2'], 'KE2');
    expect($randomSource->isExhausted())->toBeTrue();

    if (isset($vector['KE3'])) {
        expectBytes($result->state->expectedClientMac, $vector['KE3'], 'expected_client_mac');
        expectBytes($result->state->sessionKey, $vector['session_key'], 'session_key');
        expectBytes(
            ServerLogin::serverFinish(Ke3::parse($vector['KE3']), $result->state),
            $vector['session_key'],
            'ServerFinish(session_key)'
        );
    }
}

it('reproduces RFC 9807 C.1.1 (real, ristretto255-SHA512, default identities)', function (): void {
    $vector = Rfc9807Vectors::realVector1();

    $record = assertRegistrationVector($vector);

    // Sin client_identity ni server_identity: RFC 9807 §4 manda usar las
    // claves públicas como defaults.
    assertLoginVector($vector, $record, null, $vector['server_public_key']);
});

it('reproduces RFC 9807 C.1.2 (real, ristretto255-SHA512, explicit identities)', function (): void {
    $vector = Rfc9807Vectors::realVector2();

    $record = assertRegistrationVector($vector);

    assertLoginVector($vector, $record, $vector['client_identity'], $vector['server_identity']);
});

it('reproduces RFC 9807 C.2.1 (fake record for an unregistered user)', function (): void {
    $vector = Rfc9807Vectors::fakeVector1();

    // RFC 9807 §6.3.2.2: el envelope del registro ficticio son Nn + Nm bytes
    // cero; el vector no lo lista precisamente por eso (`docs/OPAQUE.md` §13.2).
    $record = new RegistrationRecord(
        $vector['client_public_key'],
        $vector['masking_key'],
        BinaryCodec::zeroes(96),
    );

    expectBytes(
        Ristretto255::scalarMultiplyBase($vector['client_private_key']),
        $vector['client_public_key'],
        'fake client_public_key'
    );

    assertLoginVector($vector, $record, $vector['client_identity'], $vector['server_identity']);
});
