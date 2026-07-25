<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Models\OpaqueLoginHandshake;
use App\Models\OpaqueRegistration;
use App\Models\UserRegistrationLink;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;

/**
 * Purga programada de filas caducadas de las tablas de arranque de sesión (Spec 0001 §3.2, §9, §11;
 * `docs/OPAQUE.md` §14.3).
 *
 * Cada `POST /phr/auth/opaque/login/start` sin autenticar inserta una fila en
 * `opaque_login_handshakes`; sin purga, el crecimiento de esa tabla lo dirige cualquiera desde fuera.
 * Lo mismo aplica a `opaque_registrations`, que acumula pendientes que nunca llaman a
 * `registration/finish`. Ambas se purgan solo por `expires_at` vencido: una vez caducada, la fila ya
 * no sirve a ningún flujo, así que no hace falta margen adicional.
 *
 * `user_registration_links` es distinta: `consumed_at` y `created_by` son señal de auditoría (quién
 * emitió el enlace y cuándo se usó), así que un enlace consumido o caducado no se borra al instante,
 * solo cuando además tiene cierta antigüedad. La spec (§3.3) no fija ese margen, solo pide "cierta
 * antigüedad"; aquí se fija explícitamente en {@see self::LINK_RETENTION_DAYS}, una decisión propia
 * de esta implementación y no un valor por defecto oculto.
 */
#[Signature('opaque:prune-handshakes')]
#[Description('Purga handshakes de login, registros OPAQUE pendientes y enlaces de registro caducados o consumidos con cierta antigüedad.')]
final class PruneOpaqueHandshakesCommand extends Command
{
    /**
     * Antigüedad mínima, en días, para purgar un enlace de registro ya consumido o caducado.
     */
    private const int LINK_RETENTION_DAYS = 30;

    public function handle(): int
    {
        $now = Carbon::now();

        $handshakes = OpaqueLoginHandshake::query()->where('expires_at', '<', $now)->delete();

        $registrations = OpaqueRegistration::query()->where('expires_at', '<', $now)->delete();

        $retentionCutoff = $now->clone()->subDays(self::LINK_RETENTION_DAYS);

        $links = UserRegistrationLink::query()
            ->where(function ($query) use ($retentionCutoff): void {
                $query->where('consumed_at', '<', $retentionCutoff)
                    ->orWhere(function ($query) use ($retentionCutoff): void {
                        $query->whereNull('consumed_at')->where('expires_at', '<', $retentionCutoff);
                    });
            })
            ->delete();

        $this->components->info("Handshakes de login purgados: {$handshakes}.");
        $this->components->info("Registros OPAQUE pendientes purgados: {$registrations}.");
        $this->components->info("Enlaces de registro purgados: {$links}.");

        return self::SUCCESS;
    }
}
