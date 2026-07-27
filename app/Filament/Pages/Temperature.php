<?php

declare(strict_types=1);

namespace App\Filament\Pages;

use App\Catalog\DataOrigin;
use App\Catalog\RecordedBy;
use App\Catalog\TemperatureLoincCode;
use App\Catalog\TemperatureMeasurementSite;
use App\Catalog\UcumUnit;
use BackedEnum;
use Filament\Support\Icons\Heroicon;
use Illuminate\Contracts\Support\Htmlable;

/**
 * Body temperature screen (ADR 0002, ADR 0004, ADR 0005, ADR 0006, ADR 0008).
 *
 * A temperature event stores the value, its unit and the site where it was measured. The site is the
 * ADR 0008 measurement method: it changes the value in a known way (axillary runs below rectal for
 * the same person at the same moment) and is only known at the moment of measuring, so it is asked
 * for and travels as a token of its own (`data.site`), never inferred.
 *
 * Unlike blood pressure, here the site **also determines the LOINC code**: LOINC publishes a code
 * per measurement site, so this screen does need a site → code resolution table, in the style of
 * blood glucose. The why, and why the generic 8310-5 is not used, is in
 * {@see TemperatureLoincCode}.
 *
 * The unit is asked for and not converted: Celsius and Fahrenheit are the same observation on a
 * different scale, each record keeps its own (ADR 0006) and the chart draws one series per (site,
 * unit) pair instead of mixing scales, which would give a curve jumping from 36 to 98 without
 * meaning anything.
 *
 * Like the rest of the event screens, this class never sees the content of a record: the shared
 * ciphertext transport lives in {@see HealthEventPage}, which validates the envelope wrapper and
 * authorization, never the content.
 *
 * The catalog does not publish {@see DataOrigin}: the view does not ask for the data origin (always
 * manual, see the JSDoc of `resources/js/health/temperaturePage.js`), so there is no `<select>` to
 * fill with those tokens. `origin` still travels inside the encrypted envelope, fixed to `manual`
 * from the client.
 */
final class Temperature extends HealthEventPage
{
    protected static string|BackedEnum|null $navigationIcon = Heroicon::Fire;

    protected string $view = 'phr.pages.temperature';

    /**
     * The title and the navigation label are resolved by method and not as a static property because
     * a property initializer in PHP only accepts constant expressions: `__()` cannot be called
     * there.
     */
    public function getTitle(): string|Htmlable
    {
        return __('Body temperature');
    }

    public static function getNavigationLabel(): string
    {
        return __('Body temperature');
    }

    /**
     * Public plaintext catalog the client needs to build the encrypted payload (ADR 0005,
     * ADR 0008). It is not clinical data: the same tokens and codes for every user.
     *
     * The unit label is not its UCUM code: the Fahrenheit code is `[degF]`, with the brackets UCUM
     * reserves for non-metric units, and showing it like that would be asking the person to read
     * exchange notation. The code is stored and `°C` or `°F` is shown, which is exactly the ADR 0005
     * distinction.
     *
     * @return array{
     *     units: list<array{code: string, label: string}>,
     *     sites: list<array{token: string, label: string}>,
     *     loinc: list<array{site: string, code: string}>,
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
                ['code' => UcumUnit::DegreeCelsius->value, 'label' => '°C'],
                ['code' => UcumUnit::DegreeFahrenheit->value, 'label' => '°F'],
            ],
            'sites' => self::labelledOptions(TemperatureMeasurementSite::cases(), $locale),
            'loinc' => self::loincTable(),
            /** Field common to every event (ADR 0006), not specific to temperature. */
            'recordedByRoles' => self::labelledOptions(RecordedBy::cases(), $locale),
        ];
    }

    /**
     * Table resolving the measurement site to the LOINC code (ADR 0005, ADR 0008), so the client
     * does not have to reimplement {@see TemperatureLoincCode::resolve()}.
     *
     * It carries no `try`/`catch` like the blood glucose one: there, some (method, unit) pairs have
     * no code and the table skips them, whereas here every published site has its own. If a site
     * without a code is ever added, this method will blow up while building the catalog —right away
     * and in plain sight— instead of serving a screen that would store records with no code.
     *
     * @return list<array{site: string, code: string}>
     */
    private static function loincTable(): array
    {
        return array_map(
            static fn (TemperatureMeasurementSite $site): array => [
                'site' => $site->value,
                'code' => TemperatureLoincCode::resolve($site)->value,
            ],
            TemperatureMeasurementSite::cases(),
        );
    }
}
