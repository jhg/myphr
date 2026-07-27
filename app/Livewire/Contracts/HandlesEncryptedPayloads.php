<?php

declare(strict_types=1);

namespace App\Livewire\Contracts;

use App\Livewire\Hooks\EncryptedPayloadGuardHook;

/**
 * Marker interface (Spec 0001 §9; ADR 0002): a Livewire component that handles encrypted data
 * implements it so {@see EncryptedPayloadGuardHook} watches its public properties.
 *
 * It is an empty interface on purpose: the guardrail needs no method from the component, only to
 * know that it belongs to this category. It is the simplest way to "apply only to components that
 * handle encrypted data" as the spec asks, without the spec pinning down the mechanism.
 */
interface HandlesEncryptedPayloads {}
