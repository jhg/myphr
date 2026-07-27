<?php

declare(strict_types=1);

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

/**
 * `Filament\Http\Middleware\AuthenticateSession` (mounted on the `phr` panel) extends
 * `Illuminate\Session\Middleware\AuthenticateSession` without overriding `handle()`. That class
 * stores `password_hash_web` in the session on the first authenticated request and compares it on
 * the following ones; if it does not match, it closes the session.
 *
 * With no `password` column, {@see User::getAuthPassword()} returns `''`, which is falsy in PHP. The
 * first line of `handle()` is
 * `if (! $request->hasSession() || ! $request->user() || ! $request->user()->getAuthPassword())`,
 * so the middleware bails out there and never gets to compare anything against the session. This
 * test shows that several authenticated requests in a row do not close the session on their own,
 * which is how it would show up in production if this broke.
 */
it('does not close the session on successive authenticated requests', function (): void {
    $user = User::factory()->registered()->create();
    $this->actingAs($user);

    $first = $this->get('/phr');
    $first->assertOk();

    expect(auth()->check())->toBeTrue()
        ->and(auth()->id())->toBe($user->id);

    $second = $this->get('/phr');
    $second->assertOk();

    expect(auth()->check())->toBeTrue()
        ->and(auth()->id())->toBe($user->id);
});
