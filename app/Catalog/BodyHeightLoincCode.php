<?php

declare(strict_types=1);

namespace App\Catalog;

/**
 * LOINC code for body height.
 *
 * **Why the generic 8302-2 "Body height" and not a variant.** LOINC publishes a whole family around
 * height, and each variant asserts something different:
 *
 * * `8308-9` "Body height --standing" and `8306-3` "Body height --lying" assert the POSTURE. The
 *   distinction is real —lying down you measure slightly more than standing, and for infants it is
 *   the only way to measure— but this screen does not ask for the posture. Recording "standing"
 *   without having asked would be inventing a clinical fact, which is the exact opposite of the
 *   {@see TemperatureLoincCode} criterion: there the generic code is not used because the screen
 *   DOES require the site, and throwing away a fact you have leaves a code worse than the data
 *   allows.
 * * `3137-7` "Body height Measured" and `3138-5` "Body height Stated" assert the METHOD. Here lies
 *   the difference with weight, which does use the "Measured" variant ({@see BodyWeightLoincCode}):
 *   weight is typed while reading a scale right then, whereas height is almost always typed from
 *   memory. Without asking, you cannot know whether it was measured or stated, and claiming
 *   "Measured" would be false most of the time.
 *
 * The generic 8302-2 is also the one the FHIR vital signs profile requires
 * (http://hl7.org/fhir/StructureDefinition/vitalsigns), so it is also the one that travels best.
 *
 * If the screen ever comes to ask for the posture, this class grows a resolver shaped like
 * {@see TemperatureLoincCode::resolve()} with `8308-9` / `8306-3` as new cases. Adding a case is
 * safe; changing the value of this one **is not**: it goes into the content encrypted in the browser
 * (ADR 0002, ADR 0004), where it can no longer be fixed without each user's key.
 *
 * Verified against LOINC with the medical terminology tool (2026-07-27).
 */
enum BodyHeightLoincCode: string
{
    /** Body height, asserting neither posture nor method. */
    case Generic = '8302-2';

    /** Official LOINC term, in English, exactly as published by the Regenstrief Institute (ADR 0005). */
    public function officialName(): string
    {
        return match ($this) {
            self::Generic => 'Body height',
        };
    }
}
