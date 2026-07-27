<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec 0001 §3.1: UUID primary key (UUIDv7) on `users`, nullable `password` and OPAQUE columns.
 *
 * Changing the type of the primary key cannot be expressed portably with `->change()` (SQLite is the
 * default driver and cannot alter a primary key in place), so the table is rebuilt. Spec §3.6 states
 * that this decision is settled before the first user exists, so the migration does not carry rows
 * over: their integer identifiers would not have a canonical UUID shape and the AAD of everything
 * encrypted afterwards would be tied to an invalid value.
 *
 * `sessions.user_id` is rebuilt at the same time because its type must follow `users.id`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('users');

        Schema::create('users', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('name');
            $table->string('email')->unique();
            $table->timestamp('email_verified_at')->nullable();
            $table->string('password')->nullable();

            /** Spec 0001 §3.1 / OPAQUE.md §13.1: HMAC-SHA-256(ENUM_KEY, normalize(login)), 32 bytes. */
            $table->binary('opaque_credential_identifier')->nullable()->unique();

            /** Spec 0001 §3.1: client_public_key || masking_key || envelope, 192 bytes. */
            $table->binary('opaque_registration_record')->nullable();

            /** Spec 0001 §3.1 / OPAQUE.md §2: profile name, including the KSF parameters. */
            $table->string('opaque_profile', 96)->nullable();

            /** Spec 0001 §3.1: NULL is indistinguishable from "no such account" for the fake login branch. */
            $table->timestamp('opaque_registered_at')->nullable();

            /** Spec 0001 §3.1 / ADR 0007: single encrypted settings envelope, never empty after signup. */
            $table->text('encrypted_settings')->nullable();

            $table->rememberToken();
            $table->timestamps();
        });

        Schema::dropIfExists('sessions');

        Schema::create('sessions', function (Blueprint $table): void {
            $table->string('id')->primary();
            $table->uuid('user_id')->nullable()->index();
            $table->string('ip_address', 45)->nullable();
            $table->text('user_agent')->nullable();
            $table->longText('payload');
            $table->integer('last_activity')->index();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('users');

        Schema::create('users', function (Blueprint $table): void {
            $table->id();
            $table->string('name');
            $table->string('email')->unique();
            $table->timestamp('email_verified_at')->nullable();
            $table->string('password');
            $table->rememberToken();
            $table->timestamps();
        });

        Schema::dropIfExists('sessions');

        Schema::create('sessions', function (Blueprint $table): void {
            $table->string('id')->primary();
            $table->foreignId('user_id')->nullable()->index();
            $table->string('ip_address', 45)->nullable();
            $table->text('user_agent')->nullable();
            $table->longText('payload');
            $table->integer('last_activity')->index();
        });
    }
};
