<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Implementación de producción de {@see Terminal} sobre `stream_isatty(STDOUT)`.
 */
final class SystemTerminal implements Terminal
{
    public function isInteractive(): bool
    {
        return defined('STDOUT') && stream_isatty(STDOUT);
    }
}
