<?php

declare(strict_types=1);

use App\Models\User;
use App\Models\UserMasterKeyEnvelope;
use App\Models\UserRegistrationLink;
use App\Provisioning\InvalidRegistrationLinkException;
use App\Provisioning\RegistrationLinkReissueRequiresConfirmationException;
use App\Provisioning\RegistrationLinks;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

uses(RefreshDatabase::class);

/**
 * `App\Provisioning\RegistrationLinks` (Spec 0001 §3.3, §3.4, §4.1, §4.2; ADR 0009).
 */

/**
 * Returns the service and the plaintext token of a freshly issued link.
 *
 * @return array{0: RegistrationLinks, 1: string, 2: User}
 */
function issuedLink(?User $user = null): array
{
    $links = app(RegistrationLinks::class);
    $user ??= User::factory()->create();
    $url = $links->issueFor($user);

    return [$links, Str::after($url, '#'), $user];
}

/** Spec 0001 §3.3: only the hash is persisted, and the TTL is 24 hours. */
it('issues a link storing only the token hash and with a 24 hour expiry', function (): void {
    $this->freezeTime();

    $user = User::factory()->create();
    $issuer = User::factory()->create();

    $url = app(RegistrationLinks::class)->issueFor($user, issuedBy: $issuer);
    $token = Str::after($url, '#');

    $link = UserRegistrationLink::query()->sole();

    expect($url)->toBe(url(RegistrationLinks::SET_PASSWORD_PATH).'#'.$token)
        ->and($token)->toMatch('/^[A-Za-z0-9_-]{43}$/')
        ->and($link->user_id)->toBe($user->id)
        ->and($link->created_by)->toBe($issuer->id)
        ->and($link->consumed_at)->toBeNull()
        ->and($link->expires_at->format('Y-m-d H:i:s'))->toBe(now()->addHours(24)->format('Y-m-d H:i:s'))
        ->and($link->token_hash)->toBe(hash('sha256', $token, true));
});

/** The plaintext token appears in no column. */
it('does not persist the plaintext token', function (): void {
    [, $token] = issuedLink();

    $row = (array) DB::table('user_registration_links')->sole();

    foreach ($row as $value) {
        expect(is_string($value) && str_contains($value, $token))->toBeFalse();
    }
});

/** Spec 0001 §5, paso 4: validar no consume. */
it('validates without consuming', function (): void {
    [$links, $token, $user] = issuedLink();

    $link = $links->validate($token);

    expect($link->user_id)->toBe($user->id)
        ->and($link->consumed_at)->toBeNull()
        ->and($links->validate($token)->id)->toBe($link->id);
});

it('consumes the link by marking the date', function (): void {
    [$links, $token] = issuedLink();

    $link = $links->consume($token);

    expect($link->consumed_at)->not->toBeNull()
        ->and(UserRegistrationLink::query()->sole()->consumed_at)->not->toBeNull();
});

it('rejects an already consumed link, both when validating and when consuming again', function (): void {
    [$links, $token] = issuedLink();

    $links->consume($token);

    expect(fn () => $links->validate($token))->toThrow(InvalidRegistrationLinkException::class)
        ->and(fn () => $links->consume($token))->toThrow(InvalidRegistrationLinkException::class);
});

it('rejects an expired link', function (): void {
    [$links, $token] = issuedLink();

    UserRegistrationLink::query()->sole()->forceFill(['expires_at' => now()->subSecond()])->save();

    expect(fn () => $links->validate($token))->toThrow(InvalidRegistrationLinkException::class)
        ->and(fn () => $links->consume($token))->toThrow(InvalidRegistrationLinkException::class);
});

/** `docs/OPAQUE.md` §13.3: the three reasons are indistinguishable. */
it('gives the same error for non-existent, expired and consumed', function (): void {
    $links = app(RegistrationLinks::class);

    [, $consumed] = issuedLink();
    $links->consume($consumed);

    [, $expired] = issuedLink();
    UserRegistrationLink::query()
        ->where('token_hash', hash('sha256', $expired, true))
        ->update(['expires_at' => now()->subSecond()]);

    $missing = Str::random(43);

    $messages = [];
    $classes = [];

    foreach (['validate', 'consume'] as $method) {
        foreach ([$missing, $expired, $consumed] as $token) {
            try {
                $links->{$method}($token);
                $this->fail("{$method} debería haber fallado.");
            } catch (InvalidRegistrationLinkException $exception) {
                $messages[] = $exception->getMessage();
                $classes[] = $exception::class;
            }
        }
    }

    expect(array_unique($messages))->toHaveCount(1)
        ->and(array_unique($classes))->toHaveCount(1);
});

/**
 * Spec 0001 §4.2: consumption is a conditional write decided by affected rows.
 *
 * The `beforeExecuting` hook simulates the rival request that wins the race just before our
 * `UPDATE`: ours must affect zero rows and fail, without overwriting the date the other one wrote.
 */
it('is atomic: if another request consumes the link just before, ours fails', function (): void {
    [$links, $token] = issuedLink();

    $rivalConsumedAt = now()->subMinute();
    $intercepted = false;

    DB::connection()->beforeExecuting(function (string $query) use (&$intercepted, $token, $rivalConsumedAt): void {
        if ($intercepted || ! str_starts_with($query, 'update "user_registration_links"')) {
            return;
        }

        $intercepted = true;

        DB::table('user_registration_links')
            ->where('token_hash', hash('sha256', $token, true))
            ->update(['consumed_at' => $rivalConsumedAt]);
    });

    expect(fn () => $links->consume($token))->toThrow(InvalidRegistrationLinkException::class)
        ->and($intercepted)->toBeTrue()
        ->and(UserRegistrationLink::query()->sole()->consumed_at->format('Y-m-d H:i:s'))
        ->toBe($rivalConsumedAt->format('Y-m-d H:i:s'));
});

/** Spec 0001 §11: `lockForUpdate()` is a no-op on SQLite, so it is forbidden. */
it('does not use lockForUpdate', function (): void {
    expect(file_get_contents(app_path('Provisioning/RegistrationLinks.php')))
        ->not->toContain('->lockForUpdate(');
});

/** Spec 0001 §3.4: reissuing on an account with access requires typing its email. */
it('requires confirmation to reissue on an already registered account', function (): void {
    $user = User::factory()->registered()->create();
    $links = app(RegistrationLinks::class);

    expect(fn () => $links->issueFor($user))
        ->toThrow(RegistrationLinkReissueRequiresConfirmationException::class)
        ->and(fn () => $links->issueFor($user, confirmation: 'otra@example.com'))
        ->toThrow(RegistrationLinkReissueRequiresConfirmationException::class)
        ->and(fn () => $links->issueFor($user, confirmation: ''))
        ->toThrow(RegistrationLinkReissueRequiresConfirmationException::class)
        ->and(UserRegistrationLink::query()->count())->toBe(0);

    $url = $links->issueFor($user, confirmation: '  '.strtoupper($user->email).' ');

    expect($url)->toContain('#')
        ->and(UserRegistrationLink::query()->count())->toBe(1);
});

/** The guard also fires with a current envelope even if the OPAQUE registration is not complete. */
it('requires confirmation if the account still has a current master key envelope', function (): void {
    $user = User::factory()->create();
    UserMasterKeyEnvelope::create(['user_id' => $user->id, 'envelope' => 'v1.sobre']);

    expect(fn () => app(RegistrationLinks::class)->issueFor($user))
        ->toThrow(RegistrationLinkReissueRequiresConfirmationException::class);
});

/** An account without access does not need any confirmation yet. */
it('asks for no confirmation for an account with no registration and no envelope', function (): void {
    $user = User::factory()->create();

    app(RegistrationLinks::class)->issueFor($user);
    app(RegistrationLinks::class)->issueFor($user);

    expect(UserRegistrationLink::query()->count())->toBe(2);
});

/** A retired envelope grants no access: it does not block a reissue. */
it('asks for no confirmation if the only envelope is retired', function (): void {
    $user = User::factory()->create();
    UserMasterKeyEnvelope::create(['user_id' => $user->id, 'envelope' => 'v1.sobre'])->retire();

    app(RegistrationLinks::class)->issueFor($user);

    expect(UserRegistrationLink::query()->count())->toBe(1);
});
