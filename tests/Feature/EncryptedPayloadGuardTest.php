<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Livewire\Contracts\HandlesEncryptedPayloads;
use App\Livewire\Hooks\EncryptedPayloadGuardViolationException;
use Livewire\Component;
use Livewire\Livewire;

/**
 * Minimal Livewire component implementing {@see HandlesEncryptedPayloads}, only to exercise the
 * server-side guardrail (Spec 0001 §9, ADR 0002) without depending on a real screen with encrypted
 * data already existing (out of scope of Spec 0001, §1).
 */
final class EncryptedPayloadGuardTestComponent extends Component implements HandlesEncryptedPayloads
{
    public string $envelope = '';

    public string $metadata = 'plain-id';

    public function render(): string
    {
        return '<div></div>';
    }
}

/**
 * Minimal Livewire component that does NOT implement {@see HandlesEncryptedPayloads}, to check that
 * the guardrail only watches the components that do.
 */
final class EncryptedPayloadGuardUnmarkedTestComponent extends Component
{
    public string $plaintext = '';

    public function render(): string
    {
        return '<div></div>';
    }
}

it('rejects on the server a long property without the encrypted envelope prefix', function (): void {
    $plaintext = str_repeat('a', 300);

    expect(fn () => Livewire::test(EncryptedPayloadGuardTestComponent::class)->set('envelope', $plaintext))
        ->toThrow(EncryptedPayloadGuardViolationException::class);
});

it('accepts an encrypted envelope with the v1. prefix', function (): void {
    $envelope = 'v1.'.str_repeat('a', 300);

    Livewire::test(EncryptedPayloadGuardTestComponent::class)
        ->set('envelope', $envelope)
        ->assertSet('envelope', $envelope);
});

it('lets short metadata through even without the prefix', function (): void {
    Livewire::test(EncryptedPayloadGuardTestComponent::class)
        ->set('metadata', 'short-id')
        ->assertSet('metadata', 'short-id');
});

it('does not watch components that do not implement the marker interface', function (): void {
    $plaintext = str_repeat('a', 300);

    Livewire::test(EncryptedPayloadGuardUnmarkedTestComponent::class)
        ->set('plaintext', $plaintext)
        ->assertSet('plaintext', $plaintext);
});

/**
 * The snapshot test Spec 0001 §9/§11 asks for: it fails if any public property of a component that
 * handles encrypted data holds something other than short metadata or an encrypted envelope with the
 * `v1.` prefix.
 */
it('the snapshot of an encrypted component only contains short metadata or v1. envelopes', function (): void {
    $envelope = 'v1.'.base64_encode(random_bytes(64));

    $test = Livewire::test(EncryptedPayloadGuardTestComponent::class)
        ->set('envelope', $envelope)
        ->set('metadata', 'short-id');

    $data = $test->snapshot['data'];

    foreach ($data as $path => $entry) {
        $value = is_array($entry) ? ($entry[0] ?? null) : $entry;

        if (! is_string($value)) {
            continue;
        }

        $isShortMetadata = strlen($value) <= 256;
        $isEncryptedEnvelope = str_starts_with($value, 'v1.');

        expect($isShortMetadata || $isEncryptedEnvelope)
            ->toBeTrue("La propiedad [{$path}] no es ni metadato corto ni un sobre cifrado v1.");
    }
});
