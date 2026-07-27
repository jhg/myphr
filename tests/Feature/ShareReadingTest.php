<?php

declare(strict_types=1);

use App\Models\Share;
use App\Models\ShareLink;
use App\Security\Opaque\Base64Url;
use App\Sharing\DecoySalt;
use App\Sharing\InvalidShareLinkException;
use App\Sharing\ShareLinkGate;
use App\Support\AuditEvent;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Spatie\Activitylog\Models\Activity;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    /**
     * The decoy salt hangs off a server key of its own and not off `APP_KEY` (ADR 0011). In the
     * tests it is set explicitly, because a dead link being indistinguishable from a live one
     * depends on it.
     */
    config()->set('share.decoy_salt_key', Base64Url::encode(str_repeat("\x2a", 32)));
});

/**
 * A live link with a known proof, so it can be opened. The real tag is computed by the client with
 * Argon2id over the PIN; the server only compares it, so 32 fixed bytes are enough here.
 *
 * @return array{0: ShareLink, 1: string}
 */
function liveShareLink(array $linkState = []): array
{
    $tag = random_bytes(ShareLink::PIN_TAG_BYTES);
    $link = ShareLink::factory()->create(array_replace(['pin_tag' => $tag], $linkState));

    return [$link, Base64Url::encode($tag)];
}

function openShare(string $linkId, string $pinTag): TestResponse
{
    return test()->postJson("/s/{$linkId}/open", ['pinTag' => $pinTag]);
}

it('returns the wrapper and the package only with the correct PIN', function (): void {
    [$link, $tag] = liveShareLink();

    $body = json_decode(openShare($link->id, $tag)->assertOk()->getContent(), true);

    expect($body['wrapper'])->toBe($link->wrapper)
        ->and($body['package'])->toBe($link->share->payload);
});

/**
 * The critical flaw this design fixed: if the server hands over a single byte of the package before
 * validating the PIN, the offline attack is back. Neither `challenge` nor a failed `open` may
 * contain anything from the package or the wrapper.
 */
it('leaks not a single byte of the package before validating the PIN', function (): void {
    [$link] = liveShareLink();

    $challenge = $this->postJson("/s/{$link->id}/challenge")->assertOk()->getContent();
    $failed = openShare($link->id, Base64Url::encode(random_bytes(32)))->getContent();

    foreach ([$challenge, $failed] as $body) {
        expect($body)->not->toContain($link->share->payload)
            ->and($body)->not->toContain($link->wrapper)
            ->and($body)->not->toContain(substr($link->share->payload, 0, 40))
            ->and($body)->not->toContain(substr($link->wrapper, 0, 40));
    }
});

/**
 * The single generic response. All four causes —does not exist, expired, revoked and wrong PIN— have
 * to produce exactly the same response: same status, same body, same case-dependent headers. If they
 * differ, a list of identifiers becomes a map of which clippings are still alive.
 */
it('answers the same for all four failure causes', function (): void {
    [$live] = liveShareLink();
    [$expired, $expiredTag] = liveShareLink(['expires_at' => now()->subMinute()]);
    [$revoked, $revokedTag] = liveShareLink();
    $revoked->share->delete();

    $responses = [
        'inexistente' => openShare((string) Str::uuid(), Base64Url::encode(random_bytes(32))),
        'caducado' => openShare($expired->id, $expiredTag),
        'revocado' => openShare($revoked->id, $revokedTag),
        'PIN incorrecto' => openShare($live->id, Base64Url::encode(random_bytes(32))),
    ];

    $seen = [];

    foreach ($responses as $name => $response) {
        $seen[$name] = [
            'status' => $response->getStatusCode(),
            'body' => $response->getContent(),
            'type' => $response->headers->get('Content-Type'),
        ];
    }

    expect(array_unique(array_map('json_encode', $seen)))->toHaveCount(1)
        ->and($seen['inexistente']['status'])->toBe(403)
        ->and($seen['inexistente']['body'])->toContain(InvalidShareLinkException::CODE);
});

/**
 * At `challenge` there is no PIN to judge yet, so a dead link has to return a salt with the same
 * shape as a live one, and the same one every time it is asked.
 */
it('returns a stable, indistinguishable decoy salt for links that do not exist', function (): void {
    [$live] = liveShareLink();
    $ghost = (string) Str::uuid();

    $vivo = $this->postJson("/s/{$live->id}/challenge")->assertOk()->json('pinSalt');
    $muerto = $this->postJson("/s/{$ghost}/challenge")->assertOk()->json('pinSalt');
    $otraVez = $this->postJson("/s/{$ghost}/challenge")->assertOk()->json('pinSalt');

    expect(strlen(Base64Url::decode($vivo)))->toBe(ShareLink::PIN_SALT_BYTES)
        ->and(strlen(Base64Url::decode($muerto)))->toBe(ShareLink::PIN_SALT_BYTES)
        ->and($muerto)->toBe($otraVez)
        ->and($muerto)->not->toBe($vivo);
});

/** Expired and revoked cannot be told apart at `challenge` either. */
it('gives a decoy salt to expired and revoked links too', function (): void {
    [$expired] = liveShareLink(['expires_at' => now()->subMinute()]);
    [$revoked] = liveShareLink();
    $revoked->share->delete();

    $decoy = app(DecoySalt::class);

    foreach ([$expired->id, $revoked->id] as $id) {
        $salt = $this->postJson("/s/{$id}/challenge")->assertOk()->json('pinSalt');

        expect(Base64Url::decode($salt))->toBe($decoy->for($id));
    }
});

/** A live link whose clipping expired serves nothing, even if the link itself is still current. */
it('does not serve a live link if its clipping expired', function (): void {
    $share = Share::factory()->expired()->create();
    [$link, $tag] = liveShareLink(['share_id' => $share->id]);

    openShare($link->id, $tag)->assertStatus(403);
});

it('spends one attempt per wrong PIN and deletes the link when they run out', function (): void {
    [$link] = liveShareLink();

    for ($attempt = ShareLink::MAX_ATTEMPTS; $attempt > 0; $attempt--) {
        openShare($link->id, Base64Url::encode(random_bytes(32)))->assertStatus(403);

        if ($attempt > 1) {
            expect(ShareLink::query()->whereKey($link->id)->value('attempts_remaining'))->toBe($attempt - 1);
        }
    }

    /** Running out of attempts deletes only the link row, never the package. */
    expect(ShareLink::query()->whereKey($link->id)->exists())->toBeFalse()
        ->and(Share::query()->whereKey($link->share_id)->exists())->toBeTrue();
});

/** The correct PIN puts the counter back at its cap: attempts bound brute force, not reads. */
it('re-arms the counter after a successful open', function (): void {
    [$link, $tag] = liveShareLink();

    openShare($link->id, Base64Url::encode(random_bytes(32)))->assertStatus(403);
    openShare($link->id, $tag)->assertOk();

    expect(ShareLink::query()->whereKey($link->id)->value('attempts_remaining'))
        ->toBe(ShareLink::MAX_ATTEMPTS);
});

/**
 * The counter lives in a column and is consumed with an atomic conditional write. The race is
 * simulated like in `RegistrationLinksTest`: a rival request empties the counter just before our
 * `update` runs, and ours has to affect zero rows.
 */
it('is atomic: two simultaneous requests do not share the same attempt', function (): void {
    [$link, $tag] = liveShareLink(['attempts_remaining' => 1]);
    $intercepted = false;

    DB::connection()->beforeExecuting(function (string $query) use (&$intercepted, $link): void {
        if ($intercepted || ! str_starts_with($query, 'update "share_links"')) {
            return;
        }

        $intercepted = true;

        DB::table('share_links')->where('id', $link->id)->update(['attempts_remaining' => 0]);
    });

    expect(fn () => app(ShareLinkGate::class)->open($link->id, Base64Url::decode($tag)))
        ->toThrow(InvalidShareLinkException::class)
        ->and($intercepted)->toBeTrue()
        ->and(DB::table('share_links')->where('id', $link->id)->value('attempts_remaining'))->toBe(0);
});

/** `lockForUpdate()` is a no-op on SQLite: a counter relying on it would pass the tests without protecting anything. */
it('does not use lockForUpdate in the reading gate', function (): void {
    expect(file_get_contents(app_path('Sharing/ShareLinkGate.php')))
        ->not->toContain('->lockForUpdate(');
});

/**
 * `opened_at` is the mark of the first access, rounded to the hour and written only once. There is
 * no download counter and no history.
 */
it('marks the first access once and rounded to the hour', function (): void {
    [$link, $tag] = liveShareLink();

    $this->travelTo(now()->startOfHour()->addMinutes(37));
    openShare($link->id, $tag)->assertOk();

    $openedAt = fn (): string => Share::query()
        ->whereKey($link->share_id)
        ->value('opened_at')
        ->format('Y-m-d H:i:s');

    $first = $openedAt();

    $this->travelTo(now()->addHours(2));
    openShare($link->id, $tag)->assertOk();

    expect($first)->toBe(now()->subHours(2)->startOfHour()->format('Y-m-d H:i:s'))
        ->and($openedAt())->toBe($first);
});

/**
 * The response carries no cache validators and no descriptive filename, and it does carry
 * `no-store`. An attachment name is clinical metadata.
 */
it('serves the package with no cache, no ETag and no Content-Disposition', function (): void {
    [$link, $tag] = liveShareLink();

    $response = openShare($link->id, $tag)->assertOk();

    expect($response->headers->get('Content-Type'))->toBe('application/octet-stream')
        ->and($response->headers->get('Cache-Control'))->toContain('no-store')
        ->and($response->headers->has('ETag'))->toBeFalse()
        ->and($response->headers->has('Last-Modified'))->toBeFalse()
        ->and($response->headers->has('Content-Disposition'))->toBeFalse();
});

/** The reader routes carry no session: whoever uses them has no account and must get no cookies. */
it('reads with no session, no CSRF and leaving no cookies', function (): void {
    [$link, $tag] = liveShareLink();

    $response = openShare($link->id, $tag)->assertOk();

    expect($response->headers->getCookies())->toBeEmpty();
});

/** No download leaves an activity trail: it would be the access history ADR 0006 rules out. */
it('records nothing when a clipping is opened', function (): void {
    [$link, $tag] = liveShareLink();

    openShare($link->id, $tag)->assertOk();

    expect(Activity::query()->where('log_name', AuditEvent::LOG_NAME)->count())->toBe(0);
});
