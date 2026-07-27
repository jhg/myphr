<?php

declare(strict_types=1);

namespace App\Filament\Pages;

use App\Catalog\FoodQuantityUnit;
use App\Catalog\MealType;
use App\Catalog\RecordedBy;
use BackedEnum;
use Filament\Support\Icons\Heroicon;
use Illuminate\Contracts\Support\Htmlable;

/**
 * Meals screen (ADR 0002, ADR 0004, ADR 0005, ADR 0006).
 *
 * This class never sees the content of a meal. The shared ciphertext transport lives in
 * {@see HealthEventPage} and is shared with the rest of the clinical event screens: the envelope
 * comes down as a return value and goes up as a method parameter, never in a public property, so it
 * does not enter the Livewire snapshot (ADR 0002). The server validates the envelope wrapper and
 * authorization, never the content: there is no way to check that it says "omelette" inside without
 * the user's key.
 *
 * Unlike blood glucose, the foods in a meal are NOT coded against any clinical vocabulary: it is a
 * deliberate decision departing from the general ADR 0005 criterion, justified in this screen's own
 * ADR. What is coded in UCUM is the unit of each food ({@see FoodQuantityUnit}), which is what ADR
 * 0005 requires so we do not end up with an impossible conversion later on.
 *
 * The ADR 0006 `origin` field (how the data got in: typed by hand or imported from a device) is not
 * asked for here: every entry today is manual, there is no meals device integration, so the client
 * always fixes it to `manual` without showing a selector whose only possible answer would be that.
 * The day there is an automatic import, that import will write `device`, not a selector in this
 * form. The blood glucose `dataOrigins` catalog is not published here for the same reason: there is
 * nothing for the client to choose.
 *
 * The view (`resources/views/phr/pages/meals.blade.php`) is an Alpine component of its own, not a
 * Filament form: ADR 0002 reserves Filament fields and columns for plaintext data, and here all the
 * clinical content is encrypted.
 */
final class Meals extends HealthEventPage
{
    protected static string|BackedEnum|null $navigationIcon = Heroicon::Cake;

    protected string $view = 'phr.pages.meals';

    /**
     * The title and the navigation label are resolved by method and not as a static property because
     * a property initializer in PHP only accepts constant expressions: `__()` cannot be called
     * there. Leaving them as fixed strings is what kept the menu and the headers in Spanish even
     * when the rest of the screen was already translated.
     */
    public function getTitle(): string|Htmlable
    {
        return __('Meals');
    }

    public static function getNavigationLabel(): string
    {
        return __('Meals');
    }

    /**
     * Public plaintext catalog the client needs to build the encrypted payload (ADR 0005,
     * ADR 0006). It is not clinical data: the same tokens and codes for every user.
     *
     * @return array{
     *     mealTypes: list<array{token: string, label: string}>,
     *     units: list<array{code: string, label: string}>,
     *     recordedByRoles: list<array{token: string, label: string}>,
     * }
     */
    public function catalog(): array
    {
        /** The catalog is plaintext and the server paints it, so the labels already come out in the
         * language in force for this request (App\Support\SupportedLocale). */
        $locale = app()->getLocale();

        return [
            'mealTypes' => self::labelledOptions(MealType::cases(), $locale),
            'units' => array_map(
                static fn (FoodQuantityUnit $unit): array => [
                    'code' => $unit->value,
                    'label' => $unit->label($locale),
                ],
                FoodQuantityUnit::cases(),
            ),
            /** Field common to every event (ADR 0006), not specific to meals. */
            'recordedByRoles' => self::labelledOptions(RecordedBy::cases(), $locale),
        ];
    }
}
