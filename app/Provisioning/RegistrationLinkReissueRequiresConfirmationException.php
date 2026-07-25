<?php

declare(strict_types=1);

namespace App\Provisioning;

use App\Models\User;
use RuntimeException;

/**
 * Reemisión sobre una cuenta que ya tiene acceso, sin la confirmación explícita
 * que exige la Spec 0001 §3.4.
 *
 * Completar un registro nuevo retira el sobre vigente de la clave maestra: quien
 * recordara la contraseña anterior deja de poder abrir sus datos. Por eso la
 * confirmación no es un «sí» genérico, sino teclear el email de la cuenta.
 */
final class RegistrationLinkReissueRequiresConfirmationException extends RuntimeException
{
    public static function for(User $user): self
    {
        return new self(
            'La cuenta '.$user->email.' ya tiene acceso: reemitir un enlace exige teclear su email como confirmación.'
        );
    }
}
