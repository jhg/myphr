<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Spec 0001 §3.3: enlace de registro de un solo uso, con TTL de 24 horas (ADR 0009).
 *
 * Solo se persiste `token_hash` (sha256 del token, 32 bytes); el token en claro nunca toca la base
 * de datos y se muestra una única vez a quien emite el enlace.
 */
#[Fillable(['user_id', 'token_hash', 'expires_at', 'created_by'])]
#[Hidden(['token_hash'])]
final class UserRegistrationLink extends Model
{
    use HasUuids;

    /** Spec 0001 §3.3: la tabla solo tiene `created_at`. */
    public const UPDATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
            'consumed_at' => 'datetime',
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
     * Spec 0001 §3.3: quién emitió el enlace, para auditoría.
     *
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
