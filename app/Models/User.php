<?php

declare(strict_types=1);

namespace App\Models;

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
 * `password` queda fuera de la asignación masiva y sin cast `hashed`: no autentica a nadie y solo
 * existe por compatibilidad de framework (§3.1, §9). `name` se guarda en claro (ADR 0009).
 */
#[Fillable(['name', 'email'])]
#[Hidden(['password', 'remember_token', 'opaque_credential_identifier', 'opaque_registration_record'])]
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
     * Spec 0001 §3.1: la columna `password` no se usa para autenticar.
     *
     * Devolver siempre la cadena vacía impide que un guard basado en hash de contraseña dé por válida
     * una credencial, incluso si alguien llegara a escribir un hash en la columna.
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
