<?php

declare(strict_types=1);

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

/**
 * Installation on the home screen.
 *
 * The first two tests check what the browser requires before offering "install". The third is the
 * one that really matters here: that the service worker still caches nothing. A worker that archived
 * responses would create a new place where copies of the panel end up, and above all it would leave
 * an `app.js` a new deployment could no longer fix. It is one line of code away, so it had better
 * fail on its own if somebody crosses it.
 */
function manifest(): array
{
    $raw = file_get_contents(public_path('manifest.webmanifest'));

    return json_decode((string) $raw, true, 512, JSON_THROW_ON_ERROR);
}

it('publishes a manifest with what the browser requires to install', function (): void {
    $manifest = manifest();

    expect($manifest['name'])->toBe('myphr')
        ->and($manifest['display'])->toBe('standalone')
        ->and($manifest['start_url'])->toBe('/phr')
        ->and($manifest['scope'])->toBe('/phr')
        ->and($manifest['theme_color'])->toBe('#0077B6');

    $sizes = array_column($manifest['icons'], 'sizes');

    expect($sizes)->toContain('192x192')
        ->and($sizes)->toContain('512x512');
});

/**
 * The manifest paths carry no domain: the installed application must not end up tied to the domain
 * it was installed from (ADR 0003 and the domain independence test).
 */
it('does not tie the installed application to any domain', function (): void {
    $manifest = manifest();
    $urls = array_merge(
        [$manifest['start_url'], $manifest['scope'], $manifest['id']],
        array_column($manifest['icons'], 'src'),
    );

    foreach ($urls as $url) {
        expect($url)->toStartWith('/')
            ->and($url)->not->toContain('://');
    }
});

it('serves the declared icons at the size they claim to have', function (string $file, int $size): void {
    $path = public_path($file);

    expect(file_exists($path))->toBeTrue();

    [$width, $height] = getimagesize($path);

    expect($width)->toBe($size)->and($height)->toBe($size);
})->with([
    ['icons/icon-192.png', 192],
    ['icons/icon-512.png', 512],
    ['icons/apple-touch-icon.png', 180],
]);

/**
 * The check that holds the decision up: the moment the worker opens a cache or answers on its own,
 * it stops being a pass-through and becomes a store.
 */
it('keeps the service worker without cache and without intercepting responses', function (): void {
    $raw = (string) file_get_contents(public_path('sw.js'));

    /**
     * The code is checked, not the comments: the file header explains precisely why there is no
     * `respondWith`, and searching over the whole text would make the test fail for saying in prose
     * what it wants to prevent in code.
     */
    $worker = preg_replace(['#/\*.*?\*/#s', '#//[^\n]*#'], '', $raw);

    expect($worker)->toContain("addEventListener('fetch'")
        ->and($worker)->not->toContain('respondWith')
        ->and($worker)->not->toContain('caches.open')
        ->and($worker)->not->toContain('cache.put')
        ->and($worker)->not->toContain('cache.add');
});

/**
 * The install button has to reach the panel HTML. Who sees it is decided by the client —there are
 * three situations and only the browser knows them— but if the render hook disappears nobody sees it
 * and no other test would notice: the panel would keep working in full.
 */
it('emits the install button in the panel', function (): void {
    $user = User::factory()->registered()->create();

    $html = $this->actingAs($user)->get('/phr')->assertOk()->getContent();

    expect($html)->toContain('x-data="phrInstallButton"')
        ->and($html)->toContain(__('Install app'));
});

it('links the manifest and the iOS icon on the panel pages', function (): void {
    $this->get('/phr/login')
        ->assertOk()
        ->assertSee('rel="manifest"', false)
        ->assertSee('/manifest.webmanifest', false)
        ->assertSee('apple-touch-icon', false)
        ->assertSee('name="theme-color"', false);
});
