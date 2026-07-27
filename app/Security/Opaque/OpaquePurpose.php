<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * What an ephemeral OPAQUE state row was born for.
 *
 * It exists because password change reuses the same two tables as signup and login, and without
 * this discrimination a login handshake could be traded for a password change ticket, and a pending
 * row born in a password change could slip through `registration/finish`, which would consume a
 * registration link and rewrite the encrypted settings.
 *
 * The values are the ones already stored in the database: changing them means migrating live rows.
 */
enum OpaquePurpose: string
{
    /** Pending registration born from a signup link (Spec 0001 §4.1). */
    case Registration = 'registration';

    /** Ordinary login handshake (Spec 0001 §4.3). */
    case Login = 'login';

    /** Reauthentication or re-registration inside a password change. */
    case PasswordChange = 'password-change';
}
