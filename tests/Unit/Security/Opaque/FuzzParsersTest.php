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
 * Fuzzing ligero de `docs/OPAQUE.md` §20.7.
 *
 * Entradas pseudoaleatorias de 0 a 512 bytes contra cada parser de mensajes y
 * contra las primitivas que reciben datos remotos. Exigencias de §20.7:
 *
 * - ningún warning, notice o deprecation de PHP (se convierten en excepción);
 * - ningún acceso fuera de rango (`substr()` corto, `unpack()` fallido…);
 * - ningún error de tipo no controlado (`TypeError`, `ValueError`,
 *   `SodiumException`, `ErrorException`…);
 * - sólo excepciones de protocolo, es decir, subclases de
 *   {@see OpaqueException}.
 *
 * El generador es determinista ({@see DeterministicByteStream}): si una
 * entrada rompe algo, la semilla del test la reproduce.
 */

/** Número de entradas aleatorias por parser. */
const FUZZ_ITERATIONS = 400;

/** Longitud máxima de entrada exigida por §20.7. */
const FUZZ_MAX_LENGTH = 512;

/**
 * Ejecuta `$parser` sobre entradas aleatorias y sobre las longitudes frontera,
 * y falla si algo distinto de una {@see OpaqueException} escapa.
 *
 * Las longitudes frontera (0, 1, `$exactLength - 1`, `$exactLength`,
 * `$exactLength + 1`, 512) se prueban siempre: los fallos de parser viven
 * justo en el borde, y el muestreo uniforme de 0..512 los visita poco.
 *
 * @param  callable(string): mixed  $parser  Parser bajo prueba.
 * @param  int|null  $exactLength  Longitud válida del mensaje, si tiene una fija.
 * @param  list<class-string<Throwable>>  $allowed  Excepciones aceptables. Por
 *                                                  defecto sólo las de protocolo.
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
        /** Convierte cualquier diagnóstico de PHP en excepción para que el test falle. */
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
                        // Excepción controlada: es lo que §20.7 permite.
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
            // comprobación sólo documenta que no se ha perdido.
            set_error_handler($previous);
            restore_error_handler();
        }
    }

    expect(true)->toBeTrue();
}

/** Setup válido y determinista para fuzzear las capas que lo necesitan. */
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
    // Bytes binarios crudos: casi todos caen fuera del alfabeto.
    fuzzParser('Base64Url::decode(binary)', static fn (string $input): string => Base64Url::decode($input), null);

    fuzzParser(
        'Base64Url::decodeExactly(binary)',
        static fn (string $input): string => Base64Url::decodeExactly($input, 32),
        null
    );

    // Cadenas dentro del alfabeto base64url: ejercitan las ramas de longitud
    // imposible (% 4 === 1) y de codificación no canónica, que las entradas
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

    // Entradas que sí son base64url válido: comprueba que el round-trip no
    // rompe y que `decodeExactly` sólo se queja de la longitud.
    fuzzParser(
        'Base64Url::decodeExactly(valid)',
        static fn (string $input): string => Base64Url::decodeExactly(Base64Url::encode($input), 32),
        null
    );
});

it('survives random input on the base64url wire entry points', function (string $label, callable $parser): void {
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

    // Bytes crudos: la mayoría se rechazan por alfabeto.
    fuzzParser($label.'(binary)', $parser);

    // Cadenas del alfabeto base64url: llegan hasta la comprobación de longitud
    // y canonicidad, y algunas hasta el parser binario de detrás.
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

    // Base64url canónico de una entrada aleatoria: siempre decodifica, así que
    // el rechazo tiene que venir de la longitud o de la validación de puntos.
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

    // `oprf_seed` no viene del cable: lo valida `ServerSetup` al arrancar, así
    // que ningún byte remoto puede llegar aquí con longitud inesperada. Con un
    // PRK corto, `HkdfSha512::expand()` lanza `InvalidConfigurationException`
    // (precondición de RFC 5869 §2.3), que ya está dentro de la jerarquía de
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

    // registration/start: bytes crudos del cliente hasta el OPRF del servidor.
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
