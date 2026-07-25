<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec 0001 §3.4 / ADR 0009: sobres de la User Master Key, tabla de solo añadir.
 *
 * Reemitir un enlace nunca sobrescribe el sobre que la contraseña anterior sabía abrir: se inserta
 * uno nuevo y el anterior queda marcado con `retired_at`. Como mucho una fila con `retired_at IS NULL`
 * por usuario, que es el sobre vigente.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_master_key_envelopes', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();

            /** Spec 0001 §3.4 / ADR 0004: sobre cifrado con prefijo `v1.`. */
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
