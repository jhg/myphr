<?php

declare(strict_types=1);

use App\Crypto\CanonicalDate;
use App\Http\Controllers\Sharing\IssueShareLinkController;
use App\Http\Controllers\Sharing\ListSharesController;
use App\Http\Controllers\Sharing\StoreShareController;
use App\Models\Share;
use App\Models\ShareLink;
use App\Models\User;
use App\Security\Opaque\Base64Url;
use Database\Factories\ShareFactory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    config()->set('share.decoy_salt_key', Base64Url::encode(str_repeat("\x2a", 32)));

    Route::middleware('auth')->group(function (): void {
        Route::get('/test/phr/shares', ListSharesController::class);
        Route::post('/test/phr/shares', StoreShareController::class);
        Route::post('/test/phr/shares/{share}/links', IssueShareLinkController::class);
    });
});

/**
 * Creation body with an expiry carrying a fraction of a second, like the one the browser's
 * `new Date()` produces.
 *
 * @return array{body: array<string, mixed>, canonical: string, linkId: string, pinTag: string}
 */
function shareBodyWithFractionalExpiry(): array
{
    $expiresAt = Carbon::now()->addDay()->startOfSecond()->addMilliseconds(123);
    $canonical = CanonicalDate::format($expiresAt);

    $linkId = (string) Str::uuid();
    $pinTag = random_bytes(ShareLink::PIN_TAG_BYTES);

    return [
        'body' => [
            'id' => (string) Str::uuid(),
            'payload' => ShareFactory::fakePackage(),
            'descriptor' => ShareFactory::fakeEnvelope(),
            'expiresAt' => $canonical,
            'link' => [
                'id' => $linkId,
                'pinSalt' => Base64Url::encode(random_bytes(ShareLink::PIN_SALT_BYTES)),
                'pinTag' => Base64Url::encode($pinTag),
                'wrapper' => ShareFactory::fakeEnvelope(),
            ],
        ],
        'canonical' => $canonical,
        'linkId' => $linkId,
        'pinTag' => $pinTag,
    ];
}

/**
 * Reproduces the real reader failure: correct PIN and a "history tampered with or incomplete"
 * warning.
 *
 * `canonicalDate(expiresAt)` goes into the `info` of `wrapKey` and into the wrapper's associated
 * data (ADR 0011). The client computes it over a `new Date()`, which carries milliseconds, and sends
 * it as is; `open` has to return **the same string**, byte for byte, or the wrapper does not open
 * and the reader shows `reader.error.tampered`.
 */
it('returns in open the same canonical expiresAt the client encrypted with', function (): void {
    $user = User::factory()->registered()->create();

    /** An instant with milliseconds, like the browser's `new Date()`. */
    ['body' => $body, 'canonical' => $canonical, 'linkId' => $linkId, 'pinTag' => $pinTag] = shareBodyWithFractionalExpiry();

    $this->actingAs($user)->postJson('/test/phr/shares', $body)->assertCreated();

    $opened = $this->postJson("/s/{$linkId}/open", ['pinTag' => Base64Url::encode($pinTag)])
        ->assertOk()
        ->getContent();

    expect(json_decode((string) $opened, true)['expiresAt'])->toBe($canonical);
});

/**
 * A sibling of the same failure, one hop further out: `open` is not the only place that date comes
 * back from the engine to take part in an AEAD.
 *
 * Re-arming a link (`POST /phr/shares/{share}/links`) forces the client to derive `wrapKey` with
 * `canonicalDate(expiresAt)`, and it does not have that expiry: it reads it from the listing, which
 * gets it from the database. If the listing returned it truncated, the re-armed link would be born
 * encrypted with a key the reader cannot derive —the server would hand it the full date in `open`—
 * and the professional would see "history tampered with" with the correct PIN, just as in the
 * original bug. The re-arm screen does not exist in the client yet, so this test is the only thing
 * holding that seam up today.
 */
it('returns the same canonical expiry in the listing and in the re-armed link', function (): void {
    $user = User::factory()->registered()->create();

    ['body' => $body, 'canonical' => $canonical] = shareBodyWithFractionalExpiry();

    $this->actingAs($user)->postJson('/test/phr/shares', $body)->assertCreated();

    $listed = $this->actingAs($user)->getJson('/test/phr/shares')
        ->assertOk()
        ->json('shares.0');

    expect($listed['expiresAt'])->toBe($canonical)
        ->and($listed['links'][0]['expiresAt'])->toBe($canonical);

    /** The new link inherits the expiry of the re-read clipping, so it is the same round trip. */
    $this->actingAs($user)
        ->postJson("/test/phr/shares/{$body['id']}/links", ['link' => shareBodyWithFractionalExpiry()['body']['link']])
        ->assertCreated()
        ->assertJsonPath('expiresAt', $canonical);

    $stored = Share::query()->findOrFail($body['id'])->links()->get();

    expect($stored->map(fn (ShareLink $link): string => CanonicalDate::format($link->expires_at))->all())
        ->toBe([$canonical, $canonical]);
});
