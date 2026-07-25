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
 * `POST /phr/auth/password/registration/start`: fase B del cambio de contraseña, paso 13.
 *
 * Cambiar la contraseña es un **registro OPAQUE nuevo** (RFC 9807 §8 exige valores aleatorios
 * frescos), del que saldrá un `registrationRecord` de 192 bytes que sustituirá al almacenado. Lo que
 * no cambia es el `credential_identifier`: se reutiliza el **almacenado**, sin ningún respaldo por si
 * falta, porque una cuenta sin identificador almacenado no está cambiando de contraseña, está
 * registrándose por primera vez, y ese es otro camino. Regenerarlo delataría el cambio de contraseña
 * ante quien reenviara el mismo punto cegado (`docs/OPAQUE.md` §13.1, RFC 9807 §10.9).
 *
 * El ticket se **comprueba pero no se consume**: consumirlo aquí dejaría sin autorización a quien
 * sufra un corte de red durante el Argon2id que corre justo después de esta respuesta, obligándole a
 * repetir también el Argon2id de la reautenticación. Es el mismo razonamiento por el que el alta no
 * consume el enlace en `registration/start`.
 *
 * El pendiente nace con `invitation_ref` nulo y `purpose = password-change`, de modo que
 * `registration/finish` no lo pueda canjear: aquel consumiría un enlace de registro inexistente y
 * reescribiría `encrypted_settings`, que en un cambio de contraseña no se toca (la configuración va
 * bajo una clave derivada de la clave maestra, y la clave maestra no cambia).
 */
final readonly class PasswordChangeRegistrationStartController
{
    /** Ventana de vida del pendiente, acotada además por la del ticket. */
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

        /** El pendiente nunca sobrevive al ticket que lo autoriza. */
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
     * Ticket ausente, no coincidente o caducado. El cliente vuelve a pedir la contraseña actual.
     */
    private function expired(): JsonResponse
    {
        return response()->json(['error' => 'password_change_expired'], 409);
    }
}
