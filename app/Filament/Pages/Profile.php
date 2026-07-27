<?php

declare(strict_types=1);

namespace App\Filament\Pages;

use App\Catalog\UcumUnit;
use App\Providers\Filament\PhrPanelProvider;
use App\Support\SupportedLocale;
use BackedEnum;
use Filament\Support\Icons\Heroicon;
use Illuminate\Contracts\Support\Htmlable;

/**
 * Profile page: account settings and password change (ADR 0002, ADR 0007, ADR 0009).
 *
 * This class sees **nothing** of what the page stores. The settings travel encrypted to `PUT
 * /phr/settings` and the password change is a full OPAQUE re-registration against the
 * `/phr/auth/password/*` routes: in both cases the browser encrypts or derives and the server only
 * validates the wrapper. That is why there is no Filament form here and no public property with
 * content: ADR 0002 reserves Filament fields for plaintext data and the view is an Alpine component
 * of its own (`resources/js/auth/profilePage.js`, registered as `phrProfilePage`).
 *
 * The only deliberate exception is the interface language, which goes in the clear in `users.locale`
 * because Filament resolves the menu, the breadcrumbs and the login screen itself on the server, and
 * that screen is painted before any key exists (ADR 0007, with the same reasoning ADR 0009 makes for
 * the email and the name). It says nothing about anyone's health.
 *
 * **Why it extends {@see HealthEventPage}** and not {@see PhrPage} directly: the latest measurements
 * block (weight, height and body mass index) is computed by decrypting in the browser, and for that
 * the client needs `fetchEvents`, the same method, the same authorization and the same canonical
 * date criterion as the history screens. A second read path would be a second place to get it wrong.
 * It is the same reasoning —and the same precedent— as {@see Sharing}; `storeEvent` comes along for
 * free and adds no surface, because any events screen in the panel already exposes it for the same
 * user. `HealthEventPage` in turn extends `PhrPage`, so the six `#[Url]` properties of
 * `InteractsWithActions` stay closed.
 *
 * The server still sees nothing: it hands over ciphertext and does not know how much anyone weighs
 * or how tall they are.
 */
final class Profile extends HealthEventPage
{
    protected static string|BackedEnum|null $navigationIcon = Heroicon::UserCircle;

    /**
     * Out of the sidebar navigation: the profile is reached from the user menu, which is where
     * anyone looks for it, and {@see PhrPanelProvider} already registers it there.
     *
     * The sidebar is for recording and reviewing clinical data. Repeating there an entry already
     * reachable from the avatar duplicates the path and steals room from what the person opens every
     * day.
     */
    protected static bool $shouldRegisterNavigation = false;

    protected string $view = 'phr.pages.profile';

    /**
     * The title and the navigation label are resolved by method and not as a static property because
     * a property initializer in PHP only accepts constant expressions: `__()` cannot be called
     * there. Leaving them as fixed strings is what kept the menu and the headers in Spanish even
     * when the rest of the screen was already translated.
     */
    public function getTitle(): string|Htmlable
    {
        return __('Profile');
    }

    public static function getNavigationLabel(): string
    {
        return __('Profile');
    }

    /**
     * Languages the interface speaks, with English first because it is the default.
     *
     * A closed list on purpose: the value ends up in `App::setLocale()`, so accepting any string
     * would let the client pick a translation file.
     *
     * @return list<array{code: string, label: string}>
     */
    public function locales(): array
    {
        return [
            ['code' => 'en', 'label' => 'English'],
            ['code' => 'es', 'label' => 'Español'],
            ['code' => 'zh_CN', 'label' => '简体中文'],
        ];
    }

    /**
     * Blood glucose units to pick a preferred one from (ADR 0006: it is a presentation preference,
     * not a requirement of the event; each record stores its own).
     *
     * @return list<array{code: string, label: string}>
     */
    public function glucoseUnits(): array
    {
        return [
            ['code' => UcumUnit::MilligramsPerDeciliter->value, 'label' => 'mg/dL'],
            ['code' => UcumUnit::MillimolesPerLiter->value, 'label' => 'mmol/L'],
        ];
    }

    /**
     * Language in force for this account: the one the person saved and, while `users.locale` is
     * still empty, the one negotiated with `Accept-Language` for this request.
     *
     * ADR 0007 only allows a default for what is not clinical content, and the language is not:
     * picking one for them claims nothing about their health.
     */
    public function currentLocale(): string
    {
        $locale = auth()->user()?->getAttribute('locale');

        return is_string($locale) && SupportedLocale::isSupported($locale)
            ? $locale
            : app()->getLocale();
    }
}
