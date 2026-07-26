<?php

declare(strict_types=1);

namespace App\Provisioning;

use App\Models\User;
use App\Models\UserRegistrationLink;
use App\Security\Opaque\Base64Url;
use App\Security\Opaque\LoginNormalizer;
use App\Security\Opaque\RandomSource;
use App\Support\AuditEvent;

/**
 * Emisión, validación y consumo de enlaces de registro de un solo uso
 * (Spec 0001 §3.3, §3.4, §4.1, §4.2; ADR 0009).
 *
 * Reglas que esta clase concentra a propósito:
 *
 * * El token en claro solo existe en memoria y en la URL devuelta. En base de
 *   datos vive únicamente su `sha256` de 32 bytes.
 * * Inexistente, caducado y consumido producen el mismo error genérico
 *   ({@see InvalidRegistrationLinkException}, `docs/OPAQUE.md` §13.3).
 * * La guardia de «esta cuenta ya tiene acceso» vive aquí y no en el comando ni
 *   en la interfaz de Filament (Spec 0001 §3.4): si viviera en dos sitios, uno
 *   de los dos acabaría sin ella, y `--no-interaction` se saltaría cualquier
 *   confirmación puesta solo en la interfaz.
 */
final readonly class RegistrationLinks
{
    /** Tamaño del token en claro, antes de codificar en base64url. */
    public const TOKEN_BYTES = 32;

    /** Spec 0001 §3.3 / ADR 0009: TTL de 24 horas, explícita y no oculta en un valor por defecto. */
    public const TTL_HOURS = 24;

    /**
     * Ruta de la página genérica de establecimiento de contraseña (Spec 0001 §4.1).
     *
     * El token viaja en el fragmento (`#<token>`), que el navegador no envía al
     * servidor: solo llega dentro del cuerpo de `registration/start`.
     */
    public const SET_PASSWORD_PATH = 'phr/set-password';

    public function __construct(private RandomSource $random) {}

    /**
     * Emite un enlace nuevo para `$user` y devuelve su URL completa.
     *
     * @param  User  $user  Cuenta destinataria del enlace.
     * @param  User|null  $issuedBy  Quién lo emite, para auditoría (`created_by`).
     * @param  string|null  $confirmation  Email tecleado como confirmación explícita de
     *                                     una reemisión sobre una cuenta con acceso.
     * @return string URL con el token en el fragmento. Es la única copia del token en claro.
     *
     * @throws RegistrationLinkReissueRequiresConfirmationException Si la cuenta ya tiene
     *                                                              acceso y falta la confirmación.
     */
    public function issueFor(User $user, ?User $issuedBy = null, ?string $confirmation = null): string
    {
        $this->assertReissueIsConfirmed($user, $confirmation);

        $token = Base64Url::encode($this->random->bytes(self::TOKEN_BYTES));

        UserRegistrationLink::create([
            'user_id' => $user->id,
            'token_hash' => $this->hash($token),
            'expires_at' => now()->addHours(self::TTL_HOURS),
            'created_by' => $issuedBy?->id,
        ]);

        /**
         * El rastro va aquí y no en quien llama, porque emitir un enlace se puede hacer desde el
         * panel y desde `phr:issue-registration-link`, y esta es la única pieza por la que pasan
         * ambas. Es la acción más destructiva del sistema (Spec 0001 §3.4): completar el registro
         * nuevo retira el sobre vigente de la clave maestra y deja inaccesible lo ya guardado.
         *
         * El token **no** se anota. Es la credencial que abre el alta, y guardarla en claro aquí
         * anularía el sentido de que en su propia tabla solo viva su hash.
         */
        activity(AuditEvent::LOG_NAME)
            ->causedBy($issuedBy)
            ->performedOn($user)
            ->event(AuditEvent::RegistrationLinkIssued->value)
            ->log(AuditEvent::RegistrationLinkIssued->value);

        return url(self::SET_PASSWORD_PATH).'#'.$token;
    }

    /**
     * Comprueba que un token es utilizable. **No lo consume** (Spec 0001 §5, paso 4).
     *
     * Consumirlo aquí dejaría sin enlace y sin cuenta usable a quien sufra un corte
     * de red durante el Argon2id del navegador.
     *
     * @throws InvalidRegistrationLinkException Si no existe, caducó o ya se consumió.
     */
    public function validate(string $token): UserRegistrationLink
    {
        $link = UserRegistrationLink::query()
            ->where('token_hash', $this->hash($token))
            ->whereNull('consumed_at')
            ->where('expires_at', '>', now())
            ->first();

        if (! $link instanceof UserRegistrationLink) {
            throw InvalidRegistrationLinkException::generic();
        }

        return $link;
    }

    /**
     * Consume un token de forma atómica (Spec 0001 §4.2).
     *
     * El consumo es una escritura condicional cuyo resultado se decide por el número
     * de filas afectadas: dos peticiones simultáneas con el mismo token producen una
     * única fila actualizada y la segunda recibe el error genérico.
     *
     * No se usa `lockForUpdate()`: en SQLite es un no-op, así que un consumo apoyado
     * en él pasaría los tests y no protegería nada (Spec 0001 §11).
     *
     * @throws InvalidRegistrationLinkException Si no existe, caducó o ya se consumió.
     */
    public function consume(string $token): UserRegistrationLink
    {
        $hash = $this->hash($token);
        $now = now();

        $affected = UserRegistrationLink::query()
            ->where('token_hash', $hash)
            ->whereNull('consumed_at')
            ->where('expires_at', '>', $now)
            ->update(['consumed_at' => $now]);

        if ($affected !== 1) {
            throw InvalidRegistrationLinkException::generic();
        }

        $link = UserRegistrationLink::query()->where('token_hash', $hash)->first();

        if (! $link instanceof UserRegistrationLink) {
            throw InvalidRegistrationLinkException::generic();
        }

        return $link;
    }

    /**
     * Consume un enlace por su identificador, con la misma escritura condicional que
     * {@see self::consume()} (Spec 0001 §4.2).
     *
     * `registration/finish` no recibe el token en claro: solo conoce el enlace a través del
     * `invitation_ref` que guardó el registro pendiente. El consumo sigue viviendo aquí y no en el
     * controlador para que exista una única implementación de lo que significa consumir un enlace.
     *
     * @param  string  $id  Identificador del enlace (`user_registration_links.id`).
     *
     * @throws InvalidRegistrationLinkException Si no existe, caducó o ya se consumió.
     */
    public function consumeById(string $id): UserRegistrationLink
    {
        $now = now();

        $affected = UserRegistrationLink::query()
            ->whereKey($id)
            ->whereNull('consumed_at')
            ->where('expires_at', '>', $now)
            ->update(['consumed_at' => $now]);

        if ($affected !== 1) {
            throw InvalidRegistrationLinkException::generic();
        }

        $link = UserRegistrationLink::query()->whereKey($id)->first();

        if (! $link instanceof UserRegistrationLink) {
            throw InvalidRegistrationLinkException::generic();
        }

        return $link;
    }

    /**
     * Guardia de la Spec 0001 §3.4.
     *
     * La confirmación es el email de la cuenta, normalizado con la misma función que
     * la columna (`docs/OPAQUE.md` §13.1.1) para que una mayúscula tecleada de más no
     * bloquee una reemisión legítima.
     *
     * @throws RegistrationLinkReissueRequiresConfirmationException
     */
    private function assertReissueIsConfirmed(User $user, ?string $confirmation): void
    {
        if (! $this->hasUsableAccess($user)) {
            return;
        }

        $typed = $confirmation === null ? '' : LoginNormalizer::normalize($confirmation);

        if ($typed !== '' && hash_equals((string) $user->email, $typed)) {
            return;
        }

        throw RegistrationLinkReissueRequiresConfirmationException::for($user);
    }

    /**
     * Una cuenta tiene acceso si completó su registro OPAQUE o si conserva un sobre
     * vigente de clave maestra: en ambos casos, un registro nuevo se lo destruye.
     */
    private function hasUsableAccess(User $user): bool
    {
        return $user->opaque_registered_at !== null
            || $user->masterKeyEnvelopes()->whereNull('retired_at')->exists();
    }

    /**
     * Spec 0001 §3.3: `sha256` binario del token en claro, 32 bytes.
     */
    private function hash(string $token): string
    {
        return hash('sha256', $token, true);
    }
}
