<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec 0001 §3.4 / ADR 0009: User Master Key envelopes, an append-only table.
 *
 * Reissuing a link never overwrites the envelope the previous password could open: a new row is
 * inserted and the previous one is marked with `retired_at`. At most one row with `retired_at IS
 * NULL` per user, which is the current envelope.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_master_key_envelopes', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();

            /** Spec 0001 §3.4 / ADR 0004: encrypted envelope with the `v1.` prefix. */
            $table->text('envelope');

            $table->timestamp('created_at');
            $table->timestamp('retired_at')->nullable();

            $table->index(['user_id', 'retired_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_master_key_envelopes');
    }
};
