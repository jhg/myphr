<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Resolutor de la combinación (método, unidad) al código LOINC de glucemia correspondiente.
 *
 * El ADR 0005 (docs/adr/0005-clinical-vocabulary-loinc-snomed.md) explica que un código LOINC no
 * identifica solo la magnitud: incluye también la unidad y, en mediciones como la glucemia, el
 * método. Por eso un mismo concepto clínico para el paciente puede necesitar más de un código
 * según cómo y con qué se midió. El ADR 0008 (docs/adr/0008-measurement-method.md) añade que esa
 * decisión se toma con método y unidad explícitos, nunca deducidos.
 *
 * Los cuatro códigos siguientes están verificados contra LOINC y no deben modificarse. El código
 * de líquido intersticial en mmol/L tiene seis dígitos antes del guion (`105272-9`); es un formato
 * válido de LOINC y cualquier validación de formato futura debe aceptarlo.
 *
 * La etiqueta al paciente (`patientLabel()`) no sustituye al término oficial LOINC
 * (`officialName()`): ambos conviven, tal y como exige el ADR 0005. La etiqueta es nuestra, en el
 * idioma del paciente; el término oficial es el que se usa en consulta o al exportar.
 */
enum GlucoseLoincCode: string
{
    case CapillaryMilligramsPerDeciliter = '41653-7';

    case CapillaryMillimolesPerLiter = '14743-9';

    case InterstitialMilligramsPerDeciliter = '99504-3';

    case InterstitialMillimolesPerLiter = '105272-9';

    /**
     * Resuelve el código LOINC de glucemia para una combinación de método y unidad.
     *
     * El resolutor es total sobre las combinaciones soportadas: para cada una devuelve siempre el
     * mismo código, y ante una combinación no soportada falla de forma ruidosa en vez de devolver
     * un código por defecto, porque un código LOINC equivocado es un dato clínico equivocado.
     *
     * @throws ValueError si la combinación de método y unidad no tiene código LOINC asignado.
     */
    public static function resolve(GlucoseMeasurementMethod $method, UcumUnit $unit): self
    {
        return match ([$method, $unit]) {
            [GlucoseMeasurementMethod::Capillary, UcumUnit::MilligramsPerDeciliter] => self::CapillaryMilligramsPerDeciliter,
            [GlucoseMeasurementMethod::Capillary, UcumUnit::MillimolesPerLiter] => self::CapillaryMillimolesPerLiter,
            [GlucoseMeasurementMethod::Interstitial, UcumUnit::MilligramsPerDeciliter] => self::InterstitialMilligramsPerDeciliter,
            [GlucoseMeasurementMethod::Interstitial, UcumUnit::MillimolesPerLiter] => self::InterstitialMillimolesPerLiter,
            default => throw new ValueError(sprintf(
                'No existe código LOINC de glucemia para el método "%s" en unidad "%s".',
                $method->value,
                $unit->value,
            )),
        };
    }

    /** Término oficial LOINC, en inglés, tal y como lo publica Regenstrief Institute. */
    public function officialName(): string
    {
        return match ($this) {
            self::CapillaryMilligramsPerDeciliter => 'Glucose [Mass/volume] in Capillary blood by Glucometer',
            self::CapillaryMillimolesPerLiter => 'Glucose [Moles/volume] in Capillary blood by Glucometer',
            self::InterstitialMilligramsPerDeciliter => 'Glucose [Mass/volume] in Interstitial fluid',
            self::InterstitialMillimolesPerLiter => 'Glucose [Moles/volume] in Interstitial fluid',
        };
    }

    /**
     * Etiqueta propia para el paciente, en el idioma indicado. No sustituye a `officialName()`.
     *
     * Esta es la única capa que podemos ofrecer completa en los tres idiomas: LOINC no publica
     * traducción oficial al chino simplificado de estos cuatro términos, así que `officialName()`
     * sigue en inglés siempre y aquí va la redacción nuestra, que sí traducimos.
     *
     * @param  string  $locale  Cualquier código; los no soportados caen al idioma por defecto.
     */
    public function patientLabel(string $locale): string
    {
        $locale = SupportedLocale::resolve($locale);

        return match ([$this, $locale]) {
            [self::CapillaryMilligramsPerDeciliter, 'es'],
            [self::CapillaryMillimolesPerLiter, 'es'] => 'Glucosa en sangre capilar',
            [self::InterstitialMilligramsPerDeciliter, 'es'],
            [self::InterstitialMillimolesPerLiter, 'es'] => 'Glucosa en líquido intersticial',
            [self::CapillaryMilligramsPerDeciliter, 'en'],
            [self::CapillaryMillimolesPerLiter, 'en'] => 'Blood glucose (capillary)',
            [self::InterstitialMilligramsPerDeciliter, 'en'],
            [self::InterstitialMillimolesPerLiter, 'en'] => 'Interstitial fluid glucose',
            [self::CapillaryMilligramsPerDeciliter, 'zh_CN'],
            [self::CapillaryMillimolesPerLiter, 'zh_CN'] => '毛细血管血糖',
            [self::InterstitialMilligramsPerDeciliter, 'zh_CN'],
            [self::InterstitialMillimolesPerLiter, 'zh_CN'] => '组织液葡萄糖',
            default => throw new ValueError(sprintf('Falta la etiqueta al paciente para el idioma "%s".', $locale)),
        };
    }
}
