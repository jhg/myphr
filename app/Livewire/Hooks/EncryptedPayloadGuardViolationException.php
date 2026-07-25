<?php

declare(strict_types=1);

namespace App\Livewire\Hooks;

use App\Crypto\EnvelopeValidator;
use RuntimeException;

/**
 * Aborto del guardarraíl de servidor (Spec 0001 §9; ADR 0002).
 *
 * El mensaje lleva la ruta de la propiedad ofensora, nunca su valor: registrar el dato en claro en
 * un log o en el mensaje de una excepción sería reproducir el mismo fallo que el guardarraíl existe
 * para evitar.
 */
final class EncryptedPayloadGuardViolationException extends RuntimeException
{
    public static function forPath(string $component, string $path): self
    {
        return new self(
            "Livewire encrypted payload guard: component [{$component}] property [{$path}] carries a "
            .'long value without the '.EnvelopeValidator::PREFIX.' envelope prefix. The update was rejected.'
        );
    }
}
