<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth\Opaque;

use App\Crypto\EnvelopeValidator;
use App\Models\OpaqueRegistration;
use App\Models\User;
use App\Models\UserMasterKeyEnvelope;
use App\Provisioning\InvalidRegistrationLinkException;
use App\Provisioning\RegistrationLinks;
use App\Security\Opaque\OpaqueException;
use App\Security\Opaque\OpaquePurpose;
use App\Security\Opaque\RegistrationRecord;
use App\Security\Opaque\ServerSetup;
use App\Support\AuditEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * `POST /phr/auth/opaque/registration/finish` (Spec 0001 §4.2 / `docs/OPAQUE.md` §15.2).
 *
 * This is step 12 of the cryptographic order (§5) and deliberately a **single transactional
 * request**: splitting it in two would leave accounts that authenticate but have no usable master
 * key, with the link already consumed and no way to recover. It is the worst failure mode of the
 * whole design.
 *
 * Inside a single transaction: it consumes the pending row, consumes the link, retires the previous
 * current envelope, inserts the new envelope into the append-only table and updates the user's
 * OPAQUE columns and encrypted settings. It does not open the master key envelope, does not store
 * the `RegistrationResponse` and does not store passwords.
 *
 * **Idempotent** (§4.2 and §7): if the response was lost on the network but the transaction already
 * ran, a retry with the same `registrationId` finds the pending row consumed, checks that the
 * account ended up registered with that same `registrationRecord` and answers success again,
 * instead of leaving the person stuck believing the registration failed when it actually completed.
 */
final readonly class RegistrationFinishController
{
    public function __construct(
        private RegistrationLinks $links,
        private ServerSetup $setup,
    ) {}

    public function __invoke(Request $request): JsonResponse
    {
        $data = $request->validate([
            'registrationId' => ['required', 'string', 'uuid'],
            'registrationRecord' => ['required', 'string', 'max:512'],
            'wrappedUserMasterKey' => ['required', 'string', 'max:8192'],
            'encryptedSettings' => ['required', 'string', 'max:8192'],
        ]);

        if (! EnvelopeValidator::isValid($data['wrappedUserMasterKey'])
            || ! EnvelopeValidator::isValid($data['encryptedSettings'])) {
            return $this->genericError();
        }

        try {
            $record = RegistrationRecord::fromBase64Url($data['registrationRecord']);
        } catch (OpaqueException) {
            return $this->genericError();
        }

        $serialized = $record->serialize();

        try {
            $userId = DB::transaction(function () use ($data, $serialized): ?string {
                $pending = OpaqueRegistration::query()->whereKey($data['registrationId'])->first();

                /**
                 * Atomic consumption by number of affected rows (`docs/OPAQUE.md` §14.3): two tabs
                 * finishing the same registration at once produce a single winning transaction, and
                 * the other falls into the idempotent branch.
                 */
                $consumed = OpaqueRegistration::query()
                    ->whereKey($data['registrationId'])
                    ->where('purpose', OpaquePurpose::Registration->value)
                    ->where('expires_at', '>', now())
                    ->delete();

                if ($consumed !== 1 || ! $pending instanceof OpaqueRegistration) {
                    return $this->alreadyRegistered($serialized);
                }

                $user = $pending->user;

                if (! $user instanceof User) {
                    return null;
                }

                /**
                 * `invitation_ref` is null when the pending row comes from public signup
                 * ({@see RegistrationPublicStartController}), which consumes no link because there
                 * never was one.
                 */
                if ($pending->invitation_ref !== null) {
                    $this->links->consumeById((string) $pending->invitation_ref);
                }

                $user->currentMasterKeyEnvelope?->retire();

                UserMasterKeyEnvelope::create([
                    'user_id' => $user->id,
                    'envelope' => $data['wrappedUserMasterKey'],
                ]);

                $user->forceFill([
                    'opaque_credential_identifier' => $pending->credential_identifier,
                    'opaque_registration_record' => $serialized,
                    'opaque_profile' => $pending->profile,
                    'opaque_registered_at' => now(),
                    'encrypted_settings' => $data['encryptedSettings'],
                ])->save();

                /**
                 * Inside the transaction and after the `save`, so only the winning transaction
                 * records it: the idempotent branch above returns earlier and does not log a signup
                 * that had actually already happened. If something blows up, the trail is rolled
                 * back with the rest.
                 */
                activity(AuditEvent::LOG_NAME)
                    ->causedBy($user)
                    ->performedOn($user)
                    ->event(AuditEvent::RegistrationCompleted->value)
                    ->log(AuditEvent::RegistrationCompleted->value);

                return (string) $user->id;
            });
        } catch (InvalidRegistrationLinkException) {
            return $this->genericError();
        }

        if ($userId === null) {
            return $this->genericError();
        }

        return response()->json([
            'registered' => true,
            'userId' => $userId,
            'profile' => $this->setup->profile,
        ]);
    }

    /**
     * Idempotent branch (§4.2): the pending row is gone. If the account ended up registered with
     * exactly this `registrationRecord`, the previous transaction was the good one.
     *
     * The comparison is against the record and not against the `registrationId` because the pending
     * row has already been deleted: the 192-byte record is the only thing tying the retry to the
     * original transaction.
     *
     * @param  string  $serialized  Binary `registrationRecord` received in the retry.
     * @return string|null Identifier of the already registered user, or `null` if not registered.
     */
    private function alreadyRegistered(string $serialized): ?string
    {
        $user = User::query()
            ->where('opaque_registration_record', $serialized)
            ->whereNotNull('opaque_registered_at')
            ->first();

        return $user instanceof User ? (string) $user->id : null;
    }

    /**
     * Pending row missing or expired, link already consumed, malformed envelope: a single error,
     * without telling the cause apart (§7).
     */
    private function genericError(): JsonResponse
    {
        return response()->json(['error' => 'invalid_registration'], 422);
    }
}
