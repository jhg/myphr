<?php

declare(strict_types=1);

namespace App\Livewire\Hooks;

use App\Crypto\EnvelopeValidator;
use App\Livewire\Contracts\HandlesEncryptedPayloads;
use Illuminate\Support\Facades\Log;
use Livewire\ComponentHook;

/**
 * Guardarraíl de servidor de la Spec 0001 §9 (ADR 0002).
 *
 * Es la mitad de servidor del par de guardarraíles: la de cliente es
 * `resources/js/guards/livewirePayloadGuard.js`, un interceptor de peticiones que revisa lo mismo
 * antes de que salgan del navegador. Ese interceptor no protege del descuido de poner un
 * `wire:model` sin pensarlo en un componente que maneja datos cifrados, porque el propio cliente es
 * quien genera la carga: este hook cubre justo ese caso, en el servidor, sobre cada actualización de
 * propiedad.
 *
 * Solo vigila componentes que implementan {@see HandlesEncryptedPayloads}: aplicarlo a todos los
 * componentes del panel dispararía falsos positivos sobre texto en claro legítimo (nombres de
 * pacientes en `UserResource`, por ejemplo, que no es dato cifrado en este proyecto).
 *
 * El umbral espeja el del guardarraíl de cliente ({@see self::MAX_PLAINTEXT_LENGTH}, igual al
 * `MAX_PLAINTEXT_LENGTH` de `resources/js/guards/livewirePayloadGuard.js`): un sobre cifrado real,
 * con el menor relleno del ADR 0004, no baja de unos 450 caracteres, así que cualquier cadena por
 * encima del umbral sin el prefijo `v1.` es, o un dato en claro que no debería viajar, o un valor mal
 * formado.
 *
 * El incidente se registra sin el valor ofendido: la ruta de la propiedad basta para depurar, y
 * escribir el valor en el log sería filtrar el propio dato clínico que el guardarraíl protege.
 */
final class EncryptedPayloadGuardHook extends ComponentHook
{
    /** Igual que `MAX_PLAINTEXT_LENGTH` en `resources/js/guards/livewirePayloadGuard.js`. */
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
