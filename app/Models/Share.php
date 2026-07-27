<?php

declare(strict_types=1);

namespace App\Models;

use App\Crypto\EnvelopeValidator;
use App\Crypto\ShareEnvelopeValidator;
use Database\Factories\ShareFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasVersion4Uuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * ADR 0011: el paquete de un recorte compartido, inmutable y opaco.
 *
 * El servidor ve un blob, un identificador y dos fechas. No sabe qué contiene ni qué rango cubre:
 * eso vive dentro de `descriptor`, cifrado bajo la clave maestra del usuario, y se descifra en el
 * navegador para pintar la pantalla de comparticiones activas.
 *
 * `HasVersion4Uuids` y no `HasUuids`: en Laravel 12 el segundo genera UUIDv7, que lleva el instante
 * de creación en claro dentro del identificador, y este identificador acaba en la URL del
 * profesional y en la foto del QR. Es la excepción que el ADR 0006 ya prevé. En la práctica el
 * identificador llega generado por el cliente; el rasgo se queda para que una fila creada sin él
 * (una fábrica, un test) no reintroduzca un v7 por descuido.
 *
 * Sin `SoftDeletes`: revocar y purgar son borrado físico (ADR 0011).
 */
#[Fillable(['id', 'user_id', 'expires_at', 'payload', 'descriptor'])]
final class Share extends Model
{
    /** @use HasFactory<ShareFactory> */
    use HasFactory, HasVersion4Uuids;

    /** ADR 0011: la tabla solo tiene `created_at`. Nada se actualiza en su sitio salvo `opened_at`. */
    public const UPDATED_AT = null;

    /**
     * Mismo rasgo que {@see Event::$dateFormat}, y por el mismo motivo: el formato por defecto de
     * Laravel, `Y-m-d H:i:s`, trunca los microsegundos al escribir en cualquier motor.
     *
     * `expires_at` no es una fecha administrativa: `canonicalDate(expiresAt)` entra en el `info` de
     * `wrapKey` y en el dato asociado del envoltorio del enlace (ADR 0011). El cliente cifra con el
     * instante que él tiene, con milisegundos; si el servidor lo relee truncado y lo devuelve así en
     * `open`, el lector deriva otra clave y reconstruye otro dato asociado, y el envoltorio no abre.
     * Con el PIN correcto, que es lo desconcertante del fallo. La otra mitad la ponen las columnas
     * `precision: 6` de la migración, que es lo que manda en MySQL y PostgreSQL.
     */
    protected $dateFormat = 'Y-m-d H:i:s.u';

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
            'opened_at' => 'datetime',
        ];
    }

    /**
     * Guardarraíl de **forma**, nunca de contenido, igual que el de {@see Event::booted()}.
     *
     * Los dos sobres de esta fila tienen formatos distintos y cada uno lo valida su propio
     * validador: el paquete es `s1.` con la escalera de 64 KiB a 4 MiB, y el descriptor es un sobre
     * `v1.` corriente del ADR 0004. Cruzarlos es justo lo que el prefijo distinto impide, así que la
     * comprobación se escribe cruzada a propósito.
     */
    protected static function booted(): void
    {
        self::saving(function (self $share): void {
            if (! ShareEnvelopeValidator::isValid($share->payload)) {
                throw new LogicException('shares.payload no tiene forma de paquete cifrado válido.');
            }

            if (! EnvelopeValidator::isValid($share->descriptor)) {
                throw new LogicException('shares.descriptor no tiene forma de sobre cifrado válido.');
            }
        });
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return HasMany<ShareLink, $this>
     */
    public function links(): HasMany
    {
        return $this->hasMany(ShareLink::class);
    }
}
