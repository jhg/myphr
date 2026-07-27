<?php

declare(strict_types=1);

use App\Filament\Pages\Profile;
use App\Models\Event;
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

/*
|--------------------------------------------------------------------------
| Bloque de solo lectura: últimas medidas corporales
|--------------------------------------------------------------------------
|
| Peso, estatura e IMC se calculan descifrando en el navegador. El servidor solo entrega ciphertext:
| aquí se comprueba la vía de lectura y que el bloque es de verdad de solo lectura, no un segundo
| sitio donde guardar la misma medida.
|
*/

it('muestra el bloque de últimas medidas, en solo lectura', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $html = Livewire::test(Profile::class)
        ->assertOk()
        ->assertSee('Latest body measurements')
        ->assertSee('Last weight')
        ->assertSee('Last height')
        ->assertSee('Body mass index')
        ->html();

    /**
     * Sin ningún control dentro de la región: las medidas se registran en la pantalla de peso y
     * estatura, con su fecha. Un campo aquí crearía dos verdades para el mismo día.
     */
    $region = str($html)->after('wire:key="profile-body-measurements-region"')->before('</section>')->toString();

    expect($region)->not->toContain('<input');
    expect($region)->not->toContain('<select');
    expect($region)->not->toContain('<textarea');
});

it('el bloque avisa de que el IMC no es un diagnóstico y no lo categoriza', function (): void {
    $template = file_get_contents(resource_path('views/phr/pages/profile.blade.php'));
    $module = file_get_contents(resource_path('js/auth/profilePage.js'));

    expect($template)->toContain('not a diagnosis');
    expect($template)->toContain('percentiles for age and sex');

    /** Ni categorías ni umbrales en la plantilla ni en el módulo (ver `health/bodyMassIndex.js`). */
    foreach (['Overweight', 'Obese', 'Underweight', 'Normal weight'] as $verdict) {
        expect($template)->not->toContain($verdict);
        expect($module)->not->toContain($verdict);
    }
});

/**
 * El perfil lee los eventos por `fetchEvents`, el mismo método y la misma autorización que las
 * pantallas de historial (por eso hereda de `HealthEventPage`). Sin este test, un cambio de herencia
 * dejaría el bloque en blanco sin ningún error visible.
 */
it('lee los eventos del usuario autenticado con el mismo fetchEvents de siempre', function (): void {
    $user = User::factory()->registered()->create();
    $otherUser = User::factory()->registered()->create();

    $ownEvent = Event::factory()->for($user)->create();
    Event::factory()->for($otherUser)->create();

    $this->actingAs($user);

    $result = Livewire::test(Profile::class)
        ->instance()
        ->fetchEvents();

    expect($result)->toHaveCount(1);
    expect($result[0]['id'])->toBe($ownEvent->id);
    expect(array_keys($result[0]))->toBe(['id', 'occurredAt', 'payload']);
});

it('cada $wire.<metodo> del modulo de perfil existe como metodo publico de la pagina', function (): void {
    preg_match_all('/\$wire\.(\w+)\(/', file_get_contents(resource_path('js/auth/profilePage.js')), $matches);

    expect($matches[1])->not->toBeEmpty();

    $publicMethods = collect((new ReflectionClass(Profile::class))->getMethods(ReflectionMethod::IS_PUBLIC))
        ->keyBy->getName();

    foreach (array_unique($matches[1]) as $method) {
        expect($publicMethods->has($method))->toBeTrue(
            sprintf('El módulo llama a $wire.%s() y esa página no tiene ese método público.', $method)
        );
    }
});
