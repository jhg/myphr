<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth\Opaque;

use App\Auth\PasswordChangeTickets;
use App\Models\OpaqueRegistration;
use App\Models\User;
use App\Security\Opaque\Base64Url;
use App\Security\Opaque\OpaqueException;
use App\Security\Opaque\OpaquePurpose;
use App\Security\Opaque\RegistrationRequest;
use App\Security\Opaque\RegistrationServer;
use App\Security\Opaque\ServerSetup;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * `POST /phr/auth/password/registration/start`: phase B of the password change, step 13.
 *
 * Changing the password is a **fresh OPAQUE registration** (RFC 9807 §8 requires fresh random
 * values), which will yield a 192-byte `registrationRecord` replacing the stored one. What does not
 * change is the `credential_identifier`: the **stored** one is reused, with no fallback in case it
 * is missing, because an account with no stored identifier is not changing its password, it is
 * registering for the first time, and that is a different path. Regenerating it would give the
 * password change away to anyone replaying the same blinded point (`docs/OPAQUE.md` §13.1,
 * RFC 9807 §10.9).
 *
 * The ticket is **checked but not consumed**: consuming it here would leave anyone who loses their
 * network during the Argon2id that runs right after this response without authorization, forcing
 * them to repeat the reauthentication Argon2id too. It is the same reasoning by which signup does
 * not consume the link in `registration/start`.
 *
 * The pending row is born with a null `invitation_ref` and `purpose = password-change`, so
 * `registration/finish` cannot redeem it: that endpoint would consume a registration link that does
 * not exist and would rewrite `encrypted_settings`, which a password change does not touch (the
 * settings go under a key derived from the master key, and the master key does not change).
 */
final readonly class PasswordChangeRegistrationStartController
{
    /** Lifetime window of the pending row, further bounded by the ticket's. */
    public const int PENDING_TTL_MINUTES = 15;

    public function __construct(
        private PasswordChangeTickets $tickets,
        private RegistrationServer $registrationServer,
        private ServerSetup $setup,
    ) {}

    public function __invoke(Request $request): JsonResponse
    {
        $data = $request->validate([
            'registrationRequest' => ['required', 'string', 'max:128'],
            'ticket' => ['required', 'string', 'max:128'],
        ]);

        $user = $request->user();
        $session = $request->session();

        if (! $user instanceof User || ! $this->tickets->verify($session, $data['ticket'])) {
            return $this->expired();
        }

        $credentialIdentifier = $user->opaque_credential_identifier;

        if ($credentialIdentifier === null) {
            return response()->json(['error' => 'password_change_unavailable'], 409);
        }

        try {
            $message = RegistrationRequest::fromBase64Url($data['registrationRequest']);
            $response = $this->registrationServer->createRegistrationResponse($message, (string) $credentialIdentifier);
        } catch (OpaqueException) {
            return response()->json(['error' => 'invalid_request'], 422);
        }

        /** The pending row never outlives the ticket that authorizes it. */
        $expiresAt = now()
            ->addMinutes(self::PENDING_TTL_MINUTES)
            ->min(now()->setTimestamp($this->tickets->expiresAt($session) ?? time()));

        $pending = OpaqueRegistration::create([
            'user_id' => $user->getKey(),
            'invitation_ref' => null,
            'credential_identifier' => $credentialIdentifier,
            'profile' => $this->setup->profile,
            'purpose' => OpaquePurpose::PasswordChange,
            'expires_at' => $expiresAt,
        ]);

        return response()->json([
            'registrationId' => $pending->id,
            'registrationResponse' => $response->toBase64Url(),
            'serverPublicKey' => Base64Url::encode($this->setup->serverPublicKey),
            'userId' => $user->getKey(),
            'profile' => $this->setup->profile,
        ])->header('Vary', 'Cookie');
    }

    /**
     * Ticket missing, not matching or expired. The client asks for the current password again.
     */
    private function expired(): JsonResponse
    {
        return response()->json(['error' => 'password_change_expired'], 409);
    }
}
