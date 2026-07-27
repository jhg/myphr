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
 * Spec 0001 §3.2 / OPAQUE.md §14.3: state of an OPAQUE login in flight, with a 180-second TTL.
 *
 * `purpose` separates an ordinary login from the reauthentication of a password change: a login
 * handshake is never traded for a change ticket.
 *
 * `user_id` is null on the fake branch. `state_ciphertext` is the `ServerLoginState` encrypted with
 * Laravel's `Crypt`; the model neither decrypts it nor exposes it in its serialization.
 */
#[Fillable(['user_id', 'state_ciphertext', 'purpose', 'expires_at'])]
#[Hidden(['state_ciphertext'])]
final class OpaqueLoginHandshake extends Model
{
    use HasUuids;

    /** Spec 0001 §3.2: the table only has `created_at`. */
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
}
