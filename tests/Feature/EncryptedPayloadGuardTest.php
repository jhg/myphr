<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Livewire\Contracts\HandlesEncryptedPayloads;
use App\Livewire\Hooks\EncryptedPayloadGuardViolationException;
use Livewire\Component;
use Livewire\Livewire;

/**
 * Componente Livewire mínimo que implementa {@see HandlesEncryptedPayloads}, solo para ejercitar el
 * guardarraíl de servidor (Spec 0001 §9, ADR 0002) sin depender de que exista ya una pantalla real
 * con datos cifrados (fuera de alcance de la Spec 0001, §1).
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
 * Componente Livewire mínimo que NO implementa {@see HandlesEncryptedPayloads}, para comprobar que
 * el guardarraíl solo vigila los componentes que sí la implementan.
 */
final class EncryptedPayloadGuardUnmarkedTestComponent extends Component
{
    public string $plaintext = '';

    public function render(): string
    {
        return '<div></div>';
    }
}

it('rechaza en servidor una propiedad larga sin el prefijo del sobre cifrado', function (): void {
    $plaintext = str_repeat('a', 300);

    expect(fn () => Livewire::test(EncryptedPayloadGuardTestComponent::class)->set('envelope', $plaintext))
        ->toThrow(EncryptedPayloadGuardViolationException::class);
});

it('acepta un sobre cifrado con el prefijo v1.', function (): void {
    $envelope = 'v1.'.str_repeat('a', 300);

    Livewire::test(EncryptedPayloadGuardTestComponent::class)
        ->set('envelope', $envelope)
        ->assertSet('envelope', $envelope);
});

it('deja pasar metadatos cortos aunque no lleven el prefijo', function (): void {
    Livewire::test(EncryptedPayloadGuardTestComponent::class)
        ->set('metadata', 'short-id')
        ->assertSet('metadata', 'short-id');
});

it('no vigila componentes que no implementan la interfaz marcadora', function (): void {
    $plaintext = str_repeat('a', 300);

    Livewire::test(EncryptedPayloadGuardUnmarkedTestComponent::class)
        ->set('plaintext', $plaintext)
        ->assertSet('plaintext', $plaintext);
});

/**
 * Test de snapshot que pide la Spec 0001 §9/§11: falla si alguna propiedad pública de un componente
 * que maneja datos cifrados contiene algo que no sea metadato corto o sobre cifrado con prefijo
 * `v1.`.
 */
it('el snapshot de un componente cifrado solo contiene metadatos cortos o sobres v1.', function (): void {
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
