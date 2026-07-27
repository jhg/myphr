<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

/**
 * Spec 0001 §3.2, §11: scheduled pruning of expired login handshakes and pending OPAQUE
 * registrations, plus registration links that expired or were consumed a while ago. The frequency is
 * high (ten minutes) because the handshake TTL is only 180 seconds (`docs/OPAQUE.md` §14.3): without
 * pruning, every unauthenticated login attempt grows the table without bound.
 */
Schedule::command('opaque:prune-handshakes')->everyTenMinutes();

/**
 * ADR 0011: pruning of expired shared clippings.
 *
 * Hourly and not every ten minutes because, unlike handshakes, there is no urgency here: expiry is
 * already enforced in the query that serves the blob, so nobody can read an expired row even while
 * it sits in the table. This only frees disk, and the shortest TTL in the closed list is one hour,
 * so that is the natural pace.
 */
Schedule::command('shares:prune')->hourly();
