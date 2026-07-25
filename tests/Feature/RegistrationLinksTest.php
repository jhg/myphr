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
 * Devuelve el servicio y el token en claro de un enlace recién emitido.
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

/** Spec 0001 §3.3: solo se persiste el hash, y la TTL es de 24 horas. */
it('emite un enlace guardando solo el hash del token y con 24 horas de caducidad', function (): void {
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

/** El token en claro no aparece en ninguna columna. */
it('no persiste el token en claro', function (): void {
    [, $token] = issuedLink();

    $row = (array) DB::table('user_registration_links')->sole();

    foreach ($row as $value) {
        expect(is_string($value) && str_contains($value, $token))->toBeFalse();
    }
});

/** Spec 0001 §5, paso 4: validar no consume. */
it('valida sin consumir', function (): void {
    [$links, $token, $user] = issuedLink();

    $link = $links->validate($token);

    expect($link->user_id)->toBe($user->id)
        ->and($link->consumed_at)->toBeNull()
        ->and($links->validate($token)->id)->toBe($link->id);
});

it('consume el enlace marcando la fecha', function (): void {
    [$links, $token] = issuedLink();

    $link = $links->consume($token);

    expect($link->consumed_at)->not->toBeNull()
        ->and(UserRegistrationLink::query()->sole()->consumed_at)->not->toBeNull();
});

it('rechaza un enlace ya consumido, tanto al validar como al volver a consumir', function (): void {
    [$links, $token] = issuedLink();

    $links->consume($token);

    expect(fn () => $links->validate($token))->toThrow(InvalidRegistrationLinkException::class)
        ->and(fn () => $links->consume($token))->toThrow(InvalidRegistrationLinkException::class);
});

it('rechaza un enlace caducado', function (): void {
    [$links, $token] = issuedLink();

    UserRegistrationLink::query()->sole()->forceFill(['expires_at' => now()->subSecond()])->save();

    expect(fn () => $links->validate($token))->toThrow(InvalidRegistrationLinkException::class)
        ->and(fn () => $links->consume($token))->toThrow(InvalidRegistrationLinkException::class);
});

/** `docs/OPAQUE.md` §13.3: los tres motivos son indistinguibles. */
it('da el mismo error para inexistente, caducado y consumido', function (): void {
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
 * Spec 0001 §4.2: el consumo es una escritura condicional decidida por filas afectadas.
 *
 * El gancho `beforeExecuting` simula la petición rival que gana la carrera justo antes
 * de nuestro `UPDATE`: la nuestra debe afectar a cero filas y fallar, sin pisar la fecha
 * que escribió la otra.
 */
it('es atómico: si otra petición consume el enlace justo antes, la nuestra falla', function (): void {
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

/** Spec 0001 §11: `lockForUpdate()` es un no-op en SQLite, así que está prohibido. */
it('no usa lockForUpdate', function (): void {
    expect(file_get_contents(app_path('Provisioning/RegistrationLinks.php')))
        ->not->toContain('->lockForUpdate(');
});

/** Spec 0001 §3.4: reemitir sobre una cuenta con acceso exige teclear su email. */
it('exige confirmación para reemitir sobre una cuenta ya registrada', function (): void {
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

/** La guardia también salta con un sobre vigente aunque el registro OPAQUE no esté completo. */
it('exige confirmación si la cuenta conserva un sobre vigente de clave maestra', function (): void {
    $user = User::factory()->create();
    UserMasterKeyEnvelope::create(['user_id' => $user->id, 'envelope' => 'v1.sobre']);

    expect(fn () => app(RegistrationLinks::class)->issueFor($user))
        ->toThrow(RegistrationLinkReissueRequiresConfirmationException::class);
});

/** Una cuenta sin acceso todavía no necesita confirmación ninguna. */
it('no pide confirmación para una cuenta sin registro ni sobre', function (): void {
    $user = User::factory()->create();

    app(RegistrationLinks::class)->issueFor($user);
    app(RegistrationLinks::class)->issueFor($user);

    expect(UserRegistrationLink::query()->count())->toBe(2);
});

/** Un sobre retirado no deja acceso: no bloquea la reemisión. */
it('no pide confirmación si el único sobre está retirado', function (): void {
    $user = User::factory()->create();
    UserMasterKeyEnvelope::create(['user_id' => $user->id, 'envelope' => 'v1.sobre'])->retire();

    app(RegistrationLinks::class)->issueFor($user);

    expect(UserRegistrationLink::query()->count())->toBe(1);
});
