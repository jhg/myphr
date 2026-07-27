<?php

declare(strict_types=1);

use App\Filament\Pages\BloodPressure;
use App\Filament\Pages\BodyWeight;
use App\Filament\Pages\Dashboard;
use App\Filament\Pages\Glucose;
use App\Filament\Pages\Insulin;
use App\Filament\Pages\Meals;
use App\Filament\Pages\Profile;
use App\Filament\Pages\Temperature;
use App\Http\Controllers\Settings\UpdateSettingsController;
use App\Http\Middleware\SetLocale;
use App\Models\User;
use App\Support\SupportedLocale;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Route;

uses(RefreshDatabase::class);

/**
 * Routes equivalent to the panel ones, to test the middleware and the controller without depending
 * on the registration `PhrPanelProvider` does, the same as in `UpdateSettingsTest`.
 */
beforeEach(function (): void {
    Route::middleware(['web', SetLocale::class])->get('/test/locale', fn (): string => App::getLocale());
    Route::middleware(['auth', SetLocale::class])->put('/test/locale/settings', UpdateSettingsController::class);
});

it('carries all configured languages, with English as the default', function (): void {
    expect(SupportedLocale::all())->toBe([
        'en', 'es', 'zh_CN', 'hi', 'fr', 'ar', 'bn', 'pt', 'ru', 'ur', 'id', 'de', 'ja',
        'sw', 'mr', 'te', 'ta', 'tr', 'ko', 'vi', 'jv', 'it', 'ha', 'th', 'fa', 'pl',
    ])
        ->and(config('app.locale'))->toBe('en')
        ->and(config('app.fallback_locale'))->toBe('en');
});

/**
 * The login screen is painted before a session exists and before any key exists, so the only thing
 * available there is what the browser already sends on every request.
 */
it('negotiates the language with Accept-Language when there is no user', function (
    ?string $header,
    string $expected,
): void {
    $this->get('/test/locale', $header === null ? [] : ['Accept-Language' => $header])
        ->assertOk()
        ->assertSee($expected);
})->with([
    'chino simplificado con guion' => ['zh-CN,zh;q=0.9', 'zh_CN'],
    'regional Spanish' => ['es-AR,es;q=0.9,en;q=0.8', 'es'],
    'English' => ['en-GB', 'en'],
    'idioma no soportado' => ['xx-XX,xx;q=0.9', 'en'],
    'sin cabecera' => [null, 'en'],
    'factor de calidad manda sobre el orden' => ['xx;q=1.0,zh-CN;q=0.8,yy;q=0.9', 'zh_CN'],
    'Hindi regional' => ['hi-IN,hi;q=0.9', 'hi'],
    'French regional' => ['fr-FR,fr;q=0.9', 'fr'],
    'Arabic regional' => ['ar-EG,ar;q=0.9', 'ar'],
    'Bengali regional' => ['bn-BD,bn;q=0.9', 'bn'],
    'Portuguese regional' => ['pt-BR,pt;q=0.9', 'pt'],
    'Russian regional' => ['ru-RU,ru;q=0.9', 'ru'],
    'Urdu regional' => ['ur-PK,ur;q=0.9', 'ur'],
    'Indonesian regional' => ['id-ID,id;q=0.9', 'id'],
    'German regional' => ['de-DE,de;q=0.9', 'de'],
    'Japanese regional' => ['ja-JP,ja;q=0.9', 'ja'],
    'Swahili regional' => ['sw-KE,sw;q=0.9', 'sw'],
    'Marathi regional' => ['mr-IN,mr;q=0.9', 'mr'],
    'Telugu regional' => ['te-IN,te;q=0.9', 'te'],
    'Tamil regional' => ['ta-IN,ta;q=0.9', 'ta'],
    'Turkish regional' => ['tr-TR,tr;q=0.9', 'tr'],
    'Korean regional' => ['ko-KR,ko;q=0.9', 'ko'],
    'Vietnamese regional' => ['vi-VN,vi;q=0.9', 'vi'],
    'Javanese regional' => ['jv-ID,jv;q=0.9', 'jv'],
    'Italian regional' => ['it-IT,it;q=0.9', 'it'],
    'Hausa regional' => ['ha-NG,ha;q=0.9', 'ha'],
    'Thai regional' => ['th-TH,th;q=0.9', 'th'],
    'Persian regional' => ['fa-IR,fa;q=0.9', 'fa'],
    'Polish regional' => ['pl-PL,pl;q=0.9', 'pl'],
]);

/** The stored choice wins over whatever the browser asks for. */
it('prefers the language stored on the account over the browser header', function (): void {
    $user = User::factory()->registered()->create(['locale' => 'zh_CN']);

    $this->actingAs($user)
        ->get('/test/locale', ['Accept-Language' => 'es-ES'])
        ->assertOk()
        ->assertSee('zh_CN');
});

/** A stale value in the column must not leave the screen blank: it is negotiated as if it were absent. */
it('ignores a stored language that is no longer supported', function (): void {
    $user = User::factory()->registered()->create(['locale' => 'gl']);

    $this->actingAs($user)
        ->get('/test/locale', ['Accept-Language' => 'es-ES'])
        ->assertOk()
        ->assertSee('es');
});

/**
 * ADR 0007: the language is the exception and travels in the clear, outside the envelope, in the
 * same request that already stores the encrypted settings.
 */
it('stores the language in the clear next to the encrypted envelope', function (): void {
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

/** A closed list: the value ends up in `App::setLocale()`, so nobody picks a translation file. */
it('rejects a language that is not on the closed list', function (): void {
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
 * The language is written after validating the envelope and the precondition: a 412 must not leave
 * the language changed and the settings unchanged.
 */
it('does not change the language if the envelope fails the precondition', function (): void {
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
 * The translation keys are in English, which is the default language, so a key missing from a
 * catalog does not show: the screen comes out in English and nobody notices. This test is the only
 * way a translation hole fails in continuous integration and not in front of the user.
 */
it('keeps the same key set across every translation catalog', function (): void {
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

        expect($keys)->toBe($reference, sprintf('The "%s" catalog does not have the same keys.', $locale));
        expect(array_filter($entries, static fn (string $text): bool => trim($text) === ''))->toBe([]);
    }
});

it('keeps the same replacement placeholders across every translation catalog', function (): void {
    $reference = json_decode(
        (string) file_get_contents(lang_path('es.json')),
        true,
        flags: JSON_THROW_ON_ERROR,
    );

    $placeholdersOf = static function (string $text): array {
        preg_match_all('/:([A-Za-z_]\w*)/', $text, $matches);

        $placeholders = $matches[1];
        sort($placeholders);

        return $placeholders;
    };

    foreach (SupportedLocale::all() as $locale) {
        if ($locale === SupportedLocale::Fallback) {
            continue;
        }

        $entries = json_decode(
            (string) file_get_contents(lang_path($locale.'.json')),
            true,
            flags: JSON_THROW_ON_ERROR,
        );

        foreach ($reference as $key => $text) {
            expect($placeholdersOf($entries[$key]))->toBe(
                $placeholdersOf($text),
                sprintf('The "%s" entry in "%s" does not preserve its placeholders.', $key, $locale),
            );
        }
    }
});

/** The profile selector offers every language, each name written in its own language. */
it('offers every language in the profile, each one in its own language', function (): void {
    expect((new Profile)->locales())->toBe([
        ['code' => 'en', 'label' => 'English'],
        ['code' => 'es', 'label' => 'Español'],
        ['code' => 'zh_CN', 'label' => '简体中文'],
        ['code' => 'hi', 'label' => 'हिन्दी'],
        ['code' => 'fr', 'label' => 'Français'],
        ['code' => 'ar', 'label' => 'العربية'],
        ['code' => 'bn', 'label' => 'বাংলা'],
        ['code' => 'pt', 'label' => 'Português'],
        ['code' => 'ru', 'label' => 'Русский'],
        ['code' => 'ur', 'label' => 'اردو'],
        ['code' => 'id', 'label' => 'Bahasa Indonesia'],
        ['code' => 'de', 'label' => 'Deutsch'],
        ['code' => 'ja', 'label' => '日本語'],
        ['code' => 'sw', 'label' => 'Kiswahili'],
        ['code' => 'mr', 'label' => 'मराठी'],
        ['code' => 'te', 'label' => 'తెలుగు'],
        ['code' => 'ta', 'label' => 'தமிழ்'],
        ['code' => 'tr', 'label' => 'Türkçe'],
        ['code' => 'ko', 'label' => '한국어'],
        ['code' => 'vi', 'label' => 'Tiếng Việt'],
        ['code' => 'jv', 'label' => 'Basa Jawa'],
        ['code' => 'it', 'label' => 'Italiano'],
        ['code' => 'ha', 'label' => 'Hausa'],
        ['code' => 'th', 'label' => 'ไทย'],
        ['code' => 'fa', 'label' => 'فارسی'],
        ['code' => 'pl', 'label' => 'Polski'],
    ]);
});

/**
 * The previous test compares the catalogs against each other, so it goes green even if the whole
 * codebase is untranslated: that is the gap `__('Entrar')` slipped through —a Spanish key that
 * existed in no catalog— along with the six hand-written navigation labels. This one walks the real
 * `__()` calls and requires every literal key to be in both catalogs.
 *
 * It only looks at literal keys: `__($variable)` cannot be resolved by reading the file and is
 * deliberately ignored, instead of pretending it is checked.
 */
it('has every key the code uses with __() translated in every catalog', function (): void {
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
                '"%s" is missing from the "%s" catalog (it is used in %s).',
                $key,
                $locale,
                $origin,
            ));
        }
    }
});

/**
 * Visible literals that do not go through `__()` are invisible to the test above: there is no key to
 * look for. This check comes from the other side —the effective language of the screen— and pins
 * down what is most visible in the panel: the page title and its menu entry, in every language.
 */
it('translates the title and the navigation label of every panel page', function (): void {
    $pages = [
        Dashboard::class,
        Glucose::class,
        BloodPressure::class,
        Insulin::class,
        Meals::class,
        BodyWeight::class,
        Temperature::class,
        Profile::class,
    ];

    foreach ($pages as $page) {
        $byLocale = [];

        foreach (SupportedLocale::all() as $locale) {
            App::setLocale($locale);
            $byLocale[$locale] = [(string) (new $page)->getTitle(), $page::getNavigationLabel()];
        }

        expect($byLocale['en'])->not->toBe($byLocale['es'], $page.': English comes out the same as Spanish.')
            ->and($byLocale['zh_CN'])->not->toBe($byLocale['es'], $page.': Chinese comes out the same as Spanish.');
    }
});
