<?php

declare(strict_types=1);

namespace App\Console\Commands;

use Illuminate\Console\Command;

/**
 * Replaces `make:filament-user` and its aliases, which Spec 0001 §9 disables.
 *
 * The original command asks for `--password` and calls `Hash::make()` on the server. In this
 * project that would produce an account that looks valid and is not: no OPAQUE registration, no
 * master key and unable to encrypt anything, because the master key is only born in the browser
 * (Spec 0001 §5).
 *
 * It is registered after the Filament provider, so its name and its two aliases end up taken by
 * this class. The only signup flow available is {@see IssueRegistrationLinkCommand} and the
 * equivalent action in the panel.
 */
final class ProhibitedMakeFilamentUserCommand extends Command
{
    protected $signature = 'make:filament-user';

    protected $description = 'Deshabilitado en este proyecto: usa phr:issue-registration-link (Spec 0001 §9).';

    /**
     * @var array<string>
     */
    protected $aliases = [
        'filament:make-user',
        'filament:user',
    ];

    /**
     * @return int Always failure: no account is created.
     */
    public function handle(): int
    {
        $this->components->error('make:filament-user está deshabilitado (Spec 0001 §9).');
        $this->components->bulletList([
            'Crearía una cuenta con contraseña hasheada en el servidor, sin registro OPAQUE y sin clave maestra.',
            'Esa cuenta no puede cifrar ni descifrar nada: la clave maestra solo nace en el navegador.',
            'Usa «php artisan phr:issue-registration-link <email> --name=«Nombre»» o el alta del panel.',
        ]);

        return self::FAILURE;
    }

    /**
     * The command exists only to occupy the name; there is no point offering it in the help.
     */
    public function isHidden(): bool
    {
        return true;
    }
}
