<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth\Opaque;

use App\Models\OpaqueRegistration;
use App\Models\User;
use App\Security\Opaque\Base64Url;
use App\Security\Opaque\CredentialIdentifier;
use App\Security\Opaque\LoginNormalizer;
use App\Security\Opaque\OpaqueException;
use App\Security\Opaque\OpaquePurpose;
use App\Security\Opaque\RegistrationRequest;
use App\Security\Opaque\RegistrationServer;
use App\Security\Opaque\ServerSetup;
use App\Support\AuditEvent;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * `POST /phr/auth/opaque/registration/public/start`: public signup, no invitation.
 *
 * Invited registration (ADR 0009, Spec 0001 §3.3) is still the only path when an administrator or
 * the console command opens it. This endpoint adds a second path: whoever arrives without a link
 * creates their own account. There is no invitation code to validate, so the equivalent of the
 * "valid token" in {@see InvitedRegistrationStartController} is, simply, that the login is free.
 *
 * It creates the user and the pending OPAQUE registration in the same request, but **not** in a
 * single atomic transaction with `registration/finish`: if the person gives up halfway, the account
 * is left without `opaque_registered_at`, exactly the same state an invited account that has not
 * opened its link is in today (`hasCompletedOpaqueRegistration()` is false in both cases). No new
 * state is invented.
 *
 * An already existing login is announced with a 409 `login_taken` on purpose (a deliberate decision,
 * mitigated by the `opaque-registration-public` limiter): whoever reads it knows they have to go and
 * log in instead of believing their signup was lost.
 */
final readonly class RegistrationPublicStartController
{
    public function __construct(
        private RegistrationServer $registrationServer,
        private ServerSetup $setup,
        private CredentialIdentifier $credentialIdentifier,
    ) {}

    public function __invoke(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'login' => ['required', 'string', 'max:320'],
            'registrationRequest' => ['required', 'string', 'max:128'],
        ]);

        try {
            $message = RegistrationRequest::fromBase64Url($data['registrationRequest']);
        } catch (OpaqueException) {
            return $this->genericError();
        }

        /**
         * It is normalized **before** checking the email shape, like
         * `IssueRegistrationLinkCommand`: outer whitespace and capitals are valid variations of the
         * same login, not format errors. Validating the raw value with Laravel's `email` rule would
         * reject a perfectly normalizable address just for having spaces around it.
         */
        $login = LoginNormalizer::normalize($data['login']);

        if (validator(['login' => $login], ['login' => 'email'])->fails()) {
            return $this->genericError();
        }

        /**
         * The uniqueness check lives in the `INSERT` itself, not in a prior `SELECT`: two
         * simultaneous signups with the same email would both pass an earlier check, and only the
         * column's `unique` constraint really decides which one wins. The loser leaves no row.
         */
        try {
            $user = User::create([
                'name' => trim($data['name']),
                'email' => $login,
            ]);
        } catch (QueryException $exception) {
            if ($this->isDuplicateEmail($exception)) {
                return response()->json(['error' => 'login_taken'], 409);
            }

            throw $exception;
        }

        /**
         * Same as in {@see InvitedRegistrationStartController::__invoke()}: the account is new, so
         * it never has an `opaque_credential_identifier` yet, but it is derived with the same
         * formula so the value matches the one `login/start` will compute (§13.1).
         */
        $credentialIdentifier = $this->credentialIdentifier->for($login);

        try {
            $response = $this->registrationServer->createRegistrationResponse($message, $credentialIdentifier);
        } catch (OpaqueException) {
            return $this->genericError();
        }

        $pending = OpaqueRegistration::create([
            'user_id' => $user->id,
            'invitation_ref' => null,
            'credential_identifier' => $credentialIdentifier,
            'profile' => $this->setup->profile,
            'purpose' => OpaquePurpose::Registration,
            'expires_at' => now()->addMinutes(InvitedRegistrationStartController::PENDING_TTL_MINUTES),
        ]);

        /**
         * Public signup creates the user row itself, so an account already exists here even though
         * the OPAQUE registration is not complete yet. No causer: nobody is authenticated, and
         * attributing it to the just-created account would say less than it seems.
         */
        activity(AuditEvent::LOG_NAME)
            ->performedOn($user)
            ->event(AuditEvent::AccountCreated->value)
            ->log(AuditEvent::AccountCreated->value);

        return response()->json([
            'userId' => $user->id,
            'registrationId' => $pending->id,
            'registrationResponse' => $response->toBase64Url(),
            'profile' => $this->setup->profile,
            'serverPublicKey' => Base64Url::encode($this->setup->serverPublicKey),
        ]);
    }

    /**
     * SQLite and MySQL word the message differently, so we look for the common substring instead of
     * comparing specific error codes.
     */
    private function isDuplicateEmail(QueryException $exception): bool
    {
        return str_contains(strtolower($exception->getMessage()), 'unique')
            && str_contains(strtolower($exception->getMessage()), 'email');
    }

    /**
     * Malformed OPAQUE message: the same generic error as the rest of the subsystem (§7). A
     * duplicate email does not come through here because it has its own code, on purpose (see the
     * class).
     */
    private function genericError(): JsonResponse
    {
        return response()->json(['error' => 'invalid_registration'], 422);
    }
}
