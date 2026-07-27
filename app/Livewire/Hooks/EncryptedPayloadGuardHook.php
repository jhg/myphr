<?php

declare(strict_types=1);

namespace App\Livewire\Hooks;

use App\Crypto\EnvelopeValidator;
use App\Livewire\Contracts\HandlesEncryptedPayloads;
use Illuminate\Support\Facades\Log;
use Livewire\ComponentHook;

/**
 * Server-side guardrail from Spec 0001 §9 (ADR 0002).
 *
 * It is the server half of a pair of guardrails: the client half is
 * `resources/js/guards/livewirePayloadGuard.js`, a request interceptor that checks the same thing
 * before anything leaves the browser. That interceptor does not protect against carelessly adding a
 * `wire:model` to a component that handles encrypted data, because the client is the one building
 * the payload: this hook covers exactly that case, on the server, on every property update.
 *
 * It only watches components that implement {@see HandlesEncryptedPayloads}: applying it to every
 * component in the panel would fire false positives on legitimate plaintext (patient names in
 * `UserResource`, for instance, which is not encrypted data in this project).
 *
 * The threshold mirrors the client guardrail's ({@see self::MAX_PLAINTEXT_LENGTH}, the same as
 * `MAX_PLAINTEXT_LENGTH` in `resources/js/guards/livewirePayloadGuard.js`): a real encrypted
 * envelope, with the smallest ADR 0004 padding, never goes below about 450 characters, so any string
 * above the threshold without the `v1.` prefix is either plaintext that should not travel or a
 * malformed value.
 *
 * The incident is logged without the offending value: the property path is enough to debug, and
 * writing the value to the log would leak the very clinical data the guardrail protects.
 */
final class EncryptedPayloadGuardHook extends ComponentHook
{
    /** The same as `MAX_PLAINTEXT_LENGTH` in `resources/js/guards/livewirePayloadGuard.js`. */
    private const int MAX_PLAINTEXT_LENGTH = 256;

    public function update(string $propertyName, string $fullPath, mixed $newValue): void
    {
        if (! $this->component instanceof HandlesEncryptedPayloads) {
            return;
        }

        if (! is_string($newValue)) {
            return;
        }

        if (strlen($newValue) <= self::MAX_PLAINTEXT_LENGTH || str_starts_with($newValue, EnvelopeValidator::PREFIX)) {
            return;
        }

        $component = $this->component::class;

        Log::warning(
            'Livewire encrypted payload guard rejected a property update.',
            ['component' => $component, 'path' => $fullPath],
        );

        throw EncryptedPayloadGuardViolationException::forPath($component, $fullPath);
    }
}
