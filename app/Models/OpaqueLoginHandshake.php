<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Spec 0001 §3.2 / OPAQUE.md §14.3: estado de un login OPAQUE en curso, con TTL de 180 segundos.
 *
 * `user_id` es nulo en la rama falsa. `state_ciphertext` es el `ServerLoginState` cifrado con `Crypt`
 * de Laravel; el modelo no lo descifra ni lo expone en su serialización.
 */
#[Fillable(['user_id', 'state_ciphertext', 'expires_at'])]
#[Hidden(['state_ciphertext'])]
final class OpaqueLoginHandshake extends Model
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
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
