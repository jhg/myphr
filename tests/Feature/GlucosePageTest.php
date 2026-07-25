<?php

declare(strict_types=1);

use App\Filament\Pages\Glucose;
use App\Models\Event;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use Livewire\Livewire;

uses(RefreshDatabase::class);

/** Módulo Alpine de la pantalla, fuente del contrato con el servidor y con el DOM. */
function glucoseModuleSource(): string
{
    return file_get_contents(base_path('resources/js/health/glucosePage.js'));
}

function glucoseViewSource(): string
{
    return file_get_contents(base_path('resources/views/phr/pages/glucose.blade.php'));
}

/**
 * La plantilla sin sus comentarios `{{-- --}}`: los contratos se comprueban contra el marcado que
 * llega al navegador, no contra la prosa que lo explica —que nombra a propósito `wire:model` y los
 * `x-ref` para decir por qué están o no están—.
 */
function glucoseViewMarkup(): string
{
    return preg_replace('/\{\{--.*?--\}\}/s', '', glucoseViewSource());
}

/**
 * Tests del transporte de la pantalla de glucemia (ADR 0002, ADR 0004, ADR 0006).
 *
 * `envelopeCipherText()` y `canonicalOccurredAtNow()` son globales y viven en `tests/Pest.php`:
 * los necesitan las cuatro pantallas de eventos, y declararlos en dos ficheros de `Feature` rompe
 * la suite entera con «cannot redeclare function».
 */
it('guarda un evento con un sobre bien formado y una fecha canónica', function (): void {
    $user = User::factory()->registered()->create();
    $envelope = envelopeCipherText();
    $occurredAt = canonicalOccurredAtNow();

    $this->actingAs($user);

    $result = Livewire::test(Glucose::class)
        ->instance()
        ->storeEvent($envelope, $occurredAt);

    expect($result['id'])->toBeString();
    expect($result['occurredAt'])->toBe($occurredAt);

    $this->assertDatabaseHas('events', [
        'id' => $result['id'],
        'user_id' => $user->id,
        'payload' => $envelope,
    ]);
});

it('rechaza un payload mal formado y no crea ninguna fila', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    expect(fn () => Livewire::test(Glucose::class)
        ->instance()
        ->storeEvent('esto no es un sobre cifrado', canonicalOccurredAtNow()))
        ->toThrow(ValidationException::class);

    expect(Event::query()->count())->toBe(0);
});

it('rechaza una fecha sin microsegundos', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    expect(fn () => Livewire::test(Glucose::class)
        ->instance()
        ->storeEvent(envelopeCipherText(), now()->utc()->format('Y-m-d\TH:i:s\Z')))
        ->toThrow(ValidationException::class);

    expect(Event::query()->count())->toBe(0);
});

it('rechaza una fecha con desfase horario en vez de Z', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    expect(fn () => Livewire::test(Glucose::class)
        ->instance()
        ->storeEvent(envelopeCipherText(), now()->format('Y-m-d\TH:i:s.u').'+02:00'))
        ->toThrow(ValidationException::class);

    expect(Event::query()->count())->toBe(0);
});

it('fetchEvents solo devuelve los eventos del usuario autenticado', function (): void {
    $user = User::factory()->registered()->create();
    $otherUser = User::factory()->registered()->create();

    $ownEvent = Event::factory()->for($user)->create();
    Event::factory()->for($otherUser)->create();

    $this->actingAs($user);

    $result = Livewire::test(Glucose::class)
        ->instance()
        ->fetchEvents();

    expect($result)->toHaveCount(1);
    expect($result[0]['id'])->toBe($ownEvent->id);
});

it('storeEvent y fetchEvents aíslan los eventos por usuario, sin ver los de otro', function (): void {
    $user = User::factory()->registered()->create();
    $otherUser = User::factory()->registered()->create();

    $this->actingAs($user);
    $ownResult = Livewire::test(Glucose::class)
        ->instance()
        ->storeEvent(envelopeCipherText(), canonicalOccurredAtNow());

    $this->actingAs($otherUser);
    Livewire::test(Glucose::class)
        ->instance()
        ->storeEvent(envelopeCipherText(), canonicalOccurredAtNow());

    $this->actingAs($user);
    $result = Livewire::test(Glucose::class)
        ->instance()
        ->fetchEvents();

    expect($result)->toHaveCount(1);
    expect($result[0]['id'])->toBe($ownResult['id']);

    $this->assertDatabaseHas('events', [
        'id' => $ownResult['id'],
        'user_id' => $user->id,
    ]);
});

/**
 * El test que exige el ADR 0002: el ciphertext baja como valor de retorno y sube como parámetro,
 * nunca por una propiedad pública, así que el snapshot del componente no puede contenerlo. Sigue el
 * mismo enfoque que `tests/Feature/EncryptedPayloadGuardTest.php`.
 */
it('el snapshot del componente no contiene ningún sobre cifrado', function (): void {
    $user = User::factory()->registered()->create();
    $envelope = envelopeCipherText();
    $occurredAt = canonicalOccurredAtNow();

    Event::factory()->for($user)->create(['payload' => envelopeCipherText()]);

    $this->actingAs($user);

    /**
     * Las llamadas van por `call()` y no por `instance()`: invocar el método sobre la instancia se
     * salta el ciclo de hidratación y deshidratación de Livewire, y entonces el snapshot que se
     * inspecciona es el de antes de la llamada. El test pasaría aunque el sobre acabase en una
     * propiedad pública, que es justo lo que tiene que detectar.
     */
    $test = Livewire::test(Glucose::class)
        ->call('storeEvent', $envelope, $occurredAt)
        ->call('fetchEvents');

    $snapshotJson = json_encode($test->snapshot);

    expect($snapshotJson)->not->toContain($envelope);
    expect($snapshotJson)->not->toContain('v1.');
});

/**
 * Contrato cliente-servidor (el fallo que llegó a producción: `storeBloodPressureEvent` seguía
 * llamándose desde JavaScript después de que el método pasara a llamarse `storeEvent` en
 * `HealthEventPage`). Nada comprobaba que el nombre existiera; esto lo comprueba.
 */
it('cada $wire.<metodo> del modulo existe como metodo publico de la pagina', function (): void {
    preg_match_all('/\$wire\.([A-Za-z0-9_]+)\s*\(/', glucoseModuleSource(), $matches);

    expect($matches[1])->not->toBeEmpty();

    foreach (array_unique($matches[1]) as $method) {
        $reflection = new ReflectionClass(Glucose::class);

        expect($reflection->hasMethod($method))
            ->toBeTrue("El módulo llama a \$wire.{$method}(), que no existe en Glucose ni en HealthEventPage.");
        expect($reflection->getMethod($method)->isPublic())
            ->toBeTrue("\$wire.{$method}() existe pero no es público: Livewire no lo puede invocar.");
    }
});

it('cada $wire.<metodo> se llama con un numero de argumentos que el metodo acepta', function (): void {
    preg_match_all('/\$wire\.([A-Za-z0-9_]+)\s*\(([^)]*)\)/', glucoseModuleSource(), $matches, PREG_SET_ORDER);

    expect($matches)->not->toBeEmpty();

    foreach ($matches as [, $method, $arguments]) {
        $given = trim($arguments) === '' ? 0 : count(explode(',', $arguments));
        $reflected = (new ReflectionClass(Glucose::class))->getMethod($method);

        expect($given)->toBeGreaterThanOrEqual(
            $reflected->getNumberOfRequiredParameters(),
            "\$wire.{$method}() se llama con {$given} argumento(s) y el método exige más.",
        );
        expect($given)->toBeLessThanOrEqual(
            $reflected->getNumberOfParameters(),
            "\$wire.{$method}() se llama con {$given} argumento(s) y el método admite menos.",
        );
    }
});

it('los campos que el cliente lee de fetchEvents y storeEvent existen en la respuesta del servidor', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $stored = Livewire::test(Glucose::class)
        ->instance()
        ->storeEvent(envelopeCipherText(), canonicalOccurredAtNow());

    expect(array_keys($stored))->toEqualCanonicalizing(['id', 'occurredAt']);

    $fetched = Livewire::test(Glucose::class)
        ->instance()
        ->fetchEvents();

    /** `rawEvent.id`, `rawEvent.occurredAt` y `rawEvent.payload` son los tres que lee `loadHistory()`. */
    expect(array_keys($fetched[0]))->toEqualCanonicalizing(['id', 'occurredAt', 'payload']);
});

/**
 * Contrato de DOM: un `$refs` sin su `x-ref` es `undefined` y revienta al pulsar, sin aviso previo;
 * un `x-ref` que nadie lee finge un contrato que no existe.
 */
it('los $refs del modulo y los x-ref de la plantilla coinciden exactamente', function (): void {
    preg_match_all('/\$refs\.([A-Za-z0-9_]+)/', glucoseModuleSource(), $usedMatches);
    preg_match_all('/x-ref="([A-Za-z0-9_]+)"/', glucoseViewMarkup(), $declaredMatches);

    $used = array_unique($usedMatches[1]);
    $declared = array_unique($declaredMatches[1]);

    expect($used)->not->toBeEmpty();
    expect(array_values(array_diff($used, $declared)))->toBe([], 'Hay $refs sin x-ref en la plantilla.');
    expect(array_values(array_diff($declared, $used)))->toBe([], 'Hay x-ref declarados que nadie usa.');
});

it('la vista respeta el ADR 0002 y va envuelta en el componente de pagina de Filament', function (): void {
    $view = glucoseViewMarkup();

    expect($view)->toContain('<x-filament-panels::page>');
    expect($view)->toContain('</x-filament-panels::page>');
    expect($view)->not->toContain('wire:model');

    /**
     * El historial va dentro de un `@island`; la gráfica NO, y es deliberado. Comprobado ejecutando
     * el componente: tras cualquier petición de Livewire el servidor emite el island vacío, así que
     * el `<canvas>` y su pie desaparecen del HTML y `$refs.chart` queda indefinido. Guardar un
     * registro reventaba con «Cannot set properties of undefined». El island no aporta nada en esa
     * región porque el servidor no la renderiza nunca: la construye Alpine entera, y `wire:ignore`
     * ya impide que el morph la toque (ADR 0002).
     */
    expect($view)->toContain("@island(name: 'glucose-list')");
    expect($view)->not->toContain("@island(name: 'glucose-chart')");
    expect($view)->toContain('wire:ignore x-ref="list" wire:key="glucose-list-region"');
    expect($view)->toContain('wire:ignore wire:key="glucose-chart-region"');
});

it('los option los renderiza Blade desde catalog(), no Alpine', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $catalog = Livewire::test(Glucose::class)->instance()->catalog();

    $html = Livewire::test(Glucose::class)->html();

    foreach ($catalog['units'] as $unit) {
        expect($html)->toContain('value="'.$unit['code'].'"');
    }

    foreach ($catalog['methods'] as $method) {
        expect($html)->toContain('value="'.$method['token'].'"');
    }

    foreach ($catalog['mealContexts'] as $mealContext) {
        expect($html)->toContain('value="'.$mealContext['token'].'"');
    }

    foreach ($catalog['recordedByRoles'] as $role) {
        expect($html)->toContain('value="'.$role['token'].'"');
    }
});

/** Convención numérica de `.ai/guidelines/ai.md` y ADR 0004. */
it('el campo de valor es numerico, con min 0 y step any', function (): void {
    $view = glucoseViewMarkup();

    expect($view)->toContain('x-ref="value"');
    expect($view)->toMatch('/x-ref="value"\s+type="number"\s+min="0"\s+step="any"\s+inputmode="decimal"/');
    expect(glucoseModuleSource())->toContain('parseNumericValue(');
});
