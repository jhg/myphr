<?php

declare(strict_types=1);

namespace App\Models;

use App\Security\Opaque\OpaquePurpose;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Spec 0001 §3.2 / OPAQUE.md §14.2: registro OPAQUE pendiente entre `registration/start` y
 * `registration/finish`, consumido de forma atómica dentro de la transacción de `finish`.
 *
 * `credential_identifier` son 32 bytes crudos: nunca se trata como texto ni pasa por funciones `mb_*`.
 *
 * `purpose` separa el alta del cambio de contraseña: `invitation_ref` es nulo en el segundo, que no
 * nace de ningún enlace, y `registration/finish` solo acepta pendientes de alta.
 */
#[Fillable(['user_id', 'invitation_ref', 'credential_identifier', 'profile', 'purpose', 'expires_at'])]
#[Hidden(['credential_identifier'])]
final class OpaqueRegistration extends Model
{
    use HasUuids;

    /** Spec 0001 §3.2: la tabla solo tiene `created_at`. */
    public const UPDATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
            'purpose' => OpaquePurpose::class,
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Spec 0001 §3.2: enlace de registro que originó el pendiente.
     *
     * @return BelongsTo<UserRegistrationLink, $this>
     */
    public function registrationLink(): BelongsTo
    {
        return $this->belongsTo(UserRegistrationLink::class, 'invitation_ref');
    }
}
