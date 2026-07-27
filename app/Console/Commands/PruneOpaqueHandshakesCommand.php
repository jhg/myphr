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
 * Scheduled pruning of expired rows in the session bootstrap tables (Spec 0001 §3.2, §9, §11;
 * `docs/OPAQUE.md` §14.3).
 *
 * Every unauthenticated `POST /phr/auth/opaque/login/start` inserts a row into
 * `opaque_login_handshakes`; without pruning, anyone outside drives the growth of that table. The
 * same applies to `opaque_registrations`, which piles up pending rows that never call
 * `registration/finish`. Both are pruned by expired `expires_at` alone: once expired, the row is no
 * use to any flow, so no extra margin is needed.
 *
 * `user_registration_links` is different: `consumed_at` and `created_by` are an audit signal (who
 * issued the link and when it was used), so a consumed or expired link is not deleted right away,
 * only once it is also old enough. The spec (§3.3) does not fix that margin, it only asks for "a
 * certain age"; it is set explicitly here in {@see self::LINK_RETENTION_DAYS}, a decision of this
 * implementation and not a hidden default.
 */
#[Signature('opaque:prune-handshakes')]
#[Description('Purga handshakes de login, registros OPAQUE pendientes y enlaces de registro caducados o consumidos con cierta antigüedad.')]
final class PruneOpaqueHandshakesCommand extends Command
{
    /**
     * Minimum age, in days, to prune a registration link that was consumed or has expired.
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
