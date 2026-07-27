<?php

declare(strict_types=1);

use App\Filament\Pages\Sharing;
use App\Models\User;
use App\Sharing\Shares;
use App\Sharing\ShareTtl;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Livewire;

uses(RefreshDatabase::class);

/** Módulo Alpine de la pantalla, fuente del contrato con el servidor y con el DOM. */
function sharingModuleSource(): string
{
    return file_get_contents(base_path('resources/js/health/sharePage.js'));
}

function sharingViewSource(): string
{
    return file_get_contents(base_path('resources/views/phr/pages/sharing.blade.php'));
}

/**
 * La plantilla sin sus comentarios `{{-- --}}`: los contratos se comprueban contra el marcado que
 * llega al navegador, no contra la prosa que lo explica, que nombra a propósito `wire:model` y
 * `bg-white` para decir por qué están o no están.
 */
function sharingViewMarkup(): string
{
    return preg_replace('/\{\{--.*?--\}\}/s', '', sharingViewSource());
}

/**
 * Tests de la pantalla de compartición (ADR 0011).
 *
 * Lo que se comprueba aquí es lo que puede romperse en silencio: que el catálogo que publica el
 * servidor y la lista de tipos que filtra el cliente no diverjan, que el componente Alpine esté
 * registrado, y que el marcado siga cumpliendo las dos reglas que el ADR pone por escrito (el PIN
 * y el QR nunca a la vez, y ningún `wire:model`).
 */
it('se pinta para una sesión autenticada', function (): void {
    $this->actingAs(User::factory()->registered()->create());

    Livewire::test(Sharing::class)
        ->assertOk()
        ->assertSee('phrSharePage', escape: false);
});

it('publica los tipos compartibles que el módulo del cliente sabe filtrar', function (): void {
    /**
     * Este es el test que más importa de este fichero. El servidor pinta las casillas y el cliente
     * filtra por el campo `type` que va **dentro** del sobre; si las dos listas dejan de coincidir,
     * la pantalla ofrece un tipo que nunca acaba dentro del recorte, y el resultado es un historial
     * al que le falta algo sin que nada falle.
     */
    preg_match('/export const SHAREABLE_TYPES = Object\.freeze\(\[(.*?)\]\)/s', sharingModuleSource(), $matches);

    expect($matches)->not->toBeEmpty();

    preg_match_all("/'([a-zA-Z]+)'/", $matches[1], $tokens);

    expect($tokens[1])->toBe(Sharing::SHAREABLE_TYPES);
});

it('publica las tres caducidades de la lista cerrada, con 24 horas por defecto', function (): void {
    $this->actingAs(User::factory()->registered()->create());

    $catalog = Livewire::test(Sharing::class)->instance()->catalog();

    expect(array_column($catalog['ttls'], 'token'))
        ->toBe(array_map(fn (ShareTtl $ttl): string => $ttl->value, ShareTtl::cases()));
    expect(array_column($catalog['ttls'], 'hours'))->toBe([1, 24, 168]);
    expect($catalog['defaultTtl'])->toBe(ShareTtl::Day->value);

    /** Toda etiqueta visible tiene que estar traducida, nunca el token crudo. */
    foreach ($catalog['ttls'] as $ttl) {
        expect($ttl['label'])->not->toBe($ttl['token']);
    }
});

it('publica los endpoints y la plantilla de la URL del lector', function (): void {
    $this->actingAs(User::factory()->registered()->create());

    $catalog = Livewire::test(Sharing::class)->instance()->catalog();

    expect($catalog['endpoints']['shares'])->toBe(route('filament.phr.shares.index'));

    /**
     * La plantilla lleva `{link}` sin rellenar y la construye `route()`: el prefijo público de la
     * página del lector puede cambiar, y el día que cambie tiene que cambiar en un solo sitio.
     */
    expect($catalog['readerUrlTemplate'])->toContain('{link}');
    expect(str_replace('{link}', 'x', $catalog['readerUrlTemplate']))->toBe(route('share.reader', ['link' => 'x']));

    expect($catalog['limits'])->toBe([
        'shares' => Shares::MAX_ACTIVE_SHARES,
        'links' => Shares::MAX_LINKS_PER_SHARE,
    ]);
});

it('no publica ningún dato del contenido en el catálogo', function (): void {
    /**
     * El catálogo lo emite el servidor en claro dentro del HTML. Solo puede llevar cosas públicas:
     * tipos, caducidades y URL. Si alguna vez alguien metiera aquí algo del historial, sería el
     * servidor sabiendo lo que este diseño existe para que no sepa.
     */
    $this->actingAs(User::factory()->registered()->create());

    $catalog = Livewire::test(Sharing::class)->instance()->catalog();

    expect(array_keys($catalog))
        ->toBe(['types', 'ttls', 'defaultTtl', 'endpoints', 'readerUrlTemplate', 'limits']);
});

it('registra el componente Alpine en app.js', function (): void {
    /**
     * Sin esta línea la pantalla se pinta entera y ningún botón responde, sin ningún error visible:
     * es el fallo silencioso contra el que avisa el propio `app.js`.
     */
    $app = file_get_contents(base_path('resources/js/app.js'));

    expect($app)->toContain("import { sharePage } from './health/sharePage.js';");
    expect($app)->toContain('phrSharePage: sharePage,');
    expect(sharingViewMarkup())->toContain('x-data="phrSharePage"');
});

it('no usa wire:model en ninguna parte de la pantalla', function (): void {
    /** ADR 0002: nada de lo que se elige aquí puede entrar en el snapshot de Livewire. */
    expect(sharingViewMarkup())->not->toContain('wire:model');
});

it('reutiliza el control de rango común y no escribe otro', function (): void {
    /**
     * Dos controles de rango con criterios distintos discreparían justo en el borde del día, que es
     * donde un registro entra o se queda fuera de lo que ve el médico.
     */
    expect(sharingViewSource())->toContain("@include('phr.partials.date-range'");
    expect(sharingModuleSource())->toContain("dateRangeControl({ preset: 'month' })");
});

it('nunca enseña el PIN y el QR a la vez', function (): void {
    /**
     * ADR 0011: «el PIN nunca aparece en la misma pantalla [que el QR], para que una sola foto no
     * contenga las dos mitades». Se comprueba sobre el marcado porque es ahí donde vive la regla:
     * el bloque del PIN se pinta solo con `! qrVisible` y el del QR solo con `qrVisible`.
     */
    $markup = sharingViewMarkup();

    expect($markup)->toContain('x-show="! qrVisible"');
    expect($markup)->toContain('x-show="qrVisible"');

    $pinPosition = strpos($markup, 'result.pin');
    $pinBlock = strrpos(substr($markup, 0, $pinPosition), 'x-show=');

    expect(substr($markup, $pinBlock, 30))->toContain('x-show="! qrVisible"');
});

it('avisa de las tres renuncias del ADR sin letra pequeña', function (): void {
    /**
     * Los tres avisos son los del apartado de consecuencias del ADR 0011 y tienen que estar a la
     * vista, no detrás de un desplegable: quien comparte tiene que saber que el enlace más el PIN
     * bastan, que revocar no recupera lo descargado, y que el servidor ve la frecuencia.
     */
    $markup = sharingViewMarkup();

    expect($markup)->toContain('Anyone holding both the link and the PIN can read the clipping.');
    expect($markup)->toContain('Revoking blocks future readings only.');
    expect($markup)->toContain('The server never learns what you share, but it does learn that you shared, when, and how often.');

    /** Nada de `<details>`: un aviso plegado es un aviso que se cuenta para poder decir que se contó. */
    expect($markup)->not->toContain('<details');
});

it('avisa de que el PIN se enseña una sola vez', function (): void {
    expect(sharingViewMarkup())->toContain('This PIN is shown once and is not stored anywhere.');
});

it('tiene traducidos los textos de la pantalla en los dos catálogos', function (): void {
    /**
     * El guardarraíl general (`LocaleTest`) ya barre todo el repositorio, pero estos tres textos
     * son los que se leen antes de tomar la decisión de compartir: si se quedaran en inglés en una
     * cuenta en castellano, quien más los necesita no los leería.
     */
    foreach (['es', 'zh_CN'] as $locale) {
        $catalog = json_decode(file_get_contents(base_path("lang/{$locale}.json")), true);

        expect($catalog)->toHaveKey('Before you share');
        expect($catalog)->toHaveKey('This PIN is shown once and is not stored anywhere.');
        expect($catalog)->toHaveKey('Share with a professional');
    }
});
