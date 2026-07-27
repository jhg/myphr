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
 * Validation against the official Appendix C vectors of RFC 9807
 * (`docs/OPAQUE.md` §20.2).
 *
 * Only the `ristretto255-SHA512` profile ones are used: C.1.1, C.1.2 and C.2.1.
 * The vectors fix `KSF: Identity` and `Context: "OPAQUE-POC"`, so the context is
 * passed explicitly instead of taken from `ServerSetup`, which in this profile
 * forces it to be empty.
 *
 * Server randomness (`masking_nonce`, `server_nonce`, `server_keyshare_seed`, in
 * that order of consumption) is injected with {@see QueuedRandomSource}; no
 * global function is mocked.
 */

/**
 * Compares two binary strings, showing the diff in hexadecimal.
 */
function expectBytes(string $actual, string $expected, string $label): void
{
    expect(bin2hex($actual))->toBe(bin2hex($expected), $label);
}

/**
 * Reproduces the client side of the registration that the vectors publish
 * (RFC 9807 §5.2.1 and §5.2.3), with `Stretch()` = identity.
 *
 * It helps locate a divergence before reaching the AKE: if
 * `randomized_password` already does not match, the fault is in the OPRF or in
 * HKDF, not in the key schedule.
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
    // The vector uses KSF = Identity, so Stretch(x) = x.
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
 * Walks the server login against a vector and checks, in order, the
 * intermediate values the RFC publishes before comparing `KE2`.
 *
 * @param  array<string, string>  $vector
 * @param  string|null  $clientIdentity  `null` applies the RFC 9807 §4 default.
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

    // The server 3DH (RFC 9807 §6.4.4) recomputed separately so we can compare
    // the preamble and the vector's intermediate keys.
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

    // No client_identity and no server_identity: RFC 9807 §4 says to use the
    // public keys as defaults.
    assertLoginVector($vector, $record, null, $vector['server_public_key']);
});

it('reproduces RFC 9807 C.1.2 (real, ristretto255-SHA512, explicit identities)', function (): void {
    $vector = Rfc9807Vectors::realVector2();

    $record = assertRegistrationVector($vector);

    assertLoginVector($vector, $record, $vector['client_identity'], $vector['server_identity']);
});

it('reproduces RFC 9807 C.2.1 (fake record for an unregistered user)', function (): void {
    $vector = Rfc9807Vectors::fakeVector1();

    // RFC 9807 §6.3.2.2: the fake registration envelope is Nn + Nm zero bytes;
    // the vector does not list it precisely because of that (`docs/OPAQUE.md` §13.2).
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
