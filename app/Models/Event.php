<?php

declare(strict_types=1);

namespace App\Models;

use App\Crypto\EnvelopeValidator;
use App\Support\AuditEvent;
use Database\Factories\EventFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use LogicException;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;

/**
 * ADR 0006: un evento clínico es un sobre cifrado con solo las columnas en claro que el servidor
 * necesita para autorizar y paginar (`user_id`, `occurred_at`, `id`). No hay columna de tipo en
 * claro a propósito: si la hubiera, el esquema revelaría qué registra el usuario sin descifrar nada.
 */
#[Fillable(['user_id', 'occurred_at', 'payload'])]
final class Event extends Model
{
    /** @use HasFactory<EventFactory> */
    use HasFactory, HasUuids, LogsActivity, SoftDeletes;

    /**
     * Nombre del log de las transiciones del ciclo de vida, separado del de la cuenta
     * ({@see AuditEvent::LOG_NAME}) para poder consultarlos por separado.
     */
    public const LOG_NAME = 'health-event';

    /**
     * El rastro va en el modelo y no en las páginas que escriben, para que ninguna vía de borrado
     * futura se quede sin anotar por olvido: cualquiera que pase por Eloquent queda registrada.
     *
     * `forceDeleted` no está entre los eventos que Spatie graba por defecto, y aquí hace falta
     * porque el objetivo distingue entre marcar para borrar y borrar de verdad.
     *
     * @var array<int, string>
     */
    protected static array $recordEvents = ['created', 'updated', 'deleted', 'restored', 'forceDeleted'];

    /**
     * Sin atributos y sin propiedades, a propósito.
     *
     * `LogOptions::defaults()` no registra ni los `fillable` ni los `unguarded`, así que la fila
     * anota el verbo, el sujeto, quién lo causó y la fecha, y nada más. Es lo único honesto que se
     * puede guardar: `payload` es un sobre cifrado que el servidor no puede leer, y copiarlo al
     * registro solo duplicaría texto cifrado y multiplicaría el sitio del que habría que borrarlo.
     */
    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()
            ->useLogName(self::LOG_NAME)
            ->setDescriptionForEvent(function (string $eventName): string {
                /**
                 * Un borrado definitivo dispara `deleted` y después `forceDeleted`, así que sin esto
                 * quedarían dos filas para una sola acción. Una descripción vacía es la forma que
                 * tiene el paquete de saltarse una entrada.
                 */
                if ($eventName === 'deleted' && $this->isForceDeleting()) {
                    return '';
                }

                return $eventName;
            });
    }

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
