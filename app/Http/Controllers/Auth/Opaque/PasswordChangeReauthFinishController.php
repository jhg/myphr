<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth\Opaque;

use App\Auth\PasswordChangeTickets;
use App\Models\OpaqueLoginHandshake;
use App\Models\User;
use App\Security\Opaque\BinaryCodec;
use App\Security\Opaque\Ke3;
use App\Security\Opaque\OpaqueException;
use App\Security\Opaque\OpaquePurpose;
use App\Security\Opaque\ServerLogin;
use App\Security\Opaque\ServerLoginState;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;

/**
 * `POST /phr/auth/password/reauth/finish`: fase A del cambio de contraseña, paso 7.
 *
 * Cierra el login OPAQUE de la reautenticación y, solo si el MAC cuadra, acuña el ticket que
 * autoriza el resto del flujo y devuelve el sobre vigente de la clave maestra para que el navegador
 * lo abra con la KEK vieja.
 *
 * Como en `login/finish`, el handshake se consume **antes** de validar el MAC, por escritura
 * condicional decidida por el número de filas afectadas: invertir el orden abre un oráculo de
 * reintento, y un `SELECT` seguido de `DELETE` no sirve porque `lockForUpdate()` es un no-op en
 * SQLite (`docs/OPAQUE.md` §14.3).
 *
 * A diferencia de `login/finish`, aquí **no** se llama a `Auth::login`, **no** se regenera la sesión
 * y **no** se acuña un secreto de sesión: la sesión ya existe, y regenerarla en este punto se
 * llevaría por delante el ticket que se acaba de guardar en ella. Ese es también el motivo de que el
 * flujo no reutilice `login/finish` y de que `purpose` distinga los dos tipos de handshake.
 */
final readonly class PasswordChangeReauthFinishController
{
    public function __construct(private PasswordChangeTickets $tickets) {}

    public function __invoke(Request $request): JsonResponse
    {
        $data = $request->validate([
            'handshakeId' => ['required', 'string', 'uuid'],
            'finishLoginRequest' => ['required', 'string', 'max:128'],
        ]);

        $user = $request->user();

        if (! $user instanceof User) {
            return $this->genericError();
        }

        $handshake = OpaqueLoginHandshake::query()->whereKey($data['handshakeId'])->first();

        $consumed = OpaqueLoginHandshake::query()
            ->whereKey($data['handshakeId'])
            ->where('purpose', OpaquePurpose::PasswordChange->value)
            ->where('user_id', $user->getKey())
            ->where('expires_at', '>', now())
            ->delete();

        if ($consumed !== 1 || ! $handshake instanceof OpaqueLoginHandshake) {
            return $this->fakeCompareAndFail($data['finishLoginRequest']);
        }

        try {
            $state = ServerLoginState::parse(Crypt::decryptString((string) $handshake->state_ciphertext));
            $ke3 = Ke3::fromBase64Url($data['finishLoginRequest']);
        } catch (DecryptException|OpaqueException) {
            return $this->genericError();
        }

        try {
            ServerLogin::serverFinish($ke3, $state);
        } catch (OpaqueException) {
            return $this->genericError();
        }

        unset($state);

        $envelope = $user->currentMasterKeyEnvelope;

        if ($envelope === null) {
            return response()->json(['error' => 'password_change_unavailable'], 409);
        }

        return response()->json([
            'ticket' => $this->tickets->mint($request->session()),
            'userId' => $user->getKey(),
            'encryptedUserMasterKey' => $envelope->envelope,
            'envelopeId' => $envelope->getKey(),
        ])->header('Vary', 'Cookie');
    }

    /**
     * Handshake inexistente, caducado, ya consumido, de otro propósito o de otra persona.
     *
     * Se ejecuta igualmente la comparación de 64 bytes contra un valor imposible, para no distinguir
     * por tiempo «no hay handshake» de «el MAC no cuadra».
     */
    private function fakeCompareAndFail(string $finishLoginRequest): JsonResponse
    {
        try {
            $ke3 = Ke3::fromBase64Url($finishLoginRequest);
        } catch (OpaqueException) {
            return $this->genericError();
        }

        BinaryCodec::constantTimeEquals($ke3->clientMac, str_repeat("\x00", Ke3::MAC_LENGTH));

        return $this->genericError();
    }

    /** Un único error para todas las causas de fallo de la reautenticación, y nunca un ticket. */
    private function genericError(): JsonResponse
    {
        return response()->json(['error' => 'authentication_failed'], 401);
    }
}
