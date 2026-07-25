<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * Spec 0001 §3.4 / ADR 0009: sobre de la User Master Key. Tabla de solo añadir.
 *
 * Reemitir un enlace no puede sobrescribir el sobre que la contraseña anterior sabía abrir: se
 * inserta uno nuevo y el anterior queda retirado con su fecha. La única mutación admitida sobre una
 * fila existente es pasar `retired_at` de nulo a una fecha, una sola vez; nunca se borra ninguna fila.
 */
#[Fillable(['user_id', 'envelope'])]
final class UserMasterKeyEnvelope extends Model
{
    use HasUuids;

    /** Spec 0001 §3.4: la tabla solo tiene `created_at` y `retired_at`. */
    public const UPDATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'retired_at' => 'datetime',
        ];
    }

    /**
     * Guardias de solo añadir (Spec 0001 §3.4).
     *
     * Cubren el camino del modelo Eloquent. Una escritura directa con el constructor de consultas no
     * pasa por aquí, así que ningún otro sitio del código debe tocar esta tabla sin el modelo.
     */
    protected static function booted(): void
    {
        self::updating(function (self $envelope): void {
            $changed = array_keys($envelope->getDirty());

            if ($changed !== ['retired_at']) {
                throw new LogicException(
                    'user_master_key_envelopes es de solo añadir: no se puede actualizar '
                    .implode(', ', $changed).'.'
                );
            }

            if ($envelope->getRawOriginal('retired_at') !== null) {
                throw new LogicException(
                    'user_master_key_envelopes es de solo añadir: un sobre ya retirado no se vuelve a tocar.'
                );
            }
        });

        self::deleting(function (self $envelope): void {
            throw new LogicException('user_master_key_envelopes es de solo añadir: no se borran filas.');
        });
    }

    /**
     * Marca este sobre como retirado. Es la única mutación admitida sobre una fila existente.
     */
    public function retire(): bool
    {
        if ($this->getRawOriginal('retired_at') !== null) {
            throw new LogicException(
                'user_master_key_envelopes es de solo añadir: un sobre ya retirado no se vuelve a tocar.'
            );
        }

        $this->retired_at = $this->freshTimestamp();

        return $this->save();
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
