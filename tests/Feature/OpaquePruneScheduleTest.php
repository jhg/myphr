<?php

declare(strict_types=1);

use Illuminate\Console\Scheduling\Schedule;

/**
 * `routes/console.php` (Spec 0001 §3.2, §11): la purga de handshakes OPAQUE debe estar
 * programada en el `Schedule` de Laravel.
 */
it('programa la purga de handshakes OPAQUE cada diez minutos', function (): void {
    $schedule = app(Schedule::class);

    $events = collect($schedule->events())
        ->filter(fn ($event) => str_contains($event->command ?? '', 'opaque:prune-handshakes'));

    expect($events)->not->toBeEmpty();

    $event = $events->first();

    expect($event->expression)->toBe('*/10 * * * *');
});
