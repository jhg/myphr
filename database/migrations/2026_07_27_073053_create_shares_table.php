<?php

declare(strict_types=1);

use App\Models\Share;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ADR 0011: the big layer of sharing a clipping with a professional.
 *
 * **The package** lives here, immutable: it is written once when the clipping is created and never
 * rewritten. The small layer (`share_links`) is the one that rotates, so re-arming a link does not
 * force re-encrypting or re-uploading the package.
 *
 * No column describes the content. The range, the included and excluded types and the content key
 * `CK` live inside `descriptor`, an ordinary `v1.` envelope from ADR 0004 under the user's master
 * key. Storing `types` or `range_from` in the clear would hand the server exactly the metadata ADR
 * 0006 encrypted: reading `["glucose","insulin"]` tells you that person is diabetic without
 * decrypting a single byte.
 *
 * **No `updated_at`**, on purpose. Nothing is updated in place except `opened_at`, and that case
 * already has its own column. A last-modified column would also be a covert access trail: it would
 * move on every open, which is exactly the history ADR 0006 rules out when it talks about the
 * activity trail.
 *
 * **No `deleted_at`** and no `SoftDeletes`, a deliberate exception to the ADR 0006 pattern: revoking
 * has to delete for real, not mark. It is the only table in the project without a tombstone.
 *
 * `id` is a UUIDv4 generated on the client and not a v7: v7 carries the creation instant in the
 * clear inside the identifier itself, which ends up in the URL and in the photo of the QR code the
 * professional keeps.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('shares', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();

            /**
             * Hard expiry. It is also enforced in the query that serves the blob
             * (`where('expires_at','>',now())`, like `RegistrationLinks::validate()`), so the
             * scheduled pruning is only storage hygiene: if the scheduler goes down, nothing lives
             * any longer.
             *
             * `precision: 6` like `events.occurred_at`, and for the same reason: this date goes into
             * the AEAD associated data and into the `info` of `wrapKey` as
             * `canonicalDate(expiresAt)` (ADR 0011), so it has to come back from the engine with the
             * exact fraction of a second the client encrypted with. A second-precision column
             * truncates it on MySQL and PostgreSQL, and then the wrapper does not open: the reader
             * shows "history was tampered with" even with the right PIN. The other half of this
             * trait is the `$dateFormat` on {@see Share}, which is the only one that rules on SQLite.
             */
            $table->timestamp('expires_at', precision: 6);

            /**
             * The package: an envelope with the `s1.` transport prefix (ADR 0011) and its own
             * padding ladder from 64 KiB to 4 MiB. `longText` and not `text` because the largest
             * step is about 5.6 MB of base64url and MySQL's `TEXT` cuts off at 64 KiB.
             */
            $table->longText('payload');

            /** `v1.` envelope under the master key: range, types and `CK`. Opaque to the server. */
            $table->text('descriptor');

            /**
             * Mark of the **first** access, rounded to the hour and written only once. There is no
             * download counter and no history: a log with second-precision marks would tell how many
             * times and when each delivery was read.
             */
            $table->timestamp('opened_at')->nullable();

            $table->timestamp('created_at');

            /** List a person's live clippings and prune the expired ones. */
            $table->index(['user_id', 'expires_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shares');
    }
};
