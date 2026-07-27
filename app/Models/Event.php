<?php

declare(strict_types=1);

namespace App\Models;

use App\Crypto\EnvelopeValidator;
use App\Support\AuditEvent;
use Database\Factories\EventFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use LogicException;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;

/**
 * ADR 0006: a clinical event is an encrypted envelope with only the plaintext columns the server
 * needs to authorize and paginate (`user_id`, `occurred_at`, `id`). There is deliberately no
 * plaintext type column: with one, the schema would reveal what the user records without decrypting
 * anything.
 */
#[Fillable(['user_id', 'occurred_at', 'payload'])]
final class Event extends Model
{
    /** @use HasFactory<EventFactory> */
    use HasFactory, HasUuids, LogsActivity, SoftDeletes;

    /**
     * Name of the lifecycle transitions log, separate from the account one
     * ({@see AuditEvent::LOG_NAME}) so they can be queried apart.
     */
    public const LOG_NAME = 'health-event';

    /**
     * The trail lives on the model and not on the pages that write, so no future deletion path is
     * left unrecorded by oversight: anything that goes through Eloquent gets logged.
     *
     * `forceDeleted` is not among the events Spatie records by default, and it is needed here
     * because the goal is to tell marking for deletion apart from actually deleting.
     *
     * @var array<int, string>
     */
    protected static array $recordEvents = ['created', 'updated', 'deleted', 'restored', 'forceDeleted'];

    /**
     * No attributes and no properties, on purpose.
     *
     * `LogOptions::defaults()` records neither the `fillable` nor the `unguarded` ones, so the row
     * records the verb, the subject, who caused it and the date, and nothing else. It is the only
     * honest thing we can store: `payload` is an encrypted envelope the server cannot read, and
     * copying it into the log would only duplicate ciphertext and multiply the places you would have
     * to delete it from.
     */
    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()
            ->useLogName(self::LOG_NAME)
            ->setDescriptionForEvent(function (string $eventName): string {
                /**
                 * A permanent delete fires `deleted` and then `forceDeleted`, so without this there
                 * would be two rows for a single action. An empty description is how the package
                 * skips an entry.
                 */
                if ($eventName === 'deleted' && $this->isForceDeleting()) {
                    return '';
                }

                return $eventName;
            });
    }

    /**
     * ADR 0006 (Consequences): Laravel's default date format, `Y-m-d H:i:s`, truncates microseconds
     * on every engine. `occurred_at` takes part as the AEAD associated data the client encrypts the
     * envelope with, so if the server reads it back truncated, the stored envelope becomes
     * undecryptable: the date that authenticates no longer matches the one used when encrypting.
     */
    protected $dateFormat = 'Y-m-d H:i:s.u';

    /**
     * `payload` deliberately does not appear here: it is an encrypted envelope, an end-to-end opaque
     * string. The server has no key to interpret it and must not try, so it gets no cast and no
     * mutator of its own, only the format guardrail in {@see self::booted()}.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'occurred_at' => 'datetime',
        ];
    }

    /**
     * ADR 0006: a guardrail on format, not on content.
     *
     * The server can never validate what is inside the envelope because it has no key; the only
     * thing it can and must check is that the column has the shape of a valid envelope (prefix,
     * encoding and size), so no route writes rubbish into `payload` even though the encrypted
     * content stays undecryptable to us.
     */
    protected static function booted(): void
    {
        self::saving(function (self $event): void {
            if (! EnvelopeValidator::isValid($event->payload)) {
                throw new LogicException('events.payload does not have the shape of a valid encrypted envelope.');
            }
        });
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
