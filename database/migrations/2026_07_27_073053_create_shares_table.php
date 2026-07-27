<?php

declare(strict_types=1);

use App\Models\Share;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ADR 0011: capa grande de la compartición de un recorte con un profesional.
 *
 * Aquí vive **el paquete**, inmutable: se escribe una vez al crear el recorte y no se reescribe
 * nunca. La capa pequeña (`share_links`) es la que rota, para que re-armar un enlace no obligue a
 * re-cifrar ni a re-subir el paquete.
 *
 * Ninguna columna describe el contenido. El rango, los tipos incluidos y excluidos y la clave de
 * contenido `CK` viven dentro de `descriptor`, un sobre `v1.` corriente del ADR 0004 bajo la clave
 * maestra del usuario. Guardar `types` o `range_from` en claro devolvería al servidor justo el
 * metadato que el ADR 0006 cifró: leer `["glucose","insulin"]` es saber que esa persona es
 * diabética sin descifrar un byte.
 *
 * **Sin `updated_at`** a propósito. Nada se actualiza en su sitio salvo `opened_at`, y ese caso ya
 * tiene su columna. Una columna de última modificación sería además un rastro de acceso encubierto:
 * se movería con cada apertura, que es justo el histórico que el ADR 0006 descarta al hablar del
 * rastro de actividad.
 *
 * **Sin `deleted_at`** y sin `SoftDeletes`, excepción consciente al patrón del ADR 0006: revocar
 * tiene que borrar de verdad, no marcar. Es la única tabla del proyecto sin lápida.
 *
 * `id` es un UUIDv4 generado en el cliente y no un v7: el v7 lleva el instante de creación en claro
 * dentro del propio identificador, que acaba en la URL y en la foto del QR que guarde el
 * profesional.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('shares', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();

            /**
             * Caducidad dura. Se aplica también en la consulta que sirve el blob
             * (`where('expires_at','>',now())`, como `RegistrationLinks::validate()`), así que la
             * purga programada es solo higiene de almacenamiento: si el planificador se cae, no se
             * alarga la vida de nada.
             *
             * `precision: 6` como `events.occurred_at`, y por el mismo motivo: esta fecha entra en
             * el dato asociado del AEAD y en el `info` de `wrapKey` como
             * `canonicalDate(expiresAt)` (ADR 0011), así que tiene que volver del motor con la
             * fracción de segundo exacta con la que el cliente cifró. Una columna de precisión de
             * segundo la trunca en MySQL y PostgreSQL, y entonces el envoltorio no abre: el lector
             * enseña «historial alterado» con el PIN correcto. La otra mitad de este rasgo es el
             * `$dateFormat` de {@see Share}, que en SQLite es la única que manda.
             */
            $table->timestamp('expires_at', precision: 6);

            /**
             * El paquete: sobre con prefijo de transporte `s1.` (ADR 0011), escalera de relleno
             * propia de 64 KiB a 4 MiB. `longText` y no `text` porque el escalón mayor son unos
             * 5,6 MB de base64url y el `TEXT` de MySQL corta en 64 KiB.
             */
            $table->longText('payload');

            /** Sobre `v1.` bajo la clave maestra: rango, tipos y `CK`. Opaco para el servidor. */
            $table->text('descriptor');

            /**
             * Marca del **primer** acceso, redondeada a la hora y escrita una sola vez. No hay
             * contador de descargas ni historial: un histórico con marcas al segundo diría cuántas
             * veces y cuándo se consultó cada envío.
             */
            $table->timestamp('opened_at')->nullable();

            $table->timestamp('created_at');

            /** Listar los recortes vivos de una persona y purgar los caducados. */
            $table->index(['user_id', 'expires_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shares');
    }
};
