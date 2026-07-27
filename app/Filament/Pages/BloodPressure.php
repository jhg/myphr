<?php

declare(strict_types=1);

namespace App\Filament\Pages;

use App\Catalog\BloodPressureArm;
use App\Catalog\BloodPressureLoincCode;
use App\Catalog\BloodPressurePosture;
use App\Catalog\BloodPressureUnit;
use App\Catalog\DataOrigin;
use App\Catalog\RecordedBy;
use BackedEnum;
use Filament\Support\Icons\Heroicon;
use Illuminate\Contracts\Support\Htmlable;

/**
 * Blood pressure screen (ADR 0002, ADR 0004, ADR 0005, ADR 0006, ADR 0008).
 *
 * A blood pressure event stores systolic, diastolic and pulse together: ADR 0006 is explicit that
 * blood pressure is "a single event", not three, because that is what the device gives and what the
 * patient experiences. The pulse is optional: not every monitor measures it.
 *
 * ADR 0008 states that the measurement method for blood pressure is made up of the arm and the
 * posture, because both change the value in a known way and are only known at the moment of
 * measuring; they travel as two tokens of their own (`data.arm`, `data.posture`) and not as loose
 * fields next to the quantity. The LOINC code depends on neither of them (see the JSDoc of
 * {@see BloodPressureLoincCode}), so, unlike blood glucose, no (method, unit) → code resolution
 * table is needed: the three codes are constants.
 *
 * Like {@see Glucose}, this class never sees the content of a reading: the shared ciphertext
 * transport lives in {@see HealthEventPage}, which validates the envelope wrapper and
 * authorization, never the content.
 *
 * The catalog does not publish {@see DataOrigin}: the view does not ask for the data origin (always
 * manual, see the JSDoc of `resources/js/health/bloodPressurePage.js`), so there is no `<select>` to
 * fill with those tokens. `origin` still travels inside the encrypted envelope, fixed to `manual`
 * from the client.
 */
final class BloodPressure extends HealthEventPage
{
    protected static string|BackedEnum|null $navigationIcon = Heroicon::Heart;

    protected string $view = 'phr.pages.blood-pressure';

    /**
     * The title and the navigation label are resolved by method and not as a static property because
     * a property initializer in PHP only accepts constant expressions: `__()` cannot be called
     * there. Leaving them as fixed strings is what kept the menu and the headers in Spanish even
     * when the rest of the screen was already translated.
     */
    public function getTitle(): string|Htmlable
    {
        return __('Blood pressure');
    }

    public static function getNavigationLabel(): string
    {
        return __('Blood pressure');
    }

    /**
     * Public plaintext catalog the client needs to build the encrypted payload (ADR 0005,
     * ADR 0008). It is not clinical data: the same tokens and codes for every user.
     *
     * @return array{
     *     arms: list<array{token: string, label: string}>,
     *     postures: list<array{token: string, label: string}>,
     *     units: array{pressure: string, pulse: string},
     *     loinc: array{systolic: string, diastolic: string, pulse: string},
     *     recordedByRoles: list<array{token: string, label: string}>,
     * }
     */
    public function catalog(): array
    {
        /** The catalog is plaintext and the server paints it, so the labels already come out in the
         * language in force for this request (App\Support\SupportedLocale). */
        $locale = app()->getLocale();

        return [
            'arms' => self::labelledOptions(BloodPressureArm::cases(), $locale),
            'postures' => self::labelledOptions(BloodPressurePosture::cases(), $locale),
            /** No selector: blood pressure offers no alternative unit (see BloodPressureUnit). */
            'units' => [
                'pressure' => BloodPressureUnit::MillimetersOfMercury->value,
                'pulse' => BloodPressureUnit::BeatsPerMinute->value,
            ],
            'loinc' => [
                'systolic' => BloodPressureLoincCode::Systolic->value,
                'diastolic' => BloodPressureLoincCode::Diastolic->value,
                'pulse' => BloodPressureLoincCode::Pulse->value,
            ],
            /** Field common to every event (ADR 0006), not specific to blood pressure. */
            'recordedByRoles' => self::labelledOptions(RecordedBy::cases(), $locale),
        ];
    }
}
