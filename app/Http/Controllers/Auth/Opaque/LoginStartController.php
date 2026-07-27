<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth\Opaque;

use App\Models\OpaqueLoginHandshake;
use App\Models\User;
use App\Security\Opaque\CredentialIdentifier;
use App\Security\Opaque\Ke1;
use App\Security\Opaque\LoginNormalizer;
use App\Security\Opaque\OpaqueException;
use App\Security\Opaque\OpaquePurpose;
use App\Security\Opaque\RegistrationRecord;
use App\Security\Opaque\ServerLogin;
use App\Security\Opaque\ServerSetup;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;

/**
 * `POST /phr/auth/opaque/login/start` (Spec 0001 §4.3 / `docs/OPAQUE.md` §15.3 and §13).
 *
 * The real branch and the fake branch run through **the same code**: same OPRF derivation, same
 * evaluation, same masking, the same three Diffie-Hellman operations, the same MACs and the same
 * handshake row. The only thing that changes is where the `RegistrationRecord` comes from and
 * whether the handshake carries a `user_id`.
 *
 * The fake branch is taken whenever the account does not exist, has no `opaque_registration_record`
 * or its `opaque_profile` does not match the current profile (§13.3): giving an account under
 * migration its own path would give it away by shape or by response time.
 *
 * The `credential_identifier` comes from the same HMAC on both branches (§13.1), so an attacker who
 * replays the same `blinded_message` before and after a signup gets the same `evaluated_message` and
 * learns nothing about the signup (RFC 9807 §10.9).
 *
 * `login` only locates the account: it never enters the cryptography.
 */
final readonly class LoginStartController
{
    /** Handshake TTL, in seconds (`docs/OPAQUE.md` §14.3): it covers the client's Argon2id. */
    public const int HANDSHAKE_TTL_SECONDS = 180;

    public function __construct(
        private ServerLogin $serverLogin,
        private ServerSetup $setup,
        private CredentialIdentifier $credentialIdentifier,
    ) {}

    public function __invoke(Request $request): JsonResponse
    {
        $data = $request->validate([
            'login' => ['required', 'string', 'max:320'],
            'startLoginRequest' => ['required', 'string', 'max:192'],
        ]);

        try {
            $ke1 = Ke1::fromBase64Url($data['startLoginRequest']);
        } catch (OpaqueException) {
            return response()->json(['error' => 'invalid_request'], 422);
        }

        [$user, $record] = $this->resolveBranch($data['login']);

        /**
         * §13.1: with an account we use the stored identifier, without one we compute the HMAC.
         * Both branches agree as long as the login has not changed, which is the residual risk
         * documented in that same section.
         */
        $credentialIdentifier = $user?->opaque_credential_identifier
            ?? $this->credentialIdentifier->for($data['login']);

        $credentialResponse = $this->serverLogin->createCredentialResponse(
            $ke1,
            $record,
            $this->setup->oprfSeed,
            $credentialIdentifier,
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
            'user_id' => $user?->id,
            'state_ciphertext' => Crypt::encryptString($result->state->serialize()),
            'purpose' => OpaquePurpose::Login,
            'expires_at' => now()->addSeconds(self::HANDSHAKE_TTL_SECONDS),
        ]);

        return response()->json([
            'handshakeId' => $handshake->id,
            'loginResponse' => $result->ke2->toBase64Url(),
            'profile' => $this->setup->profile,
        ]);
    }

    /**
     * Decides the branch and returns the (account, record) pair used to answer.
     *
     * The account is `null` —the fake branch, using the §13.2 `fake_registration_record`
     * materialized once in `opaque:setup`— in four cases §13.3 requires treating alike: the account
     * does not exist, the account has no OPAQUE registration, the account has a profile other than
     * the current one, and the stored record does not parse. The last one is the same class of
     * inconsistent state as the others and does not deserve a path of its own.
     *
     * @return array{0: User|null, 1: RegistrationRecord}
     */
    private function resolveBranch(string $login): array
    {
        $user = User::query()
            ->where('email', LoginNormalizer::normalize($login))
            ->first();

        if (! $user instanceof User
            || $user->opaque_registration_record === null
            || $user->opaque_credential_identifier === null
            || $user->opaque_profile !== $this->setup->profile) {
            return [null, $this->setup->fakeRegistrationRecord];
        }

        try {
            return [$user, RegistrationRecord::parse((string) $user->opaque_registration_record)];
        } catch (OpaqueException) {
            return [null, $this->setup->fakeRegistrationRecord];
        }
    }
}
