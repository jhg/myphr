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
 * Orden fijado por la Spec 0001 §5, paso 4: valida el token del enlace, **sin consumirlo**, evalúa
 * el OPRF sobre el punto cegado e inserta el registro pendiente. Consumir el enlace aquí dejaría sin
 * enlace y sin cuenta usable a quien sufriera un corte de red durante el Argon2id del navegador,
 * que corre después de esta respuesta.
 *
 * El token llega en el cuerpo y no en la URL: la página de establecimiento de contraseña se sirve
 * genérica y el navegador lee el token del fragmento (`#<token>`), que nunca viaja al servidor salvo
 * dentro de esta petición.
 *
 * `userId` va en la respuesta porque el cliente lo necesita para construir el dato asociado del AEAD
 * antes de cifrar la clave maestra (§4.1). `serverPublicKey` permite el pinning del paso 5.
 */
final readonly class RegistrationStartController
{
    /**
     * Ventana de vida del registro pendiente. Cubre con holgura el Argon2id del navegador sin dejar
     * filas pendientes durante las 24 horas de vida del enlace.
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
         * §13.1: si la cuenta ya tiene identificador se **reutiliza**; si no, se deriva del login
         * normalizado. Regenerarlo delataría el cambio de contraseña ante quien reenvíe el mismo
         * punto cegado (RFC 9807 §10.9).
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
     * Token inexistente, caducado o ya consumido, y mensaje OPAQUE mal formado: el mismo error, para
     * no delatar cuál de los casos ocurrió (Spec 0001 §4.1 y §7).
     */
    private function genericError(): JsonResponse
    {
        return response()->json(['error' => 'invalid_registration'], 422);
    }
}
