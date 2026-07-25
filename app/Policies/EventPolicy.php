<?php

declare(strict_types=1);

namespace App\Policies;

use App\Models\Event;
use App\Models\User;

/**
 * Autorización de eventos clínicos (ADR 0006).
 *
 * El criterio central es la propiedad: un usuario solo ve, crea, edita o borra sus propios
 * eventos. `create` no tiene un `Event` previo con el que comparar dueño, así que usa el mismo
 * criterio de «cuenta usable» que {@see UserPolicy}: el registro OPAQUE completo. Sin él, la
 * cuenta no tiene clave maestra con la que el cliente pueda cifrar el primer sobre.
 */
final readonly class EventPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasCompletedOpaqueRegistration();
    }

    public function view(User $user, Event $model): bool
    {
        return $user->id === $model->user_id;
    }

    public function create(User $user): bool
    {
        return $user->hasCompletedOpaqueRegistration();
    }

    public function update(User $user, Event $model): bool
    {
        return $user->id === $model->user_id;
    }

    public function delete(User $user, Event $model): bool
    {
        return $user->id === $model->user_id;
    }

    public function restore(User $user, Event $model): bool
    {
        return $user->id === $model->user_id;
    }

    public function forceDelete(User $user, Event $model): bool
    {
        return $user->id === $model->user_id;
    }
}
