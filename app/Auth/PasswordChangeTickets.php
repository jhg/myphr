<?php

declare(strict_types=1);

namespace App\Auth;

use App\Security\Opaque\Base64Url;
use App\Security\Opaque\RandomSource;
use Illuminate\Contracts\Session\Session;

/**
 * Ticket that authorizes an already reauthenticated password change.
 *
 * `password/reauth/finish` mints it **after** validating the MAC of a full OPAQUE login with the
 * current password, and `password/change` consumes it. In between, `password/registration/start`
 * only checks it: consuming it there would leave anyone who loses their network during the Argon2id
 * of the re-registration without a ticket, forcing them to repeat the reauthentication Argon2id too.
 *
 * It lives **inside the session payload**, like the session secret in {@see SessionSecrets} and for
 * the same reasons: it is tied to the session identifier without a new table, it dies with a lock
 * and it does not survive a regeneration. The deliberate consequence is that a ticket does not
 * travel across tabs or devices: a password change is finished where it started.
 *
 * The comparison is always constant time: the ticket is a 32-byte secret and comparing it with
 * `===` would leak by timing how many leading bytes the attacker got right.
 */
final readonly class PasswordChangeTickets
{
    /** Key of the ticket inside the session payload. */
    public const string SESSION_KEY = 'phr.password_change_ticket';

    /** Key of the expiry, as a Unix timestamp. */
    public const string EXPIRY_SESSION_KEY = 'phr.password_change_ticket_expires_at';

    /** Ticket length, in bytes. */
    public const int TICKET_BYTES = 32;

    /**
     * Lifetime window, in seconds. It comfortably covers the re-registration Argon2id without
     * leaving a password change authorization open for minutes on an unattended machine.
     */
    public const int TTL_SECONDS = 180;

    public function __construct(private RandomSource $random) {}

    /**
     * Mints a fresh ticket, replacing any previous one.
     *
     * @return string Ticket as base64url without padding, 43 characters.
     */
    public function mint(Session $session): string
    {
        $ticket = Base64Url::encode($this->random->bytes(self::TICKET_BYTES));

        $session->put(self::SESSION_KEY, $ticket);
        $session->put(self::EXPIRY_SESSION_KEY, time() + self::TTL_SECONDS);

        return $ticket;
    }

    /**
     * Is this the session's current ticket, and is it still inside its window?
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
     * Checks and destroys the ticket in one step. It returns `false` and destroys nothing when it
     * does not match: someone else's ticket or an expired one must not be usable to invalidate the
     * good one.
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
     * Expiry moment of the current ticket, or `null` if none is alive.
     *
     * `password/registration/start` uses it so the pending row never outlives the ticket that
     * authorizes it.
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
