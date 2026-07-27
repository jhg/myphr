<?php

declare(strict_types=1);

namespace App\Filament\Pages;

use App\Catalog\BodyHeightLoincCode;
use App\Catalog\BodyWeightLoincCode;
use App\Catalog\DataOrigin;
use App\Catalog\RecordedBy;
use App\Catalog\UcumUnit;
use BackedEnum;
use Filament\Support\Icons\Heroicon;
use Illuminate\Contracts\Support\Htmlable;

/**
 * Weight and height screen (ADR 0002, ADR 0004, ADR 0005, ADR 0006, ADR 0008).
 *
 * **The internal name stays as it is.** The screen no longer records weight alone, and its title and
 * menu label say so, but the class is still called `BodyWeight` and its Alpine component
 * `phrBodyWeightPage`. The component name lives in `resources/js/app.js`, which another piece of
 * work is editing right now, and losing a registration there leaves the screen mute with no visible
 * error. Renaming the class, the view, the component, the `x-ref` and the `wire:key` is a separate
 * task, for when there is no concurrent work; this change is only about the visible label.
 *
 * An event on this screen stores the weight, its unit and —optionally— the height with its own. There
 * is no measurement method to declare (ADR 0008) —a scale offers no variants that change the value
 * in a known way, unlike the arm and posture in blood pressure or the measurement site in
 * temperature— and both LOINC codes are constants, so no resolver like the blood glucose one is
 * needed either: see {@see BodyWeightLoincCode} and {@see BodyHeightLoincCode}.
 *
 * **Height is an event, not a profile field.** Someone who is growing, or in treatment to gain
 * height, needs to track it over time, and a static field on a record card does not allow that. It
 * goes in the same record as the weight because that is where it is measured and where it is used:
 * the body mass index comes from both. It is an optional field: someone who weighs themselves weekly
 * fills it in once and leaves it blank afterwards, and the client carries the last known value
 * forward.
 *
 * The unit is asked for, because kilograms and pounds are two ways of writing the same quantity and
 * each record keeps its own (ADR 0006). There is no conversion between them anywhere: conversion
 * would mean pinning precision and rounding, and the same criterion as blood glucose applies here —
 * the chart draws one series per unit instead of mixing them.
 *
 * Like {@see Glucose} and {@see BloodPressure}, this class never sees the content of a record: the
 * shared ciphertext transport lives in {@see HealthEventPage}, which validates the envelope wrapper
 * and authorization, never the content.
 *
 * The catalog does not publish {@see DataOrigin}: the view does not ask for the data origin (always
 * manual, see the JSDoc of `resources/js/health/bodyWeightPage.js`), so there is no `<select>` to
 * fill with those tokens. `origin` still travels inside the encrypted envelope, fixed to `manual`
 * from the client.
 */
final class BodyWeight extends HealthEventPage
{
    protected static string|BackedEnum|null $navigationIcon = Heroicon::Scale;

    protected string $view = 'phr.pages.body-weight';

    /**
     * The title and the navigation label are resolved by method and not as a static property because
     * a property initializer in PHP only accepts constant expressions: `__()` cannot be called
     * there.
     */
    public function getTitle(): string|Htmlable
    {
        return __('Weight and height');
    }

    public static function getNavigationLabel(): string
    {
        return __('Weight and height');
    }

    /**
     * Public plaintext catalog the client needs to build the encrypted payload (ADR 0005). It is not
     * clinical data: the same tokens and codes for every user.
     *
     * The unit label is not its UCUM code: the code for the pound is `[lb_av]`, with the brackets
     * UCUM reserves for non-metric units, and showing it like that in a dropdown and in the history
     * would be asking the person to read exchange notation. The code is stored and the label is
     * shown, which is exactly the ADR 0005 distinction.
     *
     * @return array{
     *     units: list<array{code: string, label: string}>,
     *     loinc: string,
     *     heightUnits: list<array{code: string, label: string}>,
     *     heightLoinc: string,
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
                ['code' => UcumUnit::Kilogram->value, 'label' => 'kg'],
                ['code' => UcumUnit::Pound->value, 'label' => 'lb'],
            ],
            /** Just one and constant: weight resolves no code by unit or by method. */
            'loinc' => BodyWeightLoincCode::Measured->value,
            /**
             * Centimetres and inches, the same metric/customary pair as for weight. The inch is
             * `[in_i]` in UCUM and is shown as `in`, for the same reason as the pound: the code is
             * exchange notation, not something anyone should be asked to read (ADR 0005).
             */
            'heightUnits' => [
                ['code' => UcumUnit::Centimeter->value, 'label' => 'cm'],
                ['code' => UcumUnit::Inch->value, 'label' => 'in'],
            ],
            /** Generic and asserting neither posture nor method, because neither is asked: see {@see BodyHeightLoincCode}. */
            'heightLoinc' => BodyHeightLoincCode::Generic->value,
            /** Field common to every event (ADR 0006), not specific to weight. */
            'recordedByRoles' => self::labelledOptions(RecordedBy::cases(), $locale),
        ];
    }
}
