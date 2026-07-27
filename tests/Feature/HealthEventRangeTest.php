<?php

declare(strict_types=1);

use App\Filament\Pages\Glucose;
use App\Models\Event;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use Livewire\Livewire;

uses(RefreshDatabase::class);

/**
 * Filtro por rango de fechas de `HealthEventPage::fetchEvents()` (ADR 0004, ADR 0006).
 *
 * El rango se prueba sobre `Glucose` porque el método vive en la clase base y las cinco pantallas
 * lo heredan tal cual: repetir el fichero cuatro veces probaría cuatro veces el mismo código.
 *
 * `envelopeCipherText()` y `canonicalOccurredAtNow()` son globales de `tests/Pest.php`.
 */

/** Fecha canónica del ADR 0004 a partir de un instante, la única forma que acepta el método. */
function canonicalAt(CarbonInterface $moment): string
{
    return $moment->utc()->format('Y-m-d\TH:i:s.u\Z');
}

/**
 * Un evento por día, del más antiguo al más reciente, con la hora fijada para que el test no
 * dependa del momento en que se ejecute.
 *
 * @param  list<int>  $daysAgo
 * @return array<int, Event>
 */
function eventsDaysAgo(User $user, array $daysAgo): array
{
    $events = [];

    foreach ($daysAgo as $days) {
        $events[$days] = Event::factory()->for($user)->create([
            'occurred_at' => now()->utc()->startOfDay()->subDays($days)->addHours(12),
            'payload' => envelopeCipherText(),
        ]);
    }

    return $events;
}

it('sin rango devuelve todos los eventos, como antes de existir el filtro', function (): void {
    $user = User::factory()->registered()->create();
    eventsDaysAgo($user, [1, 5, 40]);

    $this->actingAs($user);

    expect(Livewire::test(Glucose::class)->instance()->fetchEvents())->toHaveCount(3);
});

it('acota por el inicio del rango, que entra en el resultado', function (): void {
    $user = User::factory()->registered()->create();
    $events = eventsDaysAgo($user, [1, 5, 40]);

    $this->actingAs($user);

    $from = canonicalAt($events[5]->occurred_at);

    $result = Livewire::test(Glucose::class)
        ->instance()
        ->fetchEvents(null, 100, $from);

    /** El evento que está justo en `$from` entra: el inicio es inclusivo (`>=`). */
    expect(array_column($result, 'id'))->toEqualCanonicalizing([$events[1]->id, $events[5]->id]);
});

it('acota por el fin del rango, que queda fuera del resultado', function (): void {
    $user = User::factory()->registered()->create();
    $events = eventsDaysAgo($user, [1, 5, 40]);

    $this->actingAs($user);

    $to = canonicalAt($events[5]->occurred_at);

    $result = Livewire::test(Glucose::class)
        ->instance()
        ->fetchEvents(null, 100, null, $to);

    /**
     * El evento que está justo en `$to` NO entra: el rango es semiabierto `[from, to)`, que es lo
     * que permite al cliente pasar la medianoche del día siguiente sin fabricar un
     * `23:59:59.999999`.
     */
    expect(array_column($result, 'id'))->toBe([$events[40]->id]);
});

it('con las dos puntas devuelve solo lo que cae dentro', function (): void {
    $user = User::factory()->registered()->create();
    $events = eventsDaysAgo($user, [1, 5, 10, 40]);

    $this->actingAs($user);

    $result = Livewire::test(Glucose::class)
        ->instance()
        ->fetchEvents(
            null,
            100,
            canonicalAt(now()->utc()->subDays(11)),
            canonicalAt(now()->utc()->subDays(3)),
        );

    expect(array_column($result, 'id'))->toEqualCanonicalizing([$events[5]->id, $events[10]->id]);
});

/**
 * El punto delicado del ADR 0006 llevado al filtro: el rango no puede filtrar por tipo, pero sí
 * tiene que seguir aislando por usuario. Un rango no es una rendija para ver los eventos de otro.
 */
it('el rango sigue devolviendo solo los eventos del usuario autenticado', function (): void {
    $user = User::factory()->registered()->create();
    $otherUser = User::factory()->registered()->create();

    eventsDaysAgo($user, [2]);
    eventsDaysAgo($otherUser, [2]);

    $this->actingAs($user);

    $result = Livewire::test(Glucose::class)
        ->instance()
        ->fetchEvents(null, 100, canonicalAt(now()->utc()->subDays(3)));

    expect($result)->toHaveCount(1);
    expect($result[0]['id'])->toBe(Event::query()->where('user_id', $user->id)->sole()->id);
});

/**
 * Rango y cursor conviven: el cursor recorta por arriba dentro del rango, pero nunca lo ensancha.
 */
it('el cursor pagina dentro del rango sin salirse de él', function (): void {
    $user = User::factory()->registered()->create();
    $events = eventsDaysAgo($user, [1, 3, 5, 40]);

    $this->actingAs($user);

    $from = canonicalAt(now()->utc()->subDays(6));

    $firstPage = Livewire::test(Glucose::class)
        ->instance()
        ->fetchEvents(null, 2, $from);

    expect(array_column($firstPage, 'id'))->toBe([$events[1]->id, $events[3]->id]);

    $secondPage = Livewire::test(Glucose::class)
        ->instance()
        ->fetchEvents($firstPage[1]['occurredAt'], 2, $from);

    /** El evento de hace 40 días queda fuera por `$from`, aunque el cursor ya lo alcanzaría. */
    expect(array_column($secondPage, 'id'))->toBe([$events[5]->id]);
});

it('un cursor anterior al inicio del rango no devuelve nada, en vez de ensancharlo', function (): void {
    $user = User::factory()->registered()->create();
    eventsDaysAgo($user, [1, 40]);

    $this->actingAs($user);

    $result = Livewire::test(Glucose::class)
        ->instance()
        ->fetchEvents(
            canonicalAt(now()->utc()->subDays(30)),
            100,
            canonicalAt(now()->utc()->subDays(7)),
        );

    expect($result)->toBe([]);
});

it('la punta más estricta manda cuando el cursor y el fin del rango compiten', function (): void {
    $user = User::factory()->registered()->create();
    $events = eventsDaysAgo($user, [1, 5]);

    $this->actingAs($user);

    /** `$to` es hoy (no recorta nada) y el cursor sí: gana el cursor. */
    $result = Livewire::test(Glucose::class)
        ->instance()
        ->fetchEvents(
            canonicalAt(now()->utc()->subDays(3)),
            100,
            null,
            canonicalAt(now()->utc()),
        );

    expect(array_column($result, 'id'))->toBe([$events[5]->id]);
});

/**
 * Mismo criterio canónico que `storeEvent`, sin un segundo formato más laxo: es la única forma de
 * que las fechas del filtro no se desvíen de las que entran en el dato asociado del AEAD.
 */
it('rechaza una punta del rango que no está en forma canónica', function (string $badDate, bool $isStart): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    expect(fn () => Livewire::test(Glucose::class)
        ->instance()
        ->fetchEvents(null, 100, $isStart ? $badDate : null, $isStart ? null : $badDate))
        ->toThrow(ValidationException::class);
})->with([
    'inicio sin microsegundos' => ['2026-03-01T00:00:00Z', true],
    'inicio con desfase en vez de Z' => ['2026-03-01T00:00:00.000000+02:00', true],
    'inicio solo con el día' => ['2026-03-01', true],
    'fin con mes imposible' => ['2026-13-01T00:00:00.000000Z', false],
    'fin sin microsegundos' => ['2026-03-01T00:00:00Z', false],
]);

/**
 * Un rango del revés se rechaza en vez de devolver la lista vacía que produciría solo: sin error,
 * la pantalla diría «no hay registros en este periodo», que ante un historial clínico se lee como
 * «no tienes registros».
 */
it('rechaza un rango cuyo inicio va después del fin', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    expect(fn () => Livewire::test(Glucose::class)
        ->instance()
        ->fetchEvents(
            null,
            100,
            canonicalAt(now()->utc()),
            canonicalAt(now()->utc()->subDay()),
        ))
        ->toThrow(ValidationException::class);
});

it('acepta un rango de anchura cero y devuelve la lista vacía', function (): void {
    $user = User::factory()->registered()->create();
    eventsDaysAgo($user, [1]);

    $this->actingAs($user);

    $instant = canonicalAt(now()->utc());

    expect(Livewire::test(Glucose::class)->instance()->fetchEvents(null, 100, $instant, $instant))
        ->toBe([]);
});

/**
 * El contrato con el cliente: los cuatro parámetros, en el orden en que los pasa
 * `$wire.fetchEvents(null, HISTORY_FETCH_LIMIT, range.from, range.to)`, y todos opcionales, porque
 * el panel de inicio sigue llamando con dos.
 */
it('fetchEvents acepta el cursor, el límite y las dos puntas del rango en ese orden', function (): void {
    $signature = new ReflectionMethod(Glucose::class, 'fetchEvents');

    $parameters = array_map(
        fn (ReflectionParameter $parameter): string => $parameter->getName(),
        $signature->getParameters(),
    );

    expect($parameters)->toBe(['before', 'limit', 'from', 'to']);
    expect($signature->getNumberOfRequiredParameters())->toBe(0);
});

/**
 * El rango no puede acabar en la barra de direcciones (Spec 0001 §9, ADR 0002): decir «del 3 al 10
 * de marzo» en la pantalla de insulina ya es información sobre la salud de quien mira, y una URL
 * queda en el historial del navegador, en el registro del proveedor y en el `Referer`. Por eso
 * viaja como argumento del método y no como propiedad de Livewire.
 */
it('el rango no viaja en el snapshot del componente', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $from = canonicalAt(now()->utc()->subDays(7));

    $test = Livewire::test(Glucose::class)->call('fetchEvents', null, 100, $from, null);

    expect(json_encode($test->snapshot))->not->toContain($from);
});

/** Las cuatro pantallas de historial piden el rango al servidor, no lo filtran tras descifrar. */
it('los cuatro módulos de historial pasan el rango a fetchEvents', function (string $module): void {
    $source = file_get_contents(base_path("resources/js/health/{$module}.js"));

    expect($source)->toContain('$wire.fetchEvents(null, HISTORY_FETCH_LIMIT, range.from, range.to)');
    expect($source)->toContain('dateRangeControl()');
})->with(['glucosePage', 'bloodPressurePage', 'insulinPage', 'mealsPage']);

/**
 * Las cuatro pantallas de historial arrancan acotadas a las últimas 24 horas: sin acotar, abrirlas
 * descarga y descifra todo en el navegador de quien mira, y el coste solo crece con los años. El
 * atajo es el mismo que el del panel de inicio, para que dos pantallas que se abren solas no
 * discrepen sobre qué es «lo reciente».
 */
it('el historial arranca acotado al último día y no descifrando todo', function (): void {
    $source = file_get_contents(base_path('resources/js/health/dateRange.js'));

    expect($source)->toContain("export const DEFAULT_RANGE_PRESET = 'day';");
});

/**
 * El precio de acotar de oficio, y lo que lo hace aceptable. En un historial clínico «no aparece»
 * se lee como «se ha perdido», así que un recorte que nadie ha pedido tiene que ser imposible de
 * no ver: el periodo en vigor se dice en palabras junto al historial, la frase aclara que lo que
 * falta está oculto y no borrado, y salir a todo el historial es un botón a la vista y no una
 * opción escondida en el desplegable.
 */
it('deja el periodo en vigor a la vista y la salida a todo el historial a un clic', function (): void {
    $source = file_get_contents(resource_path('views/phr/partials/date-range.blade.php'));

    expect($source)->toContain("__('Showing:')");
    expect($source)->toContain("__('Older records are hidden by this period, not deleted.')");

    expect($source)->toContain("__('Show all records')");
    expect($source)->toContain('@click="showAllRecords()"');

    /** El aviso se ve siempre que el rango sea válido, no solo con el recorte puesto. */
    expect($source)->toContain('x-show="! rangeError"');
    expect($source)->toContain('role="status"');
});

/** El botón del aviso tiene que existir en el control, no solo en la plantilla. */
it('el control ofrece la salida a todo el historial', function (): void {
    expect(file_get_contents(base_path('resources/js/health/dateRange.js')))
        ->toContain('showAllRecords()');
});
