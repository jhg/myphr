<?php

declare(strict_types=1);

namespace App\Models;

use App\Http\Controllers\Settings\UpdateSettingsController;
use App\Policies\UserPolicy;
use Database\Factories\UserFactory;
use Filament\Models\Contracts\FilamentUser;
use Filament\Panel;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

/**
 * Spec 0001 §3.1: usuario con clave primaria UUIDv7 y credenciales OPAQUE.
 *
 * No existe columna `password`: con OPAQUE la contraseña nunca llega al servidor, así que guardar un
 * sitio para un hash sería superficie de ataque sin ningún uso. `name` se guarda en claro (ADR 0009).
 *
 * `locale` también va en claro, y es la otra excepción consciente a la regla de cifrar (ADR 0007):
 * el servidor tiene que saber en qué idioma pintar el panel antes de que exista ninguna clave. Fuera
 * de `$fillable` a propósito, igual que `encrypted_settings`: solo lo escribe
 * {@see UpdateSettingsController}, tras validar contra la lista
 * cerrada de `config('app.supported_locales')`.
 */
#[Fillable(['name', 'email'])]
#[Hidden(['remember_token', 'opaque_credential_identifier', 'opaque_registration_record'])]
final class User extends Authenticatable implements FilamentUser
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, HasUuids, Notifiable;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'opaque_registered_at' => 'datetime',
        ];
    }

    /**
     * Spec 0001 §3.1: no hay columna `password`; el contrato de `Authenticatable` exige el método
     * igualmente, así que se responde con la cadena vacía sin tocar el modelo.
     *
     * Esto también es lo que mantiene inofensivo a `Illuminate\Session\Middleware\AuthenticateSession`
     * (montado en el panel como `Filament\Http\Middleware\AuthenticateSession`, que no sobrescribe
     * `handle()`): su primera línea es
     * `if (! $request->hasSession() || ! $request->user() || ! $request->user()->getAuthPassword())`,
     * y una cadena vacía es «falsy» en PHP, así que el middleware devuelve `$next($request)` de
     * inmediato y nunca llega a comparar `password_hash_web` contra la sesión. Si este método
     * devolviera algo distinto de `''`/`null`, esa comparación se activaría y, como nada la mantiene
     * sincronizada (el login no pasa por `Auth::attempt()`), cerraría la sesión del usuario en la
     * siguiente petición.
     */
    public function getAuthPassword(): string
    {
        return '';
    }

    /**
     * ADR 0009: entrar al panel exige únicamente tener el registro OPAQUE completo.
     *
     * Es un criterio autosuficiente a propósito: cualquier criterio que dependa de la aprobación de
     * otro usuario deja al primero sin quien lo apruebe.
     */
    public function canAccessPanel(Panel $panel): bool
    {
        return $this->hasCompletedOpaqueRegistration();
    }

    /**
     * Spec 0001 §3.1: la cuenta terminó `registration/finish` y tiene las tres columnas OPAQUE.
     *
     * Es el único criterio de acceso al panel y de autorización sobre la gestión de usuarios
     * ({@see UserPolicy}), para que no existan dos definiciones de «cuenta usable».
     */
    public function hasCompletedOpaqueRegistration(): bool
    {
        return $this->opaque_registered_at !== null
            && $this->opaque_registration_record !== null
            && $this->opaque_credential_identifier !== null;
    }

    /**
     * @return HasMany<UserRegistrationLink, $this>
     */
    public function registrationLinks(): HasMany
    {
        return $this->hasMany(UserRegistrationLink::class);
    }

    /**
     * @return HasMany<UserMasterKeyEnvelope, $this>
     */
    public function masterKeyEnvelopes(): HasMany
    {
        return $this->hasMany(UserMasterKeyEnvelope::class);
    }

    /**
     * Spec 0001 §3.4: como mucho hay un sobre vigente (`retired_at IS NULL`) por usuario.
     *
     * @return HasOne<UserMasterKeyEnvelope, $this>
     */
    public function currentMasterKeyEnvelope(): HasOne
    {
        return $this->hasOne(UserMasterKeyEnvelope::class)->whereNull('retired_at');
    }
}
