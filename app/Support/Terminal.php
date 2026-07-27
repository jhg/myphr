<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Interactive terminal detection, injectable so it can be tested.
 *
 * `phr:issue-registration-link` uses it (Spec 0001 §10): if the output is not a
 * terminal, the link URL would end up in a log file, in the output of a cron job
 * or in a deployment system's record, which are exactly the places ADR 0009 does
 * not want it to appear.
 */
interface Terminal
{
    /**
     * @return bool `true` if standard output is an interactive terminal.
     */
    public function isInteractive(): bool;
}
