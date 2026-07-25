<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Http\Request;

/**
 * Lista cerrada de idiomas de la interfaz y resolución de cuál se usa en cada petición.
 *
 * Es lista cerrada a propósito: el valor acaba en `App::setLocale()` y termina eligiendo un fichero
 * de traducción, así que aceptar cualquier cadena sería dejar que el cliente apunte a donde quiera.
 * Todo lo que no esté en la lista cae al idioma por defecto (`app.fallback_locale`, inglés) en vez
 * de reventar: un idioma desconocido es un usuario que no entiende la pantalla, no una excepción.
 *
 * El nombre del idioma chino es `zh_CN`, con guion bajo, que es el que usan las traducciones que ya
 * trae Filament (`vendor/filament/filament/resources/lang/zh_CN`). En el atributo `lang` del HTML
 * se emite con guion normal (`zh-CN`), que es lo que pide BCP 47.
 */
final class SupportedLocale
{
    /**
     * Los tres idiomas que la interfaz sabe hablar, con el de serie primero.
     *
     * Es una constante y no una lectura de `config()` porque los enums de `App\Catalog` la usan y
     * son código puro: tienen que poder resolver una etiqueta sin contenedor. `config/app.php`
     * apunta a esta misma constante, así que no hay dos listas que puedan divergir.
     *
     * @var list<string>
     */
    public const array All = ['en', 'es', 'zh_CN'];

    /** Idioma de serie cuando no hay ninguna señal utilizable. Coincide con `app.fallback_locale`. */
    public const string Fallback = 'en';

    /**
     * @return list<string>
     */
    public static function all(): array
    {
        return self::All;
    }

    /** ¿Es este código exactamente uno de los idiomas soportados? */
    public static function isSupported(?string $locale): bool
    {
        return $locale !== null && in_array($locale, self::all(), true);
    }

    /**
     * Normaliza un código de idioma al de la lista, o devuelve el de por defecto si no lo reconoce.
     */
    public static function resolve(?string $locale): string
    {
        return self::match($locale) ?? self::fallback();
    }

    /**
     * Idioma de la petición: el que la persona guardó en su cuenta y, si no guardó ninguno, el que
     * pide su navegador.
     *
     * El orden importa. La pantalla de acceso se pinta antes de que exista sesión y antes de que
     * exista ninguna clave, así que ahí solo hay `Accept-Language`; en cuanto hay usuario, su
     * elección explícita manda sobre lo que diga el navegador.
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
     * Mejor idioma soportado según la cabecera `Accept-Language`, respetando el factor de calidad.
     *
     * No añade ninguna revelación nueva: el navegador ya manda esta cabecera en todas las
     * peticiones, se lea o no.
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
     * Idioma soportado que corresponde a este código, o `null` si ninguno.
     *
     * Acepta las variantes que llegan de fuera sin que sean un error de quien las manda: guion en
     * vez de guion bajo (`zh-CN`, como lo escribe BCP 47 y como viaja en `Accept-Language`) y
     * cualquier combinación de mayúsculas. Una etiqueta con región desconocida (`es-AR`, `zh-Hans`)
     * casa por la parte de idioma cuando solo hay una candidata con esa parte.
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

    /** Idioma por defecto. */
    private static function fallback(): string
    {
        return self::Fallback;
    }
}
