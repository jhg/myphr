<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ADR 0006: a single clinical events table with the type encrypted inside the envelope.
 *
 * No column is in the clear except the ones the server needs to authorize and paginate: `user_id` to
 * scope by owner, `occurred_at` for range and ordering, `id` as a row handle. The rest of the
 * clinical content lives in `payload`, an encrypted envelope the server does not interpret.
 *
 * `occurred_at` is declared with microsecond precision (ADR 0006, Consequences section): the
 * envelope is encrypted using that date as AEAD associated data, so if the server truncates it when
 * reading it back the envelope becomes undecryptable.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('events', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();

            $table->dateTime('occurred_at', precision: 6);

            /** ADR 0006: encrypted envelope with the `v1.` prefix, opaque content for the server. */
            $table->text('payload');

            $table->timestamps();
            $table->softDeletes();

            $table->index(['user_id', 'occurred_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('events');
    }
};
