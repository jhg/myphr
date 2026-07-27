<?php

declare(strict_types=1);

namespace App\Livewire\Hooks;

use App\Crypto\EnvelopeValidator;
use RuntimeException;

/**
 * Abort from the server-side guardrail (Spec 0001 §9; ADR 0002).
 *
 * The message carries the path of the offending property, never its value: writing plaintext into a
 * log or into an exception message would reproduce the very failure the guardrail exists to prevent.
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
