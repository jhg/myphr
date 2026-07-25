<?php

declare(strict_types=1);

use App\Filament\Pages\Profile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\App;
use Livewire\Livewire;

uses(RefreshDatabase::class);

it('carga la página de perfil para un usuario autenticado', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    Livewire::test(Profile::class)
        ->assertOk()
        ->assertSee('Target blood glucose range')
        ->assertSee('Change your password');
});

/**
 * El inglés es el idioma de serie y las claves de traducción están en inglés, así que la misma
 * pantalla cambia de idioma sin tocar la plantilla. Sirve además de aviso si alguien borra una clave
 * de `lang/es.json`: el texto volvería al inglés en silencio y aquí se ve.
 */
it('pinta la página de perfil en el idioma en vigor', function (string $locale, string $expected): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    App::setLocale($locale);

    Livewire::test(Profile::class)
        ->assertOk()
        ->assertSee($expected);
})->with([
    'castellano' => ['es', 'Rango objetivo de glucemia'],
    'chino simplificado' => ['zh_CN', '血糖目标范围'],
]);

/**
 * El rango objetivo empieza vacío y sin valor sugerido (ADR 0007): un rango por defecto es una
 * indicación clínica, no una preferencia de interfaz. Este test vigila que nadie meta un `value` ni
 * un `placeholder` con números en los dos campos del rango «para que no se vean tan vacíos».
 */
it('no propone ningún valor para el rango objetivo', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $html = Livewire::test(Profile::class)->html();

    foreach (['profile-range-low', 'profile-range-high'] as $id) {
        expect(preg_match('/<input[^>]*id="'.$id.'"[^>]*>/', $html, $matches))->toBe(1);
        expect($matches[0])->not->toContain('value=');
        expect($matches[0])->not->toContain('placeholder=');
    }
});

/**
 * El mismo test que exige el ADR 0002 en el resto de pantallas: el snapshot del componente no puede
 * llevar ciphertext. Aquí importa por partida doble, porque el sobre de ajustes de esta cuenta es
 * justo lo que la pantalla edita, y tiene que llegar al navegador por el arranque de sesión
 * (`session-secret`), nunca incrustado en el HTML ni en el estado de Livewire.
 *
 * La llamada va por `call()` y no por `instance()`, igual que en `GlucosePageTest`: invocar sobre la
 * instancia se salta el ciclo de hidratación y deshidratación, y el snapshot inspeccionado sería el
 * de antes de la llamada.
 */
it('el snapshot del componente no contiene ningún sobre cifrado', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $test = Livewire::test(Profile::class)->call('$refresh');

    $snapshotJson = json_encode($test->snapshot);

    expect($snapshotJson)->not->toContain($user->encrypted_settings);
    expect($snapshotJson)->not->toContain('v1.');
    expect($test->html())->not->toContain($user->encrypted_settings);
});
