<?php

declare(strict_types=1);

use App\Models\ShareLink;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ADR 0011: the small layer of sharing. One wrapper per link.
 *
 * It exists separately from `shares` so that rotating a link —because somebody burnt the five
 * attempts, or because you need one per recipient, each with its own PIN— does not force redoing the
 * clipping or re-encrypting the package.
 *
 * `wrapper` is an ordinary `v1.` envelope encrypted with `wrapKey` that holds `CK`. `wrapKey` is
 * derived from `S` (32 bytes that travel in the URL fragment and **never** reach the server)
 * concatenated with the Argon2id of the PIN, so the whole row, stolen from a database dump, opens
 * nothing.
 *
 * `attempts_remaining` lives in a **column** and never in Laravel's `RateLimiter`, which lives in
 * cache: an operational `cache:clear` would reset the counter and hand back the million attempts
 * this design exists to prevent. It is decremented with the same atomic conditional write as
 * `RegistrationLinks::consume()`, without `lockForUpdate()`, which is a no-op on SQLite.
 *
 * **No `updated_at`**: the only in-place change is that decrement, and a last-modified mark would
 * turn the table into a log with the exact time of every open attempt. **No `deleted_at`**: running
 * out of attempts and revoking both delete the row for real.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('share_links', function (Blueprint $table): void {
            /** Client-side UUIDv4: it is the identifier that travels in the professional's URL. */
            $table->uuid('id')->primary();

            /** Deleting the clipping takes all of its links with it. */
            $table->foreignUuid('share_id')->constrained('shares')->cascadeOnDelete();

            /** Salt for the Argon2id of the PIN, 16 bytes per link. Length validated in the application. */
            $table->binary('pin_salt');

            /** PIN proof, 32 bytes. Compared in constant time with `hash_equals()`. */
            $table->binary('pin_tag');

            /** Five attempts. With a six-digit PIN, the odds of a lucky guess are 5 in a million. */
            $table->unsignedTinyInteger('attempts_remaining');

            /** `v1.` envelope with `CK` inside, encrypted with `wrapKey`. */
            $table->text('wrapper');

            /**
             * `precision: 6` is mandatory: `canonicalDate(expires_at)` goes into the `info` of
             * `wrapKey` and into the wrapper's associated data (ADR 0011). If the engine returns this
             * date truncated to the second, the reader's key and associated data stop matching the
             * client's and the wrapper does not open. It goes together with the `$dateFormat` on
             * {@see ShareLink}: the column rules on MySQL and PostgreSQL, the model rules on SQLite,
             * and you need both.
             */
            $table->timestamp('expires_at', precision: 6);
            $table->timestamp('created_at');

            $table->index('share_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('share_links');
    }
};
