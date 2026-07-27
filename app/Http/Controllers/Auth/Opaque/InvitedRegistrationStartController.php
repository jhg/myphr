<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth\Opaque;

use App\Models\OpaqueRegistration;
use App\Models\User;
use App\Provisioning\InvalidRegistrationLinkException;
use App\Provisioning\RegistrationLinks;
use App\Security\Opaque\Base64Url;
use App\Security\Opaque\CredentialIdentifier;
use App\Security\Opaque\OpaqueException;
use App\Security\Opaque\OpaquePurpose;
use App\Security\Opaque\RegistrationRequest;
use App\Security\Opaque\RegistrationServer;
use App\Security\Opaque\ServerSetup;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * `POST /phr/auth/opaque/registration/start` (Spec 0001 §4.1 / `docs/OPAQUE.md` §15.1).
 *
 * The order is fixed by Spec 0001 §5, step 4: it validates the link token, **without consuming it**,
 * evaluates the OPRF over the blinded point and inserts the pending registration. Consuming the link
 * here would leave anyone who lost their network during the browser's Argon2id, which runs after
 * this response, without a link and without a usable account.
 *
 * The token arrives in the body and not in the URL: the set-password page is served generic and the
 * browser reads the token from the fragment (`#<token>`), which never travels to the server except
 * inside this request.
 *
 * `userId` is in the response because the client needs it to build the AEAD associated data before
 * encrypting the master key (§4.1). `serverPublicKey` allows the pinning in step 5.
 */
final readonly class InvitedRegistrationStartController
{
    /**
     * Lifetime window of the pending registration. It comfortably covers the browser's Argon2id
     * without leaving pending rows around for the link's whole 24-hour life.
     */
    public const int PENDING_TTL_MINUTES = 15;

    public function __construct(
        private RegistrationLinks $links,
        private RegistrationServer $registrationServer,
        private ServerSetup $setup,
        private CredentialIdentifier $credentialIdentifier,
    ) {}

    public function __invoke(Request $request): JsonResponse
    {
        $data = $request->validate([
            'registrationRequest' => ['required', 'string', 'max:128'],
            'registrationToken' => ['required', 'string', 'max:256'],
        ]);

        try {
            $link = $this->links->validate($data['registrationToken']);
            $message = RegistrationRequest::fromBase64Url($data['registrationRequest']);
        } catch (InvalidRegistrationLinkException|OpaqueException) {
            return $this->genericError();
        }

        $user = $link->user;

        if (! $user instanceof User) {
            return $this->genericError();
        }

        /**
         * §13.1: if the account already has an identifier it is **reused**; if not, it is derived
         * from the normalized login. Regenerating it would give the password change away to anyone
         * who replays the same blinded point (RFC 9807 §10.9).
         */
        $credentialIdentifier = $user->opaque_credential_identifier
            ?? $this->credentialIdentifier->for((string) $user->email);

        try {
            $response = $this->registrationServer->createRegistrationResponse($message, $credentialIdentifier);
        } catch (OpaqueException) {
            return $this->genericError();
        }

        $pending = OpaqueRegistration::create([
            'user_id' => $user->id,
            'invitation_ref' => $link->id,
            'credential_identifier' => $credentialIdentifier,
            'profile' => $this->setup->profile,
            'purpose' => OpaquePurpose::Registration,
            'expires_at' => now()->addMinutes(self::PENDING_TTL_MINUTES)->min($link->expires_at),
        ]);

        return response()->json([
            'registrationId' => $pending->id,
            'registrationResponse' => $response->toBase64Url(),
            'serverPublicKey' => Base64Url::encode($this->setup->serverPublicKey),
            'userId' => $user->id,
            'profile' => $this->setup->profile,
        ]);
    }

    /**
     * Non-existent, expired or already consumed token, and malformed OPAQUE message: the same
     * error, so as not to give away which case happened (Spec 0001 §4.1 and §7).
     */
    private function genericError(): JsonResponse
    {
        return response()->json(['error' => 'invalid_registration'], 422);
    }
}
