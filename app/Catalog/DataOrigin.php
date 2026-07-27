<?php

declare(strict_types=1);

namespace App\Catalog;

use App\Support\SupportedLocale;
use ValueError;

/**
 * Whether the value of a clinical event was typed by hand or came from a device (ADR 0006, "Fields
 * we capture even though we do not use them today").
 *
 * Common to every event type, not specific to blood glucose: it lives at the top level of the
 * decrypted content (`origin`), next to `v`, `type` and `tz`, not inside `data`. The value of each
 * case is the stable token that goes into the encrypted envelope (ADR 0004: "stable tokens, never
 * visible labels"), so, like {@see GlucoseMeasurementMethod}, it **can never change** once
 * published.
 *
 * Unlike {@see MealContext}, this field does admit a sensible default: it is not a clinical claim,
 * it is a fact about how the data got in, and by far the most common case is that it was typed by
 * hand.
 *
 * No capture form asks for this value: manual entry is always `Manual`, so asking has no real answer
 * and only invites wrong ones (a confusion this project already suffered once with "measurement
 * method", which is a different thing: what it was measured with, not how it got into the
 * application). The enum is not deleted even though nobody asks for it today: the value still
 * travels inside the encrypted envelope because a future automatic import (syncing with a connected
 * glucose meter or sensor) will build the event with `Device` and no human involved, and what you
 * do not capture at the source cannot be reconstructed later.
 */
enum DataOrigin: string
{
    /** Typed by hand by whoever records it. */
    case Manual = 'manual';

    /** Read automatically from a device (sensor, connected glucose meter, etc.). */
    case Device = 'device';

    /**
     * Label in the given language, to show to the patient (ADR 0005: the label does not replace the
     * token, which is the only thing that goes into the encrypted envelope).
     *
     * @param  string  $locale  Any code; unsupported ones fall back to the default language.
     */
    public function label(string $locale): string
    {
        $locale = SupportedLocale::resolve($locale);

        return match ([$this, $locale]) {
            [self::Manual, 'es'] => 'Manual',
            [self::Device, 'es'] => 'Aparato',
            [self::Manual, 'en'] => 'Manual',
            [self::Device, 'en'] => 'Device',
            [self::Manual, 'zh_CN'] => '手动输入',
            [self::Device, 'zh_CN'] => '设备读取',
            default => throw new ValueError(sprintf('Missing data origin label for locale "%s".', $locale)),
        };
    }
}
