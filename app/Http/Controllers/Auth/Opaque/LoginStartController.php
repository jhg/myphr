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
 * `POST /phr/auth/opaque/login/start` (Spec 0001 §4.3 / `docs/OPAQUE.md` §15.3 y §13).
 *
 * Rama real y rama falsa recorren **el mismo código**: misma derivación OPRF, misma evaluación,
 * mismo enmascarado, los mismos tres Diffie-Hellman, los mismos MAC y la misma fila de handshake.
 * Lo único que cambia es de dónde sale el `RegistrationRecord` y si el handshake lleva `user_id`.
 *
 * La rama falsa se recorre siempre que la cuenta no exista, que no tenga `opaque_registration_record`
 * o que su `opaque_profile` no coincida con el perfil vigente (§13.3): darle un camino propio a una
 * cuenta en migración la delataría por forma o por tiempo de respuesta.
 *
 * El `credential_identifier` sale del mismo HMAC en las dos ramas (§13.1), de modo que un atacante
 * que reenvíe el mismo `blinded_message` antes y después de un alta recibe el mismo
 * `evaluated_message` y no aprende nada del alta (RFC 9807 §10.9).
 *
 * `login` solo localiza la cuenta: nunca entra en la criptografía.
 */
final readonly class LoginStartController
{
    /** TTL del handshake, en segundos (`docs/OPAQUE.md` §14.3): cubre el Argon2id del cliente. */
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
         * §13.1: con cuenta se usa el identificador almacenado, sin cuenta se calcula el HMAC.
         * Ambas ramas coinciden mientras el login no haya cambiado, que es el riesgo residual
         * documentado en esa misma sección.
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
     * Decide la rama y devuelve el par (cuenta, record) con el que se responde.
     *
     * La cuenta es `null` —rama falsa, con el `fake_registration_record` de §13.2 materializado una
     * vez en `opaque:setup`— en cuatro casos que §13.3 obliga a tratar igual: cuenta inexistente,
     * cuenta sin registro OPAQUE, cuenta con un perfil distinto del vigente y record almacenado que
     * no parsea. El último es la misma clase de estado inconsistente que los otros y no merece un
     * camino propio.
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
