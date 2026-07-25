<?php

declare(strict_types=1);

namespace Tests\Unit\Security\Opaque\Support;

use App\Security\Opaque\InvalidConfigurationException;
use App\Security\Opaque\RandomSource;

/**
 * Fuente de aleatoriedad determinista para tests (`docs/OPAQUE.md` §20.3).
 *
 * Devuelve, en orden, los bloques que se le han precargado, comprobando que
 * cada llamada pide exactamente la longitud del bloque siguiente. Así un test
 * falla en cuanto el orden o el tamaño de los `random()` del protocolo cambia.
 */
final class QueuedRandomSource implements RandomSource
{
    /** @var list<string> */
    private array $queue;

    /**
     * @param  list<string>  $queue  Bloques binarios en el orden en que se consumirán.
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
