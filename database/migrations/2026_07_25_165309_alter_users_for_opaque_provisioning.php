<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec 0001 §3.1: clave primaria UUID (UUIDv7) en `users`, `password` nullable y columnas OPAQUE.
 *
 * El cambio de tipo de la clave primaria no se puede expresar con `->change()` de forma portable
 * (SQLite es el driver por defecto y no admite alterar la clave primaria en sitio), así que la tabla
 * se reconstruye. La spec §3.6 fija que esta decisión se cierra antes del primer usuario, por lo que
 * la migración no traslada filas: sus identificadores enteros no tendrían forma UUID canónica y el
 * AAD de todo lo que se cifrase después quedaría atado a un valor inválido.
 *
 * `sessions.user_id` se reconstruye a la vez porque su tipo debe seguir al de `users.id`.
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

            /** Spec 0001 §3.1 / OPAQUE.md §2: nombre del perfil, incluidos los parámetros del KSF. */
            $table->string('opaque_profile', 96)->nullable();

            /** Spec 0001 §3.1: NULL es indistinguible de "cuenta inexistente" para la rama falsa del login. */
            $table->timestamp('opaque_registered_at')->nullable();

            /** Spec 0001 §3.1 / ADR 0007: sobre cifrado único de configuración, nunca vacío tras el alta. */
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
