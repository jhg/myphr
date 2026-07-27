<?php

declare(strict_types=1);

namespace App\Security\Opaque;

use Normalizer;

/**
 * The single source of `normalize(login)` (`docs/OPAQUE.md` §13.1.1, Spec 0001 §10).
 *
 * ```
 * normalize(login) = mb_strtolower(NFKC(trim(login)), 'UTF-8')
 * ```
 *
 * The same normalized string is used to look the account up, to persist the
 * login column and to compute the `credential_identifier`. If two of those
 * three paths differ, an enumeration oracle appears in two requests.
 *
 * It works on text, never on binary material: `mb_strtolower` is correct here
 * because the login is a UTF-8 string.
 */
final class LoginNormalizer
{
    /**
     * @param  string  $login  Identifier exactly as the person typed it.
     * @return string Canonical form: no outer whitespace, NFKC and lowercase.
     *
     * @throws InvalidConfigurationException If the string cannot be normalized to NFKC.
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
