<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Support\Terminal;

/**
 * Injectable terminal for tests: PHPUnit's output is never a TTY.
 */
final readonly class FakeTerminal implements Terminal
{
    public function __construct(private bool $interactive = true) {}

    public function isInteractive(): bool
    {
        return $this->interactive;
    }
}
