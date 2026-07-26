<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Filament\Pages\HealthEventPage;

/**
 * Enum del catálogo con etiqueta para el paciente en los tres idiomas de la aplicación.
 *
 * Existe para una sola cosa: que {@see HealthEventPage::labelledOptions()} pueda
 * recorrer los casos de cualquiera de estos enums con tipos de verdad, en vez de recibir un `array`
 * suelto y confiar en que sus elementos respondan a `label()`.
 *
 * No cubre todo el catálogo a propósito. `UcumUnit` y `FoodQuantityUnit` publican un `code` en vez de
 * un `token` y llevan etiquetas que no se traducen (`mg/dL`, `mmol/L`), así que se quedan fuera y sus
 * mapeos siguen escritos en línea donde hacen falta.
 */
interface PatientLabelled
{
    /**
     * Etiqueta en el idioma en vigor. El texto vive dentro del propio enum, no en `lang/`, porque es
     * vocabulario clínico y no cadena de interfaz (ADR 0005).
     */
    public function label(string $locale): string;
}
