<?php

declare(strict_types=1);

namespace App\Console\Commands;

use Illuminate\Console\Command;

/**
 * Sustituye a `make:filament-user` y a sus alias, que la Spec 0001 §9 deshabilita.
 *
 * El comando original pide `--password` y hace `Hash::make()` en el servidor. En este proyecto eso
 * produciría una cuenta que parece válida y no lo es: sin registro OPAQUE, sin clave maestra e
 * incapaz de cifrar nada, porque la clave maestra solo nace en el navegador (Spec 0001 §5).
 *
 * Se registra después del proveedor de Filament, de forma que su nombre y sus dos alias quedan
 * ocupados por esta clase. El único flujo de alta disponible es
 * {@see IssueRegistrationLinkCommand} y la acción equivalente del panel.
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
     * @return int Siempre fallo: no se crea ninguna cuenta.
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
     * El comando existe solo para ocupar el nombre; no tiene sentido ofrecerlo en la ayuda.
     */
    public function isHidden(): bool
    {
        return true;
    }
}
