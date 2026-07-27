<?php

declare(strict_types=1);

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Limiters for the OPAQUE routes (Spec 0001 §4.2 and §4.4).
 *
 * A limiter that leans on a field the route never receives stops limiting per request and becomes a
 * single shared bucket: whoever drains it takes the endpoint out of service for everybody.
 * `registration/finish` is exactly that case, because the client only sends `registrationId`,
 * `registrationRecord`, `wrappedUserMasterKey` and `encryptedSettings`.
 */

/**
 * JSON body against a panel route, with a fixed IP.
 *
 * @param  array<string, mixed>  $body
 */
function opaqueRequest(string $path, array $body, string $ip = '203.0.113.9'): Request
{
    $request = Request::create(
        $path,
        'POST',
        [],
        [],
        [],
        ['REMOTE_ADDR' => $ip, 'CONTENT_TYPE' => 'application/json'],
        json_encode($body, JSON_THROW_ON_ERROR),
    );

    return $request;
}

/**
 * Keys of the buckets a limiter applies to a request.
 *
 * @return list<string>
 */
function rateLimitKeys(string $limiter, Request $request): array
{
    $resolver = RateLimiter::limiter($limiter);

    expect($resolver)->not->toBeNull();

    $limits = $resolver($request);
    $limits = is_array($limits) ? $limits : [$limits];

    return array_values(array_map(
        static fn (Limit $limit): string => (string) $limit->key,
        $limits,
    ));
}

it('separates every registration/finish request by pending registration', function (): void {
    $first = rateLimitKeys('opaque-registration-finish', opaqueRequest(
        '/phr/auth/opaque/registration/finish',
        ['registrationId' => '11111111-1111-4111-8111-111111111111'],
    ));

    $second = rateLimitKeys('opaque-registration-finish', opaqueRequest(
        '/phr/auth/opaque/registration/finish',
        ['registrationId' => '22222222-2222-4222-8222-222222222222'],
    ));

    expect($first)->not->toBe($second)
        ->and(array_diff($first, $second))->not->toBeEmpty();

    /** And the plaintext login is never a key: there is not even a field here that could be one. */
    foreach ([...$first, ...$second] as $key) {
        expect($key)->not->toContain('@');
    }
});

/**
 * The defect this file chases: `opaque-registration` builds its second key from
 * `registrationToken`, which `registration/finish` never sends. All of its requests would fall into
 * the same 15/min bucket, so that route cannot use that limiter.
 */
it('does not mount registration/finish on a limiter that cannot tell its requests apart', function (): void {
    $first = rateLimitKeys('opaque-registration', opaqueRequest(
        '/phr/auth/opaque/registration/finish',
        ['registrationId' => '11111111-1111-4111-8111-111111111111'],
    ));

    $second = rateLimitKeys('opaque-registration', opaqueRequest(
        '/phr/auth/opaque/registration/finish',
        ['registrationId' => '22222222-2222-4222-8222-222222222222'],
    ));

    expect($first)->toBe($second);

    $middleware = collect(app('router')->getRoutes()->getByName('filament.phr.auth.opaque.registration.finish')->gatherMiddleware());

    expect($middleware)->toContain('throttle:opaque-registration-finish')
        ->and($middleware)->not->toContain('throttle:opaque-registration');
});

it('keeps separating registration/start requests by token', function (): void {
    $first = rateLimitKeys('opaque-registration', opaqueRequest(
        '/phr/auth/opaque/registration/start',
        ['registrationToken' => 'token-uno'],
    ));

    $second = rateLimitKeys('opaque-registration', opaqueRequest(
        '/phr/auth/opaque/registration/start',
        ['registrationToken' => 'token-dos'],
    ));

    expect($first)->not->toBe($second);

    $middleware = app('router')->getRoutes()->getByName('filament.phr.auth.opaque.registration.start')->gatherMiddleware();

    expect($middleware)->toContain('throttle:opaque-registration');
});
