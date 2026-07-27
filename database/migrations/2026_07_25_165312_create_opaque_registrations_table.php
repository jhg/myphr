<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec 0001 §3.2 / OPAQUE.md §14.2: pending OPAQUE registration between `registration/start` and
 * `registration/finish`. It is consumed atomically inside the `registration/finish` transaction.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('opaque_registrations', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();

            /** Spec 0001 §3.2: registration link the pending row came from. */
            $table->foreignUuid('invitation_ref')
                ->constrained('user_registration_links')
                ->cascadeOnDelete();

            /** OPAQUE.md §13.1: 32 bytes. Length validated in the application, not by the schema. */
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
