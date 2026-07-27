<?php

declare(strict_types=1);

use App\Crypto\CanonicalDate;
use App\Http\Controllers\Sharing\IssueShareLinkController;
use App\Http\Controllers\Sharing\ListSharesController;
use App\Http\Controllers\Sharing\RevokeShareController;
use App\Http\Controllers\Sharing\StoreShareController;
use App\Models\Share;
use App\Models\ShareLink;
use App\Models\User;
use App\Security\Opaque\Base64Url;
use App\Sharing\Shares;
use App\Support\AuditEvent;
use Database\Factories\ShareFactory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Spatie\Activitylog\Models\Activity;

uses(RefreshDatabase::class);

/**
 * The real routes live in `PhrPanelProvider::sessionRoutes()`, which drags the whole Filament panel
 * along. Equivalents are mounted here —same controllers, same authentication middleware— to test the
 * logic without depending on that registration, as `UpdateSettingsTest` does.
 */
beforeEach(function (): void {
    Route::middleware('auth')->group(function (): void {
        Route::get('/test/phr/shares', ListSharesController::class);
        Route::post('/test/phr/shares', StoreShareController::class);
        Route::post('/test/phr/shares/{share}/links', IssueShareLinkController::class);
        Route::delete('/test/phr/shares/{share}', RevokeShareController::class);
    });
});

/**
 * A well formed creation body. Everything the server can check is shape, so the values are bytes of
 * the right length with no cryptographic meaning.
 *
 * @return array<string, mixed>
 */
function shareCreationBody(array $overrides = []): array
{
    return array_replace_recursive([
        'id' => (string) Str::uuid(),
        'payload' => ShareFactory::fakePackage(),
        'descriptor' => ShareFactory::fakeEnvelope(),
        'expiresAt' => CanonicalDate::format(now()->addDay()),
        'link' => shareLinkBody(),
    ], $overrides);
}

/**
 * @return array<string, string>
 */
function shareLinkBody(array $overrides = []): array
{
    return array_replace([
        'id' => (string) Str::uuid(),
        'pinSalt' => Base64Url::encode(random_bytes(ShareLink::PIN_SALT_BYTES)),
        'pinTag' => Base64Url::encode(random_bytes(ShareLink::PIN_TAG_BYTES)),
        'wrapper' => ShareFactory::fakeEnvelope(),
    ], $overrides);
}

it('creates the clipping and its first link in a single call', function (): void {
    $user = User::factory()->registered()->create();
    $body = shareCreationBody();

    $this->actingAs($user)
        ->postJson('/test/phr/shares', $body)
        ->assertCreated()
        ->assertJson(['id' => $body['id']]);

    $share = Share::query()->sole();

    expect($share->user_id)->toBe($user->id)
        ->and($share->payload)->toBe($body['payload'])
        ->and($share->descriptor)->toBe($body['descriptor'])
        ->and($share->opened_at)->toBeNull()
        ->and($share->links()->count())->toBe(1)
        ->and($share->links()->sole()->attempts_remaining)->toBe(ShareLink::MAX_ATTEMPTS)
        /** The link inherits the clipping expiry: it cannot outlive the package it serves. */
        ->and($share->links()->sole()->expires_at->equalTo($share->expires_at))->toBeTrue();
});

/**
 * ADR 0011: **no plaintext column describes the clipping content**. This test is what closes the
 * schema promise, and that is why it enumerates the columns instead of checking for isolated
 * absences: adding a `types` or a `range_from` in the future breaks it.
 */
it('has no plaintext column describing the clipping', function (): void {
    expect(Schema::getColumnListing('shares'))
        ->toEqualCanonicalizing(['id', 'user_id', 'expires_at', 'payload', 'descriptor', 'opened_at', 'created_at'])
        ->and(Schema::getColumnListing('share_links'))
        ->toEqualCanonicalizing([
            'id', 'share_id', 'pin_salt', 'pin_tag', 'attempts_remaining', 'wrapper', 'expires_at', 'created_at',
        ]);
});

/**
 * No `updated_at` on either of the two, and no `deleted_at`: revoking really deletes (a deliberate
 * exception to the ADR 0006 pattern).
 */
it('carries no updated_at and no deletion tombstone', function (string $table): void {
    expect(Schema::hasColumn($table, 'updated_at'))->toBeFalse()
        ->and(Schema::hasColumn($table, 'deleted_at'))->toBeFalse();
})->with(['shares', 'share_links']);

it('rejects a package that does not have the shape of an s1. envelope', function (mixed $payload): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user)
        ->postJson('/test/phr/shares', shareCreationBody(['payload' => $payload]))
        ->assertStatus(422)
        ->assertJson(['error' => 'invalid_package']);

    expect(Share::query()->count())->toBe(0);
})->with([
    'sobre de evento' => fn (): string => ShareFactory::fakeEnvelope(),
    'size off the ladder' => fn (): string => 's1.'.rtrim(strtr(base64_encode(random_bytes(4096)), '+/', '-_'), '='),
    'texto suelto' => 'no es un sobre',
]);

it('rejects a descriptor that does not have the shape of a v1. envelope', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user)
        ->postJson('/test/phr/shares', shareCreationBody(['descriptor' => ShareFactory::fakePackage()]))
        ->assertStatus(422)
        ->assertJson(['error' => 'invalid_descriptor']);
});

/**
 * The ADR rules out UUIDv7 for these identifiers: they carry the creation instant in the clear
 * inside the link itself and inside the photo the professional keeps.
 */
it('rejects an identifier that is not a UUIDv4', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user)
        ->postJson('/test/phr/shares', shareCreationBody(['id' => (string) Str::uuid7()]))
        ->assertStatus(422)
        ->assertJson(['error' => 'invalid_share_id']);

    $this->actingAs($user)
        ->postJson('/test/phr/shares', shareCreationBody(['link' => shareLinkBody(['id' => (string) Str::uuid7()])]))
        ->assertStatus(422)
        ->assertJson(['error' => 'invalid_link']);
});

/**
 * The expiry is set by the client because it goes into the `wrapKey` derivation, but it comes from a
 * closed list and the server checks it: 1 hour, 24 hours and 7 days, with slack for the Argon2id.
 */
it('accepts only the expiries on the closed list', function (string $expiresAt, bool $accepted): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user)
        ->postJson('/test/phr/shares', shareCreationBody(['expiresAt' => $expiresAt]))
        ->assertStatus($accepted ? 201 : 422);
})->with([
    'una hora' => [fn (): string => CanonicalDate::format(now()->addHour()), true],
    'one day' => [fn (): string => CanonicalDate::format(now()->addDay()), true],
    'seven days' => [fn (): string => CanonicalDate::format(now()->addDays(7)), true],
    'three days' => [fn (): string => CanonicalDate::format(now()->addDays(3)), false],
    'un mes' => [fn (): string => CanonicalDate::format(now()->addMonth()), false],
    'en el pasado' => [fn (): string => CanonicalDate::format(now()->subHour()), false],
    'not canonical' => ['2026-07-27T10:00:00Z', false],
]);

it('lists only the clippings that are ours and alive', function (): void {
    $user = User::factory()->registered()->create();
    $other = User::factory()->registered()->create();

    $mine = Share::factory()->for($user)->create();
    Share::factory()->for($user)->expired()->create();
    Share::factory()->for($other)->create();

    $response = $this->actingAs($user)->getJson('/test/phr/shares')->assertOk();

    expect($response->json('shares'))->toHaveCount(1)
        ->and($response->json('shares.0.id'))->toBe($mine->id)
        ->and($response->json('shares.0.descriptor'))->toBe($mine->descriptor);
});

/**
 * Neither the package, nor the salt, nor the PIN proof, nor the wrapper comes out of the listing.
 * The owner herself is the one asking, so it breaks nothing today; returning them would turn any
 * future leak of this response into the offline attack the ADR fixed.
 */
it('does not return the package or the PIN material in the listing', function (): void {
    $user = User::factory()->registered()->create();
    $share = Share::factory()->for($user)->create();
    ShareLink::factory()->for($share)->create();

    $body = $this->actingAs($user)->getJson('/test/phr/shares')->assertOk()->json();
    $encoded = json_encode($body);

    expect($body['shares'][0])->not->toHaveKey('payload')
        ->and($body['shares'][0]['links'][0])->not->toHaveKeys(['pinSalt', 'pinTag', 'wrapper'])
        ->and($encoded)->not->toContain($share->payload);
});

it('does not let anyone revoke or re-arm somebody else clipping', function (): void {
    $user = User::factory()->registered()->create();
    $other = User::factory()->registered()->create();
    $theirs = Share::factory()->for($other)->create();

    $this->actingAs($user)
        ->deleteJson("/test/phr/shares/{$theirs->id}")
        ->assertNotFound();

    $this->actingAs($user)
        ->postJson("/test/phr/shares/{$theirs->id}/links", ['link' => shareLinkBody()])
        ->assertNotFound();

    expect(Share::query()->whereKey($theirs->id)->exists())->toBeTrue();
});

/** Revoking is a physical delete, not a tombstone: the package has to disappear from the table. */
it('revoking really deletes the clipping and its links', function (): void {
    $user = User::factory()->registered()->create();
    $share = Share::factory()->for($user)->create();
    ShareLink::factory()->count(2)->for($share)->create();

    $this->actingAs($user)->deleteJson("/test/phr/shares/{$share->id}")->assertOk();

    expect(Share::query()->count())->toBe(0)
        ->and(ShareLink::query()->count())->toBe(0);
});

/**
 * Re-arming is the whole point of the two layers: a new `S` and PIN without re-uploading the
 * package.
 */
it('re-arms a link on the same package', function (): void {
    $user = User::factory()->registered()->create();
    $share = Share::factory()->for($user)->create();
    $payload = $share->payload;

    $this->actingAs($user)
        ->postJson("/test/phr/shares/{$share->id}/links", ['link' => shareLinkBody()])
        ->assertCreated();

    expect($share->refresh()->payload)->toBe($payload)
        ->and($share->links()->count())->toBe(1);
});

it('applies the cap of active clippings per user', function (): void {
    $user = User::factory()->registered()->create();
    Share::factory()->count(Shares::MAX_ACTIVE_SHARES)->for($user)->create();

    $this->actingAs($user)
        ->postJson('/test/phr/shares', shareCreationBody())
        ->assertStatus(409)
        ->assertJson(['error' => 'share_limit_reached']);
});

it('applies the cap of live links per clipping', function (): void {
    $user = User::factory()->registered()->create();
    $share = Share::factory()->for($user)->create();
    ShareLink::factory()->count(Shares::MAX_LINKS_PER_SHARE)->for($share)->create();

    $this->actingAs($user)
        ->postJson("/test/phr/shares/{$share->id}/links", ['link' => shareLinkBody()])
        ->assertStatus(409);
});

/**
 * The trail records that a share happened and when, never what of: no range, no types, no clipping
 * identifier, which is deleted on revoke anyway.
 */
it('records creating and revoking without saying anything about the content', function (): void {
    $user = User::factory()->registered()->create();
    $body = shareCreationBody();

    $this->actingAs($user)->postJson('/test/phr/shares', $body)->assertCreated();
    $this->actingAs($user)->deleteJson("/test/phr/shares/{$body['id']}")->assertOk();

    $events = Activity::query()->where('log_name', AuditEvent::LOG_NAME)->pluck('event');

    expect($events)->toContain(AuditEvent::ShareCreated->value)
        ->toContain(AuditEvent::ShareRevoked->value);

    Activity::query()
        ->whereIn('event', [AuditEvent::ShareCreated->value, AuditEvent::ShareRevoked->value])
        ->each(function (Activity $activity) use ($user, $body): void {
            expect($activity->subject_id)->toBe($user->id)
                ->and(json_encode($activity->properties))->not->toContain($body['payload'])
                ->and(json_encode($activity->properties))->not->toContain($body['descriptor'])
                ->and(json_encode($activity->properties))->not->toContain($body['id']);
        });
});

/** There is no audit entry for downloads: it would be the access history the ADR rules out. */
it('defines no audit event for downloads', function (): void {
    $values = array_map(fn (AuditEvent $case): string => $case->value, AuditEvent::cases());

    expect($values)->not->toContain('share-opened')
        ->and($values)->not->toContain('share-downloaded');
});
