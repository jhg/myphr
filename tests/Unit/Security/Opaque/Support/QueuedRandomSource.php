<?php

declare(strict_types=1);

namespace Tests\Unit\Security\Opaque\Support;

use App\Security\Opaque\InvalidConfigurationException;
use App\Security\Opaque\RandomSource;

/**
 * Deterministic source of randomness for tests (`docs/OPAQUE.md` §20.3).
 *
 * It returns, in order, the blocks preloaded into it, checking that every call
 * asks for exactly the length of the next block. That way a test fails as soon
 * as the order or the size of the protocol's `random()` calls changes.
 */
final class QueuedRandomSource implements RandomSource
{
    /** @var list<string> */
    private array $queue;

    /**
     * @param  list<string>  $queue  Binary blocks in the order they will be consumed.
     */
    public function __construct(array $queue)
    {
        $this->queue = $queue;
    }

    public function bytes(int $length): string
    {
        $chunk = array_shift($this->queue);

        if ($chunk === null) {
            throw new InvalidConfigurationException('QueuedRandomSource exhausted.');
        }

        if (strlen($chunk) !== $length) {
            throw new InvalidConfigurationException(
                'QueuedRandomSource: expected a request of '.strlen($chunk)." bytes, got {$length}."
            );
        }

        return $chunk;
    }

    public function isExhausted(): bool
    {
        return $this->queue === [];
    }
}
