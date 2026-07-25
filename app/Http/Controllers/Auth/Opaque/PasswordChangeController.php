<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth\Opaque;

use App\Auth\PasswordChangeTickets;
use App\Auth\SessionSecrets;
use App\Crypto\EnvelopeValidator;
use App\Models\OpaqueRegistration;
use App\Models\User;
use App\Models\UserMasterKeyEnvelope;
use App\Security\Opaque\OpaqueException;
use App\Security\Opaque\OpaquePurpose;
use App\Security\Opaque\RegistrationRecord;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * `POST /phr/auth/password/change`: fase C del cambio de contraseña, paso 20.
 *
 * **Una petición y una transacción**, y esto no es una preferencia de estilo. Si el registro OPAQUE
 * nuevo y el sobre nuevo se escribieran por separado, un fallo entre ambos dejaría la cuenta viva y
 * su historial ilegible para siempre: con el registro escrito primero, la cuenta autentica con la
 * contraseña nueva mientras el sobre vigente sigue bajo la KEK de la vieja, que ya no autentica; con
 * el sobre primero, la simetría exacta del mismo bloqueo. O cambian las dos cosas o no cambia
 * ninguna.
 *
 * Lo que **no** hace, y cada omisión es deliberada:
 *
 * * No genera una clave maestra nueva. La clave maestra no cambia nunca: el navegador la abrió con
 *   la KEK vieja y la reenvolvió con la nueva. Generar una nueva dejaría ilegible todo el histórico,
 *   porque cada registro va bajo una clave derivada de la anterior y el servidor no puede re-cifrar
 *   nada.
 * * No sobrescribe el sobre anterior. Lo **retira** con su fecha e inserta uno nuevo: si el registro
 *   OPAQUE nuevo resultara inservible, sobrescribirlo habría destruido el único criptograma que la
 *   contraseña vieja sabía abrir.
 * * No toca `opaque_credential_identifier` (`docs/OPAQUE.md` §13.1) ni `encrypted_settings` (la
 *   configuración va bajo una clave derivada de la clave maestra, que no cambia).
 * * No abre el sobre ni ve la contraseña, la clave maestra o ninguna clave derivada. Del
 *   `wrappedUserMasterKey` solo comprueba la **forma**, con el mismo {@see EnvelopeValidator} que el
 *   alta: un segundo criterio de validez sería un segundo sitio donde equivocarse.
 *
 * Ya comprometida la transacción, regenera la sesión —el identificador emitido bajo la contraseña
 * vieja no debe sobrevivir al cambio— y solo **entonces** acuña el secreto de sesión nuevo:
 * acuñarlo antes lo ataría al identificador anterior y se perdería en la regeneración, sin ningún
 * síntoma hasta el primer F5 de esa persona.
 *
 * **Idempotente** por el par (`registrationRecord`, sobre vigente): si la respuesta se pierde en la
 * red y el cliente reintenta, el pendiente ya no existe, así que se comprueban las dos escrituras. Si
 * cuadran ambas, se responde éxito otra vez. Si cuadra **solo una**, es corrupción —el único síntoma
 * posible de una escritura partida— y se responde 500, nunca éxito.
 */
final readonly class PasswordChangeController
{
    public function __construct(
        private PasswordChangeTickets $tickets,
        private SessionSecrets $sessionSecrets,
    ) {}

    public function __invoke(Request $request): JsonResponse
    {
        $data = $request->validate([
            'registrationId' => ['required', 'string', 'uuid'],
            'ticket' => ['required', 'string', 'max:128'],
            'registrationRecord' => ['required', 'string', 'max:512'],
            'wrappedUserMasterKey' => ['required', 'string', 'max:8192'],
        ]);

        $user = $request->user();

        if (! $user instanceof User) {
            return $this->expired();
        }

        if (! EnvelopeValidator::isValid($data['wrappedUserMasterKey'])) {
            return $this->invalidRegistration();
        }

        try {
            $serialized = RegistrationRecord::fromBase64Url($data['registrationRecord'])->serialize();
        } catch (OpaqueException) {
            return $this->invalidRegistration();
        }

        $outcome = DB::transaction(fn (): string => $this->commit($request, $user, $data, $serialized));

        if ($outcome !== 'changed') {
            return match ($outcome) {
                'inconsistent' => response()->json(['error' => 'password_change_inconsistent'], 500),
                default => $this->expired(),
            };
        }

        /**
         * Fuera de la transacción y en este orden: la sesión primero, el secreto después.
         */
        $request->session()->regenerate();

        $sessionSecret = $this->sessionSecrets->mint($request->session());

        /** ADR 0006: se anota que la cuenta cambió de contraseña, jamás nada del contenido. */
        activity()
            ->causedBy($user)
            ->performedOn($user)
            ->event('password-changed')
            ->log('cambio de contraseña');

        return response()->json([
            'changed' => true,
            'userId' => $user->getKey(),
            'csrf' => $request->session()->token(),
            'sessionSecret' => $sessionSecret,
            'envelopeId' => $user->currentMasterKeyEnvelope()->first()?->getKey(),
        ])->header('Vary', 'Cookie');
    }

    /**
     * Cuerpo transaccional del paso 20.
     *
     * @param  array{registrationId: string, ticket: string, registrationRecord: string, wrappedUserMasterKey: string}  $data
     * @param  string  $serialized  `registrationRecord` binario de 192 bytes.
     * @return string `changed`, `expired` o `inconsistent`.
     */
    private function commit(Request $request, User $user, array $data, string $serialized): string
    {
        $pending = OpaqueRegistration::query()->whereKey($data['registrationId'])->first();

        /**
         * Consumo atómico por número de filas afectadas: dos pestañas que terminen el mismo cambio
         * a la vez producen una única transacción ganadora, y la otra cae en la rama idempotente.
         */
        $consumed = OpaqueRegistration::query()
            ->whereKey($data['registrationId'])
            ->where('user_id', $user->getKey())
            ->where('purpose', OpaquePurpose::PasswordChange->value)
            ->where('expires_at', '>', now())
            ->delete();

        if ($consumed !== 1 || ! $pending instanceof OpaqueRegistration) {
            return $this->alreadyChanged($user, $data['wrappedUserMasterKey'], $serialized);
        }

        /** El ticket se consume aquí, dentro de la transacción, y no antes en el flujo. */
        if (! $this->tickets->consume($request->session(), $data['ticket'])) {
            return 'expired';
        }

        $user->currentMasterKeyEnvelope?->retire();

        UserMasterKeyEnvelope::create([
            'user_id' => $user->getKey(),
            'envelope' => $data['wrappedUserMasterKey'],
        ]);

        $user->forceFill([
            'opaque_registration_record' => $serialized,
            'opaque_profile' => $pending->profile,
            'opaque_registered_at' => now(),
        ])->save();

        return 'changed';
    }

    /**
     * Rama idempotente: el pendiente ya no existe. La comparación es contra las **dos** escrituras,
     * porque comprobar solo una no distinguiría el reintento legítimo de una escritura partida.
     */
    private function alreadyChanged(User $user, string $wrappedUserMasterKey, string $serialized): string
    {
        $fresh = $user->fresh();

        $recordMatches = $fresh !== null
            && is_string($fresh->opaque_registration_record)
            && hash_equals($fresh->opaque_registration_record, $serialized);

        $envelopeMatches = $fresh?->currentMasterKeyEnvelope?->envelope === $wrappedUserMasterKey;

        if ($recordMatches && $envelopeMatches) {
            return 'changed';
        }

        return $recordMatches || $envelopeMatches ? 'inconsistent' : 'expired';
    }

    /** Ticket inválido o caducado, o pendiente inexistente, caducado, ajeno o de otro propósito. */
    private function expired(): JsonResponse
    {
        return response()->json(['error' => 'password_change_expired'], 409);
    }

    /** `registrationRecord` que no parsea a 192 bytes, o sobre que no pasa la validación de forma. */
    private function invalidRegistration(): JsonResponse
    {
        return response()->json(['error' => 'invalid_registration'], 422);
    }
}
