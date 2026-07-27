<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

/**
 * Browser tab icon.
 *
 * The panel is the only thing serving HTML in this application, so if its pages do not declare a
 * `<link rel="icon">` there is nowhere else to fix it: every tab is left with the generic icon. This
 * holds that declaration up and, above all, that it points at the same file as the PWA manifest, so
 * the tab and the installed application icon cannot drift apart.
 */
it('declares the icon on the panel pages', function (): void {
    /**
     * It is checked on the login screen because that one is painted without a session: the icon has
     * to be there before you identify yourself, which is exactly when the tab has just been opened.
     */
    $this->get('/phr/login')
        ->assertOk()
        ->assertSee('rel="icon"', false)
        ->assertSee('/icons/icon-192.png', false);
});

/**
 * The tab icon comes from the PWA set, not from one of its own. If somebody adds a second icon set
 * and points the favicon there, this test falls over: keeping two sets always ends with one getting
 * updated and the other forgotten.
 */
it('reuses an icon the manifest already declares', function (): void {
    $manifest = json_decode(
        (string) file_get_contents(public_path('manifest.webmanifest')),
        true,
        512,
        JSON_THROW_ON_ERROR,
    );

    expect(array_column($manifest['icons'], 'src'))->toContain('/icons/icon-192.png');
});

/**
 * `public/favicon.ico` used to be here with 0 bytes, which is worse than not being there: the
 * browser asks for it by convention, gets an empty file and paints a broken icon. With the
 * `<link rel="icon">` above, that path is no longer needed, so it is deliberately left absent. If it
 * comes back, let it be a deliberate decision with valid content, not an empty file restored by
 * accident.
 */
it('leaves no empty favicon.ico in the public root', function (): void {
    $path = public_path('favicon.ico');

    expect(file_exists($path) && filesize($path) === 0)->toBeFalse();
});
