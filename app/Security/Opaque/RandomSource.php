<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * Injectable source of randomness (`docs/OPAQUE.md` §20.3).
 *
 * It exists so we can reproduce the official RFC 9807 Appendix C vectors,
 * which fix `envelope_nonce`, `masking_nonce`, `server_nonce`, `client_nonce`,
 * seeds and blinds. Every random byte the OPAQUE subsystem generates goes
 * through here; we never call `random_bytes()` directly and we never mock
 * global functions.
 */
interface RandomSource
{
    /**
     * Returns exactly `$length` bytes.
     *
     * @param  int<1, max>  $length  Number of bytes requested.
     * @return string Binary string of length `$length`.
     *
     * @throws InvalidConfigurationException If `$length` is not positive or the
     *                                       source cannot satisfy it.
     */
    public function bytes(int $length): string;
}
