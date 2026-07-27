<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Production implementation of {@see Terminal} on top of `stream_isatty(STDOUT)`.
 */
final class SystemTerminal implements Terminal
{
    public function isInteractive(): bool
    {
        return defined('STDOUT') && stream_isatty(STDOUT);
    }
}
