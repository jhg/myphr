<?php

declare(strict_types=1);

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

/**
 * El `lang` del `<html>` es la única fuente del idioma para todo lo que pinta JavaScript.
 *
 * `resources/js/i18n/index.js` lo lee una vez y lo recuerda: de ahí salen las etiquetas del panel de
 * salud, los pies de las gráficas y los mensajes de validación clínica. Si el servidor emite ahí un
 * idioma distinto del que usa para renderizar con `__()`, la pantalla acaba en dos idiomas a la vez
 * y ningún test lo nota, porque cada mitad es correcta por su lado.
 */
it('emite en el html el mismo idioma que usa para renderizar', function (): void {
    $user = User::factory()->registered()->create(['locale' => 'zh_CN']);

    $html = $this->actingAs($user)
        ->get('/phr')
        ->assertOk()
        ->getContent();

    expect($html)->toContain('lang="zh-CN"')
        ->and($html)->toContain('data-phr-locale="zh_CN"');
});

it('respeta la cabecera del navegador en las pantallas sin sesión', function (): void {
    $html = $this->get('/phr/login', ['Accept-Language' => 'zh-CN,zh;q=0.9'])
        ->assertOk()
        ->getContent();

    expect($html)->toContain('lang="zh-CN"')
        ->and($html)->toContain('data-phr-locale="zh_CN"');
});

/**
 * El marcador tiene que viajar en el `<body>`, no en el `<head>`.
 *
 * Ahí está el fallo que este fichero existe para impedir: Livewire navega sin recargar y reemplaza
 * el `<body>`, pero no los atributos del `<html>` ni el `<head>`. Un idioma leído solo de la
 * cabecera se queda en el de la primera carga, que en la práctica es el de la pantalla de acceso,
 * servida por `Accept-Language` cuando todavía no hay sesión.
 */
it('emite el marcador dentro del body', function (): void {
    $user = User::factory()->registered()->create(['locale' => 'es']);

    $html = $this->actingAs($user)->get('/phr')->assertOk()->getContent();

    $bodyStart = strpos($html, '<body');
    $markerAt = strpos($html, 'data-phr-locale');

    expect($bodyStart)->not->toBeFalse()
        ->and($markerAt)->not->toBeFalse()
        ->and($markerAt)->toBeGreaterThan($bodyStart);
});

/**
 * El menú de usuario se traduce en cada petición, no al construir el panel.
 *
 * `PhrPanelProvider::panel()` corre una sola vez, al registrar el panel, y en ese momento todavía no
 * ha pasado `SetLocale`: un `__()` evaluado ahí congela la traducción del primer idioma que hubiera.
 * Es el mismo motivo por el que los títulos de las páginas se resuelven por método y no como
 * propiedad estática.
 */
it('traduce el menú de usuario en el idioma de la cuenta', function (): void {
    $user = User::factory()->registered()->create(['locale' => 'zh_CN']);

    $this->actingAs($user)
        ->get('/phr')
        ->assertOk()
        ->assertSee('我的资料', false)
        ->assertDontSee('My profile', false);
});

/**
 * Guardia contra la recaída: ya han sido tres en este proyecto.
 *
 * El cuerpo de `panel()` corre una sola vez. Toda traducción que aparezca ahí tiene que estar dentro
 * de un `Closure` para que Filament la resuelva al pintar, con `SetLocale` ya aplicado. Escrita como
 * cadena suelta se congela en el idioma por defecto y el fallo no da ningún error: simplemente sale
 * en el idioma equivocado, que es de lo más difícil de notar revisando código.
 */
it('no evalúa ninguna traducción al construir el panel', function (): void {
    $lines = file(app_path('Providers/Filament/PhrPanelProvider.php'), FILE_IGNORE_NEW_LINES);

    /**
     * Se miran solo líneas de código. Los comentarios que explican por qué la traducción va dentro
     * de un `Closure` mencionan `__()` por fuerza, y contarlos haría fallar el test por documentar
     * justo lo que quiere impedir.
     */
    $eager = array_filter(
        $lines,
        static function (string $line): bool {
            $trimmed = ltrim($line);

            return str_contains($line, '__(')
                && ! str_starts_with($trimmed, '*')
                && ! str_starts_with($trimmed, '//')
                && ! str_starts_with($trimmed, '/*')
                && ! str_contains($line, 'fn (')
                && ! str_contains($line, 'function (');
        },
    );

    expect($eager)->toBe([], 'Traducción evaluada fuera de un Closure: '.implode(' | ', $eager));
});
