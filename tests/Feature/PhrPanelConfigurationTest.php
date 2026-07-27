<?php

declare(strict_types=1);

use App\Security\Opaque\Base64Url;
use App\Security\Opaque\OpaqueProfile;
use App\Security\Opaque\Oprf;
use App\Security\Opaque\RegistrationRecord;
use Filament\Panel;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Vite;

uses(RefreshDatabase::class);

/**
 * Wiring of the `phr` panel (Spec 0001 §9 and §10).
 */
function phrPanel(): Panel
{
    return filament()->getPanel('phr');
}

it('runs as an SPA but never prefetches', function (): void {
    /**
     * Prefetching requests the page when you hover over a link. Each of those requests is an access
     * to clinical data nobody asked for and it lands in the audit log as if the person had opened
     * the screen.
     */
    expect(phrPanel()->hasSpaMode())->toBeTrue()
        ->and(phrPanel()->hasSpaPrefetching())->toBeFalse();
});

it('keeps the JSON endpoints out of the SPA router', function (): void {
    expect(phrPanel()->getSpaUrlExceptions())
        ->toContain(url('/phr/auth/*'))
        ->toContain(url('/phr/logout'));
});

it('has no global search', function (): void {
    /** It would resolve on the server over encrypted data: it would find nothing and send what was typed. */
    expect(phrPanel()->getGlobalSearchProvider())->toBeNull();
});

it('emits the crypto module and the pinned OPAQUE parameters in the panel head', function (): void {
    [$privateKey] = Oprf::deriveDiffieHellmanKeyPair(str_repeat("\x11", OpaqueProfile::NSEED));
    [, $fakeClientPublicKey] = Oprf::deriveDiffieHellmanKeyPair(str_repeat("\x22", OpaqueProfile::NSEED));

    config(['opaque' => [
        'profile' => OpaqueProfile::NAME,
        'oprf_seed' => Base64Url::encode(str_repeat("\x44", OpaqueProfile::OPRF_SEED_BYTES)),
        'server_private_key' => Base64Url::encode($privateKey),
        'server_public_key' => null,
        'fake_registration_record' => (new RegistrationRecord(
            $fakeClientPublicKey,
            str_repeat("\x33", OpaqueProfile::NH),
            str_repeat("\x00", OpaqueProfile::ENVELOPE_BYTES),
        ))->toBase64Url(),
        'server_identity' => 'myemr.test/opaque-v1',
        'enumeration_key' => Base64Url::encode(str_repeat("\x55", 32)),
        'context' => '',
    ]]);

    $this->get(route('filament.phr.auth.login'))
        ->assertOk()
        ->assertSee('name="phr-opaque-profile" content="'.OpaqueProfile::NAME.'"', escape: false)
        ->assertSee('name="phr-opaque-server-identity" content="myemr.test/opaque-v1"', escape: false)
        ->assertSee('name="phr-opaque-server-public-key"', escape: false)
        ->assertSee('<script type="module" src="'.Vite::asset('resources/js/app.js'), escape: false);
});
