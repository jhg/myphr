<?php

declare(strict_types=1);

use App\Security\Opaque\AuthResponse;
use App\Security\Opaque\Base64Url;
use App\Security\Opaque\CredentialResponse;
use App\Security\Opaque\Ke1;
use App\Security\Opaque\Ke2;
use App\Security\Opaque\Ke3;
use App\Security\Opaque\OpaqueException;
use App\Security\Opaque\OpaqueProfile;
use App\Security\Opaque\Oprf;
use App\Security\Opaque\RegistrationRecord;
use App\Security\Opaque\RegistrationRequest;
use App\Security\Opaque\RegistrationResponse;
use App\Security\Opaque\RegistrationServer;
use App\Security\Opaque\Ristretto255;
use App\Security\Opaque\ServerLogin;
use App\Security\Opaque\ServerLoginState;
use App\Security\Opaque\ServerSetup;
use App\Security\Opaque\SystemRandomSource;
use Tests\Unit\Security\Opaque\Support\DeterministicByteStream;

/**
 * Light fuzzing from `docs/OPAQUE.md` §20.7.
 *
 * Pseudorandom inputs of 0 to 512 bytes against every message parser and
 * against the primitives that take remote data. What §20.7 demands:
 *
 * - no PHP warning, notice or deprecation (they are turned into exceptions);
 * - no out-of-range access (short `substr()`, failed `unpack()`…);
 * - no unhandled type error (`TypeError`, `ValueError`,
 *   `SodiumException`, `ErrorException`…);
 * - only protocol exceptions, that is, subclasses of
 *   {@see OpaqueException}.
 *
 * The generator is deterministic ({@see DeterministicByteStream}): if an
 * input breaks something, the test seed reproduces it.
 */

/** Number of random inputs per parser. */
const FUZZ_ITERATIONS = 400;

/** Maximum input length required by §20.7. */
const FUZZ_MAX_LENGTH = 512;

/**
 * Runs `$parser` over random inputs and over the boundary lengths, and fails
 * if anything other than an {@see OpaqueException} escapes.
 *
 * The boundary lengths (0, 1, `$exactLength - 1`, `$exactLength`,
 * `$exactLength + 1`, 512) are always tried: parser bugs live right on the
 * edge, and uniform sampling of 0..512 rarely visits them.
 *
 * @param  callable(string): mixed  $parser  Parser under test.
 * @param  int|null  $exactLength  Valid message length, if it has a fixed one.
 * @param  list<class-string<Throwable>>  $allowed  Acceptable exceptions. By
 *                                                  default only the protocol ones.
 */
function fuzzParser(
    string $label,
    callable $parser,
    ?int $exactLength = null,
    array $allowed = [OpaqueException::class],
): void {
    $stream = new DeterministicByteStream("opaque-fuzz-{$label}");

    $lengths = [0, 1, 2, 31, 32, 33, 63, 64, 65, FUZZ_MAX_LENGTH];

    if ($exactLength !== null) {
        $lengths[] = max(0, $exactLength - 1);
        $lengths[] = $exactLength;
        $lengths[] = $exactLength + 1;
    }

    for ($i = 0; $i < FUZZ_ITERATIONS; $i++) {
        $lengths[] = $stream->intBetween(0, FUZZ_MAX_LENGTH);
    }

    $previous = set_error_handler(
        /** Turns any PHP diagnostic into an exception so the test fails. */
        static function (int $severity, string $message, string $file, int $line): bool {
            throw new ErrorException($message, 0, $severity, $file, $line);
        }
    );

    try {
        foreach ($lengths as $length) {
            $input = $stream->bytes($length);

            try {
                $parser($input);
            } catch (Throwable $unexpected) {
                foreach ($allowed as $allowedClass) {
                    if ($unexpected instanceof $allowedClass) {
                        // Handled exception: this is what §20.7 allows.
                        continue 2;
                    }
                }

                throw new RuntimeException(
                    sprintf(
                        '%s leaked %s on a %d-byte input (%s): %s',
                        $label,
                        $unexpected::class,
                        $length,
                        bin2hex($input),
                        $unexpected->getMessage()
                    ),
                    0,
                    $unexpected
                );
            }
        }
    } finally {
        restore_error_handler();

        if ($previous !== null) {
            // `restore_error_handler()` ya devuelve el handler anterior; esta
            // check only documents that it has not been lost.
            set_error_handler($previous);
            restore_error_handler();
        }
    }

    expect(true)->toBeTrue();
}

/** A valid, deterministic setup to fuzz the layers that need one. */
function fuzzServerSetup(): ServerSetup
{
    [$privateKey] = Oprf::deriveDiffieHellmanKeyPair(str_repeat("\x11", 32));
    [, $fakeClientPublicKey] = Oprf::deriveDiffieHellmanKeyPair(str_repeat("\x22", 32));

    return new ServerSetup(
        str_repeat("\x33", OpaqueProfile::OPRF_SEED_BYTES),
        $privateKey,
        Ristretto255::scalarMultiplyBase($privateKey),
        new RegistrationRecord(
            $fakeClientPublicKey,
            str_repeat("\x44", OpaqueProfile::NH),
            str_repeat("\x00", OpaqueProfile::ENVELOPE_BYTES),
        ),
        'fuzz.example/opaque-v1',
    );
}

it('survives random input on every wire-message parser', function (string $label, callable $parser, ?int $exactLength): void {
    fuzzParser($label, $parser, $exactLength);
})->with([
    'RegistrationRequest::parse' => ['RegistrationRequest::parse', RegistrationRequest::parse(...), 32],
    'RegistrationResponse::parse' => ['RegistrationResponse::parse', RegistrationResponse::parse(...), 64],
    'RegistrationRecord::parse' => ['RegistrationRecord::parse', RegistrationRecord::parse(...), 192],
    'CredentialResponse::parse' => ['CredentialResponse::parse', CredentialResponse::parse(...), 192],
    'AuthResponse::parse' => ['AuthResponse::parse', AuthResponse::parse(...), 128],
    'Ke1::parse' => ['Ke1::parse', Ke1::parse(...), 96],
    'Ke2::parse' => ['Ke2::parse', Ke2::parse(...), 320],
    'Ke3::parse' => ['Ke3::parse', Ke3::parse(...), 64],
    'ServerLoginState::parse' => ['ServerLoginState::parse', ServerLoginState::parse(...), 128],
]);

it('survives random input on the base64url decoders', function (): void {
    // Raw binary bytes: nearly all of them fall outside the alphabet.
    fuzzParser('Base64Url::decode(binary)', static fn (string $input): string => Base64Url::decode($input), null);

    fuzzParser(
        'Base64Url::decodeExactly(binary)',
        static fn (string $input): string => Base64Url::decodeExactly($input, 32),
        null
    );

    // Strings inside the base64url alphabet: they exercise the impossible-length
    // (% 4 === 1) and non-canonical encoding branches, which binary inputs
    // binarias casi nunca alcanzan.
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

    fuzzParser(
        'Base64Url::decode(alphabet)',
        static function (string $input) use ($alphabet): string {
            $encoded = '';

            for ($i = 0; $i < strlen($input); $i++) {
                $encoded .= $alphabet[ord($input[$i]) % 64];
            }

            return Base64Url::decode($encoded);
        },
        null
    );

    // Inputs that really are valid base64url: it checks that the round trip does
    // not break and that `decodeExactly` only complains about the length.
    fuzzParser(
        'Base64Url::decodeExactly(valid)',
        static fn (string $input): string => Base64Url::decodeExactly(Base64Url::encode($input), 32),
        null
    );
});

it('survives random input on the base64url wire entry points', function (string $label, callable $parser): void {
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

    // Raw bytes: most are rejected by the alphabet.
    fuzzParser($label.'(binary)', $parser);

    // Strings from the base64url alphabet: they reach the length and canonicity
    // checks, and some of them even the binary parser behind.
    fuzzParser(
        $label.'(alphabet)',
        static function (string $input) use ($alphabet, $parser): mixed {
            $encoded = '';

            for ($i = 0; $i < strlen($input); $i++) {
                $encoded .= $alphabet[ord($input[$i]) % 64];
            }

            return $parser($encoded);
        }
    );

    // Canonical base64url of a random input: it always decodes, so the rejection
    // has to come from the length or from point validation.
    fuzzParser(
        $label.'(canonical)',
        static fn (string $input): mixed => $parser(Base64Url::encode($input))
    );
})->with([
    'RegistrationRequest::fromBase64Url' => ['RegistrationRequest::fromBase64Url', RegistrationRequest::fromBase64Url(...)],
    'RegistrationResponse::fromBase64Url' => ['RegistrationResponse::fromBase64Url', RegistrationResponse::fromBase64Url(...)],
    'RegistrationRecord::fromBase64Url' => ['RegistrationRecord::fromBase64Url', RegistrationRecord::fromBase64Url(...)],
    'Ke1::fromBase64Url' => ['Ke1::fromBase64Url', Ke1::fromBase64Url(...)],
    'Ke2::fromBase64Url' => ['Ke2::fromBase64Url', Ke2::fromBase64Url(...)],
    'Ke3::fromBase64Url' => ['Ke3::fromBase64Url', Ke3::fromBase64Url(...)],
]);

it('survives random input on the ristretto255 wrapper', function (): void {
    fuzzParser('Ristretto255::validatePoint', Ristretto255::validatePoint(...), 32);
    fuzzParser('Ristretto255::validateScalar', Ristretto255::validateScalar(...), 32);
    fuzzParser('Ristretto255::scalarReduce', Ristretto255::scalarReduce(...), 64);
    fuzzParser('Ristretto255::pointFromHash', Ristretto255::pointFromHash(...), 64);
    fuzzParser('Ristretto255::scalarMultiplyBase', Ristretto255::scalarMultiplyBase(...), 32);
    fuzzParser('Ristretto255::scalarInvert', Ristretto255::scalarInvert(...), 32);

    $validPoint = Ristretto255::pointFromHash(str_repeat("\x5c", 64));

    fuzzParser(
        'Ristretto255::scalarMultiply(scalar)',
        static fn (string $input): string => Ristretto255::scalarMultiply($input, $validPoint),
        32
    );

    $validScalar = Ristretto255::scalarReduce(str_repeat("\x6d", 64));

    fuzzParser(
        'Ristretto255::scalarMultiply(point)',
        static fn (string $input): string => Ristretto255::scalarMultiply($validScalar, $input),
        32
    );
});

it('survives random input on the OPRF server functions', function (): void {
    $oprfKey = Oprf::deriveOprfKey(str_repeat("\x7e", 64), str_repeat("\x01", 32));

    fuzzParser(
        'Oprf::blindEvaluate(element)',
        static fn (string $input): string => Oprf::blindEvaluate($oprfKey, $input),
        32
    );

    fuzzParser(
        'Oprf::blindEvaluate(key)',
        static fn (string $input): string => Oprf::blindEvaluate($input, Ristretto255::pointFromHash(str_repeat("\x2f", 64))),
        32
    );

    // `oprf_seed` does not come from the wire: `ServerSetup` validates it at boot,
    // so no remote byte can reach here with an unexpected length. With a short
    // PRK corto, `HkdfSha512::expand()` lanza `InvalidConfigurationException`
    // PRK, `HkdfSha512::expand()` throws `InvalidConfigurationException` (an
    // `OpaqueException` (`docs/OPAQUE.md` §18).
    fuzzParser(
        'Oprf::deriveOprfKey(seed)',
        static fn (string $input): string => Oprf::deriveOprfKey($input, str_repeat("\x01", 32)),
        64,
        [OpaqueException::class]
    );

    fuzzParser(
        'Oprf::deriveOprfKey(identifier)',
        static fn (string $input): string => Oprf::deriveOprfKey(str_repeat("\x7e", 64), $input),
        32
    );

    fuzzParser(
        'Oprf::deriveDiffieHellmanKeyPair',
        static fn (string $input): array => Oprf::deriveDiffieHellmanKeyPair($input),
        32
    );
});

it('survives random input on the full server registration and login entry points', function (): void {
    $setup = fuzzServerSetup();
    $registrationServer = new RegistrationServer($setup);

    // registration/start: raw client bytes all the way to the server OPRF.
    fuzzParser(
        'RegistrationServer::createRegistrationResponse',
        static fn (string $input): RegistrationResponse => $registrationServer->createRegistrationResponse(
            RegistrationRequest::parse($input),
            str_repeat("\x55", OpaqueProfile::CREDENTIAL_IDENTIFIER_BYTES),
        ),
        32
    );

    // registration/finish: el record llega del cliente y se persiste.
    fuzzParser(
        'RegistrationRecord::parse (upload)',
        RegistrationRecord::parse(...),
        192
    );

    $login = new ServerLogin(new SystemRandomSource);

    // login/start completo: KE1 crudo → CredentialResponse → KE2.
    fuzzParser(
        'ServerLogin::createCredentialResponse+authServerRespond',
        static function (string $input) use ($login, $setup): void {
            $ke1 = Ke1::parse($input);

            $credentialResponse = $login->createCredentialResponse(
                $ke1,
                $setup->fakeRegistrationRecord,
                $setup->oprfSeed,
                str_repeat("\x55", OpaqueProfile::CREDENTIAL_IDENTIFIER_BYTES),
                $setup->serverPublicKey,
            );

            $login->authServerRespond(
                $ke1,
                $credentialResponse,
                $setup->fakeRegistrationRecord,
                $setup->serverPrivateKey,
                $setup->serverIdentity,
                $setup->context,
            );
        },
        96
    );

    // login/finish: KE3 crudo contra un estado fijo.
    $state = new ServerLoginState(str_repeat("\x66", 64), str_repeat("\x77", 64));

    fuzzParser(
        'ServerLogin::serverFinish',
        static fn (string $input): string => ServerLogin::serverFinish(Ke3::parse($input), $state),
        64
    );
});
