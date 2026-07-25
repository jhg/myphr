<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec 0001 §3.2 / OPAQUE.md §14.2: registro OPAQUE pendiente entre `registration/start` y
 * `registration/finish`. Se consume de forma atómica dentro de la transacción de `registration/finish`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('opaque_registrations', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();

            /** Spec 0001 §3.2: enlace de registro que originó el pendiente. */
            $table->foreignUuid('invitation_ref')
                ->constrained('user_registration_links')
                ->cascadeOnDelete();

            /** OPAQUE.md §13.1: 32 bytes. Longitud validada en aplicación, no por el esquema. */
            $table->binary('credential_identifier');

            $table->string('profile', 96);
            $table->timestamp('expires_at')->index();
            $table->timestamp('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('opaque_registrations');
    }
};
