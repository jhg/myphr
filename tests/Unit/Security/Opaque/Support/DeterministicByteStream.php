<?php

declare(strict_types=1);

namespace Tests\Unit\Security\Opaque\Support;

/**
 * Generador de bytes pseudoaleatorio determinista para el fuzzing ligero de
 * `docs/OPAQUE.md` §20.7.
 *
 * No es un CSPRNG ni pretende serlo: su única propiedad relevante es que la
 * misma semilla produce siempre la misma secuencia, de modo que un fallo de
 * fuzzing se puede reproducir exactamente. Se construye encadenando
 * SHA-512 sobre `semilla || contador`.
 */
final class DeterministicByteStream
{
    private int $counter = 0;

    public function __construct(private readonly string $seed) {}

    /**
     * Devuelve exactamente `$length` bytes binarios (0 <= length).
     *
     * @param  int<0, max>  $length  Número de bytes solicitados.
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
