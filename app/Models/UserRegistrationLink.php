<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Spec 0001 §3.3: single-use registration link, with a 24-hour TTL (ADR 0009).
 *
 * Only `token_hash` is persisted (the sha256 of the token, 32 bytes); the plaintext token never
 * touches the database and is shown once to whoever issues the link.
 */
#[Fillable(['user_id', 'token_hash', 'expires_at', 'created_by'])]
#[Hidden(['token_hash'])]
final class UserRegistrationLink extends Model
{
    use HasUuids;

    /** Spec 0001 §3.3: the table only has `created_at`. */
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
     * Spec 0001 §3.3: who issued the link, for auditing.
     *
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
