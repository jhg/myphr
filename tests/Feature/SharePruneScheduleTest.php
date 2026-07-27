<?php

declare(strict_types=1);

use App\Models\Share;
use App\Models\ShareLink;
use App\Security\Opaque\Base64Url;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

/** ADR 0011: la purga de recortes caducados va programada, como la de handshakes de OPAQUE. */
it('programa la purga de recortes cada hora', function (): void {
    $events = collect(app(Schedule::class)->events())
        ->filter(fn ($event) => str_contains($event->command ?? '', 'shares:prune'));

    expect($events)->not->toBeEmpty()
        ->and($events->first()->expression)->toBe('0 * * * *');
});

it('borra los recortes y enlaces caducados y deja los vivos', function (): void {
    $live = Share::factory()->create();
    ShareLink::factory()->for($live)->create();

    $dead = Share::factory()->expired()->create();
    ShareLink::factory()->for($dead)->expired()->create();

    $this->artisan('shares:prune')->assertSuccessful();

    expect(Share::query()->pluck('id')->all())->toBe([$live->id])
        ->and(ShareLink::query()->count())->toBe(1);
});

/**
 * La purga es solo higiene de almacenamiento: la caducidad ya se aplica en la consulta que sirve el
 * blob, así que un planificador caído no alarga la vida de nada. Este test lo fija: sin purgar, un
 * recorte caducado sigue sin poder leerse.
 */
it('no alarga la vida de nada si la purga no llega a ejecutarse', function (): void {
    config()->set('share.decoy_salt_key', Base64Url::encode(random_bytes(32)));

    $share = Share::factory()->expired()->create();
    $link = ShareLink::factory()->for($share)->create();

    expect(Share::query()->whereKey($share->id)->exists())->toBeTrue();

    $this->postJson("/s/{$link->id}/open", [
        'pinTag' => Base64Url::encode(random_bytes(32)),
    ])->assertStatus(403);
});
