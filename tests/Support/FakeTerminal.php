<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Support\Terminal;

/**
 * Terminal inyectable para tests: la salida de PHPUnit nunca es un TTY.
 */
final readonly class FakeTerminal implements Terminal
{
    public function __construct(private bool $interactive = true) {}

    public function isInteractive(): bool
    {
        return $this->interactive;
    }
}
