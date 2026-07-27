<?php

declare(strict_types=1);

namespace App\Models;

use App\Crypto\EnvelopeValidator;
use Database\Factories\ShareLinkFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasVersion4Uuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * ADR 0011: el envoltorio pequeño de un enlace de compartición.
 *
 * `pin_salt` y `pin_tag` están ocultos de la serialización por defecto: el tag es el comprobante del
 * PIN y la sal solo debe salir por el `challenge`, que la entrega deliberadamente y una a una. Que
 * un `toArray()` distraído los volcase en una respuesta de listado le regalaría a cualquiera el
 * material para atacar el PIN fuera de línea, que es exactamente el fallo que este diseño corrigió.
 *
 * `HasVersion4Uuids` por el mismo motivo que en {@see Share}: el identificador viaja en la URL y un
 * UUIDv7 llevaría dentro el instante de creación.
 */
#[Fillable(['id', 'share_id', 'pin_salt', 'pin_tag', 'attempts_remaining', 'wrapper', 'expires_at'])]
#[Hidden(['pin_salt', 'pin_tag', 'wrapper'])]
final class ShareLink extends Model
{
    /** @use HasFactory<ShareLinkFactory> */
    use HasFactory, HasVersion4Uuids;

    /** ADR 0011: la tabla solo tiene `created_at`. */
    public const UPDATED_AT = null;

    /**
     * Igual que en {@see Share::$dateFormat} y en {@see Event::$dateFormat}: sin esto, el formato
     * por defecto de Laravel guarda `expires_at` sin fracción de segundo.
     *
     * Aquí duele más que en ningún otro sitio, porque es esta caducidad la que `ShareLinkGate::open()`
     * devuelve al lector y la que entra en la derivación de `wrapKey` y en el dato asociado del
     * envoltorio (ADR 0011). Un solo milisegundo perdido y el AEAD falla: el profesional teclea el
     * PIN correcto y ve el aviso de historial alterado.
     */
    protected $dateFormat = 'Y-m-d H:i:s.u';

    /** Longitud exacta de la sal del Argon2id del PIN. */
    public const int PIN_SALT_BYTES = 16;

    /** Longitud exacta del comprobante del PIN. */
    public const int PIN_TAG_BYTES = 32;

    /**
     * Cinco intentos por enlace (ADR 0011). Con PIN de seis dígitos generado por la aplicación, la
     * probabilidad de acertar es 5 entre un millón.
     */
    public const int MAX_ATTEMPTS = 5;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
            'attempts_remaining' => 'integer',
        ];
    }

    /**
     * Guardarraíl de forma. Las longitudes exactas se comprueban aquí y no en la migración porque
     * `binary` no las fija en SQLite, y un `pin_tag` de tamaño distinto haría que `hash_equals()`
     * devolviese siempre `false` sin decir por qué.
     */
    protected static function booted(): void
    {
        self::saving(function (self $link): void {
            if (! is_string($link->pin_salt) || strlen($link->pin_salt) !== self::PIN_SALT_BYTES) {
                throw new LogicException('share_links.pin_salt debe medir exactamente 16 bytes.');
            }

            if (! is_string($link->pin_tag) || strlen($link->pin_tag) !== self::PIN_TAG_BYTES) {
                throw new LogicException('share_links.pin_tag debe medir exactamente 32 bytes.');
            }

            if (! EnvelopeValidator::isValid($link->wrapper)) {
                throw new LogicException('share_links.wrapper no tiene forma de sobre cifrado válido.');
            }
        });
    }

    /**
     * @return BelongsTo<Share, $this>
     */
    public function share(): BelongsTo
    {
        return $this->belongsTo(Share::class);
    }
}
