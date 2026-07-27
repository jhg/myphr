<?php

declare(strict_types=1);

namespace App\Security\Opaque;

use Exception;

/**
 * Production implementation of {@see RandomSource} on top of `random_bytes()`
 * (`docs/OPAQUE.md` §4, §20.3).
 *
 * `random_bytes()` is the system CSPRNG and the only source allowed in
 * production. Tests replace this class with a deterministic source carrying
 * the exact bytes from the vector.
 */
final class SystemRandomSource implements RandomSource
{
    /**
     * @param  int<1, max>  $length  Number of bytes requested.
     * @return string Binary string of length `$length`.
     *
     * @throws InvalidConfigurationException If `$length` is not positive or the
     *                                       system CSPRNG is not available.
     */
    public function bytes(int $length): string
    {
        if ($length < 1) {
            throw new InvalidConfigurationException("Random byte count must be positive, got {$length}.");
        }

        try {
            return random_bytes($length);
        } catch (Exception $exception) {
            throw new InvalidConfigurationException('The system CSPRNG is unavailable.', 0, $exception);
        }
    }
}
