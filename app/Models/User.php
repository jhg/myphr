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
 * Spec 0001 §3.1: user with a UUIDv7 primary key and OPAQUE credentials.
 *
 * There is no `password` column: with OPAQUE the password never reaches the server, so keeping a
 * place for a hash would be attack surface with no use. `name` is stored in the clear (ADR 0009).
 *
 * `locale` is also in the clear, and it is the other deliberate exception to the encrypt-everything
 * rule (ADR 0007): the server has to know which language to paint the panel in before any key
 * exists. It is deliberately outside `$fillable`, like `encrypted_settings`: only
 * {@see UpdateSettingsController} writes it, after validating against the closed list in
 * `config('app.supported_locales')`.
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
     * Spec 0001 §3.1: there is no `password` column; the `Authenticatable` contract requires the
     * method anyway, so we answer with the empty string without touching the model.
     *
     * This is also what keeps `Illuminate\Session\Middleware\AuthenticateSession` harmless (mounted
     * on the panel as `Filament\Http\Middleware\AuthenticateSession`, which does not override
     * `handle()`): its first line is
     * `if (! $request->hasSession() || ! $request->user() || ! $request->user()->getAuthPassword())`,
     * and an empty string is falsy in PHP, so the middleware returns `$next($request)` right away
     * and never gets to compare `password_hash_web` against the session. If this method returned
     * anything other than `''`/`null`, that comparison would kick in and, since nothing keeps it in
     * sync (login does not go through `Auth::attempt()`), it would log the user out on the next
     * request.
     */
    public function getAuthPassword(): string
    {
        return '';
    }

    /**
     * ADR 0009: entering the panel requires only a completed OPAQUE registration.
     *
     * It is a self-sufficient criterion on purpose: any criterion that depends on another user's
     * approval leaves the first one with nobody to approve them.
     */
    public function canAccessPanel(Panel $panel): bool
    {
        return $this->hasCompletedOpaqueRegistration();
    }

    /**
     * Spec 0001 §3.1: the account finished `registration/finish` and has the three OPAQUE columns.
     *
     * It is the only criterion for panel access and for authorization over user management
     * ({@see UserPolicy}), so there are not two definitions of "usable account".
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
     * Spec 0001 §3.4: there is at most one current envelope (`retired_at IS NULL`) per user.
     *
     * @return HasOne<UserMasterKeyEnvelope, $this>
     */
    public function currentMasterKeyEnvelope(): HasOne
    {
        return $this->hasOne(UserMasterKeyEnvelope::class)->whereNull('retired_at');
    }
}
