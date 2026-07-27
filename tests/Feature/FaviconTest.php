<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

/**
 * Icono de la pestaña del navegador.
 *
 * El panel es lo único que sirve HTML en esta aplicación, así que si sus páginas no declaran un
 * `<link rel="icon">` no hay ningún otro sitio donde arreglarlo: todas las pestañas se quedan con
 * el icono genérico. Aquí se sostiene esa declaración y, sobre todo, que apunte al mismo fichero
 * que el manifiesto del PWA, para que la pestaña y el icono de la aplicación instalada no puedan
 * divergir.
 */
it('declara el icono en las páginas del panel', function (): void {
    /**
     * Se comprueba sobre la pantalla de acceso porque se pinta sin sesión: el icono tiene que estar
     * antes de identificarse, que es justo cuando la pestaña está recién abierta.
     */
    $this->get('/phr/login')
        ->assertOk()
        ->assertSee('rel="icon"', false)
        ->assertSee('/icons/icon-192.png', false);
});

/**
 * El icono de la pestaña sale del juego del PWA, no de uno propio. Si alguien añade un segundo
 * juego de iconos y apunta el favicon ahí, este test cae: mantener dos juegos termina siempre en
 * que se actualiza uno y se olvida el otro.
 */
it('reutiliza un icono que el manifiesto ya declara', function (): void {
    $manifest = json_decode(
        (string) file_get_contents(public_path('manifest.webmanifest')),
        true,
        512,
        JSON_THROW_ON_ERROR,
    );

    expect(array_column($manifest['icons'], 'src'))->toContain('/icons/icon-192.png');
});

/**
 * `public/favicon.ico` estuvo aquí con 0 bytes, que es peor que no estar: el navegador lo pide por
 * convención, recibe un fichero vacío y pinta un icono roto. Con el `<link rel="icon">` de arriba
 * esa ruta ya no hace falta, así que se deja ausente a propósito. Si vuelve, que sea una decisión
 * consciente y con contenido válido, no un fichero vacío recuperado sin querer.
 */
it('no deja un favicon.ico vacío en el raíz público', function (): void {
    $path = public_path('favicon.ico');

    expect(file_exists($path) && filesize($path) === 0)->toBeFalse();
});
