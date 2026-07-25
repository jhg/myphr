<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Models\User;
use App\Provisioning\RegistrationLinkReissueRequiresConfirmationException;
use App\Provisioning\RegistrationLinks;
use App\Security\Opaque\LoginNormalizer;
use App\Support\Terminal;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

/**
 * Emite un enlace de registro de un solo uso (Spec 0001 §10, ADR 0009).
 *
 * Es el comando que crea el primer usuario del sistema, el que luego podrá dar de
 * alta a los demás desde el panel. Crea la fila de usuario si no existe, sin
 * contraseña y sin clave: la clave maestra nace en el navegador de esa persona
 * cuando abre el enlace (Spec 0001 §5).
 *
 * La URL se **imprime por pantalla y nada más**: no se envía por correo ni se
 * escribe en ningún fichero (ADR 0009). Por eso aborta si la salida no es un
 * terminal interactivo, para que no acabe en un log de despliegue o de cron.
 *
 * Nunca acepta ni imprime contraseñas.
 */
#[Signature('phr:issue-registration-link {email : Email de la persona, se normaliza antes de guardarlo} {--name= : Nombre para mostrar, solo se usa al crear la cuenta}')]
#[Description('Crea la cuenta si no existe y emite un enlace de registro de un solo uso, imprimiéndolo por pantalla.')]
final class IssueRegistrationLinkCommand extends Command
{
    /**
     * @return int Código de salida: 0 si se emitió, 1 en cualquier otro caso.
     */
    public function handle(RegistrationLinks $links, Terminal $terminal): int
    {
        if (! $terminal->isInteractive()) {
            $this->components->error(
                'La salida no es un terminal interactivo. El enlace no se imprime para que no acabe en un log.'
            );

            return self::FAILURE;
        }

        /** @var string $rawEmail */
        $rawEmail = $this->argument('email');
        $email = LoginNormalizer::normalize($rawEmail);

        if (validator(['email' => $email], ['email' => 'email'])->fails()) {
            $this->components->error("«{$rawEmail}» no es un email válido.");

            return self::FAILURE;
        }

        $user = User::query()->where('email', $email)->first();

        if (! $user instanceof User) {
            /** @var string|null $name */
            $name = $this->option('name');

            $user = User::create([
                'name' => $name === null || trim($name) === '' ? $email : trim($name),
                'email' => $email,
            ]);

            $this->components->info("Cuenta creada: {$user->email}");
        }

        $url = $this->issue($links, $user);

        if ($url === null) {
            return self::FAILURE;
        }

        $this->printLink($url);

        return self::SUCCESS;
    }

    /**
     * Emite el enlace y, si la cuenta ya tiene acceso, pide la confirmación explícita
     * que exige el servicio (Spec 0001 §3.4). La guardia no se replica aquí: el comando
     * solo recoge el email tecleado y se lo pasa al servicio, que vuelve a decidir.
     *
     * @return string|null La URL, o `null` si la reemisión no se confirmó.
     */
    private function issue(RegistrationLinks $links, User $user): ?string
    {
        try {
            return $links->issueFor($user);
        } catch (RegistrationLinkReissueRequiresConfirmationException $exception) {
            $this->newLine();
            $this->components->warn($exception->getMessage());
            $this->components->bulletList([
                'Al completarse el registro nuevo, el sobre vigente de su clave maestra queda retirado.',
                'Quien recordase la contraseña anterior dejará de poder abrir sus datos.',
                'No hay recuperación: en esta fase no existe escrow (ADR 0002).',
            ]);

            if (! $this->input->isInteractive()) {
                $this->components->error(
                    'Sin interacción no hay confirmación posible. No se ha emitido ningún enlace.'
                );

                return null;
            }

            /** @var string|null $typed */
            $typed = $this->ask('Teclea el email de la cuenta para confirmar la reemisión');
        }

        try {
            return $links->issueFor($user, confirmation: $typed);
        } catch (RegistrationLinkReissueRequiresConfirmationException) {
            $this->components->error('Confirmación incorrecta. No se ha emitido ningún enlace.');

            return null;
        }
    }

    /**
     * Imprime la URL. Es la única copia del token en claro que existirá nunca.
     */
    private function printLink(string $url): void
    {
        $this->newLine();
        $this->line($url);
        $this->newLine();

        $this->components->info('Cópialo ahora: el token no se guarda y no se puede volver a mostrar.');
        $this->components->bulletList([
            'Caduca en '.RegistrationLinks::TTL_HOURS.' horas y sirve una sola vez.',
            'Hazlo llegar por el canal que elijas: la aplicación nunca lo envía.',
            'La parte tras «#» no viaja al servidor salvo dentro de la petición de registro.',
        ]);
    }
}
