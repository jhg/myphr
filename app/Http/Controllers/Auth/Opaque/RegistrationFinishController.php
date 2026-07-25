<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth\Opaque;

use App\Crypto\EnvelopeValidator;
use App\Models\OpaqueRegistration;
use App\Models\User;
use App\Models\UserMasterKeyEnvelope;
use App\Provisioning\InvalidRegistrationLinkException;
use App\Provisioning\RegistrationLinks;
use App\Security\Opaque\OpaqueException;
use App\Security\Opaque\RegistrationRecord;
use App\Security\Opaque\ServerSetup;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * `POST /phr/auth/opaque/registration/finish` (Spec 0001 §4.2 / `docs/OPAQUE.md` §15.2).
 *
 * Es el paso 12 del orden criptográfico (§5) y una **única petición transaccional** a propósito:
 * partirlo en dos dejaría cuentas que se autentican pero no tienen clave maestra utilizable, con el
 * enlace ya consumido y sin recuperación posible. Es el peor modo de fallo del diseño completo.
 *
 * Dentro de una sola transacción: consume el pendiente, consume el enlace, retira el sobre vigente
 * anterior, inserta el sobre nuevo en la tabla de solo añadir y actualiza las columnas OPAQUE y la
 * configuración cifrada del usuario. No abre el sobre de la clave maestra, no guarda la
 * `RegistrationResponse` y no guarda contraseñas.
 *
 * **Idempotente** (§4.2 y §7): si la respuesta se perdió en la red pero la transacción ya corrió, un
 * reintento con el mismo `registrationId` encuentra el pendiente consumido, comprueba que la cuenta
 * quedó registrada con ese mismo `registrationRecord` y responde éxito otra vez, en vez de dejar a
 * la persona atascada creyendo que el registro falló cuando en realidad se completó.
 */
final readonly class RegistrationFinishController
{
    public function __construct(
        private RegistrationLinks $links,
        private ServerSetup $setup,
    ) {}

    public function __invoke(Request $request): JsonResponse
    {
        $data = $request->validate([
            'registrationId' => ['required', 'string', 'uuid'],
            'registrationRecord' => ['required', 'string', 'max:512'],
            'wrappedUserMasterKey' => ['required', 'string', 'max:8192'],
            'encryptedSettings' => ['required', 'string', 'max:8192'],
        ]);

        if (! EnvelopeValidator::isValid($data['wrappedUserMasterKey'])
            || ! EnvelopeValidator::isValid($data['encryptedSettings'])) {
            return $this->genericError();
        }

        try {
            $record = RegistrationRecord::fromBase64Url($data['registrationRecord']);
        } catch (OpaqueException) {
            return $this->genericError();
        }

        $serialized = $record->serialize();

        try {
            $userId = DB::transaction(function () use ($data, $serialized): ?string {
                $pending = OpaqueRegistration::query()->whereKey($data['registrationId'])->first();

                /**
                 * Consumo atómico por número de filas afectadas (`docs/OPAQUE.md` §14.3): dos
                 * pestañas que terminen el mismo registro a la vez producen una única transacción
                 * ganadora, y la otra cae en la rama idempotente.
                 */
                $consumed = OpaqueRegistration::query()
                    ->whereKey($data['registrationId'])
                    ->where('expires_at', '>', now())
                    ->delete();

                if ($consumed !== 1 || ! $pending instanceof OpaqueRegistration) {
                    return $this->alreadyRegistered($serialized);
                }

                $user = $pending->user;

                if (! $user instanceof User) {
                    return null;
                }

                $this->links->consumeById((string) $pending->invitation_ref);

                $user->currentMasterKeyEnvelope?->retire();

                UserMasterKeyEnvelope::create([
                    'user_id' => $user->id,
                    'envelope' => $data['wrappedUserMasterKey'],
                ]);

                $user->forceFill([
                    'opaque_credential_identifier' => $pending->credential_identifier,
                    'opaque_registration_record' => $serialized,
                    'opaque_profile' => $pending->profile,
                    'opaque_registered_at' => now(),
                    'encrypted_settings' => $data['encryptedSettings'],
                ])->save();

                return (string) $user->id;
            });
        } catch (InvalidRegistrationLinkException) {
            return $this->genericError();
        }

        if ($userId === null) {
            return $this->genericError();
        }

        return response()->json([
            'registered' => true,
            'userId' => $userId,
            'profile' => $this->setup->profile,
        ]);
    }

    /**
     * Rama idempotente (§4.2): el pendiente ya no existe. Si la cuenta quedó registrada con
     * exactamente este `registrationRecord`, la transacción anterior fue la buena.
     *
     * La comparación se hace contra el record y no contra el `registrationId` porque el pendiente ya
     * se borró: el record de 192 bytes es lo único que ata el reintento a la transacción original.
     *
     * @param  string  $serialized  `registrationRecord` binario recibido en el reintento.
     * @return string|null Identificador del usuario ya registrado, o `null` si no lo está.
     */
    private function alreadyRegistered(string $serialized): ?string
    {
        $user = User::query()
            ->where('opaque_registration_record', $serialized)
            ->whereNotNull('opaque_registered_at')
            ->first();

        return $user instanceof User ? (string) $user->id : null;
    }

    /**
     * Pendiente inexistente o caducado, enlace ya consumido, sobre mal formado: un único error, sin
     * distinguir la causa (§7).
     */
    private function genericError(): JsonResponse
    {
        return response()->json(['error' => 'invalid_registration'], 422);
    }
}
