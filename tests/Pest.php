<?php

use App\Crypto\EnvelopeValidator;
use App\Security\Opaque\Base64Url;
use App\Security\Opaque\OpaqueProfile;
use App\Security\Opaque\Oprf;
use App\Security\Opaque\RegistrationRecord;
use Illuminate\Foundation\Testing\RefreshDatabase;
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
 * Sobre cifrado de mentira, con la forma que valida `App\Crypto\EnvelopeValidator`.
 *
 * El servidor no puede fabricar un sobre real porque no tiene la clave del cliente, así que los
 * tests del transporte usan uno bien formado pero indescifrable: prefijo `v1.` más base64url de un
 * tamaño de relleno admitido. Es suficiente, porque el servidor solo valida la envoltura.
 *
 * Vive aquí, y no en cada fichero de test, porque lo necesitan las cuatro pantallas de eventos y
 * declararlo en dos ficheros de `Feature` rompe la suite entera con «cannot redeclare function».
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
 * Instante actual en la forma canónica del ADR 0004, que es la única que acepta `storeEvent`.
 */
function canonicalOccurredAtNow(): string
{
    return now()->utc()->format('Y-m-d\TH:i:s.u\Z');
}

/**
 * Identidad del servidor OPAQUE en los tests.
 *
 * Es un identificador de despliegue fijo, deliberadamente NO derivado del dominio: si cambiase con
 * `app.url`, las cuentas dejarían de poder entrar al mover el sitio de dominio (lo comprueban
 * `OpaqueServerIdentityIsDomainIndependentTest` y `DomainChangeDoesNotBreakAccountTest`). Vive aquí
 * porque el cliente de pruebas la necesita en `finishLogin`/`finishRegistration` de media docena de
 * ficheros: si cada uno declarase la suya, un cambio en una sola convertiría el resto en tests que
 * pasan por casualidad.
 */
const TEST_SERVER_IDENTITY = 'myemr.test/opaque-v1';

/**
 * Configuración OPAQUE equivalente a la que produce `opaque:setup`, con material fijo para que un
 * fallo sea reproducible.
 *
 * Vive aquí, y no en cada fichero de test, porque la necesitan todos los flujos de autenticación
 * (alta, login, cambio de contraseña, cambio de dominio) y declarar la misma función en dos
 * ficheros de `Feature` rompe la suite entera con «cannot redeclare function».
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
