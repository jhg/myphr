<?php

declare(strict_types=1);

namespace App\Catalog;

/**
 * UCUM units (http://unitsofmeasure.org) specific to blood pressure.
 *
 * They are declared apart from {@see UcumUnit} instead of being added to that shared enum because
 * this screen does not touch files that are not its own (several agents work on the catalog in
 * parallel). ADR 0005 (docs/adr/0005-clinical-vocabulary-loinc-snomed.md) fixes millimetres of
 * mercury as `mm[Hg]` and beats per minute as `/min`, both verified against UCUM: unlike blood
 * glucose, blood pressure offers no alternative unit for the user to pick, so each case is fixed for
 * its quantity and there is no selector on the screen.
 */
enum BloodPressureUnit: string
{
    /** Millimetres of mercury, the unit of systolic and diastolic pressure. */
    case MillimetersOfMercury = 'mm[Hg]';

    /** Beats per minute, the unit of the pulse. */
    case BeatsPerMinute = '/min';
}
