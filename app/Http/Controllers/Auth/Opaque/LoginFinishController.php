<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth\Opaque;

use App\Auth\SessionSecrets;
use App\Models\OpaqueLoginHandshake;
use App\Models\User;
use App\Security\Opaque\BinaryCodec;
use App\Security\Opaque\Ke3;
use App\Security\Opaque\OpaqueException;
use App\Security\Opaque\OpaquePurpose;
use App\Security\Opaque\ServerLogin;
use App\Security\Opaque\ServerLoginState;
use Filament\Facades\Filament;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Crypt;

/**
 * `POST /phr/auth/opaque/login/finish` (Spec 0001 §4.4 / `docs/OPAQUE.md` §15.4).
 *
 * Consume el handshake **antes** de validar el MAC: invertir el orden abre un oráculo de reintento
 * sobre el mismo handshake. El consumo es una escritura condicional decidida por el número de filas
 * afectadas, no un `SELECT` seguido de `DELETE`, porque `lockForUpdate()` es un no-op en SQLite y
 * dos peticiones simultáneas consumirían el mismo handshake (`docs/OPAQUE.md` §14.3).
 *
 * Todos los fallos —MAC inválido, handshake caducado, handshake reutilizado, rama falsa, cuenta sin
 * sobre de clave maestra— producen **el mismo error genérico** y ninguna sesión.
 *
 * En el éxito, el orden es normativo (§5, paso 14): `Auth::login`, `session()->regenerate()` y solo
 * entonces la acuñación del secreto de sesión. Acuñarlo antes lo ataría al identificador de sesión
 * anterior y se perdería en la regeneración, sin ningún síntoma hasta el primer F5 de esa persona.
 */
final readonly class LoginFinishController
{
    public function __construct(private SessionSecrets $sessionSecrets) {}

    public function __invoke(Request $request): JsonResponse
    {
        $data = $request->validate([
            'handshakeId' => ['required', 'string', 'uuid'],
            'finishLoginRequest' => ['required', 'string', 'max:128'],
        ]);

        $handshake = OpaqueLoginHandshake::query()->whereKey($data['handshakeId'])->first();

        $consumed = OpaqueLoginHandshake::query()
            ->whereKey($data['handshakeId'])
            ->where('purpose', OpaquePurpose::Login->value)
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
            /**
             * La `session_key` que devuelve `ServerFinish` se descarta aquí mismo: el cliente ya
             * tiene su copia y el servidor no la necesita después del handshake (§4.4).
             */
            ServerLogin::serverFinish($ke3, $state);
        } catch (OpaqueException) {
            return $this->genericError();
        }

        unset($state);

        $user = $handshake->user_id === null
            ? null
            : User::query()->whereKey($handshake->user_id)->first();

        /** Rama falsa correcta (§15.4, paso 7): el MAC cuadró, pero no hay cuenta detrás. */
        if (! $user instanceof User) {
            return $this->genericError();
        }

        $envelope = $user->currentMasterKeyEnvelope;

        if ($envelope === null) {
            return $this->genericError();
        }

        Auth::guard('web')->login($user, remember: false);
        $request->session()->regenerate();

        $sessionSecret = $this->sessionSecrets->mint($request->session());

        /** El `userId` es el dato asociado del sobre de la clave maestra: sin el, el cliente no puede abrirlo. */
        return response()->json([
            'userId' => $user->getKey(),
            'redirect' => $request->session()->pull('url.intended', $this->panelUrl()),
            'csrf' => $request->session()->token(),
            'sessionSecret' => $sessionSecret,
            'encryptedUserMasterKey' => $envelope->envelope,
            'encryptedSettings' => $user->encrypted_settings,
        ]);
    }

    /**
     * Destino tras el login. `url.intended` primero, para no perder la URL profunda de la que un
     * middleware sacó a la persona con `redirect()->guest()` (§4.4).
     */
    private function panelUrl(): string
    {
        return Filament::getCurrentPanel()?->getUrl() ?? url('/');
    }

    /**
     * Handshake inexistente, ya consumido o caducado (`docs/OPAQUE.md` §15.4, paso 2).
     *
     * Se ejecuta igualmente una comparación de 64 bytes contra un valor que no puede cuadrar, para
     * no distinguir por tiempo el caso "no hay handshake" del caso "el MAC no cuadra".
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

    /**
     * Error único para todas las causas (§4.4): credenciales incorrectas, cuenta inexistente, MAC
     * inválido, handshake caducado y handshake reutilizado.
     */
    private function genericError(): JsonResponse
    {
        return response()->json(['error' => 'authentication_failed'], 401);
    }
}
