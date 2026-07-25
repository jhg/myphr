<?php

declare(strict_types=1);

use App\Security\Opaque\InvalidConfigurationException;
use App\Security\Opaque\RandomSource;
use App\Security\Opaque\SystemRandomSource;

it('implements the injectable random source interface', function (): void {
    expect(new SystemRandomSource)->toBeInstanceOf(RandomSource::class);
});

it('returns exactly the requested number of bytes', function (int $length): void {
    expect(strlen((new SystemRandomSource)->bytes($length)))->toBe($length);
})->with([1, 32, 64, 128, 512]);

it('does not repeat itself', function (): void {
    $source = new SystemRandomSource;

    expect($source->bytes(32))->not->toBe($source->bytes(32));
});

it('rejects a non positive length', function (int $length): void {
    (new SystemRandomSource)->bytes($length);
})->with([0, -1])->throws(InvalidConfigurationException::class);
