<?php

declare(strict_types=1);

namespace App\Crypto;

use Carbon\CarbonImmutable;
use DateTimeInterface;
use Exception;

/**
 * Formato canónico de fecha del ADR 0004: `YYYY-MM-DDTHH:MM:SS.ffffffZ`, siempre UTC, sufijo `Z`,
 * seis dígitos de fracción rellenados con ceros.
 *
 * No es un formateo de presentación: estas fechas entran en el dato asociado del AEAD y en el `info`
 * de la derivación de claves, así que una variante distinta de la misma fecha son bytes distintos y
 * produce un sobre indescifrable. ISO 8601 a secas no basta, porque admite varias formas del mismo
 * instante, y las propias herramientas del proyecto producen tres incompatibles entre sí.
 *
 * Vive en un solo sitio porque un segundo criterio de fecha sería un segundo sitio donde
 * equivocarse: lo usan tanto el `occurred_at` de los eventos (ADR 0006) como el `expiresAt` de los
 * recortes compartidos (ADR 0011), y el que se desviase sería justo el que participa en un AEAD.
 */
final class CanonicalDate
{
    public const string FORMAT = 'Y-m-d\TH:i:s.u\Z';

    /** Forma exacta admitida. Se comprueba antes de parsear, porque Carbon es tolerante de más. */
    public const string REGEX = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/';

    private function __construct() {}

    /**
     * Parsea una fecha canónica, o `null` si no lo es.
     *
     * La comprobación es de ida y vuelta: además del patrón, se vuelve a formatear el resultado y se
     * exige igualdad con la entrada. Sin eso, Carbon acepta cosas como el 31 de febrero y las
     * desplaza en silencio al 3 de marzo, con lo que el servidor guardaría una fecha distinta de la
     * que el cliente usó al cifrar.
     */
    public static function parse(mixed $value): ?CarbonImmutable
    {
        if (! is_string($value) || preg_match(self::REGEX, $value) !== 1) {
            return null;
        }

        try {
            $date = CarbonImmutable::createFromFormat(self::FORMAT, $value, 'UTC');
        } catch (Exception) {
            return null;
        }

        if (! $date instanceof CarbonImmutable || self::format($date) !== $value) {
            return null;
        }

        return $date;
    }

    public static function format(DateTimeInterface $date): string
    {
        return CarbonImmutable::instance($date)->utc()->format(self::FORMAT);
    }
}
