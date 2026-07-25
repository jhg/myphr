<?php

declare(strict_types=1);

use App\Catalog\FoodQuantityUnit;
use App\Catalog\MealType;
use App\Filament\Pages\HealthEventPage;
use App\Filament\Pages\Meals;
use App\Models\Event;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use Livewire\Livewire;

uses(RefreshDatabase::class);

/** Módulo Alpine de la pantalla, fuente del contrato con el servidor y con el DOM. */
function mealsModuleSource(): string
{
    return file_get_contents(base_path('resources/js/health/mealsPage.js'));
}

function mealsViewSource(): string
{
    return file_get_contents(base_path('resources/views/phr/pages/meals.blade.php'));
}

/**
 * Tests del transporte de la pantalla de comidas (ADR 0002, ADR 0004, ADR 0006).
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

    $result = Livewire::test(Meals::class)
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

    expect(fn () => Livewire::test(Meals::class)
        ->instance()
        ->storeEvent('esto no es un sobre cifrado', canonicalOccurredAtNow()))
        ->toThrow(ValidationException::class);

    expect(Event::query()->count())->toBe(0);
});

it('rechaza una fecha que no está en la forma canónica del ADR 0004', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    expect(fn () => Livewire::test(Meals::class)
        ->instance()
        ->storeEvent(envelopeCipherText(), now()->utc()->format('Y-m-d\TH:i:s\Z')))
        ->toThrow(ValidationException::class);

    expect(Event::query()->count())->toBe(0);
});

it('fetchEvents solo devuelve los eventos del usuario autenticado', function (): void {
    $user = User::factory()->registered()->create();
    $otherUser = User::factory()->registered()->create();

    $ownEvent = Event::factory()->for($user)->create();
    Event::factory()->for($otherUser)->create();

    $this->actingAs($user);

    $result = Livewire::test(Meals::class)
        ->instance()
        ->fetchEvents();

    expect($result)->toHaveCount(1);
    expect($result[0]['id'])->toBe($ownEvent->id);
});

/**
 * Un usuario nuevo no tiene ningún evento: `fetchEvents` devuelve una lista vacía sin fallar, y es
 * el cliente quien pinta el estado «todavía no hay comidas registradas» en vez de una tarjeta vacía.
 */
it('fetchEvents devuelve una lista vacía para un usuario recién registrado', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    expect(Livewire::test(Meals::class)->instance()->fetchEvents())->toBe([]);
});

/**
 * El test que exige el ADR 0002: el ciphertext baja como valor de retorno y sube como parámetro,
 * nunca por una propiedad pública, así que el snapshot del componente no puede contenerlo.
 */
it('el snapshot del componente no contiene ningún sobre cifrado', function (): void {
    $user = User::factory()->registered()->create();
    $envelope = envelopeCipherText();

    Event::factory()->for($user)->create(['payload' => envelopeCipherText()]);

    $this->actingAs($user);

    /**
     * Las llamadas van por `call()` y no por `instance()`: invocar el método sobre la instancia se
     * salta el ciclo de hidratación y deshidratación de Livewire, y entonces el snapshot que se
     * inspecciona es el de antes de la llamada.
     */
    $test = Livewire::test(Meals::class)
        ->call('storeEvent', $envelope, canonicalOccurredAtNow())
        ->call('fetchEvents');

    $snapshotJson = json_encode($test->snapshot);

    expect($snapshotJson)->not->toContain($envelope);
    expect($snapshotJson)->not->toContain('v1.');
});

/**
 * Contrato con el servidor. En producción apareció un `MethodNotFoundException` porque el módulo
 * seguía llamando a `storeBloodPressureEvent` después de que el transporte se unificara en
 * `HealthEventPage::storeEvent()`. Nada comprobaba que el nombre existiera de verdad: esto lo hace.
 */
it('cada $wire.<metodo> del modulo existe como metodo publico de la pagina', function (): void {
    preg_match_all('/\$wire\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/', mealsModuleSource(), $matches);

    $calledMethods = array_unique($matches[1]);

    expect($calledMethods)->not->toBeEmpty();

    foreach ($calledMethods as $method) {
        expect(method_exists(Meals::class, $method))
            ->toBeTrue("El módulo llama a \$wire.{$method}(), que no existe en ".Meals::class);

        expect((new ReflectionMethod(Meals::class, $method))->isPublic())
            ->toBeTrue("\$wire.{$method}() existe pero no es público: Livewire no lo puede invocar.");
    }
});

/**
 * El número de argumentos también es parte del contrato: `storeEvent($payload, $occurredAt)` con un
 * solo argumento revienta igual de tarde que un nombre equivocado.
 */
it('las llamadas a storeEvent y fetchEvents pasan los argumentos que la pagina espera', function (): void {
    $source = mealsModuleSource();

    expect($source)->toContain('$wire.storeEvent(payload, occurredAt)');
    expect($source)->toContain('$wire.fetchEvents()');

    $storeEvent = new ReflectionMethod(HealthEventPage::class, 'storeEvent');
    expect($storeEvent->getNumberOfParameters())->toBe(2);
    expect($storeEvent->getParameters()[0]->getName())->toBe('payload');
    expect($storeEvent->getParameters()[1]->getName())->toBe('occurredAt');

    /** `fetchEvents()` se llama sin argumentos: los dos suyos tienen que ser opcionales. */
    expect((new ReflectionMethod(HealthEventPage::class, 'fetchEvents'))->getNumberOfRequiredParameters())->toBe(0);
});

/** Los campos que el cliente lee de cada evento devuelto tienen que existir en la respuesta. */
it('fetchEvents devuelve exactamente las claves que lee el modulo', function (): void {
    $user = User::factory()->registered()->create();
    Event::factory()->for($user)->create();

    $this->actingAs($user);

    $event = Livewire::test(Meals::class)->instance()->fetchEvents()[0];

    expect(array_keys($event))->toEqualCanonicalizing(['id', 'occurredAt', 'payload']);
});

/**
 * Contrato del DOM. Un `this.$refs.X` sin su `x-ref="X"` es `undefined` y revienta al pulsar, sin
 * aviso previo; un `x-ref` declarado y no usado sobra y confunde a quien venga después.
 */
it('los $refs del modulo y los x-ref de la plantilla son exactamente los mismos', function (): void {
    preg_match_all('/\$refs\.([A-Za-z_][A-Za-z0-9_]*)/', mealsModuleSource(), $usedMatches);
    preg_match_all('/x-ref="([^"]+)"/', mealsViewSource(), $declaredMatches);

    $used = array_unique($usedMatches[1]);
    $declared = array_unique($declaredMatches[1]);

    sort($used);
    sort($declared);

    expect($used)->toBe($declared);
});

/** Los `data-*` de la fila de alimento son la otra mitad del contrato del DOM. */
it('los data-* de la fila de alimento existen en la plantilla', function (): void {
    $view = mealsViewSource();

    foreach (['data-food-row', 'data-food-name', 'data-food-quantity', 'data-food-unit', 'data-food-remove'] as $hook) {
        expect($view)->toContain($hook);
    }
});

/**
 * Reglas del ADR 0002 que la plantilla no puede perder: nada de `wire:model`, la región descifrada
 * dentro del island con `wire:ignore` y `wire:key` estable, y la página envuelta en el componente de
 * página de Filament (sin él, la primera tarjeta queda pegada a la barra superior).
 */
it('la plantilla cumple el ADR 0002 y va envuelta en el componente de pagina de Filament', function (): void {
    $view = mealsViewSource();

    /** `wire:model=` y no `wire:model` a secas: el comentario de cabecera nombra la regla. */
    expect($view)->not->toContain('wire:model=');
    expect($view)->toContain('<x-filament-panels::page>');
    expect($view)->toContain('</x-filament-panels::page>');
    expect($view)->toContain("@island(name: 'meals-list')");
    expect($view)->toContain('wire:ignore x-ref="list" wire:key="meals-list-region"');

    /** La acción que dispara la petición va FUERA del island: el island solo envuelve la lista. */
    $islandStart = strpos($view, "@island(name: 'meals-list')");
    expect(strpos($view, '@submit.prevent="submit"'))->toBeLessThan($islandStart);
});

/**
 * Convención de campo numérico clínico (`.ai/guidelines/ai.md`): la cantidad de cada alimento es un
 * valor de medida, así que nunca `type="text"`.
 */
it('la cantidad de alimento es un campo numerico con min 0 y step any', function (): void {
    $view = mealsViewSource();

    expect($view)->toMatch('/type="number"\s+min="0"\s+step="any"\s+inputmode="decimal"\s+data-food-quantity/');
    expect(mealsModuleSource())->toContain('parseNumericValue');
});

/** ADR 0002: los `<option>` los emite el servidor, nunca Alpine (el morph los borraría). */
it('los option de los catalogos los renderiza Blade y no Alpine', function (): void {
    $user = User::factory()->registered()->create();
    $this->actingAs($user);

    $html = Livewire::test(Meals::class)->html();

    foreach (MealType::cases() as $mealType) {
        expect($html)->toContain('<option value="'.$mealType->value.'">');
    }

    foreach (FoodQuantityUnit::cases() as $unit) {
        expect($html)->toContain('<option value="'.e($unit->value).'">');
    }

    /** El módulo no fabrica ningún `<option>` ni toca la colección `options` de un `<select>`. */
    expect(mealsModuleSource())->not->toContain("createElement('option')");
    expect(mealsModuleSource())->not->toContain('innerHTML');
});

/** El catálogo es dato público en claro: mismas claves que espera el módulo (ADR 0005). */
it('el catalogo publica los tres bloques que el modulo necesita', function (): void {
    $catalog = (new Meals)->catalog();

    expect(array_keys($catalog))->toEqualCanonicalizing(['mealTypes', 'units', 'recordedByRoles']);
    expect($catalog['mealTypes'][0])->toHaveKeys(['token', 'label']);
    expect($catalog['units'][0])->toHaveKeys(['code', 'label']);
    expect($catalog['recordedByRoles'][0])->toHaveKeys(['token', 'label']);

    /** El origen del dato no se publica: no hay nada que elegir, siempre es `manual`. */
    expect($catalog)->not->toHaveKey('dataOrigins');
});
