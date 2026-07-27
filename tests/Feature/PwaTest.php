<?php

declare(strict_types=1);

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

/**
 * Instalación en la pantalla de inicio.
 *
 * Los dos primeros tests comprueban lo que el navegador exige para ofrecer «instalar». El tercero es
 * el que de verdad importa aquí: que el service worker siga sin cachear nada. Un worker que archive
 * respuestas crearía un sitio nuevo donde acabarían copias del panel, y sobre todo dejaría un
 * `app.js` que un despliegue nuevo ya no podría corregir. Es una línea de código de distancia, así
 * que conviene que falle sola si alguien la cruza.
 */
function manifest(): array
{
    $raw = file_get_contents(public_path('manifest.webmanifest'));

    return json_decode((string) $raw, true, 512, JSON_THROW_ON_ERROR);
}

it('publica un manifiesto con lo que el navegador exige para instalar', function (): void {
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
 * Las rutas del manifiesto no llevan dominio: la aplicación instalada no puede quedar atada al
 * dominio con el que se instaló (ADR 0003 y el test de independencia de dominio).
 */
it('no ata la aplicación instalada a ningún dominio', function (): void {
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

it('sirve los iconos declarados con el tamaño que dicen tener', function (string $file, int $size): void {
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
 * La comprobación que sostiene la decisión: en cuanto el worker abra una caché o responda por su
 * cuenta, deja de ser un pasamanos y pasa a ser un almacén.
 */
it('mantiene el service worker sin caché y sin interceptar respuestas', function (): void {
    $raw = (string) file_get_contents(public_path('sw.js'));

    /**
     * Se comprueba el código, no los comentarios: la cabecera del fichero explica precisamente por
     * qué no hay `respondWith`, y buscarlo sobre el texto entero haría fallar el test por decir en
     * prosa lo que se quiere impedir en código.
     */
    $worker = preg_replace(['#/\*.*?\*/#s', '#//[^\n]*#'], '', $raw);

    expect($worker)->toContain("addEventListener('fetch'")
        ->and($worker)->not->toContain('respondWith')
        ->and($worker)->not->toContain('caches.open')
        ->and($worker)->not->toContain('cache.put')
        ->and($worker)->not->toContain('cache.add');
});

/**
 * El botón de instalar tiene que llegar al HTML del panel. Quién lo ve lo decide el cliente —hay
 * tres situaciones y solo el navegador las conoce—, pero si el render hook desaparece no lo ve
 * nadie y ningún otro test lo notaría: el panel seguiría funcionando entero.
 */
it('emite el botón de instalar en el panel', function (): void {
    $user = User::factory()->registered()->create();

    $html = $this->actingAs($user)->get('/phr')->assertOk()->getContent();

    expect($html)->toContain('x-data="phrInstallButton"')
        ->and($html)->toContain(__('Install app'));
});

it('enlaza el manifiesto y el icono de iOS en las páginas del panel', function (): void {
    $this->get('/phr/login')
        ->assertOk()
        ->assertSee('rel="manifest"', false)
        ->assertSee('/manifest.webmanifest', false)
        ->assertSee('apple-touch-icon', false)
        ->assertSee('name="theme-color"', false);
});
