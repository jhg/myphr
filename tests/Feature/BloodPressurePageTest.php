<?php

declare(strict_types=1);

use App\Filament\Pages\BloodPressure;
use App\Models\Event;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use Livewire\Livewire;

uses(RefreshDatabase::class);

/**
 * Tests del transporte de la pantalla de tensión arterial (ADR 0002, ADR 0004, ADR 0006) y del
 * contrato entre la plantilla, el módulo de Alpine y esta página.
 *
 * El servidor no puede fabricar un sobre cifrado real porque no tiene la clave del cliente. Los
 * tests que necesitan un payload válido usan `envelopeCipherText()` y `canonicalOccurredAtNow()`,
 * los ayudantes GLOBALES de `tests/Pest.php`: antes este fichero tenía su propia copia con otro
 * nombre, que es la forma de que las dos versiones se separen en silencio.
 */
it('guarda un evento con un sobre bien formado y una fecha canónica', function (): void {
    $user = User::factory()->registered()->create();
    $envelope = envelopeCipherText();
    $occurredAt = canonicalOccurredAtNow();

    $this->actingAs($user);

    $result = Livewire::test(BloodPressure::class)
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

    expect(fn () => Livewire::test(BloodPressure::class)
        ->instance()
        ->storeEvent('esto no es un sobre cifrado', canonicalOccurredAtNow()))
        ->toThrow(ValidationException::class);

    expect(Event::query()->count())->toBe(0);
});

it('rechaza una fecha sin microsegundos', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    expect(fn () => Livewire::test(BloodPressure::class)
        ->instance()
        ->storeEvent(envelopeCipherText(), now()->utc()->format('Y-m-d\TH:i:s\Z')))
        ->toThrow(ValidationException::class);

    expect(Event::query()->count())->toBe(0);
});

it('rechaza una fecha con desfase horario en vez de Z', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    expect(fn () => Livewire::test(BloodPressure::class)
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

    $result = Livewire::test(BloodPressure::class)
        ->instance()
        ->fetchEvents();

    expect($result)->toHaveCount(1);
    expect($result[0]['id'])->toBe($ownEvent->id);
});

it('storeEvent y fetchEvents aíslan los eventos por usuario, sin ver los de otro', function (): void {
    $user = User::factory()->registered()->create();
    $otherUser = User::factory()->registered()->create();

    $this->actingAs($user);
    $ownResult = Livewire::test(BloodPressure::class)
        ->instance()
        ->storeEvent(envelopeCipherText(), canonicalOccurredAtNow());

    $this->actingAs($otherUser);
    Livewire::test(BloodPressure::class)
        ->instance()
        ->storeEvent(envelopeCipherText(), canonicalOccurredAtNow());

    $this->actingAs($user);
    $result = Livewire::test(BloodPressure::class)
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
 * mismo enfoque que `tests/Feature/EncryptedPayloadGuardTest.php` y `GlucosePageTest.php`.
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
    $test = Livewire::test(BloodPressure::class)
        ->call('storeEvent', $envelope, $occurredAt)
        ->call('fetchEvents');

    $snapshotJson = json_encode($test->snapshot);

    expect($snapshotJson)->not->toContain($envelope);
    expect($snapshotJson)->not->toContain('v1.');
});

it('el catálogo trae los tres códigos LOINC verificados y las unidades UCUM del ADR 0005', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $catalog = Livewire::test(BloodPressure::class)
        ->instance()
        ->catalog();

    expect($catalog['loinc'])->toBe([
        'systolic' => '8480-6',
        'diastolic' => '8462-4',
        'pulse' => '8867-4',
    ]);

    expect($catalog['units'])->toBe([
        'pressure' => 'mm[Hg]',
        'pulse' => '/min',
    ]);

    expect(collect($catalog['arms'])->pluck('token')->all())->toBe(['left', 'right']);
    expect(collect($catalog['postures'])->pluck('token')->all())->toBe(['sitting', 'lying', 'standing']);
});

/*
|--------------------------------------------------------------------------
| Contrato entre cliente y servidor
|--------------------------------------------------------------------------
|
| En producción apareció `MethodNotFoundException: Public method
| [storeBloodPressureEvent] not found on component`: el transporte común se extrajo a
| `HealthEventPage` y el método pasó a llamarse `storeEvent`, pero el módulo de Alpine siguió
| llamando al nombre viejo. Nada lo comprobaba. Estos tests lo comprueban.
|
| Los tres contratos de esta pantalla son de texto, no de tipos: nombres de método que el cliente
| escribe como cadena, y `x-ref` que la plantilla declara y el módulo lee. Ninguno de los dos falla
| al compilar ni al desplegar: fallan al pulsar. Se leen los ficheros y se cruzan.
|
*/

/** @return string Código fuente del módulo Alpine de la pantalla. */
function bloodPressureModuleSource(): string
{
    return file_get_contents(resource_path('js/health/bloodPressurePage.js'));
}

/** @return string Código fuente de la plantilla Blade de la pantalla. */
function bloodPressureTemplateSource(): string
{
    return file_get_contents(resource_path('views/phr/pages/blood-pressure.blade.php'));
}

/**
 * La plantilla sin sus comentarios Blade. Las reglas del ADR 0002 se comprueban sobre el marcado
 * que llega al navegador: los comentarios citan `wire:model` o `@island` para explicar por qué se
 * usan o no, y contarlos daría un falso positivo.
 */
function bloodPressureTemplateMarkup(): string
{
    return preg_replace('/\{\{--.*?--\}\}/s', '', bloodPressureTemplateSource());
}

/**
 * Extrae el texto de los argumentos de cada llamada `$wire.<metodo>(...)`, respetando paréntesis
 * anidados, para poder contar cuántos argumentos se pasan de verdad.
 *
 * @return list<array{method: string, arguments: string}>
 */
function bloodPressureWireCalls(string $source): array
{
    preg_match_all('/\$wire\.(\w+)\(/', $source, $matches, PREG_OFFSET_CAPTURE);

    $calls = [];

    foreach ($matches[1] as $index => [$method, $_]) {
        $cursor = $matches[0][$index][1] + strlen($matches[0][$index][0]);
        $depth = 1;
        $start = $cursor;

        while ($depth > 0 && $cursor < strlen($source)) {
            $depth += match ($source[$cursor]) {
                '(' => 1,
                ')' => -1,
                default => 0,
            };
            $cursor++;
        }

        $calls[] = ['method' => $method, 'arguments' => substr($source, $start, $cursor - $start - 1)];
    }

    return $calls;
}

/** @return int Número de argumentos de primer nivel en el texto de una llamada. */
function bloodPressureArgumentCount(string $arguments): int
{
    if (trim($arguments) === '') {
        return 0;
    }

    $count = 1;
    $depth = 0;

    foreach (str_split($arguments) as $character) {
        $depth += match ($character) {
            '(', '[', '{' => 1,
            ')', ']', '}' => -1,
            default => 0,
        };

        if ($character === ',' && $depth === 0) {
            $count++;
        }
    }

    return $count;
}

it('cada $wire.<metodo> del modulo existe como metodo publico de la pagina', function (): void {
    $calls = bloodPressureWireCalls(bloodPressureModuleSource());

    expect($calls)->not->toBeEmpty();

    $publicMethods = collect((new ReflectionClass(BloodPressure::class))->getMethods(ReflectionMethod::IS_PUBLIC))
        ->keyBy->getName();

    foreach ($calls as $call) {
        expect($publicMethods->has($call['method']))->toBeTrue(
            sprintf('El módulo llama a $wire.%s() y esa página no tiene ese método público.', $call['method'])
        );
    }
});

it('cada $wire.<metodo> pasa un numero de argumentos que el metodo del servidor acepta', function (): void {
    foreach (bloodPressureWireCalls(bloodPressureModuleSource()) as $call) {
        $method = new ReflectionMethod(BloodPressure::class, $call['method']);
        $passed = bloodPressureArgumentCount($call['arguments']);

        expect($passed)->toBeGreaterThanOrEqual($method->getNumberOfRequiredParameters());
        expect($passed)->toBeLessThanOrEqual($method->getNumberOfParameters());
    }
});

it('el cliente solo lee campos que storeEvent y fetchEvents devuelven de verdad', function (): void {
    $user = User::factory()->registered()->create();
    $this->actingAs($user);

    $page = Livewire::test(BloodPressure::class)->instance();

    $stored = $page->storeEvent(envelopeCipherText(), canonicalOccurredAtNow());
    expect(array_keys($stored))->toBe(['id', 'occurredAt']);

    /** `loadHistory()` lee estos tres campos de cada fila; si faltase uno, el sobre no abriría. */
    $fetched = $page->fetchEvents();
    expect($fetched)->toHaveCount(1);
    expect(array_keys($fetched[0]))->toBe(['id', 'occurredAt', 'payload']);
});

it('cada this.$refs del modulo tiene su x-ref en la plantilla', function (): void {
    preg_match_all('/this\.\$refs\.(\w+)/', bloodPressureModuleSource(), $usedMatches);
    preg_match_all('/x-ref="(\w+)"/', bloodPressureTemplateSource(), $declaredMatches);

    $used = array_unique($usedMatches[1]);
    $declared = array_unique($declaredMatches[1]);

    expect($used)->not->toBeEmpty();

    foreach ($used as $ref) {
        expect(in_array($ref, $declared, true))->toBeTrue(
            sprintf('El módulo lee this.$refs.%s y la plantilla no declara ese x-ref.', $ref)
        );
    }
});

it('la plantilla no declara ningun x-ref huerfano', function (): void {
    preg_match_all('/this\.\$refs\.(\w+)/', bloodPressureModuleSource(), $usedMatches);
    preg_match_all('/x-ref="(\w+)"/', bloodPressureTemplateSource(), $declaredMatches);

    /**
     * `form` y `error` los declaran las cuatro pantallas de eventos y ninguna los lee desde
     * JavaScript: el formulario se maneja con `@submit.prevent` y el error con `x-text`. Se dejan
     * porque quitarlos solo aquí rompería la simetría entre pantallas, pero se nombran de una en
     * una para que un `x-ref` nuevo y no usado sí haga fallar este test.
     */
    $knownUnused = ['form', 'error'];

    $orphans = array_diff(array_unique($declaredMatches[1]), $usedMatches[1], $knownUnused);

    expect($orphans)->toBe([], 'x-ref declarados en la plantilla que nadie lee: '.implode(', ', $orphans));
});

/*
|--------------------------------------------------------------------------
| Reglas del ADR 0002 y del envoltorio de página
|--------------------------------------------------------------------------
*/

it('la plantilla va envuelta en el componente de pagina de Filament', function (): void {
    /** Sin él se pierde `fi-page-header-main-ctn` y la primera tarjeta queda pegada a la barra. */
    expect(bloodPressureTemplateSource())->toContain('<x-filament-panels::page>');
});

it('el historial va en un island y las graficas solo con wire:ignore', function (): void {
    $template = bloodPressureTemplateMarkup();

    /**
     * El historial lleva las dos capas del ADR 0002: `@island` fuera y `wire:ignore` dentro.
     *
     * Las graficas NO llevan island, y es deliberado. Comprobado ejecutando el componente: tras
     * cualquier peticion de Livewire el servidor emite el island vacio, asi que el `<canvas>` y su
     * pie desaparecen del HTML y `$refs.chart` queda indefinido; guardar un registro reventaba con
     * «Cannot set properties of undefined». El island no aporta nada en esa region porque el
     * servidor no la renderiza nunca, la construye Alpine entera, y `wire:ignore` ya impide que el
     * morph la toque.
     */
    expect($template)->toContain("@island(name: 'blood-pressure-list')");
    expect($template)->not->toContain("@island(name: 'blood-pressure-chart')");
    expect($template)->not->toContain("@island(name: 'blood-pressure-pulse-chart')");

    foreach (['blood-pressure-list', 'blood-pressure-chart', 'blood-pressure-pulse-chart'] as $region) {
        expect($template)->toContain("wire:key=\"{$region}-region\"");
    }

    expect(substr_count($template, 'wire:ignore'))->toBe(3);
    expect(substr_count($template, '@island('))->toBe(1);
});

it('cada canvas tiene nombre accesible y un pie que lo describe en texto', function (): void {
    $template = bloodPressureTemplateMarkup();

    /**
     * Do's #3: la tendencia no puede comunicarse solo por el color de la línea. El pie lo pinta
     * Blade y no el JavaScript, para que tenga un `id` estable al que apuntar desde el lienzo.
     */
    foreach (['blood-pressure-chart-caption', 'blood-pressure-pulse-chart-caption'] as $captionId) {
        expect($template)->toContain('aria-describedby="'.$captionId.'"');
        expect($template)->toContain('id="'.$captionId.'"');
    }

    expect(substr_count($template, 'role="img"'))->toBe(2);
    expect(bloodPressureModuleSource())->not->toContain('insertAdjacentElement');
});

it('la plantilla no usa wire:model en ninguna variante', function (): void {
    expect(bloodPressureTemplateMarkup())->not->toContain('wire:model');
});

it('los option de brazo y postura los renderiza Blade, no Alpine', function (): void {
    $template = bloodPressureTemplateSource();
    $module = bloodPressureModuleSource();

    expect($template)->toContain("@foreach (\$catalog['arms'] as \$arm)");
    expect($template)->toContain("@foreach (\$catalog['postures'] as \$posture)");

    /** Si Alpine creara `<option>`, el morph los borraría en la primera petición (ADR 0002). */
    expect($module)->not->toContain("createElement('option')");
});

it('los campos numericos siguen la convencion de .ai/guidelines/ai.md', function (): void {
    $template = bloodPressureTemplateSource();

    foreach (['bp-systolic', 'bp-diastolic', 'bp-pulse'] as $id) {
        $field = str($template)->after('id="'.$id.'"')->before('>')->toString();

        expect($field)->toContain('type="number"');
        expect($field)->toContain('min="0"');
        expect($field)->toContain('step="any"');
        expect($field)->toContain('inputmode="decimal"');
        expect($field)->toContain('font-mono');
        expect($field)->toContain('min-h-11');
    }

    /** El límite de dos decimales y la normalización de coma a punto son de `numericValue.js`. */
    expect(bloodPressureModuleSource())->toContain("from './numericValue.js'");
});

it('cada campo del formulario tiene una etiqueta visible asociada', function (): void {
    $template = bloodPressureTemplateSource();

    preg_match_all('/<label for="([\w-]+)"/', $template, $labels);
    preg_match_all('/\sid="(bp-[\w-]+)"/', $template, $fields);

    /** DESIGN.md: la etiqueta siempre visible, nunca un placeholder haciendo de etiqueta. */
    expect(array_diff($fields[1], $labels[1]))->toBe([]);
});
