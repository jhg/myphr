<?php

declare(strict_types=1);

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

/**
 * The `lang` on `<html>` is the only source of the language for everything JavaScript paints.
 *
 * `resources/js/i18n/index.js` reads it once and remembers it: the health panel labels, the chart
 * captions and the clinical validation messages all come from there. If the server emits a language
 * there different from the one it renders with using `__()`, the screen ends up in two languages at
 * once and no test notices, because each half is correct on its own.
 */
it('emits in the html the same language it renders with', function (): void {
    $user = User::factory()->registered()->create(['locale' => 'zh_CN']);

    $html = $this->actingAs($user)
        ->get('/phr')
        ->assertOk()
        ->getContent();

    expect($html)->toContain('lang="zh-CN"')
        ->and($html)->toContain('data-phr-locale="zh_CN"');
});

it('honours the browser header on the screens without a session', function (): void {
    $html = $this->get('/phr/login', ['Accept-Language' => 'zh-CN,zh;q=0.9'])
        ->assertOk()
        ->getContent();

    expect($html)->toContain('lang="zh-CN"')
        ->and($html)->toContain('data-phr-locale="zh_CN"');
});

/**
 * The marker has to travel in the `<body>`, not in the `<head>`.
 *
 * That is where the bug this file exists to prevent lives: Livewire navigates without reloading and
 * replaces the `<body>`, but not the attributes of `<html>` and not the `<head>`. A language read
 * only from the head stays at the one from the first load, which in practice is the login screen's,
 * served from `Accept-Language` when there is no session yet.
 */
it('emits the marker inside the body', function (): void {
    $user = User::factory()->registered()->create(['locale' => 'es']);

    $html = $this->actingAs($user)->get('/phr')->assertOk()->getContent();

    $bodyStart = strpos($html, '<body');
    $markerAt = strpos($html, 'data-phr-locale');

    expect($bodyStart)->not->toBeFalse()
        ->and($markerAt)->not->toBeFalse()
        ->and($markerAt)->toBeGreaterThan($bodyStart);
});

/**
 * The user menu is translated on every request, not while building the panel.
 *
 * `PhrPanelProvider::panel()` runs once, when the panel is registered, and at that point `SetLocale`
 * has not run: a `__()` evaluated there freezes the translation of whatever the first language was.
 * It is the same reason page titles are resolved by method and not as a static property.
 */
it('translates the user menu into the account language', function (): void {
    $user = User::factory()->registered()->create(['locale' => 'zh_CN']);

    $this->actingAs($user)
        ->get('/phr')
        ->assertOk()
        ->assertSee('我的资料', false)
        ->assertDontSee('My profile', false);
});

/**
 * A guard against relapse: there have already been three in this project.
 *
 * The body of `panel()` runs once. Every translation appearing there has to be inside a `Closure` so
 * Filament resolves it when painting, with `SetLocale` already applied. Written as a loose string it
 * freezes into the default language and the fault raises no error: it simply comes out in the wrong
 * language, which is one of the hardest things to spot in code review.
 */
it('evaluates no translation while building the panel', function (): void {
    $lines = file(app_path('Providers/Filament/PhrPanelProvider.php'), FILE_IGNORE_NEW_LINES);

    /**
     * Only lines of code are examined. The comments explaining why the translation goes inside a
     * `Closure` inevitably mention `__()`, and counting them would make the test fail for
     * documenting exactly what it wants to prevent.
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

    expect($eager)->toBe([], 'Translation evaluated outside a Closure: '.implode(' | ', $eager));
});
