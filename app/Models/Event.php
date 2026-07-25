<?php

declare(strict_types=1);

namespace App\Models;

use App\Crypto\EnvelopeValidator;
use Database\Factories\EventFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use LogicException;

/**
 * ADR 0006: un evento clínico es un sobre cifrado con solo las columnas en claro que el servidor
 * necesita para autorizar y paginar (`user_id`, `occurred_at`, `id`). No hay columna de tipo en
 * claro a propósito: si la hubiera, el esquema revelaría qué registra el usuario sin descifrar nada.
 */
#[Fillable(['user_id', 'occurred_at', 'payload'])]
final class Event extends Model
{
    /** @use HasFactory<EventFactory> */
    use HasFactory, HasUuids, SoftDeletes;

    /**
     * ADR 0006 (Consequences): el formato de fecha por defecto de Laravel, `Y-m-d H:i:s`, trunca los
     * microsegundos en cualquier motor. `occurred_at` participa como dato asociado del AEAD con el
     * que el cliente cifra el sobre, así que si el servidor la relee truncada, el sobre guardado
     * queda indescifrable: la fecha que autentica ya no coincide con la que se usó al cifrar.
     */
    protected $dateFormat = 'Y-m-d H:i:s.u';

    /**
     * `payload` deliberadamente no aparece aquí: es un sobre cifrado, cadena opaca de extremo a
     * extremo. El servidor no tiene la clave para interpretarlo ni debe intentarlo, así que no lleva
     * cast ni mutador propio, solo el guardarraíl de formato de {@see self::booted()}.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'occurred_at' => 'datetime',
        ];
    }

    /**
     * ADR 0006: guardarraíl de formato, no de contenido.
     *
     * El servidor nunca puede validar qué hay dentro del sobre porque no tiene la clave; lo único
     * que puede y debe comprobar es que la columna tenga forma de sobre válido (prefijo, codificación
     * y tamaño), para que ninguna ruta escriba basura en `payload` aunque el contenido cifrado
     * siga siendo indescifrable para nosotros.
     */
    protected static function booted(): void
    {
        self::saving(function (self $event): void {
            if (! EnvelopeValidator::isValid($event->payload)) {
                throw new LogicException('events.payload no tiene forma de sobre cifrado válido.');
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
}
