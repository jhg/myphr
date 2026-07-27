<?php

declare(strict_types=1);

use App\Models\Share;
use App\Models\ShareLink;
use App\Models\User;
use App\Security\Opaque\Base64Url;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

/**
 * End-to-end test of the shared clipping (ADR 0011).
 *
 * It encrypts with the real modules from `resources/js/crypto/` —the JavaScript half lives in
 * `tests/js/support/shareRoundTrip.mjs`— and puts the real database and the real HTTP routes in the
 * middle. It is the only place in the project where the full seam is checked: what the browser
 * encrypts has to be opened by the reader after the package, the wrapper and **the dates** have gone
 * through the server.
 *
 * It was born from a real bug: `expires_at` was stored without a fraction of a second, so
 * `canonicalDate(expiresAt)` was one string when encrypting and another when decrypting; since that
 * string goes into the `info` of `wrapKey` and into the wrapper's associated data, the AEAD failed
 * and the reader showed "history tampered with or incomplete" with the correct PIN. Neither the PHP
 * tests nor the JavaScript ones saw it, because each half was consistent with itself.
 */
beforeEach(function (): void {
    config()->set('share.decoy_salt_key', Base64Url::encode(str_repeat("\x2a", 32)));
});

/** `runShareClient()`, the bridge to the JavaScript half, lives in `tests/Pest.php`. */
it('encrypts a clipping in the browser and the reader opens it after a round trip through the server', function (): void {
    $user = User::factory()->registered()->create();

    /**
     * The PIN stretching goes in already done: Argon2id costs more than a second per side and
     * touches nothing of this seam, which is about the expiry and the identifiers. It is covered by
     * `tests/js/shareKeys.test.mjs`.
     */
    $stretched = Base64Url::encode(random_bytes(32));

    $sealed = runShareClient('seal', [
        'pin' => '048261',
        'stretched' => $stretched,
        'masterKey' => Base64Url::encode(random_bytes(32)),
        'ttlHours' => 24,
        'eventCount' => 7,
    ]);

    expect($sealed['ok'])->toBeTrue(json_encode($sealed));

    $client = $sealed['result'];

    $this->actingAs($user)
        ->postJson(route('filament.phr.shares.store'), $client['request'])
        ->assertCreated();

    /** The salt has to come back exactly as uploaded, or the reader would stretch the PIN with another. */
    $this->postJson(route('share.challenge', ['link' => $client['linkId']]))
        ->assertOk()
        ->assertJsonPath('pinSalt', $client['pinSalt']);

    $opened = $this->postJson(
        route('share.open', ['link' => $client['linkId']]),
        ['pinTag' => $client['pinTag']],
    )->assertOk();

    /** @var array<string, mixed> $body */
    $body = json_decode($opened->getContent(), true, 512, JSON_THROW_ON_ERROR);

    $read = runShareClient('open', [
        'stretched' => $stretched,
        'pinSalt' => $client['pinSalt'],
        'fragment' => $client['fragment'],
        'linkId' => $client['linkId'],
        'opened' => $body,
    ]);

    expect($read['ok'])->toBeTrue(json_encode($read));
    expect($read['result']['eventCount'])->toBe($client['eventCount']);
    expect($read['result']['events'])->toBe($client['eventCount']);

    /**
     * The seam, said out loud: the expiry the server returns has to be, byte for byte, the one the
     * client encrypted with. It comes after the decryption because the decryption is what really
     * matters, and it is here so that, if it breaks again, the failure says **what** broke and not
     * just that the envelope does not open.
     */
    expect($body['expiresAt'])->toBe($client['expiresAtSealed']);
});

/**
 * The full walk through the feature, in a single test and in the order it really happens: create,
 * list, open with the correct PIN, fail with a wrong one, burn the five attempts and revoke.
 *
 * The tests in `ShareEndpointsTest` and `ShareReadingTest` cover each step separately, with factory
 * packages and random proofs. This one goes after the case neither of them sees: that the six
 * chained steps still add up with **real encryption**, because the bug that started all this was not
 * in any single step but between two of them. That is why the decryption happens after a wrong-PIN
 * cycle: if consuming an attempt touched any of the pieces that go into the associated data, it
 * would show up here and nowhere else.
 */
it('walks through creating, listing, opening, failing the PIN, running out of attempts and revoking', function (): void {
    $user = User::factory()->registered()->create();

    $stretched = Base64Url::encode(random_bytes(32));

    $sealed = runShareClient('seal', [
        'pin' => '731904',
        'stretched' => $stretched,
        'masterKey' => Base64Url::encode(random_bytes(32)),
        'ttlHours' => 24,
        'eventCount' => 3,
    ]);

    expect($sealed['ok'])->toBeTrue(json_encode($sealed));

    $client = $sealed['result'];
    $linkId = $client['linkId'];

    /** 1. Crear. */
    $this->actingAs($user)
        ->postJson(route('filament.phr.shares.store'), $client['request'])
        ->assertCreated();

    /**
     * 2. Listing. The expiry that comes out of the listing has to be the one that was encrypted: it
     * is the one the screen would use to re-arm a link, and it comes from the database.
     */
    $this->actingAs($user)->getJson(route('filament.phr.shares.index'))
        ->assertOk()
        ->assertJsonPath('shares.0.id', $client['request']['id'])
        ->assertJsonPath('shares.0.expiresAt', $client['expiresAtSealed'])
        ->assertJsonPath('shares.0.links.0.attemptsRemaining', ShareLink::MAX_ATTEMPTS);

    $wrongPinTag = Base64Url::encode(random_bytes(ShareLink::PIN_TAG_BYTES));

    /** 3. A wrong PIN returns nothing and spends one attempt. */
    $this->postJson(route('share.open', ['link' => $linkId]), ['pinTag' => $wrongPinTag])
        ->assertForbidden();

    expect(ShareLink::query()->findOrFail($linkId)->attempts_remaining)
        ->toBe(ShareLink::MAX_ATTEMPTS - 1);

    /** 4. With the correct PIN the reader opens the package and the counter goes back to its cap. */
    $body = json_decode(
        (string) $this->postJson(
            route('share.open', ['link' => $linkId]),
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
        'linkId' => $linkId,
        'opened' => $body,
    ]);

    expect($read['ok'])->toBeTrue(json_encode($read))
        ->and($read['result']['eventCount'])->toBe($client['eventCount'])
        ->and(ShareLink::query()->findOrFail($linkId)->attempts_remaining)->toBe(ShareLink::MAX_ATTEMPTS);

    /** 5. Burning the five attempts deletes the link, and only the link. */
    for ($attempt = 0; $attempt < ShareLink::MAX_ATTEMPTS; $attempt++) {
        $this->postJson(route('share.open', ['link' => $linkId]), ['pinTag' => $wrongPinTag])
            ->assertForbidden();
    }

    expect(ShareLink::query()->whereKey($linkId)->exists())->toBeFalse()
        ->and(Share::query()->count())->toBe(1);

    /** Not even with the right PIN does it serve again: the row is gone. */
    $this->postJson(route('share.open', ['link' => $linkId]), ['pinTag' => $client['pinTag']])
        ->assertForbidden();

    /** 6. Revoking really deletes the clipping, with no tombstone. */
    $this->actingAs($user)
        ->deleteJson(route('filament.phr.shares.destroy', ['share' => $client['request']['id']]))
        ->assertOk();

    expect(Share::query()->count())->toBe(0);
});
