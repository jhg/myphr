<?php

declare(strict_types=1);

namespace App\Filament\Pages;

use App\Catalog\InjectionSite;
use App\Catalog\InsulinType;
use App\Catalog\RecordedBy;
use App\Catalog\UcumUnit;
use BackedEnum;
use Filament\Support\Icons\Heroicon;
use Illuminate\Contracts\Support\Htmlable;

/**
 * Injected insulin screen (ADR 0002, ADR 0004, ADR 0005, ADR 0006).
 *
 * This class never sees the content of an insulin administration. The shared ciphertext transport
 * —the envelope comes down as a return value and goes up as a method parameter, never in a public
 * property, so it does not enter the Livewire snapshot (ADR 0002)— lives in {@see HealthEventPage}
 * and is shared with the rest of the clinical event screens. The server validates the envelope
 * wrapper and authorization, never the content: there is no way to check that it says "insulin"
 * inside without the user's key.
 *
 * **It carries no LOINC code.** Unlike blood glucose, an insulin event is not an observation of a
 * quantity: it is the record of a medication administration (ADR 0006, "type rapid|long|mixed, dose,
 * and the product code where applicable, because it is a medication administration and not an
 * observation"). There is no (type, unit) → code table to resolve here, and none should be added: it
 * is the deliberate difference from {@see Glucose::catalog()}.
 *
 * The view (`resources/views/phr/pages/insulin.blade.php`) is an Alpine component of its own, not a
 * Filament form: ADR 0002 reserves Filament fields and columns for plaintext data, and here all the
 * clinical content is encrypted.
 *
 * **The form does not ask for the data origin** (manual or device): there is no device integration
 * on this screen today, so entry is always manual and asking has no real answer. `origin` still
 * travels in the encrypted content because ADR 0006 requires it and it cannot be added later over
 * already encrypted data, but `insulinPage.js` fixes it to `manual` without showing any control; the
 * day there is an automatic import from a device, that import will set it to `device`. That is why
 * `catalog()` no longer publishes `dataOrigins`: nothing in the view needs it.
 */
final class Insulin extends HealthEventPage
{
    /**
     * UCUM code for the international unit of insulin (ADR 0005: "the international unit of insulin
     * is `[iU]`, nobody writes it spontaneously"). Verified against https://unitsofmeasure.org:
     * `[iU]` is the UCUM code for "international unit".
     *
     * It does not come from {@see UcumUnit} because that enum today only covers the blood glucose
     * units; adding a case to it is out of the scope of this screen.
     */
    private const string UNIT_INTERNATIONAL_UNIT = '[iU]';

    /**
     * Heroicons has no syringe: `EyeDropper` is the closest available icon to "dose administered",
     * and different from the `Beaker` used by {@see Glucose}.
     */
    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedEyeDropper;

    protected string $view = 'phr.pages.insulin';

    /**
     * The title and the navigation label are resolved by method and not as a static property because
     * a property initializer in PHP only accepts constant expressions: `__()` cannot be called
     * there. Leaving them as fixed strings is what kept the menu and the headers in Spanish even
     * when the rest of the screen was already translated.
     */
    public function getTitle(): string|Htmlable
    {
        return __('Injected insulin');
    }

    public static function getNavigationLabel(): string
    {
        return __('Insulin');
    }

    /**
     * Public plaintext catalog the client needs to build the encrypted payload (ADR 0005,
     * ADR 0006). It is not clinical data: the same tokens for every user.
     *
     * @return array{
     *     units: list<array{code: string, label: string}>,
     *     insulinTypes: list<array{token: string, label: string}>,
     *     injectionSites: list<array{token: string, label: string}>,
     *     recordedByRoles: list<array{token: string, label: string}>,
     * }
     */
    public function catalog(): array
    {
        /** The catalog is plaintext and the server paints it, so the labels already come out in the
         * language in force for this request (App\Support\SupportedLocale). */
        $locale = app()->getLocale();

        return [
            'units' => [
                ['code' => self::UNIT_INTERNATIONAL_UNIT, 'label' => 'UI (unidades internacionales)'],
            ],
            'insulinTypes' => self::labelledOptions(InsulinType::cases(), $locale),
            'injectionSites' => self::labelledOptions(InjectionSite::cases(), $locale),
            /**
             * Field common to every event (ADR 0006), not specific to insulin. `dataOrigins` is not
             * published: the form does not ask for the data origin (see the class JSDoc), so the
             * view does not need it.
             */
            'recordedByRoles' => self::labelledOptions(RecordedBy::cases(), $locale),
        ];
    }
}
