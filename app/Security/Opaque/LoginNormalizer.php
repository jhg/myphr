<?php

declare(strict_types=1);

namespace App\Security\Opaque;

use Normalizer;

/**
 * Única fuente de `normalize(login)` (`docs/OPAQUE.md` §13.1.1, Spec 0001 §10).
 *
 * ```
 * normalize(login) = mb_strtolower(NFKC(trim(login)), 'UTF-8')
 * ```
 *
 * La misma cadena normalizada se usa para buscar la cuenta, para persistir la
 * columna de login y para calcular el `credential_identifier`. Si dos de esos
 * tres caminos difieren aparece un oráculo de enumeración en dos peticiones.
 *
 * Opera sobre texto, nunca sobre material binario: `mb_strtolower` es correcto
 * aquí porque el login es una cadena UTF-8.
 */
final class LoginNormalizer
{
    /**
     * @param  string  $login  Identificador tal cual lo escribió la persona.
     * @return string Forma canónica: sin espacios exteriores, NFKC y en minúsculas.
     *
     * @throws InvalidConfigurationException Si la cadena no se puede normalizar a NFKC.
     */
    public static function normalize(string $login): string
    {
        $normalized = Normalizer::normalize(trim($login), Normalizer::FORM_KC);

        if (! is_string($normalized)) {
            throw new InvalidConfigurationException('The login could not be normalized to NFKC.');
        }

        return mb_strtolower($normalized, 'UTF-8');
    }
}
