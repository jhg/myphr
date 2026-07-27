<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth\Opaque;

use App\Models\OpaqueLoginHandshake;
use App\Models\User;
use App\Security\Opaque\Ke1;
use App\Security\Opaque\OpaqueException;
use App\Security\Opaque\OpaquePurpose;
use App\Security\Opaque\RegistrationRecord;
use App\Security\Opaque\ServerLogin;
use App\Security\Opaque\ServerSetup;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;

/**
 * `POST /phr/auth/password/reauth/start`: phase A of the password change, step 4.
 *
 * It starts a **full** OPAQUE login against the stored registration. This is not a formality: having
 * the session open is not enough (an unattended machine or a stolen cookie would change somebody
 * else's password), and above all this login is the **only** way to obtain the previous
 * `exportKey`, without which there is no old KEK and the master key envelope cannot be opened.
 * Verifying and opening are the same step here, not two.
 *
 * The user comes from the **session**, never from a `login` field in the body: accepting it from the
 * body would turn this authenticated route into an arbitrary login oracle and would reintroduce the
 * enumeration `docs/OPAQUE.md` §13 closes.
 *
 * There is no fake branch, unlike in `login/start`: whoever gets here is already authenticated, so
 * there is nothing left to enumerate and a fake branch would only make them spend twelve seconds of
 * Argon2id that could never match. An account with no usable OPAQUE registration gets an explicit
 * 409.
 *
 * The `credential_identifier` is the **stored** one, never a new one (`docs/OPAQUE.md` §13.1):
 * regenerating it would change the user's OPRF key and anyone replaying the same blinded point
 * before and after would detect the password change (RFC 9807 §10.9).
 */
final readonly class PasswordChangeReauthStartController
{
    /** Handshake TTL, in seconds: it covers the client's Argon2id, same as at login. */
    public const int HANDSHAKE_TTL_SECONDS = 180;

    public function __construct(
        private ServerLogin $serverLogin,
        private ServerSetup $setup,
    ) {}

    public function __invoke(Request $request): JsonResponse
    {
        $data = $request->validate([
            'startLoginRequest' => ['required', 'string', 'max:192'],
        ]);

        $user = $request->user();

        if (! $user instanceof User) {
            return $this->unavailable();
        }

        try {
            $ke1 = Ke1::fromBase64Url($data['startLoginRequest']);
        } catch (OpaqueException) {
            return response()->json(['error' => 'invalid_request'], 422);
        }

        $record = $this->usableRecord($user);

        if ($record === null) {
            return $this->unavailable();
        }

        $credentialResponse = $this->serverLogin->createCredentialResponse(
            $ke1,
            $record,
            $this->setup->oprfSeed,
            (string) $user->opaque_credential_identifier,
            $this->setup->serverPublicKey,
        );

        $result = $this->serverLogin->authServerRespond(
            $ke1,
            $credentialResponse,
            $record,
            $this->setup->serverPrivateKey,
            $this->setup->serverIdentity,
            $this->setup->context,
        );

        $handshake = OpaqueLoginHandshake::create([
            'user_id' => $user->getKey(),
            'state_ciphertext' => Crypt::encryptString($result->state->serialize()),
            'purpose' => OpaquePurpose::PasswordChange,
            'expires_at' => now()->addSeconds(self::HANDSHAKE_TTL_SECONDS),
        ]);

        return response()->json([
            'handshakeId' => $handshake->id,
            'loginResponse' => $result->ke2->toBase64Url(),
            'profile' => $this->setup->profile,
            'userId' => $user->getKey(),
        ])->header('Vary', 'Cookie');
    }

    /**
     * OPAQUE registration that can be used to reauthenticate today, or `null` if the account is in
     * no shape to change its password.
     *
     * It requires the three OPAQUE columns, the current profile and a master key envelope that is
     * not retired: without that envelope there is nothing to rewrap, and finding out after the
     * Argon2id would mean spending twelve seconds of the person's time for nothing.
     */
    private function usableRecord(User $user): ?RegistrationRecord
    {
        if ($user->opaque_registration_record === null
            || $user->opaque_credential_identifier === null
            || $user->opaque_profile !== $this->setup->profile
            || $user->currentMasterKeyEnvelope === null) {
            return null;
        }

        try {
            return RegistrationRecord::parse((string) $user->opaque_registration_record);
        } catch (OpaqueException) {
            return null;
        }
    }

    /**
     * The account cannot change its password this way. It is deliberately told apart from the
     * credentials error: the person is already authenticated and there is nothing to hide from them.
     */
    private function unavailable(): JsonResponse
    {
        return response()->json(['error' => 'password_change_unavailable'], 409);
    }
}
