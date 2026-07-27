<?php

declare(strict_types=1);

use App\Models\ShareLink;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ADR 0011: capa pequeña de la compartición. Un envoltorio por enlace.
 *
 * Existe separada de `shares` para que rotar un enlace —porque alguien quemó los cinco intentos, o
 * porque hay que dar uno por destinatario, cada uno con su PIN— no obligue a rehacer el recorte ni a
 * re-cifrar el paquete.
 *
 * `wrapper` es un sobre `v1.` corriente cifrado con `wrapKey` que contiene `CK`. `wrapKey` se deriva
 * de `S` (32 bytes que viajan en el fragmento de la URL y **nunca** llegan al servidor) concatenado
 * con el Argon2id del PIN, así que la fila completa, robada de un volcado de base de datos, no abre
 * nada.
 *
 * `attempts_remaining` va en **columna** y jamás en el `RateLimiter` de Laravel, que vive en caché:
 * un `cache:clear` operativo reiniciaría el contador y devolvería el millón de intentos que este
 * diseño existe para impedir. Se decrementa con la misma escritura condicional atómica de
 * `RegistrationLinks::consume()`, sin `lockForUpdate()`, que en SQLite es un no-op.
 *
 * **Sin `updated_at`**: el único cambio en su sitio es ese decremento, y una marca de última
 * modificación convertiría la tabla en un registro con la hora exacta de cada intento de apertura.
 * **Sin `deleted_at`**: agotar los intentos y revocar borran la fila de verdad.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('share_links', function (Blueprint $table): void {
            /** UUIDv4 del cliente: es el identificador que viaja en la URL del profesional. */
            $table->uuid('id')->primary();

            /** Borrar el recorte se lleva por delante todos sus enlaces. */
            $table->foreignUuid('share_id')->constrained('shares')->cascadeOnDelete();

            /** Sal del Argon2id del PIN, 16 bytes por enlace. Longitud validada en aplicación. */
            $table->binary('pin_salt');

            /** Comprobante del PIN, 32 bytes. Se compara en tiempo constante con `hash_equals()`. */
            $table->binary('pin_tag');

            /** Cinco intentos. Con PIN de seis dígitos, la probabilidad de acierto es 5 entre un millón. */
            $table->unsignedTinyInteger('attempts_remaining');

            /** Sobre `v1.` con `CK` dentro, cifrado con `wrapKey`. */
            $table->text('wrapper');

            /**
             * `precision: 6` obligatoria: `canonicalDate(expires_at)` entra en el `info` de
             * `wrapKey` y en el dato asociado del envoltorio (ADR 0011). Si el motor devuelve esta
             * fecha truncada al segundo, la clave y el dato asociado del lector dejan de coincidir
             * con los del cliente y el envoltorio no abre. Va junto al `$dateFormat` de
             * {@see ShareLink}: la columna manda en MySQL y PostgreSQL, el modelo en
             * SQLite, y hacen falta las dos.
             */
            $table->timestamp('expires_at', precision: 6);
            $table->timestamp('created_at');

            $table->index('share_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('share_links');
    }
};
