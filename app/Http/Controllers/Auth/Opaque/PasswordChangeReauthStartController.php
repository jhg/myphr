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
 * `POST /phr/auth/password/reauth/start`: fase A del cambio de contraseña, paso 4.
 *
 * Empieza un login OPAQUE **completo** contra el registro almacenado. No es una formalidad: tener la
 * sesión abierta no basta (un puesto desatendido o una cookie robada cambiarían la contraseña de
 * otra persona), y sobre todo este login es la **única** forma de obtener el `exportKey` anterior,
 * sin el cual no hay KEK vieja y el sobre de la clave maestra no se puede abrir. Verificar y abrir
 * son aquí el mismo paso, no dos.
 *
 * El usuario sale de la **sesión**, nunca de un campo `login` del cuerpo: aceptarlo del cuerpo
 * convertiría esta ruta autenticada en un oráculo de login arbitrario y reintroduciría la
 * enumeración que `docs/OPAQUE.md` §13 cierra.
 *
 * No hay rama falsa, al contrario que en `login/start`: quien llega aquí ya está autenticado, así
 * que no queda nada que enumerar y una rama falsa solo serviría para hacerle gastar un Argon2id de
 * doce segundos que jamás podría cuadrar. Una cuenta sin registro OPAQUE utilizable recibe un 409
 * explícito.
 *
 * El `credential_identifier` es el **almacenado**, jamás uno nuevo (`docs/OPAQUE.md` §13.1):
 * regenerarlo cambiaría la clave OPRF del usuario y quien reenviara el mismo punto cegado antes y
 * después detectaría el cambio de contraseña (RFC 9807 §10.9).
 */
final readonly class PasswordChangeReauthStartController
{
    /** TTL del handshake, en segundos: cubre el Argon2id del cliente, igual que en el login. */
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
     * Registro OPAQUE con el que se puede reautenticar hoy, o `null` si la cuenta no está en
     * condiciones de cambiar la contraseña.
     *
     * Exige las tres columnas OPAQUE, el perfil vigente y un sobre de clave maestra sin retirar: sin
     * ese sobre no hay nada que reenvolver, y descubrirlo después del Argon2id sería gastar doce
     * segundos de la persona para nada.
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
     * La cuenta no puede cambiar su contraseña por este camino. Se distingue del error de
     * credenciales a propósito: la persona ya está autenticada y no hay nada que ocultarle.
     */
    private function unavailable(): JsonResponse
    {
        return response()->json(['error' => 'password_change_unavailable'], 409);
    }
}
