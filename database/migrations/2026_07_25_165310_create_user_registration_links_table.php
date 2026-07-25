<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec 0001 §3.3: enlace de registro de un solo uso, con TTL de 24 horas (ADR 0009).
 *
 * El token en claro nunca se persiste: solo su `sha256` de 32 bytes.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_registration_links', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();

            /** Spec 0001 §3.3: sha256 del token en claro, 32 bytes. Longitud validada en aplicación. */
            $table->binary('token_hash')->unique();

            $table->timestamp('expires_at');
            $table->timestamp('consumed_at')->nullable();

            /** Spec 0001 §3.3: quién emitió el enlace, para auditoría. */
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamp('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_registration_links');
    }
};
