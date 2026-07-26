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
