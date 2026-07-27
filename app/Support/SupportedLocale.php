<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Http\Request;

/**
 * Closed list of interface languages and resolution of which one to use on each request.
 *
 * It is a closed list on purpose: the value ends up in `App::setLocale()` and eventually picks a
 * translation file, so accepting any string would let the client point wherever it likes. Anything
 * not on the list falls back to the default language (`app.fallback_locale`, English) instead of
 * blowing up: an unknown language is a user who does not understand the screen, not an exception.
 *
 * The name of the Chinese locale is `zh_CN`, with an underscore, which is the one the translations
 * Filament already ships use (`vendor/filament/filament/resources/lang/zh_CN`). In the HTML `lang`
 * attribute it is emitted with a plain dash (`zh-CN`), which is what BCP 47 asks for.
 */
final class SupportedLocale
{
    /**
     * The three languages the interface speaks, with the default one first.
     *
     * It is a constant and not a `config()` read because the `App\Catalog` enums use it and they are
     * plain code: they have to be able to resolve a label without the container. `config/app.php`
     * points to this same constant, so there are not two lists that can drift apart.
     *
     * @var list<string>
     */
    public const array All = ['en', 'es', 'zh_CN'];

    /** Default language when there is no usable signal. It matches `app.fallback_locale`. */
    public const string Fallback = 'en';

    /**
     * @return list<string>
     */
    public static function all(): array
    {
        return self::All;
    }

    /** Is this code exactly one of the supported languages? */
    public static function isSupported(?string $locale): bool
    {
        return $locale !== null && in_array($locale, self::all(), true);
    }

    /**
     * Normalizes a language code to one on the list, or returns the default if it is unrecognized.
     */
    public static function resolve(?string $locale): string
    {
        return self::match($locale) ?? self::fallback();
    }

    /**
     * Language for the request: the one the person saved in their account and, if they saved none,
     * the one their browser asks for.
     *
     * The order matters. The login screen is painted before a session exists and before any key
     * exists, so there is only `Accept-Language` there; as soon as there is a user, their explicit
     * choice wins over whatever the browser says.
     */
    public static function forRequest(Request $request): string
    {
        $stored = $request->user()?->getAttribute('locale');

        if (is_string($stored) && self::isSupported($stored)) {
            return $stored;
        }

        return self::negotiate($request->header('Accept-Language'));
    }

    /**
     * Best supported language according to the `Accept-Language` header, honouring the quality
     * factor.
     *
     * It reveals nothing new: the browser already sends this header on every request, whether we
     * read it or not.
     */
    public static function negotiate(?string $header): string
    {
        if ($header === null || $header === '') {
            return self::fallback();
        }

        $candidates = [];

        foreach (explode(',', $header) as $part) {
            $pieces = explode(';', trim($part));
            $tag = trim($pieces[0]);

            if ($tag === '' || $tag === '*') {
                continue;
            }

            $quality = 1.0;

            if (isset($pieces[1]) && preg_match('/q=([0-9.]+)/', $pieces[1], $found) === 1) {
                $quality = (float) $found[1];
            }

            $candidates[] = ['tag' => $tag, 'quality' => $quality];
        }

        usort($candidates, static fn (array $a, array $b): int => $b['quality'] <=> $a['quality']);

        foreach ($candidates as $candidate) {
            $matched = self::match($candidate['tag']);

            if ($matched !== null) {
                return $matched;
            }
        }

        return self::fallback();
    }

    /**
     * Supported language matching this code, or `null` if none does.
     *
     * It accepts the variants that arrive from outside without treating them as a caller error: a
     * dash instead of an underscore (`zh-CN`, as BCP 47 writes it and as it travels in
     * `Accept-Language`) and any mix of capitals. A tag with an unknown region (`es-AR`, `zh-Hans`)
     * matches on the language part when there is only one candidate with that part.
     */
    private static function match(?string $locale): ?string
    {
        if ($locale === null || trim($locale) === '') {
            return null;
        }

        $normalized = str_replace('-', '_', trim($locale));

        foreach (self::all() as $supported) {
            if (strcasecmp($normalized, $supported) === 0) {
                return $supported;
            }
        }

        $language = strtolower(explode('_', $normalized)[0]);
        $matches = array_values(array_filter(
            self::all(),
            static fn (string $supported): bool => strtolower(explode('_', $supported)[0]) === $language,
        ));

        return count($matches) === 1 ? $matches[0] : null;
    }

    /** Default language. */
    private static function fallback(): string
    {
        return self::Fallback;
    }
}
