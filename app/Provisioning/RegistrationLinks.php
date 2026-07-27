<?php

declare(strict_types=1);

namespace App\Provisioning;

use App\Models\User;
use App\Models\UserRegistrationLink;
use App\Security\Opaque\Base64Url;
use App\Security\Opaque\LoginNormalizer;
use App\Security\Opaque\RandomSource;
use App\Support\AuditEvent;

/**
 * Issuing, validating and consuming single-use registration links
 * (Spec 0001 §3.3, §3.4, §4.1, §4.2; ADR 0009).
 *
 * Rules this class deliberately gathers in one place:
 *
 * * The plaintext token only exists in memory and in the returned URL. In the database only its
 *   32-byte `sha256` lives.
 * * Non-existent, expired and consumed produce the same generic error
 *   ({@see InvalidRegistrationLinkException}, `docs/OPAQUE.md` §13.3).
 * * The "this account already has access" guard lives here and not in the command or in the
 *   Filament interface (Spec 0001 §3.4): if it lived in two places, one of them would end up
 *   without it, and `--no-interaction` would skip any confirmation placed only in the interface.
 */
final readonly class RegistrationLinks
{
    /** Size of the plaintext token, before base64url encoding. */
    public const TOKEN_BYTES = 32;

    /** Spec 0001 §3.3 / ADR 0009: a 24-hour TTL, explicit and not hidden in a default value. */
    public const TTL_HOURS = 24;

    /**
     * Path of the generic set-password page (Spec 0001 §4.1).
     *
     * The token travels in the fragment (`#<token>`), which the browser does not send to the
     * server: it only arrives inside the body of `registration/start`.
     */
    public const SET_PASSWORD_PATH = 'phr/set-password';

    public function __construct(private RandomSource $random) {}

    /**
     * Issues a new link for `$user` and returns its full URL.
     *
     * @param  User  $user  Account the link is for.
     * @param  User|null  $issuedBy  Who issues it, for auditing (`created_by`).
     * @param  string|null  $confirmation  Email typed as explicit confirmation of a reissue on an
     *                                     account that already has access.
     * @return string URL with the token in the fragment. It is the only copy of the plaintext token.
     *
     * @throws RegistrationLinkReissueRequiresConfirmationException If the account already has
     *                                                              access and the confirmation is missing.
     */
    public function issueFor(User $user, ?User $issuedBy = null, ?string $confirmation = null): string
    {
        $this->assertReissueIsConfirmed($user, $confirmation);

        $token = Base64Url::encode($this->random->bytes(self::TOKEN_BYTES));

        UserRegistrationLink::create([
            'user_id' => $user->id,
            'token_hash' => $this->hash($token),
            'expires_at' => now()->addHours(self::TTL_HOURS),
            'created_by' => $issuedBy?->id,
        ]);

        /**
         * The trail goes here and not in the caller, because issuing a link can be done from the
         * panel and from `phr:issue-registration-link`, and this is the only piece both go through.
         * It is the most destructive action in the system (Spec 0001 §3.4): completing the new
         * registration retires the current master key envelope and leaves what was stored
         * inaccessible.
         *
         * The token is **not** recorded. It is the credential that opens the signup, and storing it
         * in the clear here would defeat the point of its own table only holding its hash.
         */
        activity(AuditEvent::LOG_NAME)
            ->causedBy($issuedBy)
            ->performedOn($user)
            ->event(AuditEvent::RegistrationLinkIssued->value)
            ->log(AuditEvent::RegistrationLinkIssued->value);

        return url(self::SET_PASSWORD_PATH).'#'.$token;
    }

    /**
     * Checks that a token is usable. **It does not consume it** (Spec 0001 §5, step 4).
     *
     * Consuming it here would leave anyone who loses their network during the browser's Argon2id
     * without a link and without a usable account.
     *
     * @throws InvalidRegistrationLinkException If it does not exist, expired or was already consumed.
     */
    public function validate(string $token): UserRegistrationLink
    {
        $link = UserRegistrationLink::query()
            ->where('token_hash', $this->hash($token))
            ->whereNull('consumed_at')
            ->where('expires_at', '>', now())
            ->first();

        if (! $link instanceof UserRegistrationLink) {
            throw InvalidRegistrationLinkException::generic();
        }

        return $link;
    }

    /**
     * Consumes a token atomically (Spec 0001 §4.2).
     *
     * Consumption is a conditional write whose result is decided by the number of affected rows:
     * two simultaneous requests with the same token produce a single updated row and the second one
     * gets the generic error.
     *
     * `lockForUpdate()` is not used: on SQLite it is a no-op, so a consumption relying on it would
     * pass the tests and protect nothing (Spec 0001 §11).
     *
     * @throws InvalidRegistrationLinkException If it does not exist, expired or was already consumed.
     */
    public function consume(string $token): UserRegistrationLink
    {
        $hash = $this->hash($token);
        $now = now();

        $affected = UserRegistrationLink::query()
            ->where('token_hash', $hash)
            ->whereNull('consumed_at')
            ->where('expires_at', '>', $now)
            ->update(['consumed_at' => $now]);

        if ($affected !== 1) {
            throw InvalidRegistrationLinkException::generic();
        }

        $link = UserRegistrationLink::query()->where('token_hash', $hash)->first();

        if (! $link instanceof UserRegistrationLink) {
            throw InvalidRegistrationLinkException::generic();
        }

        return $link;
    }

    /**
     * Consumes a link by its identifier, with the same conditional write as
     * {@see self::consume()} (Spec 0001 §4.2).
     *
     * `registration/finish` does not receive the plaintext token: it only knows the link through the
     * `invitation_ref` the pending registration stored. Consumption still lives here and not in the
     * controller so there is a single implementation of what consuming a link means.
     *
     * @param  string  $id  Link identifier (`user_registration_links.id`).
     *
     * @throws InvalidRegistrationLinkException If it does not exist, expired or was already consumed.
     */
    public function consumeById(string $id): UserRegistrationLink
    {
        $now = now();

        $affected = UserRegistrationLink::query()
            ->whereKey($id)
            ->whereNull('consumed_at')
            ->where('expires_at', '>', $now)
            ->update(['consumed_at' => $now]);

        if ($affected !== 1) {
            throw InvalidRegistrationLinkException::generic();
        }

        $link = UserRegistrationLink::query()->whereKey($id)->first();

        if (! $link instanceof UserRegistrationLink) {
            throw InvalidRegistrationLinkException::generic();
        }

        return $link;
    }

    /**
     * Guard from Spec 0001 §3.4.
     *
     * The confirmation is the account email, normalized with the same function as the column
     * (`docs/OPAQUE.md` §13.1.1) so one extra capital letter does not block a legitimate reissue.
     *
     * @throws RegistrationLinkReissueRequiresConfirmationException
     */
    private function assertReissueIsConfirmed(User $user, ?string $confirmation): void
    {
        if (! $this->hasUsableAccess($user)) {
            return;
        }

        $typed = $confirmation === null ? '' : LoginNormalizer::normalize($confirmation);

        if ($typed !== '' && hash_equals((string) $user->email, $typed)) {
            return;
        }

        throw RegistrationLinkReissueRequiresConfirmationException::for($user);
    }

    /**
     * An account has access if it completed its OPAQUE registration or if it still holds a current
     * master key envelope: in both cases, a new registration destroys it.
     */
    private function hasUsableAccess(User $user): bool
    {
        return $user->opaque_registered_at !== null
            || $user->masterKeyEnvelopes()->whereNull('retired_at')->exists();
    }

    /**
     * Spec 0001 §3.3: binary `sha256` of the plaintext token, 32 bytes.
     */
    private function hash(string $token): string
    {
        return hash('sha256', $token, true);
    }
}
