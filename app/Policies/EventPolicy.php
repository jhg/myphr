<?php

declare(strict_types=1);

namespace App\Policies;

use App\Models\Event;
use App\Models\User;

/**
 * Authorization of clinical events (ADR 0006).
 *
 * The central criterion is ownership: a user only sees, creates, edits or deletes their own events.
 * `create` has no previous `Event` to compare owners against, so it uses the same "usable account"
 * criterion as {@see UserPolicy}: a completed OPAQUE registration. Without it, the account has no
 * master key for the client to encrypt the first envelope with.
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
