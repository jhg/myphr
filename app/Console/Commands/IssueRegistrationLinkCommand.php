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
 * Issues a single-use registration link (Spec 0001 §10, ADR 0009).
 *
 * It is the command that creates the first user of the system, the one who can
 * later sign the others up from the panel. It creates the user row if it does
 * not exist, with no password and no key: the master key is born in that
 * person's browser when they open the link (Spec 0001 §5).
 *
 * The URL is **printed on screen and nowhere else**: it is not emailed and not
 * written to any file (ADR 0009). That is why it aborts if the output is not an
 * interactive terminal, so it does not end up in a deployment or cron log.
 *
 * It never accepts or prints passwords.
 */
#[Signature('phr:issue-registration-link {email : Email de la persona, se normaliza antes de guardarlo} {--name= : Nombre para mostrar, solo se usa al crear la cuenta}')]
#[Description('Crea la cuenta si no existe y emite un enlace de registro de un solo uso, imprimiéndolo por pantalla.')]
final class IssueRegistrationLinkCommand extends Command
{
    /**
     * @return int Exit code: 0 if the link was issued, 1 in any other case.
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
     * Issues the link and, if the account already has access, asks for the explicit confirmation
     * the service requires (Spec 0001 §3.4). The guard is not duplicated here: the command only
     * collects the typed email and hands it to the service, which decides again.
     *
     * @return string|null The URL, or `null` if the reissue was not confirmed.
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
     * Prints the URL. It is the only copy of the plaintext token that will ever exist.
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
