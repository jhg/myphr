<?php

use App\Crypto\EnvelopeValidator;
use App\Security\Opaque\Base64Url;
use App\Security\Opaque\OpaqueProfile;
use App\Security\Opaque\Oprf;
use App\Security\Opaque\RegistrationRecord;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Symfony\Component\Process\Process;
use Tests\TestCase;

/*
|--------------------------------------------------------------------------
| Test Case
|--------------------------------------------------------------------------
|
| The closure you provide to your test functions is always bound to a specific PHPUnit test
| case class. By default, that class is "PHPUnit\Framework\TestCase". Of course, you may
| need to change it using the "pest()" function to bind different classes or traits.
|
*/

pest()->extend(TestCase::class)
 // ->use(RefreshDatabase::class)
    ->in('Feature');

/*
|--------------------------------------------------------------------------
| Expectations
|--------------------------------------------------------------------------
|
| When you're writing tests, you often need to check that values meet certain conditions. The
| "expect()" function gives you access to a set of "expectations" methods that you can use
| to assert different things. Of course, you may extend the Expectation API at any time.
|
*/

expect()->extend('toBeOne', function () {
    return $this->toBe(1);
});

/*
|--------------------------------------------------------------------------
| Functions
|--------------------------------------------------------------------------
|
| While Pest is very powerful out-of-the-box, you may have some testing code specific to your
| project that you don't want to repeat in every file. Here you can also expose helpers as
| global functions to help you to reduce the number of lines of code in your test files.
|
*/

/**
 * A fake encrypted envelope, with the shape `App\Crypto\EnvelopeValidator` validates.
 *
 * The server cannot build a real envelope because it has no client key, so the transport tests use
 * a well-formed but undecryptable one: the `v1.` prefix plus base64url of an allowed padding size.
 * That is enough, because the server only validates the wrapper.
 *
 * It lives here, and not in each test file, because the four event screens need it and declaring it
 * in two `Feature` files breaks the whole suite with "cannot redeclare function".
 */
function envelopeCipherText(int $paddedSize = 256): string
{
    $totalBytes = EnvelopeValidator::HEADER_BYTES
        + EnvelopeValidator::TAG_BYTES
        + $paddedSize;

    return EnvelopeValidator::PREFIX
        .rtrim(strtr(base64_encode(random_bytes($totalBytes)), '+/', '-_'), '=');
}

/**
 * The current instant in the canonical ADR 0004 form, which is the only one `storeEvent` accepts.
 */
function canonicalOccurredAtNow(): string
{
    return now()->utc()->format('Y-m-d\TH:i:s.u\Z');
}

/**
 * Runs one command of the JavaScript half of the sharing tests.
 *
 * Lives here, and not in a single test file, because two `Feature` files now need it and declaring
 * the same function twice breaks the whole suite with "cannot redeclare function".
 *
 * @param  array<string, mixed>  $input
 * @return array<string, mixed>
 */
function runShareClient(string $command, array $input): array
{
    $process = new Process(
        ['node', base_path('tests/js/support/shareRoundTrip.mjs'), $command],
        base_path(),
        null,
        json_encode($input, JSON_THROW_ON_ERROR),
        120,
    );

    $process->run();

    expect($process->getExitCode())->toBe(0, $process->getErrorOutput());

    /** @var array<string, mixed> $decoded */
    $decoded = json_decode($process->getOutput(), true, 512, JSON_THROW_ON_ERROR);

    expect($decoded['ok'])->toBeTrue(json_encode($decoded));

    return $decoded;
}

/**
 * OPAQUE server identity used in the tests.
 *
 * It is a fixed deployment identifier, deliberately NOT derived from the domain: if it changed with
 * `app.url`, accounts would stop being able to log in when the site moves domain (checked by
 * `OpaqueServerIdentityIsDomainIndependentTest` and `DomainChangeDoesNotBreakAccountTest`). It lives
 * here because the test client needs it in `finishLogin`/`finishRegistration` across half a dozen
 * files: if each one declared its own, a change in a single one would turn the rest into tests that
 * pass by accident.
 */
const TEST_SERVER_IDENTITY = 'myemr.test/opaque-v1';

/**
 * OPAQUE configuration equivalent to the one `opaque:setup` produces, with fixed material so a
 * failure is reproducible.
 *
 * It lives here, and not in each test file, because every authentication flow needs it (signup,
 * login, password change, domain change) and declaring the same function in two `Feature` files
 * breaks the whole suite with "cannot redeclare function".
 *
 * @return array<string, mixed>
 */
function opaqueEndpointConfig(): array
{
    [$privateKey] = Oprf::deriveDiffieHellmanKeyPair(str_repeat("\x11", OpaqueProfile::NSEED));
    [, $fakeClientPublicKey] = Oprf::deriveDiffieHellmanKeyPair(str_repeat("\x22", OpaqueProfile::NSEED));

    $fakeRecord = new RegistrationRecord(
        $fakeClientPublicKey,
        str_repeat("\x33", OpaqueProfile::NH),
        str_repeat("\x00", OpaqueProfile::ENVELOPE_BYTES),
    );

    return [
        'profile' => OpaqueProfile::NAME,
        'oprf_seed' => Base64Url::encode(str_repeat("\x44", OpaqueProfile::OPRF_SEED_BYTES)),
        'server_private_key' => Base64Url::encode($privateKey),
        'server_public_key' => null,
        'fake_registration_record' => $fakeRecord->toBase64Url(),
        'server_identity' => TEST_SERVER_IDENTITY,
        'enumeration_key' => Base64Url::encode(str_repeat("\x55", 32)),
        'context' => '',
    ];
}
