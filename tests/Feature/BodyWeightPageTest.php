<?php

declare(strict_types=1);

use App\Catalog\BodyHeightLoincCode;
use App\Filament\Pages\BodyWeight;
use App\Models\Event;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use Livewire\Livewire;

uses(RefreshDatabase::class);

/**
 * Tests del transporte de la pantalla de peso corporal (ADR 0002, ADR 0004, ADR 0006) y del
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

    $result = Livewire::test(BodyWeight::class)
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

    expect(fn () => Livewire::test(BodyWeight::class)
        ->instance()
        ->storeEvent('esto no es un sobre cifrado', canonicalOccurredAtNow()))
        ->toThrow(ValidationException::class);

    expect(Event::query()->count())->toBe(0);
});

it('rechaza una fecha sin microsegundos', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    expect(fn () => Livewire::test(BodyWeight::class)
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

    $result = Livewire::test(BodyWeight::class)
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

    /**
     * Las llamadas van por `call()` y no por `instance()`: invocar el método sobre la instancia se
     * salta el ciclo de hidratación y deshidratación de Livewire, y entonces el snapshot que se
     * inspecciona es el de antes de la llamada.
     */
    $test = Livewire::test(BodyWeight::class)
        ->call('storeEvent', $envelope, canonicalOccurredAtNow())
        ->call('fetchEvents');

    $snapshotJson = json_encode($test->snapshot);

    expect($snapshotJson)->not->toContain($envelope);
    expect($snapshotJson)->not->toContain('v1.');
});

it('el catálogo trae el código LOINC verificado y las dos unidades UCUM del ADR 0005', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $catalog = Livewire::test(BodyWeight::class)
        ->instance()
        ->catalog();

    /** 3141-9 «Body weight Measured», verificado contra LOINC; no depende de la unidad. */
    expect($catalog['loinc'])->toBe('3141-9');

    expect($catalog['units'])->toBe([
        ['code' => 'kg', 'label' => 'kg'],
        ['code' => '[lb_av]', 'label' => 'lb'],
    ]);

    /**
     * El código UCUM de la libra lleva corchetes y la etiqueta no: es la distinción del ADR 0005
     * entre lo que se guarda (código de intercambio) y lo que se enseña.
     */
    expect(collect($catalog['units'])->pluck('label')->all())->not->toContain('[lb_av]');
});

it('el catálogo trae el código LOINC de estatura y sus dos unidades UCUM', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $catalog = Livewire::test(BodyWeight::class)
        ->instance()
        ->catalog();

    /**
     * 8302-2 «Body height», el genérico: la pantalla no pregunta postura (de pie / tumbado) ni
     * método (medida / declarada), así que no puede afirmar ninguno de los dos. Ver
     * `App\Catalog\BodyHeightLoincCode`.
     */
    expect($catalog['heightLoinc'])->toBe(BodyHeightLoincCode::Generic->value);
    expect($catalog['heightLoinc'])->toBe('8302-2');

    expect($catalog['heightUnits'])->toBe([
        ['code' => 'cm', 'label' => 'cm'],
        ['code' => '[in_i]', 'label' => 'in'],
    ]);

    /** La pulgada se guarda como `[in_i]` (UCUM la distingue de la US survey) y se enseña como `in`. */
    expect(collect($catalog['heightUnits'])->pluck('label')->all())->not->toContain('[in_i]');
});

it('el término oficial LOINC de la estatura no se traduce (ADR 0005)', function (): void {
    expect(BodyHeightLoincCode::Generic->officialName())->toBe('Body height');
});

/*
|--------------------------------------------------------------------------
| Contrato entre cliente y servidor
|--------------------------------------------------------------------------
|
| Los contratos de esta pantalla son de texto, no de tipos: nombres de método que el cliente escribe
| como cadena, y `x-ref` que la plantilla declara y el módulo lee. Ninguno de los dos falla al
| compilar ni al desplegar: fallan al pulsar. Se leen los ficheros y se cruzan. Es el mismo barrido
| que hace `BloodPressurePageTest`, tras el `MethodNotFoundException` que llegó a producción.
|
*/

/** @return string Código fuente del módulo Alpine de la pantalla. */
function bodyWeightModuleSource(): string
{
    return file_get_contents(resource_path('js/health/bodyWeightPage.js'));
}

/** @return string Código fuente de la plantilla Blade de la pantalla. */
function bodyWeightTemplateSource(): string
{
    return file_get_contents(resource_path('views/phr/pages/body-weight.blade.php'));
}

/**
 * La plantilla sin sus comentarios Blade. Las reglas del ADR 0002 se comprueban sobre el marcado
 * que llega al navegador: los comentarios citan `wire:model` o `@island` para explicar por qué se
 * usan o no, y contarlos daría un falso positivo.
 */
function bodyWeightTemplateMarkup(): string
{
    return preg_replace('/\{\{--.*?--\}\}/s', '', bodyWeightTemplateSource());
}

it('cada $wire.<metodo> del modulo existe como metodo publico de la pagina', function (): void {
    preg_match_all('/\$wire\.(\w+)\(/', bodyWeightModuleSource(), $matches);

    expect($matches[1])->not->toBeEmpty();

    $publicMethods = collect((new ReflectionClass(BodyWeight::class))->getMethods(ReflectionMethod::IS_PUBLIC))
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

    $page = Livewire::test(BodyWeight::class)->instance();

    $stored = $page->storeEvent(envelopeCipherText(), canonicalOccurredAtNow());
    expect(array_keys($stored))->toBe(['id', 'occurredAt']);

    /** `loadHistory()` lee estos tres campos de cada fila; si faltase uno, el sobre no abriría. */
    $fetched = $page->fetchEvents();
    expect($fetched)->toHaveCount(1);
    expect(array_keys($fetched[0]))->toBe(['id', 'occurredAt', 'payload']);
});

it('cada this.$refs del modulo tiene su x-ref en la plantilla', function (): void {
    preg_match_all('/this\.\$refs\.(\w+)/', bodyWeightModuleSource(), $usedMatches);
    preg_match_all('/x-ref="(\w+)"/', bodyWeightTemplateSource(), $declaredMatches);

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
    preg_match_all('/this\.\$refs\.(\w+)/', bodyWeightModuleSource(), $usedMatches);
    preg_match_all('/x-ref="(\w+)"/', bodyWeightTemplateSource(), $declaredMatches);

    /**
     * `form` y `error` los declaran todas las pantallas de eventos y ninguna los lee desde
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
    expect(bodyWeightTemplateSource())->toContain('<x-filament-panels::page>');
});

it('el historial va en un island y la grafica solo con wire:ignore', function (): void {
    $template = bodyWeightTemplateMarkup();

    /**
     * El historial lleva las dos capas del ADR 0002: `@island` fuera y `wire:ignore` dentro. La
     * gráfica NO lleva island, y es deliberado: el servidor emite el island vacío tras cualquier
     * petición de Livewire, el `<canvas>` desaparece y `$refs.chart` queda indefinido.
     */
    expect($template)->toContain("@island(name: 'body-weight-list')");
    expect($template)->not->toContain("@island(name: 'body-weight-chart')");

    foreach (['body-weight-list', 'body-weight-chart'] as $region) {
        expect($template)->toContain("wire:key=\"{$region}-region\"");
    }

    expect(substr_count($template, 'wire:ignore'))->toBe(2);
    expect(substr_count($template, '@island('))->toBe(1);
});

it('el canvas tiene nombre accesible y un pie que lo describe en texto', function (): void {
    $template = bodyWeightTemplateMarkup();

    /** Do's #3: la tendencia no puede comunicarse solo por el color de la línea. */
    expect($template)->toContain('aria-describedby="body-weight-chart-caption"');
    expect($template)->toContain('id="body-weight-chart-caption"');
    expect(substr_count($template, 'role="img"'))->toBe(1);
});

it('la plantilla no usa wire:model en ninguna variante', function (): void {
    expect(bodyWeightTemplateMarkup())->not->toContain('wire:model');
});

it('los option de unidad los renderiza Blade, no Alpine', function (): void {
    expect(bodyWeightTemplateSource())->toContain("@foreach (\$catalog['units'] as \$unit)");

    /** Si Alpine creara `<option>`, el morph los borraría en la primera petición (ADR 0002). */
    expect(bodyWeightModuleSource())->not->toContain("createElement('option')");
});

it('el historial hereda el filtro por rango de fechas', function (): void {
    /** El control común vive en una sola plantilla; la pantalla la incluye, no la copia. */
    expect(bodyWeightTemplateSource())
        ->toContain("@include('phr.partials.date-range', ['idPrefix' => 'body-weight'])");

    $module = bodyWeightModuleSource();

    expect($module)->toContain("from './dateRange.js'");
    expect($module)->toContain('...dateRangeControl()');
    /** El rango viaja como argumento de `fetchEvents`, nunca como propiedad de Livewire (ADR 0002). */
    expect($module)->toContain('this.$wire.fetchEvents(null, HISTORY_FETCH_LIMIT, range.from, range.to)');
});

it('el campo numerico sigue la convencion de .ai/guidelines/ai.md', function (): void {
    $field = str(bodyWeightTemplateSource())->after('id="body-weight-value"')->before('>')->toString();

    expect($field)->toContain('type="number"');
    expect($field)->toContain('min="0"');
    expect($field)->toContain('step="any"');
    expect($field)->toContain('inputmode="decimal"');
    expect($field)->toContain('font-mono');
    expect($field)->toContain('min-h-11');

    /** El límite de dos decimales y la normalización de coma a punto son de `numericValue.js`. */
    expect(bodyWeightModuleSource())->toContain("from './numericValue.js'");
});

it('cada campo del formulario tiene una etiqueta visible asociada', function (): void {
    $template = bodyWeightTemplateSource();

    preg_match_all('/<label for="([\w-]+)"/', $template, $labels);
    /** Solo controles: el `id` del pie de la gráfica existe para `aria-describedby`, no es campo. */
    preg_match_all('/<(?:input|select|textarea)\s+id="([\w-]+)"/', $template, $fields);

    /** DESIGN.md: la etiqueta siempre visible, nunca un placeholder haciendo de etiqueta. */
    expect(array_diff($fields[1], $labels[1]))->toBe([]);
});

it('el campo de estatura es opcional, numerico y esta explicado en la propia pantalla', function (): void {
    $template = bodyWeightTemplateSource();

    $field = str($template)->after('id="body-weight-height"')->before('>')->toString();

    /** Convención de todo campo de medida del proyecto (.ai/guidelines/ai.md). */
    expect($field)->toContain('type="number"');
    expect($field)->toContain('min="0"');
    expect($field)->toContain('step="any"');
    expect($field)->toContain('inputmode="decimal"');

    /** Opcional de verdad: ni `aria-required`, ni el asterisco que llevan peso y fecha. */
    expect($field)->not->toContain('aria-required');

    /**
     * Y explicado donde se ve, no solo en el código: sin ese texto, el campo vacío se lee como un
     * olvido y se acaba rellenando de memoria cada semana.
     */
    expect($template)->toContain('The height is optional');
});

it('la pantalla advierte de que el IMC no es un diagnostico y no lo categoriza', function (): void {
    $template = bodyWeightTemplateMarkup();

    expect($template)->toContain('not a diagnosis');
    expect($template)->toContain('percentiles for age and sex');

    /** Ni categorías ni colores de juicio en ninguna parte de la pantalla ni del módulo. */
    foreach (['Overweight', 'Obese', 'Underweight', 'Normal weight'] as $verdict) {
        expect($template)->not->toContain($verdict);
        expect(bodyWeightModuleSource())->not->toContain($verdict);
    }
});

it('el titulo y la etiqueta de navegacion nombran las dos magnitudes', function (): void {
    expect((new BodyWeight)->getTitle())->toBe(__('Weight and height'));
    expect(BodyWeight::getNavigationLabel())->toBe(__('Weight and height'));

    /**
     * El nombre interno NO se renombra con la etiqueta: el componente Alpine vive en
     * `resources/js/app.js`, que está vetado mientras haya trabajo concurrente. Este test fija esa
     * decisión para que nadie la deshaga a medias y deje la pantalla muda.
     */
    expect(bodyWeightTemplateSource())->toContain('x-data="phrBodyWeightPage"');
});
