<?php

declare(strict_types=1);

namespace Tests\Unit\Security\Opaque\Support;

/**
 * Deterministic pseudorandom byte generator for the light fuzzing in
 * `docs/OPAQUE.md` §20.7.
 *
 * It is not a CSPRNG and does not pretend to be: its only relevant property is
 * that the same seed always produces the same sequence, so a fuzzing failure
 * can be reproduced exactly. It is built by chaining SHA-512 over
 * `seed || counter`.
 */
final class DeterministicByteStream
{
    private int $counter = 0;

    public function __construct(private readonly string $seed) {}

    /**
     * Returns exactly `$length` binary bytes (0 <= length).
     *
     * @param  int<0, max>  $length  Number of bytes requested.
     */
    public function bytes(int $length): string
    {
        $output = '';

        while (strlen($output) < $length) {
            $output .= hash('sha512', $this->seed.pack('J', $this->counter), true);
            $this->counter++;
        }

        return substr($output, 0, $length);
    }

    /**
     * Entero uniforme en `[$min, $max]`, derivado del propio flujo.
     */
    public function intBetween(int $min, int $max): int
    {
        $span = $max - $min + 1;
        $value = unpack('J', $this->bytes(8))[1];

        return $min + (int) (($value >> 1) % $span);
    }
}
