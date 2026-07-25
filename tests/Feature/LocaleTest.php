<?php

declare(strict_types=1);

use App\Filament\Pages\BloodPressure;
use App\Filament\Pages\Dashboard;
use App\Filament\Pages\Glucose;
use App\Filament\Pages\Insulin;
use App\Filament\Pages\Meals;
use App\Filament\Pages\Profile;
use App\Http\Controllers\Settings\UpdateSettingsController;
use App\Http\Middleware\SetLocale;
use App\Models\User;
use App\Support\SupportedLocale;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Route;

uses(RefreshDatabase::class);

/**
 * Rutas equivalentes a las del panel para probar el middleware y el controlador sin depender del
 * registro que hace `PhrPanelProvider`, igual que en `UpdateSettingsTest`.
 */
beforeEach(function (): void {
    Route::middleware(['web', SetLocale::class])->get('/test/locale', fn (): string => App::getLocale());
    Route::middleware(['auth', SetLocale::class])->put('/test/locale/settings', UpdateSettingsController::class);
});

it('trae los tres idiomas configurados, con el inglés de serie', function (): void {
    expect(SupportedLocale::all())->toBe(['en', 'es', 'zh_CN'])
        ->and(config('app.locale'))->toBe('en')
        ->and(config('app.fallback_locale'))->toBe('en');
});

/**
 * La pantalla de acceso se pinta antes de que exista sesión y antes de que exista ninguna clave, así
 * que ahí lo único disponible es lo que el navegador ya manda en todas las peticiones.
 */
it('negocia el idioma con Accept-Language cuando no hay usuario', function (
    ?string $header,
    string $expected,
): void {
    $this->get('/test/locale', $header === null ? [] : ['Accept-Language' => $header])
        ->assertOk()
        ->assertSee($expected);
})->with([
    'chino simplificado con guion' => ['zh-CN,zh;q=0.9', 'zh_CN'],
    'castellano regional' => ['es-AR,es;q=0.9,en;q=0.8', 'es'],
    'inglés' => ['en-GB', 'en'],
    'idioma no soportado' => ['fr-FR,fr;q=0.9', 'en'],
    'sin cabecera' => [null, 'en'],
    'factor de calidad manda sobre el orden' => ['fr;q=1.0,zh-CN;q=0.8,de;q=0.9', 'zh_CN'],
]);

/** La elección guardada manda sobre lo que pida el navegador. */
it('prefiere el idioma guardado en la cuenta a la cabecera del navegador', function (): void {
    $user = User::factory()->registered()->create(['locale' => 'zh_CN']);

    $this->actingAs($user)
        ->get('/test/locale', ['Accept-Language' => 'es-ES'])
        ->assertOk()
        ->assertSee('zh_CN');
});

/** Un valor obsoleto en la columna no debe dejar la pantalla en blanco: se negocia como si no hubiera. */
it('ignora un idioma guardado que ya no está soportado', function (): void {
    $user = User::factory()->registered()->create(['locale' => 'gl']);

    $this->actingAs($user)
        ->get('/test/locale', ['Accept-Language' => 'es-ES'])
        ->assertOk()
        ->assertSee('es');
});

/**
 * ADR 0007: el idioma es la excepción y viaja en claro, fuera del sobre, en la misma petición que
 * ya guarda los ajustes cifrados.
 */
it('guarda el idioma en claro junto al sobre cifrado', function (): void {
    $user = User::factory()->registered()->create(['encrypted_settings' => null, 'locale' => null]);
    $envelope = envelopeCipherText();

    $this->actingAs($user)
        ->putJson(
            '/test/locale/settings',
            ['encryptedSettings' => $envelope, 'locale' => 'zh_CN'],
            ['If-Match' => '*'],
        )
        ->assertOk();

    expect($user->refresh()->locale)->toBe('zh_CN')
        ->and($user->encrypted_settings)->toBe($envelope);
});

/** Lista cerrada: el valor acaba en `App::setLocale()`, así que nadie elige fichero de traducción. */
it('rechaza un idioma que no está en la lista cerrada', function (): void {
    $user = User::factory()->registered()->create(['locale' => null]);

    $this->actingAs($user)
        ->putJson(
            '/test/locale/settings',
            ['encryptedSettings' => envelopeCipherText(), 'locale' => '../../etc/passwd'],
            ['If-Match' => '*'],
        )
        ->assertStatus(422);

    expect($user->refresh()->locale)->toBeNull();
});

/**
 * El idioma se escribe después de validar el sobre y la precondición: un 412 no puede dejar el
 * idioma cambiado y los ajustes sin cambiar.
 */
it('no cambia el idioma si el sobre no pasa la precondición', function (): void {
    $user = User::factory()->registered()->create([
        'encrypted_settings' => envelopeCipherText(),
        'locale' => 'es',
    ]);

    $this->actingAs($user)
        ->putJson(
            '/test/locale/settings',
            ['encryptedSettings' => envelopeCipherText(), 'locale' => 'zh_CN'],
            ['If-Match' => '"desfasado"'],
        )
        ->assertStatus(412);

    expect($user->refresh()->locale)->toBe('es');
});

/**
 * Las claves de traducción están en inglés, que es el idioma de serie, así que una clave que falte
 * en un catálogo no se ve: la pantalla sale en inglés y nadie se entera. Este test es la única forma
 * de que un hueco de traducción falle en integración continua y no delante del usuario.
 */
it('mantiene el mismo juego de claves en todos los catálogos de traducción', function (): void {
    $catalogs = [];

    foreach (SupportedLocale::all() as $locale) {
        if ($locale === SupportedLocale::Fallback) {
            continue;
        }

        $path = lang_path($locale.'.json');

        expect($path)->toBeFile();

        /** @var array<string, string> $entries */
        $entries = json_decode((string) file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
        $catalogs[$locale] = $entries;
    }

    $reference = array_keys(reset($catalogs) ?: []);
    sort($reference);

    expect($reference)->not->toBeEmpty();

    foreach ($catalogs as $locale => $entries) {
        $keys = array_keys($entries);
        sort($keys);

        expect($keys)->toBe($reference, sprintf('El catálogo de "%s" no tiene las mismas claves.', $locale));
        expect(array_filter($entries, static fn (string $text): bool => trim($text) === ''))->toBe([]);
    }
});

/** El selector del perfil ofrece los tres idiomas, cada nombre escrito en su propio idioma. */
it('ofrece los tres idiomas en el perfil, cada uno en su propio idioma', function (): void {
    expect((new Profile)->locales())->toBe([
        ['code' => 'en', 'label' => 'English'],
        ['code' => 'es', 'label' => 'Español'],
        ['code' => 'zh_CN', 'label' => '简体中文'],
    ]);
});

/**
 * El test anterior compara los catálogos entre sí, así que da verde aunque el código entero esté sin
 * traducir: es el hueco por el que se colaron `__('Entrar')` —una clave castellana que no existía en
 * ningún catálogo— y las seis etiquetas de navegación escritas a mano. Este recorre las llamadas
 * reales a `__()` y exige que cada clave literal esté en los dos catálogos.
 *
 * Solo mira claves literales: `__($variable)` no se puede resolver leyendo el fichero y se ignora a
 * propósito, en vez de fingir que se comprueba.
 */
it('tiene traducida en todos los catálogos cada clave que el código usa con __()', function (): void {
    $sources = [app_path(), resource_path('views/phr'), resource_path('views/layouts')];

    $usedKeys = [];

    foreach ($sources as $source) {
        /** @var iterable<SplFileInfo> $files */
        $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($source, FilesystemIterator::SKIP_DOTS));

        foreach ($files as $file) {
            if (! $file->isFile() || ! in_array($file->getExtension(), ['php'], true)) {
                continue;
            }

            $contents = (string) file_get_contents($file->getPathname());

            preg_match_all("/__\(\s*'((?:[^'\\\\]|\\\\.)*)'/", $contents, $singleQuoted);
            preg_match_all('/__\(\s*"((?:[^"\\\\]|\\\\.)*)"/', $contents, $doubleQuoted);

            foreach ([...$singleQuoted[1], ...$doubleQuoted[1]] as $key) {
                $usedKeys[stripcslashes($key)] = $file->getPathname();
            }
        }
    }

    expect($usedKeys)->not->toBeEmpty();

    foreach (SupportedLocale::all() as $locale) {
        if ($locale === SupportedLocale::Fallback) {
            continue;
        }

        /** @var array<string, string> $entries */
        $entries = json_decode(
            (string) file_get_contents(lang_path($locale.'.json')),
            true,
            flags: JSON_THROW_ON_ERROR,
        );

        foreach ($usedKeys as $key => $origin) {
            expect(array_key_exists($key, $entries))->toBeTrue(sprintf(
                'Falta "%s" en el catálogo de "%s" (se usa en %s).',
                $key,
                $locale,
                $origin,
            ));
        }
    }
});

/**
 * Los literales visibles que no pasan por `__()` no los ve el test de arriba: no hay clave que
 * buscar. Esta comprobación va por el otro lado —el idioma efectivo de la pantalla— y fija lo que
 * más se ve del panel: el título de la página y su entrada de menú, en los tres idiomas.
 */
it('traduce el título y la etiqueta de navegación de todas las páginas del panel', function (): void {
    $pages = [
        Dashboard::class,
        Glucose::class,
        BloodPressure::class,
        Insulin::class,
        Meals::class,
        Profile::class,
    ];

    foreach ($pages as $page) {
        $byLocale = [];

        foreach (SupportedLocale::all() as $locale) {
            App::setLocale($locale);
            $byLocale[$locale] = [(string) (new $page)->getTitle(), $page::getNavigationLabel()];
        }

        expect($byLocale['en'])->not->toBe($byLocale['es'], $page.': el inglés sale igual que el castellano.')
            ->and($byLocale['zh_CN'])->not->toBe($byLocale['es'], $page.': el chino sale igual que el castellano.');
    }
});
