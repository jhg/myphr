<?php

declare(strict_types=1);

namespace App\Filament\Pages;

use BackedEnum;
use Filament\Panel;
use Filament\Support\Icons\Heroicon;
use Illuminate\Contracts\Support\Htmlable;

/**
 * Home dashboard (Spec 0001 §9, "Properties in the URL"; ADR 0002, ADR 0006, ADR 0007, ADR 0008).
 *
 * It replaces `Filament\Pages\Dashboard`: its widgets resolve on the server, and the server cannot
 * read encrypted data (ADR 0002). This page shows, instead, the timeline, the charts and the
 * statistics **for the period and the event types the person picks**, all computed in the browser
 * (`resources/js/health/dashboardPage.js`) from `fetchEvents()`, inherited from
 * {@see HealthEventPage} just like {@see Glucose} does. The server never sees the content of an
 * event; it only hands over the ciphertext, as on any other clinical events screen.
 *
 * The period is applied by the server, because `occurred_at` is a plaintext column (ADR 0006) and
 * `fetchEvents()` accepts the range; the type filter cannot be applied there —the type goes inside
 * the encrypted envelope— so the client does it over what it has already decrypted, with no extra
 * requests.
 *
 * It extends `HealthEventPage` (and not `Filament\Pages\Dashboard`) to reuse `fetchEvents` and to
 * inherit, through {@see PhrPage}, the same closing of the six `#[Url]` properties of
 * `InteractsWithActions` that Spec 0001 §9 requires.
 *
 * **It is still the panel's home page, at `/phr`.** `HasRoutes::getRoutePath()` computes the route
 * from `getSlug()` unless it is overridden, which would give `/phr/dashboard`. `getRoutePath()` is
 * overridden here to `/`, just like `Filament\Pages\Dashboard::$routePath` does, so the panel route
 * stays `/phr` and the registration in
 * `App\Providers\Filament\PhrPanelProvider::pages()` does not change.
 *
 * The six `InteractsWithActions` properties are **not redeclared here**: the redeclaration without
 * `#[Url]` in {@see PhrPage} is already the one Livewire's reflection sees, because an inherited
 * property keeps the declaration —and the attributes— of the class that declared it last, and that
 * is `PhrPage`. Copying them again added no guarantee; what does give it is
 * `tests/Feature/PanelUrlPropertiesTest.php`, which walks every page in the panel and fails if any
 * of them exposes one with the attribute again.
 */
final class Dashboard extends HealthEventPage
{
    protected static string $routePath = '/';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::Home;

    protected static ?int $navigationSort = -2;

    protected string $view = 'phr.pages.dashboard';

    /**
     * The title and the navigation label are resolved by method and not as a static property because
     * a property initializer in PHP only accepts constant expressions: `__()` cannot be called
     * there. Leaving them as fixed strings is what kept the menu and the headers in Spanish even
     * when the rest of the screen was already translated.
     */
    public function getTitle(): string|Htmlable
    {
        return __('Home');
    }

    public static function getNavigationLabel(): string
    {
        return __('Home');
    }

    public static function getRoutePath(Panel $panel): string
    {
        return self::$routePath;
    }
}
