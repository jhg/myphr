<?php

declare(strict_types=1);

namespace App\Auth;

use App\Security\Opaque\Base64Url;
use App\Security\Opaque\RandomSource;
use Illuminate\Contracts\Session\Session;

/**
 * Secreto de sesión del ADR 0003 (Spec 0001 §3.5, §4.4, §4.5, §4.6).
 *
 * Vive **dentro de la carga útil de la sesión de Laravel**, sin tabla ni columna: lo protege el
 * mismo almacén de servidor que protege el resto de la sesión, y destruir la sesión lo destruye.
 * Lo que se pierde a cambio es poder revocar la sesión criptográfica de alguien sin deserializar su
 * carga útil; es una pérdida aceptada de forma explícita en §3.5.
 *
 * Se acuña **después** de `session()->regenerate()` (Spec 0001 §5, paso 14): acuñarlo antes lo ata
 * al identificador de sesión anterior y se pierde en la regeneración, sin ningún síntoma hasta el
 * primer F5 de esa persona.
 *
 * El valor se entrega en base64url para que viaje por JSON tal cual; el navegador deriva de él la
 * clave con la que abre el paquete de `sessionStorage`.
 */
final readonly class SessionSecrets
{
    /** Clave dentro de la carga útil de la sesión. */
    public const string SESSION_KEY = 'phr.session_secret';

    /** Longitud del secreto, en bytes. */
    public const int SECRET_BYTES = 32;

    public function __construct(private RandomSource $random) {}

    /**
     * Acuña un secreto nuevo y lo guarda en la sesión, sustituyendo cualquier anterior.
     *
     * @return string Secreto en base64url sin padding, 43 caracteres.
     */
    public function mint(Session $session): string
    {
        $secret = Base64Url::encode($this->random->bytes(self::SECRET_BYTES));

        $session->put(self::SESSION_KEY, $secret);

        return $secret;
    }

    /**
     * Devuelve el secreto vigente de la sesión, o `null` si no hay ninguno.
     *
     * `null` es el caso normal tras un bloqueo o un cierre de sesión, no un error: la interfaz
     * degrada a pedir autenticación (Spec 0001 §6.2).
     */
    public function current(Session $session): ?string
    {
        $secret = $session->get(self::SESSION_KEY);

        return is_string($secret) && $secret !== '' ? $secret : null;
    }

    /**
     * Destruye el secreto. El bloqueo y el cierre de sesión destruyen además la sesión entera
     * (Spec 0001 §8), lo que lo destruiría igualmente; esto lo hace explícito y no dependiente
     * de ese efecto lateral.
     */
    public function destroy(Session $session): void
    {
        $session->forget(self::SESSION_KEY);
    }
}
