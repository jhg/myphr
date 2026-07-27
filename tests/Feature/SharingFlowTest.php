<?php

declare(strict_types=1);

use App\Filament\Pages\Sharing;
use App\Models\Event;
use App\Models\User;
use App\Security\Opaque\Base64Url;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Livewire;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    config()->set('share.decoy_salt_key', Base64Url::encode(str_repeat("\x2a", 32)));
});

/**
 * The sharing screen, walked the way the browser walks it, over the transport the browser is told
 * to use.
 *
 * `ShareRoundTripTest` already proves the crypto seam, but it starts from events it makes up. The
 * step it never exercises is the first one — reading the history through `$wire.fetchEvents` — and
 * that is precisely the one that broke in production: Livewire advertised an update endpoint that
 * the server rejected with a 404, so `loadHistory` failed and the screen blamed the encryption.
 *
 * So this test does not call `Livewire::test()->call('fetchEvents')`, which would bypass the routing
 * entirely and keep passing while production burned. It reads `getUpdateUri()` — the very URI that
 * ends up in `data-update-uri` — and posts a real Livewire message to it.
 */
it('shares a clipping end to end, from reading the history over Livewire to the reader opening it', function (): void {
    $user = User::factory()->registered()->create();
    $masterKey = Base64Url::encode(random_bytes(32));

    /** 1. Three real envelopes, sealed by the browser's own code under the account's master key. */
    $occurredAt = collect([2, 1, 0])->map(
        static fn (int $hoursAgo): string => now()->subHours($hoursAgo)->utc()->format('Y-m-d\TH:i:s.u\Z'),
    );

    $sealedEvents = runShareClient('sealEvents', [
        'masterKey' => $masterKey,
        'userId' => $user->id,
        'events' => $occurredAt->map(static fn (string $at, int $index): array => [
            'occurredAt' => $at,
            'content' => [
                'v' => 1,
                'type' => 'glucose',
                'tz' => '+00:00',
                'data' => ['value' => (string) (95 + $index), 'unit' => 'mg/dL', 'loinc' => '41653-7'],
            ],
        ])->values()->all(),
    ])['result']['events'];

    foreach ($sealedEvents as $event) {
        Event::query()->create([
            'user_id' => $user->id,
            'occurred_at' => $event['occurredAt'],
            'payload' => $event['payload'],
        ]);
    }

    /** 2. The screen reads them back over the endpoint the page hands to the browser. */
    $snapshot = Livewire::actingAs($user)->test(Sharing::class)->assertOk()->snapshot;

    $update = $this->actingAs($user)->postJson(
        app('livewire')->getUpdateUri(),
        ['components' => [[
            'snapshot' => json_encode($snapshot, JSON_THROW_ON_ERROR),
            'updates' => [],
            'calls' => [['path' => '', 'method' => 'fetchEvents', 'params' => [null, 250, null, null]]],
        ]]],
        ['X-Livewire' => '1'],
    )->assertOk();

    $rawEvents = $update->json('components.0.effects.returns.0');

    expect($rawEvents)->toHaveCount(3);

    /** 3. The clipping is built out of exactly those envelopes, with the screen's own functions. */
    $stretched = Base64Url::encode(random_bytes(32));

    $client = runShareClient('sealFetched', [
        'masterKey' => $masterKey,
        'userId' => $user->id,
        'stretched' => $stretched,
        'ttlHours' => 24,
        'types' => ['glucose' => true],
        'range' => ['from' => null, 'to' => null],
        'rawEvents' => $rawEvents,
    ])['result'];

    /** 4. Upload, and then the professional's side: challenge, open with the PIN, decrypt. */
    $this->actingAs($user)
        ->postJson(route('filament.phr.shares.store'), $client['request'])
        ->assertCreated();

    $this->postJson(route('share.challenge', ['link' => $client['linkId']]))
        ->assertOk()
        ->assertJsonPath('pinSalt', $client['pinSalt']);

    $opened = json_decode(
        (string) $this->postJson(
            route('share.open', ['link' => $client['linkId']]),
            ['pinTag' => $client['pinTag']],
        )->assertOk()->getContent(),
        true,
        512,
        JSON_THROW_ON_ERROR,
    );

    $read = runShareClient('open', [
        'stretched' => $stretched,
        'pinSalt' => $client['pinSalt'],
        'fragment' => $client['fragment'],
        'linkId' => $client['linkId'],
        'opened' => $opened,
    ])['result'];

    /**
     * The assertion that matters is not the count but the numbers: a clipping that opens while
     * carrying the wrong readings would pass a count and would be worse than one that fails.
     */
    expect($read['eventCount'])->toBe(3)
        ->and(collect($read['contents'])->pluck('content.data.value')->sort()->values()->all())
        ->toBe(['95', '96', '97'])
        ->and($read['includedTypes'])->toBe(['glucose'])
        /** The five types left out travel written down, never implied (ADR 0011). */
        ->and($read['excludedTypes'])->toHaveCount(count(Sharing::SHAREABLE_TYPES) - 1);
});
