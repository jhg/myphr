<?php

declare(strict_types=1);

use App\Security\Opaque\AuthenticationFailedException;
use App\Security\Opaque\ExpiredHandshakeException;
use App\Security\Opaque\InvalidConfigurationException;
use App\Security\Opaque\InvalidMessageException;
use App\Security\Opaque\InvalidPointException;
use App\Security\Opaque\OpaqueException;

it('derives every protocol exception from the base exception', function (string $class): void {
    expect(new $class('boom'))
        ->toBeInstanceOf(OpaqueException::class)
        ->toBeInstanceOf(RuntimeException::class);
})->with([
    InvalidMessageException::class,
    InvalidPointException::class,
    InvalidConfigurationException::class,
    ExpiredHandshakeException::class,
    AuthenticationFailedException::class,
]);

it('makes the invalid point exception a subtype of the invalid message exception', function (): void {
    expect(new InvalidPointException('boom'))->toBeInstanceOf(InvalidMessageException::class);
});

it('keeps configuration, expiry and authentication errors outside the message hierarchy', function (string $class): void {
    expect(new $class('boom'))->not->toBeInstanceOf(InvalidMessageException::class);
})->with([
    InvalidConfigurationException::class,
    ExpiredHandshakeException::class,
    AuthenticationFailedException::class,
]);

it('catches every protocol error through the base exception', function (): void {
    $caught = null;

    try {
        throw new AuthenticationFailedException('client mac mismatch');
    } catch (OpaqueException $exception) {
        $caught = $exception->getMessage();
    }

    expect($caught)->toBe('client mac mismatch');
});
