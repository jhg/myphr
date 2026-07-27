<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth\Opaque;

use App\Auth\PasswordChangeTickets;
use App\Auth\SessionSecrets;
use App\Crypto\EnvelopeValidator;
use App\Models\OpaqueRegistration;
use App\Models\User;
use App\Models\UserMasterKeyEnvelope;
use App\Security\Opaque\OpaqueException;
use App\Security\Opaque\OpaquePurpose;
use App\Security\Opaque\RegistrationRecord;
use App\Support\AuditEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * `POST /phr/auth/password/change`: phase C of the password change, step 20.
 *
 * **One request and one transaction**, and this is not a style preference. If the new OPAQUE
 * registration and the new envelope were written separately, a failure in between would leave the
 * account alive and its history unreadable forever: with the registration written first, the account
 * authenticates with the new password while the current envelope is still under the old KEK, which
 * no longer authenticates; with the envelope first, the exact mirror of the same lockout. Either
 * both change or neither does.
 *
 * What it does **not** do, and every omission is deliberate:
 *
 * * It does not generate a new master key. The master key never changes: the browser opened it with
 *   the old KEK and rewrapped it with the new one. Generating a new one would make the whole
 *   history unreadable, because each record goes under a key derived from the previous one and the
 *   server cannot re-encrypt anything.
 * * It does not overwrite the previous envelope. It **retires** it with its date and inserts a new
 *   one: if the new OPAQUE registration turned out to be useless, overwriting it would have
 *   destroyed the only ciphertext the old password could open.
 * * It does not touch `opaque_credential_identifier` (`docs/OPAQUE.md` §13.1) or
 *   `encrypted_settings` (the settings go under a key derived from the master key, which does not
 *   change).
 * * It does not open the envelope and never sees the password, the master key or any derived key. Of
 *   the `wrappedUserMasterKey` it only checks the **shape**, with the same {@see EnvelopeValidator}
 *   as signup: a second validity criterion would be a second place to get it wrong.
 *
 * Once the transaction is committed, it regenerates the session —the identifier issued under the old
 * password must not survive the change— and only **then** mints the new session secret: minting it
 * earlier would tie it to the previous identifier and it would be lost on regeneration, with no
 * symptom until that person's first page refresh.
 *
 * **Idempotent** on the pair (`registrationRecord`, current envelope): if the response is lost on
 * the network and the client retries, the pending row is gone, so both writes are checked. If both
 * match, success is returned again. If **only one** matches, that is corruption —the only possible
 * symptom of a split write— and it answers 500, never success.
 */
final readonly class PasswordChangeController
{
    public function __construct(
        private PasswordChangeTickets $tickets,
        private SessionSecrets $sessionSecrets,
    ) {}

    public function __invoke(Request $request): JsonResponse
    {
        $data = $request->validate([
            'registrationId' => ['required', 'string', 'uuid'],
            'ticket' => ['required', 'string', 'max:128'],
            'registrationRecord' => ['required', 'string', 'max:512'],
            'wrappedUserMasterKey' => ['required', 'string', 'max:8192'],
        ]);

        $user = $request->user();

        if (! $user instanceof User) {
            return $this->expired();
        }

        if (! EnvelopeValidator::isValid($data['wrappedUserMasterKey'])) {
            return $this->invalidRegistration();
        }

        try {
            $serialized = RegistrationRecord::fromBase64Url($data['registrationRecord'])->serialize();
        } catch (OpaqueException) {
            return $this->invalidRegistration();
        }

        $outcome = DB::transaction(fn (): string => $this->commit($request, $user, $data, $serialized));

        if ($outcome !== 'changed') {
            return match ($outcome) {
                'inconsistent' => response()->json(['error' => 'password_change_inconsistent'], 500),
                default => $this->expired(),
            };
        }

        /**
         * Outside the transaction and in this order: the session first, the secret afterwards.
         */
        $request->session()->regenerate();

        $sessionSecret = $this->sessionSecrets->mint($request->session());

        /** We record that the account changed its password, never anything about the content. */
        activity(AuditEvent::LOG_NAME)
            ->causedBy($user)
            ->performedOn($user)
            ->event(AuditEvent::PasswordChanged->value)
            ->log(AuditEvent::PasswordChanged->value);

        return response()->json([
            'changed' => true,
            'userId' => $user->getKey(),
            'csrf' => $request->session()->token(),
            'sessionSecret' => $sessionSecret,
            'envelopeId' => $user->currentMasterKeyEnvelope()->first()?->getKey(),
        ])->header('Vary', 'Cookie');
    }

    /**
     * Transactional body of step 20.
     *
     * @param  array{registrationId: string, ticket: string, registrationRecord: string, wrappedUserMasterKey: string}  $data
     * @param  string  $serialized  192-byte binary `registrationRecord`.
     * @return string `changed`, `expired` or `inconsistent`.
     */
    private function commit(Request $request, User $user, array $data, string $serialized): string
    {
        $pending = OpaqueRegistration::query()->whereKey($data['registrationId'])->first();

        /**
         * Atomic consumption by number of affected rows: two tabs finishing the same change at once
         * produce a single winning transaction, and the other falls into the idempotent branch.
         */
        $consumed = OpaqueRegistration::query()
            ->whereKey($data['registrationId'])
            ->where('user_id', $user->getKey())
            ->where('purpose', OpaquePurpose::PasswordChange->value)
            ->where('expires_at', '>', now())
            ->delete();

        if ($consumed !== 1 || ! $pending instanceof OpaqueRegistration) {
            return $this->alreadyChanged($user, $data['wrappedUserMasterKey'], $serialized);
        }

        /** The ticket is consumed here, inside the transaction, and not earlier in the flow. */
        if (! $this->tickets->consume($request->session(), $data['ticket'])) {
            return 'expired';
        }

        $user->currentMasterKeyEnvelope?->retire();

        UserMasterKeyEnvelope::create([
            'user_id' => $user->getKey(),
            'envelope' => $data['wrappedUserMasterKey'],
        ]);

        $user->forceFill([
            'opaque_registration_record' => $serialized,
            'opaque_profile' => $pending->profile,
            'opaque_registered_at' => now(),
        ])->save();

        return 'changed';
    }

    /**
     * Idempotent branch: the pending row is gone. The comparison is against **both** writes, because
     * checking only one would not tell a legitimate retry from a split write.
     */
    private function alreadyChanged(User $user, string $wrappedUserMasterKey, string $serialized): string
    {
        $fresh = $user->fresh();

        $recordMatches = $fresh !== null
            && is_string($fresh->opaque_registration_record)
            && hash_equals($fresh->opaque_registration_record, $serialized);

        $envelopeMatches = $fresh?->currentMasterKeyEnvelope?->envelope === $wrappedUserMasterKey;

        if ($recordMatches && $envelopeMatches) {
            return 'changed';
        }

        return $recordMatches || $envelopeMatches ? 'inconsistent' : 'expired';
    }

    /** Invalid or expired ticket, or a pending row that is missing, expired, someone else's or of another purpose. */
    private function expired(): JsonResponse
    {
        return response()->json(['error' => 'password_change_expired'], 409);
    }

    /** A `registrationRecord` that does not parse to 192 bytes, or an envelope that fails the shape check. */
    private function invalidRegistration(): JsonResponse
    {
        return response()->json(['error' => 'invalid_registration'], 422);
    }
}
