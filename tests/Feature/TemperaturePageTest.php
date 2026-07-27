<?php

declare(strict_types=1);

use App\Catalog\TemperatureLoincCode;
use App\Catalog\TemperatureMeasurementSite;
use App\Filament\Pages\Temperature;
use App\Models\Event;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use Livewire\Livewire;

uses(RefreshDatabase::class);

/**
 * Tests del transporte de la pantalla de temperatura corporal (ADR 0002, ADR 0004, ADR 0006) y del
 * contrato entre la plantilla, el módulo de Alpine y esta página.
 *
 * El servidor no puede fabricar un sobre cifrado real porque no tiene la clave del cliente. Los
 * tests que necesitan un payload válido usan `envelopeCipherText()` y `canonicalOccurredAtNow()`,
 * los ayudantes GLOBALES de `tests/Pest.php`.
 */
it('guarda un evento con un sobre bien formado y una fecha canónica', function (): void {
    $user = User::factory()->registered()->create();
    $envelope = envelopeCipherText();
    $occurredAt = canonicalOccurredAtNow();

    $this->actingAs($user);

    $result = Livewire::test(Temperature::class)
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

    expect(fn () => Livewire::test(Temperature::class)
        ->instance()
        ->storeEvent('esto no es un sobre cifrado', canonicalOccurredAtNow()))
        ->toThrow(ValidationException::class);

    expect(Event::query()->count())->toBe(0);
});

it('rechaza una fecha con desfase horario en vez de Z', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    expect(fn () => Livewire::test(Temperature::class)
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

    $result = Livewire::test(Temperature::class)
        ->instance()
        ->fetchEvents();

    expect($result)->toHaveCount(1);
    expect($result[0]['id'])->toBe($ownEvent->id);
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

    $test = Livewire::test(Temperature::class)
        ->call('storeEvent', $envelope, canonicalOccurredAtNow())
        ->call('fetchEvents');

    $snapshotJson = json_encode($test->snapshot);

    expect($snapshotJson)->not->toContain($envelope);
    expect($snapshotJson)->not->toContain('v1.');
});

it('el catálogo resuelve un código LOINC verificado por cada sitio de medición', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $catalog = Livewire::test(Temperature::class)
        ->instance()
        ->catalog();

    /**
     * A diferencia de la tensión, aquí el código LOINC depende del sitio: LOINC publica uno por
     * sitio de medida. Los cinco están verificados contra LOINC y no pueden cambiar (entran en el
     * sobre cifrado).
     */
    expect($catalog['loinc'])->toBe([
        ['site' => 'axillary', 'code' => '8328-7'],
        ['site' => 'oral', 'code' => '8331-1'],
        ['site' => 'tympanic', 'code' => '8333-7'],
        ['site' => 'temporal', 'code' => '75539-7'],
        ['site' => 'rectal', 'code' => '8332-9'],
    ]);

    expect($catalog['units'])->toBe([
        ['code' => 'Cel', 'label' => '°C'],
        ['code' => '[degF]', 'label' => '°F'],
    ]);

    expect(collect($catalog['sites'])->pluck('token')->all())
        ->toBe(['axillary', 'oral', 'tympanic', 'temporal', 'rectal']);
});

it('la tabla LOINC del catálogo cubre todos los sitios publicados', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $catalog = Livewire::test(Temperature::class)->instance()->catalog();

    /**
     * Un sitio en el desplegable sin fila en la tabla dejaría a la pantalla sin código que guardar
     * justo al pulsar «Guardar»: el cliente no inventa códigos ni cae al genérico 8310-5.
     */
    expect(collect($catalog['loinc'])->pluck('site')->all())
        ->toBe(collect($catalog['sites'])->pluck('token')->all());
});

it('no usa el código genérico de temperatura corporal', function (): void {
    /**
     * 8310-5 «Body temperature» no dice dónde se midió. La pantalla exige sitio, así que guardarlo
     * sería tirar un dato que sí se tiene (ADR 0005).
     */
    foreach (TemperatureMeasurementSite::cases() as $site) {
        expect(TemperatureLoincCode::resolve($site)->value)->not->toBe('8310-5');
    }
});

/*
|--------------------------------------------------------------------------
| Contrato entre cliente y servidor
|--------------------------------------------------------------------------
|
| Los contratos de esta pantalla son de texto, no de tipos: nombres de método que el cliente escribe
| como cadena, y `x-ref` que la plantilla declara y el módulo lee. Ninguno de los dos falla al
| compilar ni al desplegar: fallan al pulsar. Se leen los ficheros y se cruzan.
|
*/

/** @return string Código fuente del módulo Alpine de la pantalla. */
function temperatureModuleSource(): string
{
    return file_get_contents(resource_path('js/health/temperaturePage.js'));
}

/** @return string Código fuente de la plantilla Blade de la pantalla. */
function temperatureTemplateSource(): string
{
    return file_get_contents(resource_path('views/phr/pages/temperature.blade.php'));
}

/**
 * La plantilla sin sus comentarios Blade. Las reglas del ADR 0002 se comprueban sobre el marcado
 * que llega al navegador: los comentarios citan `wire:model` o `@island` para explicar por qué se
 * usan o no, y contarlos daría un falso positivo.
 */
function temperatureTemplateMarkup(): string
{
    return preg_replace('/\{\{--.*?--\}\}/s', '', temperatureTemplateSource());
}

it('cada $wire.<metodo> del modulo existe como metodo publico de la pagina', function (): void {
    preg_match_all('/\$wire\.(\w+)\(/', temperatureModuleSource(), $matches);

    expect($matches[1])->not->toBeEmpty();

    $publicMethods = collect((new ReflectionClass(Temperature::class))->getMethods(ReflectionMethod::IS_PUBLIC))
        ->keyBy->getName();

    foreach (array_unique($matches[1]) as $method) {
        expect($publicMethods->has($method))->toBeTrue(
            sprintf('El módulo llama a $wire.%s() y esa página no tiene ese método público.', $method)
        );
    }
});

it('el cliente solo lee campos que storeEvent y fetchEvents devuelven de verdad', function (): void {
    $user = User::factory()->registered()->create();
    $this->actingAs($user);

    $page = Livewire::test(Temperature::class)->instance();

    $stored = $page->storeEvent(envelopeCipherText(), canonicalOccurredAtNow());
    expect(array_keys($stored))->toBe(['id', 'occurredAt']);

    /** `loadHistory()` lee estos tres campos de cada fila; si faltase uno, el sobre no abriría. */
    $fetched = $page->fetchEvents();
    expect($fetched)->toHaveCount(1);
    expect(array_keys($fetched[0]))->toBe(['id', 'occurredAt', 'payload']);
});

it('cada this.$refs del modulo tiene su x-ref en la plantilla', function (): void {
    preg_match_all('/this\.\$refs\.(\w+)/', temperatureModuleSource(), $usedMatches);
    preg_match_all('/x-ref="(\w+)"/', temperatureTemplateSource(), $declaredMatches);

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
    preg_match_all('/this\.\$refs\.(\w+)/', temperatureModuleSource(), $usedMatches);
    preg_match_all('/x-ref="(\w+)"/', temperatureTemplateSource(), $declaredMatches);

    /** `form` y `error` los declaran todas las pantallas de eventos y nadie los lee (ver el mismo
     * comentario en `BloodPressurePageTest`). */
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
    expect(temperatureTemplateSource())->toContain('<x-filament-panels::page>');
});

it('el historial va en un island y la grafica solo con wire:ignore', function (): void {
    $template = temperatureTemplateMarkup();

    expect($template)->toContain("@island(name: 'temperature-list')");
    expect($template)->not->toContain("@island(name: 'temperature-chart')");

    foreach (['temperature-list', 'temperature-chart'] as $region) {
        expect($template)->toContain("wire:key=\"{$region}-region\"");
    }

    expect(substr_count($template, 'wire:ignore'))->toBe(2);
    expect(substr_count($template, '@island('))->toBe(1);
});

it('el canvas tiene nombre accesible y un pie que lo describe en texto', function (): void {
    $template = temperatureTemplateMarkup();

    /** Do's #3: la tendencia no puede comunicarse solo por el color de la línea. */
    expect($template)->toContain('aria-describedby="temperature-chart-caption"');
    expect($template)->toContain('id="temperature-chart-caption"');
    expect(substr_count($template, 'role="img"'))->toBe(1);
});

it('la plantilla no usa wire:model en ninguna variante', function (): void {
    expect(temperatureTemplateMarkup())->not->toContain('wire:model');
});

it('los option de unidad y sitio los renderiza Blade, no Alpine', function (): void {
    $template = temperatureTemplateSource();

    expect($template)->toContain("@foreach (\$catalog['units'] as \$unit)");
    expect($template)->toContain("@foreach (\$catalog['sites'] as \$site)");

    /** Si Alpine creara `<option>`, el morph los borraría en la primera petición (ADR 0002). */
    expect(temperatureModuleSource())->not->toContain("createElement('option')");
});

it('el historial hereda el filtro por rango de fechas', function (): void {
    expect(temperatureTemplateSource())
        ->toContain("@include('phr.partials.date-range', ['idPrefix' => 'temperature'])");

    $module = temperatureModuleSource();

    expect($module)->toContain("from './dateRange.js'");
    expect($module)->toContain('...dateRangeControl()');
    /** El rango viaja como argumento de `fetchEvents`, nunca como propiedad de Livewire (ADR 0002). */
    expect($module)->toContain('this.$wire.fetchEvents(null, HISTORY_FETCH_LIMIT, range.from, range.to)');
});

it('el campo numerico sigue la convencion de .ai/guidelines/ai.md', function (): void {
    $field = str(temperatureTemplateSource())->after('id="temperature-value"')->before('>')->toString();

    expect($field)->toContain('type="number"');
    expect($field)->toContain('min="0"');
    expect($field)->toContain('step="any"');
    expect($field)->toContain('inputmode="decimal"');
    expect($field)->toContain('font-mono');
    expect($field)->toContain('min-h-11');

    /** El límite de dos decimales y la normalización de coma a punto son de `numericValue.js`. */
    expect(temperatureModuleSource())->toContain("from './numericValue.js'");
});

it('cada campo del formulario tiene una etiqueta visible asociada', function (): void {
    $template = temperatureTemplateSource();

    preg_match_all('/<label for="([\w-]+)"/', $template, $labels);
    /** Solo controles: el `id` del pie de la gráfica existe para `aria-describedby`, no es campo. */
    preg_match_all('/<(?:input|select|textarea)\s+id="([\w-]+)"/', $template, $fields);

    /** DESIGN.md: la etiqueta siempre visible, nunca un placeholder haciendo de etiqueta. */
    expect(array_diff($fields[1], $labels[1]))->toBe([]);
});
