<?php

declare(strict_types=1);

namespace App\Provisioning;

use App\Models\User;
use RuntimeException;

/**
 * Reissue on an account that already has access, without the explicit confirmation
 * Spec 0001 §3.4 requires.
 *
 * Completing a new registration retires the current master key envelope: anyone who remembered the
 * previous password loses the ability to open their data. That is why the confirmation is not a
 * generic "yes" but typing the account email.
 */
final class RegistrationLinkReissueRequiresConfirmationException extends RuntimeException
{
    public static function for(User $user): self
    {
        return new self(
            'Account '.$user->email.' already has access: reissuing a link requires typing its email as confirmation.'
        );
    }
}
