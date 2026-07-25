<?php

declare(strict_types=1);

use App\Filament\Pages\Dashboard;
use App\Models\Event;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Livewire;

uses(RefreshDatabase::class);

/**
 * Tests del panel de inicio (ADR 0002, ADR 0004, ADR 0006).
 *
 * El servidor no puede fabricar un sobre cifrado real, así que los tests que necesitan uno usan el
 * ayudante global `envelopeCipherText()` de `tests/Pest.php`, compartido con las demás pantallas de
 * eventos.
 */
const DASHBOARD_MODULE = 'resources/js/health/dashboardPage.js';

const DASHBOARD_VIEW = 'resources/views/phr/pages/dashboard.blade.php';

/**
 * Fuente sin comentarios, para que los tests que prohíben una clase no fallen por citarla en un
 * comentario que explica precisamente por qué no se usa.
 */
function dashboardSourceWithoutComments(string $path): string
{
    $contents = (string) file_get_contents(base_path($path));

    $contents = (string) preg_replace('/\{\{--.*?--\}\}/s', '', $contents);
    $contents = (string) preg_replace('#/\*.*?\*/#s', '', $contents);

    return (string) preg_replace('#(^|\s)//.*$#m', '', $contents);
}

it('carga para un usuario autenticado', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    Livewire::test(Dashboard::class)->assertOk();
});

it('sigue siendo la página de inicio del panel, en /phr', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $this->get('/phr')->assertOk();
    $this->get('/phr')->assertSeeLivewire(Dashboard::class);
});

/**
 * El test que exige el ADR 0002: el ciphertext solo baja como valor de retorno de `fetchEvents`,
 * nunca por una propiedad pública, así que el snapshot del componente no puede contenerlo. Sigue el
 * mismo enfoque que el test homónimo de `GlucosePageTest`.
 */
it('el snapshot del componente no contiene ningún sobre cifrado', function (): void {
    $user = User::factory()->registered()->create();
    $envelope = envelopeCipherText();

    Event::factory()->for($user)->create(['payload' => $envelope]);

    $this->actingAs($user);

    /**
     * Igual que en `GlucosePageTest`: `call()` y no `instance()`, para pasar por la
     * hidratación/deshidratación de Livewire y que el snapshot inspeccionado sea el real.
     */
    $test = Livewire::test(Dashboard::class)->call('fetchEvents');

    $snapshotJson = json_encode($test->snapshot);

    expect($snapshotJson)->not->toContain($envelope);
    expect($snapshotJson)->not->toContain('v1.');
});

/**
 * ─── Contrato cliente/servidor ────────────────────────────────────────────────────────────────
 *
 * El fallo de producción «Public method [storeBloodPressureEvent] not found on component» ocurrió
 * porque nada comprobaba que el nombre que llama el cliente exista en el servidor. Este test lo
 * comprueba: cada `$wire.<metodo>` del módulo tiene que existir como método público de la página
 * (propio o heredado de `HealthEventPage`).
 */
it('cada $wire.<metodo> del módulo existe como método público de la página', function (): void {
    $module = (string) file_get_contents(base_path(DASHBOARD_MODULE));

    preg_match_all('/\$wire\.(\w+)\s*\(/', $module, $matches);

    $calledMethods = array_unique($matches[1]);

    expect($calledMethods)->not->toBeEmpty();

    foreach ($calledMethods as $method) {
        expect(method_exists(Dashboard::class, $method))
            ->toBeTrue("El módulo llama a \$wire.{$method}(), que no existe en ".Dashboard::class);

        expect((new ReflectionMethod(Dashboard::class, $method))->isPublic())
            ->toBeTrue("\$wire.{$method}() existe pero no es público en ".Dashboard::class);
    }
});

/**
 * El otro extremo del mismo contrato: el número y el orden de los argumentos. `fetchEvents(?string
 * $before, int $limit)` acepta dos, opcionales, y el módulo pagina pasándolos en ese orden.
 */
it('fetchEvents acepta el cursor y el límite en el orden en que los pasa el módulo', function (): void {
    $signature = new ReflectionMethod(Dashboard::class, 'fetchEvents');

    $parameters = array_map(
        fn (ReflectionParameter $parameter): string => $parameter->getName(),
        $signature->getParameters(),
    );

    expect($parameters)->toBe(['before', 'limit']);
    expect($signature->getNumberOfRequiredParameters())->toBe(0);
});

/**
 * El contrato de datos: el cliente lee `occurredAt` y `payload` de cada elemento devuelto, y usa
 * el `occurredAt` del último como cursor de la página siguiente.
 */
it('fetchEvents devuelve los campos que el cliente lee, y el cursor pagina hacia atrás', function (): void {
    $user = User::factory()->registered()->create();

    foreach ([1, 2, 3] as $daysAgo) {
        Event::factory()->for($user)->create([
            'occurred_at' => now()->subDays($daysAgo),
            'payload' => envelopeCipherText(),
        ]);
    }

    $this->actingAs($user);

    $firstPage = Livewire::test(Dashboard::class)->instance()->fetchEvents(null, 2);

    expect($firstPage)->toHaveCount(2);
    expect(array_keys($firstPage[0]))->toEqualCanonicalizing(['id', 'occurredAt', 'payload']);

    $cursor = $firstPage[1]['occurredAt'];

    $secondPage = Livewire::test(Dashboard::class)->instance()->fetchEvents($cursor, 2);

    expect($secondPage)->toHaveCount(1);
    expect($secondPage[0]['occurredAt'])->toBeLessThan($cursor);
});

/**
 * ─── Contrato de DOM ──────────────────────────────────────────────────────────────────────────
 *
 * Un `this.$refs.<algo>` sin su `x-ref` en la plantilla es `undefined` y revienta al usarse, sin
 * aviso previo; un `x-ref` que nadie usa es plomo muerto que confunde al siguiente. Los dos
 * conjuntos tienen que coincidir exactamente.
 */
it('los $refs del módulo y los x-ref de la plantilla coinciden exactamente', function (): void {
    $module = (string) file_get_contents(base_path(DASHBOARD_MODULE));
    $view = (string) file_get_contents(base_path(DASHBOARD_VIEW));

    preg_match_all('/this\.\$refs\.(\w+)/', $module, $moduleMatches);
    preg_match_all('/x-ref="(\w+)"/', $view, $viewMatches);

    $used = array_values(array_unique($moduleMatches[1]));
    $declared = array_values(array_unique($viewMatches[1]));

    sort($used);
    sort($declared);

    expect($used)->not->toBeEmpty();
    expect($used)->toBe($declared);
});

/**
 * ─── Reglas del ADR 0002 en la plantilla ──────────────────────────────────────────────────────
 */
it('la plantilla no usa wire:model en ninguna variante', function (): void {
    expect(dashboardSourceWithoutComments(DASHBOARD_VIEW))->not->toContain('wire:model');
});

it('cada región que escribe Alpine va dentro de un island, con wire:ignore y wire:key', function (): void {
    $view = (string) file_get_contents(base_path(DASHBOARD_VIEW));

    preg_match_all("/@island\(name: '[\w-]+'\)(.*?)@endisland/s", $view, $islands, PREG_SET_ORDER);

    expect($islands)->toHaveCount(3);

    foreach ($islands as [, $body]) {
        expect($body)->toContain('wire:ignore');
        expect($body)->toMatch('/wire:key="[\w-]+"/');
    }

    $outsideIslands = (string) preg_replace("/@island\(name: '[\w-]+'\).*?@endisland/s", '', $view);

    expect($outsideIslands)->not->toContain('x-ref=');
});

/**
 * La página va envuelta en el componente de página de Filament: sin él se pierde el contenedor que
 * aporta el relleno vertical y la primera tarjeta queda pegada a la barra superior.
 */
it('la plantilla va envuelta en el componente de página de Filament', function (): void {
    $view = (string) file_get_contents(base_path(DASHBOARD_VIEW));

    expect($view)->toContain('<x-filament-panels::page>');
    expect($view)->toContain('</x-filament-panels::page>');
});

/**
 * ─── DESIGN.md ────────────────────────────────────────────────────────────────────────────────
 *
 * Ni la plantilla ni el módulo pueden pintar superficies con tonos de la rampa: `bg-white` no
 * conmuta con el tema y `gray-200` es la tinta en oscuro, no un borde (ver `theme.css`,
 * § Ramp Mapping — Dark). Las superficies van por su papel: `bg-surface`, `bg-background`,
 * `border-border`.
 */
it('las superficies usan papeles del tema y no tonos de la rampa gris', function (string $path): void {
    $contents = dashboardSourceWithoutComments($path);

    expect($contents)->not->toContain('bg-white');
    expect($contents)->not->toContain('bg-gray-50');
    expect($contents)->not->toContain('border-gray-200');
})->with([DASHBOARD_VIEW, DASHBOARD_MODULE]);

/**
 * Los avisos usan los tokens `error-*` / `info-*`, que conmutan con el tema, y no las rampas de
 * acento, que no se reasignan en oscuro (`theme.css`, § Avisos y chips).
 */
it('los avisos del módulo usan los tokens de aviso y no las rampas de acento', function (): void {
    $module = dashboardSourceWithoutComments(DASHBOARD_MODULE);

    expect($module)->toContain('bg-error-surface');
    expect($module)->toContain('bg-info-surface');
    expect($module)->not->toContain('bg-danger-50');
    expect($module)->not->toContain('bg-primary-50');
});
