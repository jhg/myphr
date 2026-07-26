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
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * `POST /phr/auth/opaque/registration/public/start`: alta pública, sin invitación.
 *
 * El registro por invitación (ADR 0009, Spec 0001 §3.3) sigue siendo el único camino cuando lo abre
 * un administrador o el comando de consola. Este endpoint añade un segundo camino: quien llega sin
 * enlace crea su propia cuenta. No hay código de invitación que validar, así que el equivalente al
 * «token válido» de {@see RegistrationStartController} es, simplemente, que el login esté libre.
 *
 * Crea el usuario y el registro OPAQUE pendiente en la misma petición, pero **no** en una única
 * transacción atómica con `registration/finish`: si la persona abandona a mitad, la cuenta queda sin
 * `opaque_registered_at`, exactamente el mismo estado que hoy tiene una cuenta invitada que no ha
 * abierto su enlace (`hasCompletedOpaqueRegistration()` es falso en ambos casos). No se inventa un
 * estado nuevo.
 *
 * El login ya existente se anuncia con 409 `login_taken` a propósito (decisión consciente, mitigada
 * con el limitador `opaque-registration-public`): quien lo lea sabe que tiene que ir a iniciar sesión
 * en vez de creer que su alta se perdió.
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
         * Se normaliza **antes** de comprobar la forma de email, igual que
         * `IssueRegistrationLinkCommand`: espacios exteriores y mayúsculas son variaciones válidas de
         * un mismo login, no errores de formato. Validar el crudo con la regla `email` de Laravel
         * rechazaría un correo perfectamente normalizable solo por llevar espacios alrededor.
         */
        $login = LoginNormalizer::normalize($data['login']);

        if (validator(['login' => $login], ['login' => 'email'])->fails()) {
            return $this->genericError();
        }

        /**
         * La comprobación de unicidad vive en el propio `INSERT`, no en un `SELECT` previo: dos
         * altas simultáneas con el mismo correo pasarían igual una comprobación anterior, y solo la
         * restricción `unique` de la columna decide de verdad cuál gana. La que pierde no deja fila.
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
         * Igual que en {@see RegistrationStartController::__invoke()}: la cuenta es nueva, así que
         * nunca tiene `opaque_credential_identifier` todavía, pero se deriva con la misma fórmula
         * para que el valor coincida con el que calculará `login/start` (§13.1).
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
            'expires_at' => now()->addMinutes(RegistrationStartController::PENDING_TTL_MINUTES),
        ]);

        return response()->json([
            'userId' => $user->id,
            'registrationId' => $pending->id,
            'registrationResponse' => $response->toBase64Url(),
            'profile' => $this->setup->profile,
            'serverPublicKey' => Base64Url::encode($this->setup->serverPublicKey),
        ]);
    }

    /**
     * SQLite y MySQL redactan el mensaje de forma distinta, así que se busca la subcadena común en
     * vez de comparar códigos de error concretos.
     */
    private function isDuplicateEmail(QueryException $exception): bool
    {
        return str_contains(strtolower($exception->getMessage()), 'unique')
            && str_contains(strtolower($exception->getMessage()), 'email');
    }

    /**
     * Mensaje OPAQUE mal formado: mismo error genérico que el resto del subsistema (§7). El correo
     * duplicado no entra aquí porque tiene su propio código, a propósito (ver la clase).
     */
    private function genericError(): JsonResponse
    {
        return response()->json(['error' => 'invalid_registration'], 422);
    }
}
