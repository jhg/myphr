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
 * Pruning of expired shared clippings (ADR 0011), sibling of `opaque:prune-handshakes`.
 *
 * It is **storage hygiene only**, and it is worth writing down: expiry is already enforced in the
 * query that serves the blob (`where('expires_at','>',now())`, like
 * `RegistrationLinks::validate()`), so if the scheduler goes down nothing lives any longer. What
 * this pruning avoids is a package of up to 4 MiB sitting on disk months after it stopped being
 * useful for anything.
 *
 * There is no retention window here like the one in `user_registration_links`. That table keeps
 * `consumed_at` and `created_by`, which are an audit signal; these two tables have no signal to
 * keep: the trail that a share happened lives in `AuditEvent` and not in the row. Retaining them
 * for no reason would mean keeping alive an encrypted blob nobody can open any more.
 *
 * Deleting the clipping takes its links with it through the cascading foreign key. The links are
 * also pruned on their own because they may expire before their clipping if they ever stop
 * inheriting its date, and a pruning that relies on that never happening is a pruning that breaks
 * silently.
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
