<?php

declare(strict_types=1);

use App\Models\Share;
use App\Models\ShareLink;
use App\Security\Opaque\Base64Url;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

/** ADR 0011: the pruning of expired clippings is scheduled, like the OPAQUE handshake one. */
it('schedules the clipping pruning every hour', function (): void {
    $events = collect(app(Schedule::class)->events())
        ->filter(fn ($event) => str_contains($event->command ?? '', 'shares:prune'));

    expect($events)->not->toBeEmpty()
        ->and($events->first()->expression)->toBe('0 * * * *');
});

it('deletes expired clippings and links and leaves the live ones', function (): void {
    $live = Share::factory()->create();
    ShareLink::factory()->for($live)->create();

    $dead = Share::factory()->expired()->create();
    ShareLink::factory()->for($dead)->expired()->create();

    $this->artisan('shares:prune')->assertSuccessful();

    expect(Share::query()->pluck('id')->all())->toBe([$live->id])
        ->and(ShareLink::query()->count())->toBe(1);
});

/**
 * Pruning is storage hygiene only: expiry is already enforced in the query that serves the blob, so
 * a scheduler that is down extends nothing's lifetime. This test pins it down: without pruning, an
 * expired clipping still cannot be read.
 */
it('extends nothing lifetime if the pruning never runs', function (): void {
    config()->set('share.decoy_salt_key', Base64Url::encode(random_bytes(32)));

    $share = Share::factory()->expired()->create();
    $link = ShareLink::factory()->for($share)->create();

    expect(Share::query()->whereKey($share->id)->exists())->toBeTrue();

    $this->postJson("/s/{$link->id}/open", [
        'pinTag' => Base64Url::encode(random_bytes(32)),
    ])->assertStatus(403);
});
