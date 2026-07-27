<?php

declare(strict_types=1);

namespace App\Policies;

use App\Models\User;
use App\Provisioning\RegistrationLinks;

/**
 * Authorization of user management (Spec 0001 §10, ADR 0009).
 *
 * The only criterion is having a completed OPAQUE registration: any criterion that depends on
 * another user approving leaves the first one with nobody to approve them (ADR 0009). It is
 * deliberately the same criterion as `canAccessPanel()`, so there are not two definitions of "usable
 * account".
 *
 * **User management is disabled.** The four permissions that opened it return a flat `false`, so the
 * resource does not appear in the navigation and does not answer by URL. Accounts are created by
 * public registration (ADR 0009) and links are issued by
 * `php artisan phr:issue-registration-link`, which does not go through this policy. That is the only
 * change to undo in order to open it again: return the criterion below here.
 *
 * The original criterion, `hasCompletedOpaqueRegistration()`, is left written in each method so it
 * is not lost, because it is the same one as `canAccessPanel()` and there are not two definitions of
 * "usable account".
 *
 * There is no `update` and no `delete`: the normalized login is fixed once the account is
 * registered, because the credential identifier was derived from it and changing it would leave the
 * master key envelope unrecoverable (ADR 0009). Changing somebody's password is not an edit either:
 * it is reissuing the link, with the loss of history that same ADR describes.
 */
final readonly class UserPolicy
{
    public function viewAny(User $user): bool
    {
        // Criterio original: $user->hasCompletedOpaqueRegistration();
        return false;
    }

    public function view(User $user, User $model): bool
    {
        // Criterio original: $user->hasCompletedOpaqueRegistration();
        return false;
    }

    public function create(User $user): bool
    {
        // Criterio original: $user->hasCompletedOpaqueRegistration();
        return false;
    }

    /**
     * Reissue another account's registration link (Spec 0001 §3.4).
     *
     * The explicit confirmation an account with access requires does not live here but in
     * {@see RegistrationLinks}: this only decides who may try.
     */
    public function issueRegistrationLink(User $user, User $model): bool
    {
        // Criterio original: $user->hasCompletedOpaqueRegistration();
        return false;
    }

    public function update(User $user, User $model): bool
    {
        return false;
    }

    public function delete(User $user, User $model): bool
    {
        return false;
    }

    public function restore(User $user, User $model): bool
    {
        return false;
    }

    public function forceDelete(User $user, User $model): bool
    {
        return false;
    }
}
