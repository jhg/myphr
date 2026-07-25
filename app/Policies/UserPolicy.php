<?php

declare(strict_types=1);

namespace App\Policies;

use App\Models\User;
use App\Provisioning\RegistrationLinks;

/**
 * Autorización de la gestión de usuarios (Spec 0001 §10, ADR 0009).
 *
 * El único criterio es tener el registro OPAQUE completo: cualquier criterio que dependa de que
 * otro usuario apruebe deja al primero sin quien lo apruebe (ADR 0009). Es el mismo criterio que
 * `canAccessPanel()`, deliberadamente, para que no haya dos definiciones de «cuenta usable».
 *
 * No hay `update` ni `delete`: el login normalizado queda fijo una vez la cuenta está registrada,
 * porque el identificador de credencial se derivó de él y cambiarlo dejaría el sobre de la clave
 * maestra irrecuperable (ADR 0009). Cambiar la contraseña de alguien tampoco es una edición: es la
 * reemisión del enlace, con la pérdida de historial que describe ese mismo ADR.
 */
final readonly class UserPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasCompletedOpaqueRegistration();
    }

    public function view(User $user, User $model): bool
    {
        return $user->hasCompletedOpaqueRegistration();
    }

    public function create(User $user): bool
    {
        return $user->hasCompletedOpaqueRegistration();
    }

    /**
     * Reemitir el enlace de registro de otra cuenta (Spec 0001 §3.4).
     *
     * La confirmación explícita que exige una cuenta con acceso no vive aquí, sino en
     * {@see RegistrationLinks}: esto solo decide quién puede intentarlo.
     */
    public function issueRegistrationLink(User $user, User $model): bool
    {
        return $user->hasCompletedOpaqueRegistration();
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
