<?php

declare(strict_types=1);

use Illuminate\Console\Scheduling\Schedule;

/**
 * `routes/console.php` (Spec 0001 §3.2, §11): the OPAQUE handshake pruning has to be scheduled in
 * Laravel's `Schedule`.
 */
it('schedules the OPAQUE handshake pruning every ten minutes', function (): void {
    $schedule = app(Schedule::class);

    $events = collect($schedule->events())
        ->filter(fn ($event) => str_contains($event->command ?? '', 'opaque:prune-handshakes'));

    expect($events)->not->toBeEmpty();

    $event = $events->first();

    expect($event->expression)->toBe('*/10 * * * *');
});
