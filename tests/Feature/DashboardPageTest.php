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
 * Módulos que pintan lo que se ve en esta pantalla.
 *
 * La visualización ya no pertenece al panel: la línea temporal, las tarjetas y las gráficas viven en
 * módulos que reciben eventos descifrados y devuelven nodos, para que el lector del profesional
 * enseñe exactamente lo mismo sin sesión (ADR 0011). Las reglas de DESIGN.md se comprueban sobre
 * todos ellos, porque el marcado salió de `dashboardPage.js` y las reglas tenían que salir con él.
 *
 * @var list<string>
 */
const DASHBOARD_RENDER_MODULES = [
    'resources/js/health/dashboardPage.js',
    'resources/js/health/timelineView.js',
    'resources/js/health/statsView.js',
    'resources/js/health/chartsView.js',
    'resources/js/health/eventVisuals.js',
];

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
 * El otro extremo del mismo contrato: el número y el orden de los argumentos. El panel pagina
 * pasando los cuatro por posición —cursor, límite y las dos puntas del periodo elegido—, así que el
 * orden de la firma es parte del contrato y no un detalle interno.
 *
 * El panel dejó de resumir dos ventanas fijas: ahora acota por rango en el servidor, que sí puede
 * filtrar por `occurred_at` (ADR 0006). Es la diferencia entre descifrar 24 horas de sobres y
 * descifrar un mes en cada visita a la pantalla de entrada.
 */
it('fetchEvents acepta el cursor, el límite y el rango en el orden en que los pasa el módulo', function (): void {
    $signature = new ReflectionMethod(Dashboard::class, 'fetchEvents');

    $parameters = array_map(
        fn (ReflectionParameter $parameter): string => $parameter->getName(),
        $signature->getParameters(),
    );

    expect(array_slice($parameters, 0, 4))->toBe(['before', 'limit', 'from', 'to']);
    expect($signature->getNumberOfRequiredParameters())->toBe(0);
});

/**
 * El panel tiene que pasar el rango de verdad, no solo poder hacerlo: si volviera a llamar con dos
 * argumentos, bajaría y descifraría todo el historial en cada visita sin que ningún test lo notara.
 */
it('el módulo pasa el rango elegido a fetchEvents, no solo el cursor y el límite', function (): void {
    $module = (string) file_get_contents(base_path(DASHBOARD_MODULE));

    expect($module)->toMatch('/\$wire\.fetchEvents\([^)]*range\.from[^)]*range\.to[^)]*\)/');
});

/**
 * El periodo por defecto de esta pantalla es el último día, y es una decisión de producto, no un
 * detalle: es lo que hace que la pantalla de entrada abra rápido. El historial, en cambio, sigue
 * arrancando sin acotar.
 */
it('el panel arranca con el periodo del último día', function (): void {
    $module = (string) file_get_contents(base_path(DASHBOARD_MODULE));

    expect($module)->toContain("dateRangeControl({ preset: 'day' })");
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

    /**
     * Avisos de carga, línea temporal y estadísticas: las tres regiones que escribe Alpine. Las
     * tarjetas por tipo ya no son regiones de la plantilla, porque cuáles existen depende del filtro
     * de tipos del cliente.
     */
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
})->with([DASHBOARD_VIEW, ...DASHBOARD_RENDER_MODULES]);

/**
 * Los avisos usan los tokens `error-*` / `info-*`, que conmutan con el tema, y no las rampas de
 * acento, que no se reasignan en oscuro (`theme.css`, § Avisos y chips).
 *
 * El aviso lo construye `eventVisuals.js`, que es el módulo compartido por las tres pantallas que
 * enseñan eventos: un aviso con los colores mal puestos ahí saldría ilegible en las tres a la vez.
 */
it('los avisos usan los tokens de aviso y no las rampas de acento', function (): void {
    $module = dashboardSourceWithoutComments('resources/js/health/eventVisuals.js');

    expect($module)->toContain('bg-error-surface');
    expect($module)->toContain('bg-info-surface');

    foreach (DASHBOARD_RENDER_MODULES as $path) {
        expect(dashboardSourceWithoutComments($path))->not->toContain('bg-danger-50');
        expect(dashboardSourceWithoutComments($path))->not->toContain('bg-primary-50');
    }
});

/**
 * ─── Región de gráficas ───────────────────────────────────────────────────────────────────────
 *
 * Los lienzos **no** pueden vivir dentro de un `@island`: tras cualquier petición de Livewire el
 * servidor lo reemite y se lleva por delante lo que Alpine dibujó, que es el fallo que ya costó caro
 * en las pantallas de glucemia, tensión e insulina. Lo que protege la región es `wire:ignore` con
 * `wire:key` estable (ADR 0002).
 */
it('los lienzos de las gráficas viven fuera de los islands, con wire:ignore y wire:key', function (): void {
    $view = (string) file_get_contents(base_path(DASHBOARD_VIEW));

    $outsideIslands = (string) preg_replace("/@island\(name: '[\w-]+'\).*?@endisland/s", '', $view);

    expect($outsideIslands)->toContain('wire:key="dashboard-charts-region"');
    expect($outsideIslands)->toContain('<canvas');

    $insideIslands = (string) preg_replace('/^.*?(?=@island)/s', '', $view);

    preg_match_all("/@island\(name: '[\w-]+'\)(.*?)@endisland/s", $insideIslands, $islands, PREG_SET_ORDER);

    foreach ($islands as [, $body]) {
        expect($body)->not->toContain('<canvas');
    }
});

/**
 * El módulo busca sus lienzos por `id` y no por `x-ref`, precisamente porque están fuera de los
 * islands. Los dos extremos de ese contrato tienen que coincidir: un `id` que la plantilla no emite
 * deja la gráfica sin dibujar y sin ningún error.
 */
it('cada tipo con gráfica trae en la plantilla los cuatro identificadores que busca el módulo', function (): void {
    $view = (string) file_get_contents(base_path(DASHBOARD_VIEW));

    /** Las comidas no están: no tienen magnitud que promediar, así que no tienen gráfica. */
    foreach (['glucose', 'bloodPressure', 'insulin', 'bodyWeight', 'temperature'] as $type) {
        foreach (['', '-canvas', '-caption', '-legend'] as $suffix) {
            expect($view)->toContain('id="dashboard-chart-{{ $token }}'.$suffix.'"');
        }

        expect($view)->toContain("'{$type}' => __(");
    }
});

/**
 * Las dos gráficas que no son de un tipo de evento —la curva de glucemia con marcas de comida e
 * insulina, y la superposición de los días del periodo sobre 24 horas— salen de un `@foreach`
 * distinto al de los tipos, así que el test de arriba no las cubre: sus tokens son los que
 * `chartsView.js` exporta en `CHART_BLOCKS` y sus identificadores los que escribe
 * `chartElementIds()`. Se comprueba sobre el HTML ya renderizado, que es lo que de verdad recibe el
 * navegador: un token mal escrito en la plantilla deja la gráfica sin dibujar y sin ningún error.
 */
it('el panel emite los cuatro identificadores de las dos gráficas que cruzan tipos', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $page = Livewire::test(Dashboard::class);

    foreach (['glucoseContext', 'dayOverlay'] as $token) {
        foreach (['', '-canvas', '-caption', '-legend'] as $suffix) {
            $page->assertSeeHtml('id="dashboard-chart-'.$token.$suffix.'"');
        }
    }
});

/**
 * El lienzo es un objeto gráfico sin texto: sin nombre accesible y sin un pie que diga en texto qué
 * series incluye, la tendencia solo llegaría por el color de las líneas (DESIGN.md Do's #3).
 */
it('cada lienzo lleva nombre accesible y apunta a su pie y a su leyenda', function (): void {
    $view = (string) file_get_contents(base_path(DASHBOARD_VIEW));

    expect($view)->toContain('role="img"');
    expect($view)->toContain('aria-label="{{ __(\'Daily median and daily range for :type\'');
    expect($view)->toContain('aria-describedby="dashboard-chart-{{ $token }}-caption dashboard-chart-{{ $token }}-legend"');
});
