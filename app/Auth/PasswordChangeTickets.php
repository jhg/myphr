<?php

declare(strict_types=1);

namespace App\Auth;

use App\Security\Opaque\Base64Url;
use App\Security\Opaque\RandomSource;
use Illuminate\Contracts\Session\Session;

/**
 * Ticket que autoriza un cambio de contraseña ya reautenticado.
 *
 * Lo acuña `password/reauth/finish` **después** de validar el MAC de un login OPAQUE completo con la
 * contraseña actual, y lo consume `password/change`. Entre medias, `password/registration/start` solo
 * lo comprueba: consumirlo allí dejaría sin ticket a quien sufra un corte de red durante el Argon2id
 * del re-registro, obligándole a repetir también el Argon2id de la reautenticación.
 *
 * Vive **dentro de la carga útil de la sesión**, igual que el secreto de sesión de {@see SessionSecrets}
 * y por los mismos motivos: queda atado al identificador de sesión sin tabla nueva, muere con el
 * bloqueo y no sobrevive a una regeneración. La consecuencia deliberada es que un ticket no viaja
 * entre pestañas ni entre dispositivos: el cambio de contraseña se completa donde empezó.
 *
 * La comparación es siempre en tiempo constante: el ticket es un secreto de 32 bytes y compararlo con
 * `===` filtraría por tiempo cuántos bytes iniciales acertó quien lo intenta.
 */
final readonly class PasswordChangeTickets
{
    /** Clave del ticket dentro de la carga útil de la sesión. */
    public const string SESSION_KEY = 'phr.password_change_ticket';

    /** Clave de la caducidad, como marca de tiempo Unix. */
    public const string EXPIRY_SESSION_KEY = 'phr.password_change_ticket_expires_at';

    /** Longitud del ticket, en bytes. */
    public const int TICKET_BYTES = 32;

    /**
     * Ventana de vida, en segundos. Cubre el Argon2id del re-registro con holgura sin dejar abierta
     * durante minutos una autorización de cambio de contraseña en un puesto desatendido.
     */
    public const int TTL_SECONDS = 180;

    public function __construct(private RandomSource $random) {}

    /**
     * Acuña un ticket nuevo, sustituyendo cualquier anterior.
     *
     * @return string Ticket en base64url sin padding, 43 caracteres.
     */
    public function mint(Session $session): string
    {
        $ticket = Base64Url::encode($this->random->bytes(self::TICKET_BYTES));

        $session->put(self::SESSION_KEY, $ticket);
        $session->put(self::EXPIRY_SESSION_KEY, time() + self::TTL_SECONDS);

        return $ticket;
    }

    /**
     * ¿Es este el ticket vigente de la sesión y sigue dentro de su ventana?
     */
    public function verify(Session $session, string $ticket): bool
    {
        $stored = $session->get(self::SESSION_KEY);
        $expiresAt = $session->get(self::EXPIRY_SESSION_KEY);

        if (! is_string($stored) || $stored === '' || ! is_int($expiresAt) || $expiresAt <= time()) {
            return false;
        }

        return hash_equals($stored, $ticket);
    }

    /**
     * Comprueba y destruye el ticket en un solo paso. Devuelve `false` sin destruir nada cuando no
     * cuadra: un ticket ajeno o caducado no puede servir para invalidar el bueno.
     */
    public function consume(Session $session, string $ticket): bool
    {
        if (! $this->verify($session, $ticket)) {
            return false;
        }

        $this->destroy($session);

        return true;
    }

    /**
     * Momento de caducidad del ticket vigente, o `null` si no hay ninguno vivo.
     *
     * Lo usa `password/registration/start` para que el pendiente nunca sobreviva al ticket que lo
     * autoriza.
     */
    public function expiresAt(Session $session): ?int
    {
        $expiresAt = $session->get(self::EXPIRY_SESSION_KEY);

        return is_int($expiresAt) && $expiresAt > time() ? $expiresAt : null;
    }

    public function destroy(Session $session): void
    {
        $session->forget([self::SESSION_KEY, self::EXPIRY_SESSION_KEY]);
    }
}
