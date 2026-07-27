<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * Spec 0001 §3.4 / ADR 0009: User Master Key envelope. An append-only table.
 *
 * Reissuing a link must not overwrite the envelope the previous password could open: a new one is
 * inserted and the previous one is retired with its date. The only mutation allowed on an existing
 * row is moving `retired_at` from null to a date, once; no row is ever deleted.
 */
#[Fillable(['user_id', 'envelope'])]
final class UserMasterKeyEnvelope extends Model
{
    use HasUuids;

    /** Spec 0001 §3.4: the table only has `created_at` and `retired_at`. */
    public const UPDATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'retired_at' => 'datetime',
        ];
    }

    /**
     * Append-only guards (Spec 0001 §3.4).
     *
     * They cover the Eloquent model path. A direct write with the query builder does not go through
     * here, so no other place in the code may touch this table without the model.
     */
    protected static function booted(): void
    {
        self::updating(function (self $envelope): void {
            $changed = array_keys($envelope->getDirty());

            if ($changed !== ['retired_at']) {
                throw new LogicException(
                    'user_master_key_envelopes is append-only: cannot update '
                    .implode(', ', $changed).'.'
                );
            }

            if ($envelope->getRawOriginal('retired_at') !== null) {
                throw new LogicException(
                    'user_master_key_envelopes is append-only: a retired envelope is never touched again.'
                );
            }
        });

        self::deleting(function (self $envelope): void {
            throw new LogicException('user_master_key_envelopes is append-only: rows are never deleted.');
        });
    }

    /**
     * Marks this envelope as retired. It is the only mutation allowed on an existing row.
     */
    public function retire(): bool
    {
        if ($this->getRawOriginal('retired_at') !== null) {
            throw new LogicException(
                'user_master_key_envelopes is append-only: a retired envelope is never touched again.'
            );
        }

        $this->retired_at = $this->freshTimestamp();

        return $this->save();
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
