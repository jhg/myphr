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
 * Spec 0001 §3.2 / OPAQUE.md §14.2: pending OPAQUE registration between `registration/start` and
 * `registration/finish`, consumed atomically inside the `finish` transaction.
 *
 * `credential_identifier` is 32 raw bytes: it is never treated as text and never goes through `mb_*`
 * functions.
 *
 * `purpose` separates signup from password change: `invitation_ref` is null in the latter, which
 * comes from no link, and `registration/finish` only accepts signup pending rows.
 */
#[Fillable(['user_id', 'invitation_ref', 'credential_identifier', 'profile', 'purpose', 'expires_at'])]
#[Hidden(['credential_identifier'])]
final class OpaqueRegistration extends Model
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

    /**
     * Spec 0001 §3.2: registration link the pending row came from.
     *
     * @return BelongsTo<UserRegistrationLink, $this>
     */
    public function registrationLink(): BelongsTo
    {
        return $this->belongsTo(UserRegistrationLink::class, 'invitation_ref');
    }
}
