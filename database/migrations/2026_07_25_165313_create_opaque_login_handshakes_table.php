<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec 0001 §3.2 / OPAQUE.md §14.3: estado de un login OPAQUE en curso, con TTL de 180 segundos.
 *
 * `user_id` es nulo en la rama falsa (OPAQUE.md §13.3). El estado va cifrado con `Crypt` de Laravel.
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
