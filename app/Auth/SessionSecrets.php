<?php

declare(strict_types=1);

namespace App\Auth;

use App\Security\Opaque\Base64Url;
use App\Security\Opaque\RandomSource;
use Illuminate\Contracts\Session\Session;

/**
 * Session secret from ADR 0003 (Spec 0001 §3.5, §4.4, §4.5, §4.6).
 *
 * It lives **inside the Laravel session payload**, with no table and no column: the same server-side
 * store that protects the rest of the session protects it, and destroying the session destroys it.
 * What we give up is being able to revoke someone's cryptographic session without deserializing
 * their payload; that loss is explicitly accepted in §3.5.
 *
 * It is minted **after** `session()->regenerate()` (Spec 0001 §5, step 14): minting it earlier ties
 * it to the previous session identifier and it is lost on regeneration, with no symptom until that
 * person's first page refresh.
 *
 * The value is handed over as base64url so it travels over JSON as is; the browser derives from it
 * the key that opens the `sessionStorage` bundle.
 */
final readonly class SessionSecrets
{
    /** Key inside the session payload. */
    public const string SESSION_KEY = 'phr.session_secret';

    /** Secret length, in bytes. */
    public const int SECRET_BYTES = 32;

    public function __construct(private RandomSource $random) {}

    /**
     * Mints a fresh secret and stores it in the session, replacing any previous one.
     *
     * @return string Secret as base64url without padding, 43 characters.
     */
    public function mint(Session $session): string
    {
        $secret = Base64Url::encode($this->random->bytes(self::SECRET_BYTES));

        $session->put(self::SESSION_KEY, $secret);

        return $secret;
    }

    /**
     * Returns the session's current secret, or `null` if there is none.
     *
     * `null` is the normal case after a lock or a logout, not an error: the interface degrades to
     * asking for authentication (Spec 0001 §6.2).
     */
    public function current(Session $session): ?string
    {
        $secret = $session->get(self::SESSION_KEY);

        return is_string($secret) && $secret !== '' ? $secret : null;
    }

    /**
     * Destroys the secret. Locking and logging out destroy the whole session as well
     * (Spec 0001 §8), which would destroy it anyway; this makes it explicit instead of relying on
     * that side effect.
     */
    public function destroy(Session $session): void
    {
        $session->forget(self::SESSION_KEY);
    }
}
