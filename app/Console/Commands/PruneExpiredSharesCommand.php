<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Models\Share;
use App\Models\ShareLink;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;

/**
 * Purga de recortes compartidos caducados (ADR 0011), hermana de `opaque:prune-handshakes`.
 *
 * Es **solo higiene de almacenamiento**, y conviene que quede escrito: la caducidad ya se aplica en
 * la consulta que sirve el blob (`where('expires_at','>',now())`, como
 * `RegistrationLinks::validate()`), así que si el planificador se cae no se alarga la vida de nada.
 * Lo que esta purga evita es que un paquete de hasta 4 MiB siga ocupando disco meses después de
 * haber dejado de servir para nada.
 *
 * Aquí no hay margen de retención como el de `user_registration_links`. Aquel guarda `consumed_at` y
 * `created_by`, que son señal de auditoría; estas dos tablas no tienen ninguna señal que conservar:
 * el rastro de que hubo una compartición vive en `AuditEvent` y no en la fila. Retenerlas sin motivo
 * sería mantener vivo un blob cifrado que ya nadie puede abrir.
 *
 * Borrar el recorte se lleva sus enlaces por la clave foránea en cascada. Los enlaces se purgan
 * además por su cuenta porque pueden caducar antes que su recorte si alguna vez dejan de heredar su
 * fecha, y una purga que dependa de que eso nunca pase es una purga que se rompe en silencio.
 */
#[Signature('shares:prune')]
#[Description('Purga los recortes compartidos y los enlaces cuya caducidad ya pasó.')]
final class PruneExpiredSharesCommand extends Command
{
    public function handle(): int
    {
        $now = Carbon::now();

        $links = ShareLink::query()->where('expires_at', '<', $now)->delete();
        $shares = Share::query()->where('expires_at', '<', $now)->delete();

        $this->components->info("Enlaces de compartición purgados: {$links}.");
        $this->components->info("Recortes compartidos purgados: {$shares}.");

        return self::SUCCESS;
    }
}
