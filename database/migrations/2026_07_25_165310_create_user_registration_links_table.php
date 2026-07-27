<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec 0001 §3.3: single-use registration link, with a 24-hour TTL (ADR 0009).
 *
 * The plaintext token is never persisted: only its 32-byte `sha256`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_registration_links', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();

            /** Spec 0001 §3.3: sha256 of the plaintext token, 32 bytes. Length validated in the application. */
            $table->binary('token_hash')->unique();

            $table->timestamp('expires_at');
            $table->timestamp('consumed_at')->nullable();

            /** Spec 0001 §3.3: who issued the link, for auditing. */
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamp('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_registration_links');
    }
};
