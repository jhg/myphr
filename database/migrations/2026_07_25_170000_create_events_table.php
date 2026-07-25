<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ADR 0006: una sola tabla de eventos clínicos con el tipo cifrado dentro del sobre.
 *
 * Ninguna columna en claro salvo las que el servidor necesita para autorizar y paginar: `user_id`
 * para acotar por dueño, `occurred_at` para rango y orden, `id` como asa de fila. El resto del
 * contenido clínico vive en `payload`, un sobre cifrado que el servidor no interpreta.
 *
 * `occurred_at` se declara con precisión de microsegundos (ADR 0006, sección Consequences): el
 * sobre se cifra usando esa fecha como dato asociado del AEAD, así que si el servidor la trunca al
 * releerla el sobre queda indescifrable.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('events', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();

            $table->dateTime('occurred_at', precision: 6);

            /** ADR 0006: sobre cifrado con prefijo `v1.`, contenido opaco para el servidor. */
            $table->text('payload');

            $table->timestamps();
            $table->softDeletes();

            $table->index(['user_id', 'occurred_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('events');
    }
};
