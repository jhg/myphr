<?php

declare(strict_types=1);

use App\Console\Commands\ProhibitedMakeFilamentUserCommand;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;

uses(RefreshDatabase::class);

/**
 * Spec 0001 §9: `make:filament-user` y sus alias quedan deshabilitados.
 */
it('disables make:filament-user and its aliases', function (string $name): void {
    expect(Artisan::all()[$name] ?? null)->toBeInstanceOf(ProhibitedMakeFilamentUserCommand::class);
})->with(['make:filament-user', 'filament:make-user', 'filament:user']);

it('aborts without creating any account', function (): void {
    $this->artisan('make:filament-user')->assertFailed();

    expect(User::query()->count())->toBe(0);
});
