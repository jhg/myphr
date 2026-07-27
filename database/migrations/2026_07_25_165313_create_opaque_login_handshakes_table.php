<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec 0001 §3.2 / OPAQUE.md §14.3: state of an OPAQUE login in flight, with a 180-second TTL.
 *
 * `user_id` is null on the fake branch (OPAQUE.md §13.3). The state is encrypted with Laravel's
 * `Crypt`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('opaque_login_handshakes', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->nullable()->constrained('users')->cascadeOnDelete();
            $table->text('state_ciphertext');
            $table->timestamp('expires_at')->index();
            $table->timestamp('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('opaque_login_handshakes');
    }
};
