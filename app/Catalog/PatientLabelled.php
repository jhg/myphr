<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Filament\Pages\HealthEventPage;

/**
 * A catalog enum with a patient-facing label in every supported language.
 *
 * It exists for one thing only: so {@see HealthEventPage::labelledOptions()} can walk the cases of
 * any of these enums with real types, instead of receiving a loose `array` and trusting that its
 * elements answer to `label()`.
 *
 * It deliberately does not cover the whole catalog. `UcumUnit` and `FoodQuantityUnit` expose a
 * `code` instead of a `token` and carry labels that are not translated (`mg/dL`, `mmol/L`), so they
 * stay out and their mappings remain written inline where they are needed.
 */
interface PatientLabelled
{
    /**
     * Label in the current language. The text lives inside the enum itself, not in `lang/`, because
     * it is clinical vocabulary and not interface copy (ADR 0005).
     */
    public function label(string $locale): string;
}
