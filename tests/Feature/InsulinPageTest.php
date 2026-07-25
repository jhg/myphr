<?php

declare(strict_types=1);

use App\Crypto\EnvelopeValidator;
use App\Filament\Pages\HealthEventPage;
use App\Filament\Pages\Insulin;
use App\Models\Event;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use Livewire\Livewire;

uses(RefreshDatabase::class);

/**
 * Tests del transporte de la pantalla de insulina (ADR 0002, ADR 0004, ADR 0006).
 *
 * El servidor no puede fabricar un sobre cifrado real porque no tiene la clave del cliente. Los
 * tests que necesitan un payload válido generan uno con la misma forma que produce
 * `resources/js/crypto/envelope.js`: prefijo `v1.` más base64url de un tamaño de relleno admitido.
 * Calca `tests/Feature/GlucosePageTest.php`: {@see Insulin} no aporta lógica propia de transporte,
 * solo hereda {@see HealthEventPage::storeEvent()} y
 * {@see HealthEventPage::fetchEvents()}, así que las mismas garantías aplican.
 */
function insulinEnvelopeCipherText(int $paddedSize = 256): string
{
    $totalBytes = EnvelopeValidator::HEADER_BYTES + EnvelopeValidator::TAG_BYTES + $paddedSize;

    return EnvelopeValidator::PREFIX.rtrim(strtr(base64_encode(random_bytes($totalBytes)), '+/', '-_'), '=');
}

function insulinCanonicalOccurredAtNow(): string
{
    return now()->utc()->format('Y-m-d\TH:i:s.u\Z');
}

it('guarda un evento con un sobre bien formado y una fecha canónica', function (): void {
    $user = User::factory()->registered()->create();
    $envelope = insulinEnvelopeCipherText();
    $occurredAt = insulinCanonicalOccurredAtNow();

    $this->actingAs($user);

    $result = Livewire::test(Insulin::class)
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

    expect(fn () => Livewire::test(Insulin::class)
        ->instance()
        ->storeEvent('esto no es un sobre cifrado', insulinCanonicalOccurredAtNow()))
        ->toThrow(ValidationException::class);

    expect(Event::query()->count())->toBe(0);
});

it('rechaza una fecha sin microsegundos', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    expect(fn () => Livewire::test(Insulin::class)
        ->instance()
        ->storeEvent(insulinEnvelopeCipherText(), now()->utc()->format('Y-m-d\TH:i:s\Z')))
        ->toThrow(ValidationException::class);

    expect(Event::query()->count())->toBe(0);
});

it('rechaza una fecha con desfase horario en vez de Z', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    expect(fn () => Livewire::test(Insulin::class)
        ->instance()
        ->storeEvent(insulinEnvelopeCipherText(), now()->format('Y-m-d\TH:i:s.u').'+02:00'))
        ->toThrow(ValidationException::class);

    expect(Event::query()->count())->toBe(0);
});

it('fetchEvents solo devuelve los eventos del usuario autenticado', function (): void {
    $user = User::factory()->registered()->create();
    $otherUser = User::factory()->registered()->create();

    $ownEvent = Event::factory()->for($user)->create();
    Event::factory()->for($otherUser)->create();

    $this->actingAs($user);

    $result = Livewire::test(Insulin::class)
        ->instance()
        ->fetchEvents();

    expect($result)->toHaveCount(1);
    expect($result[0]['id'])->toBe($ownEvent->id);
});

it('storeEvent y fetchEvents aíslan los eventos por usuario, sin ver los de otro', function (): void {
    $user = User::factory()->registered()->create();
    $otherUser = User::factory()->registered()->create();

    $this->actingAs($user);
    $ownResult = Livewire::test(Insulin::class)
        ->instance()
        ->storeEvent(insulinEnvelopeCipherText(), insulinCanonicalOccurredAtNow());

    $this->actingAs($otherUser);
    Livewire::test(Insulin::class)
        ->instance()
        ->storeEvent(insulinEnvelopeCipherText(), insulinCanonicalOccurredAtNow());

    $this->actingAs($user);
    $result = Livewire::test(Insulin::class)
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
 * nunca por una propiedad pública, así que el snapshot del componente no puede contenerlo.
 */
it('el snapshot del componente no contiene ningún sobre cifrado', function (): void {
    $user = User::factory()->registered()->create();
    $envelope = insulinEnvelopeCipherText();
    $occurredAt = insulinCanonicalOccurredAtNow();

    Event::factory()->for($user)->create(['payload' => insulinEnvelopeCipherText()]);

    $this->actingAs($user);

    /**
     * Las llamadas van por `call()` y no por `instance()`: invocar el método sobre la instancia se
     * salta el ciclo de hidratación y deshidratación de Livewire, y entonces el snapshot que se
     * inspecciona es el de antes de la llamada. El test pasaría aunque el sobre acabase en una
     * propiedad pública, que es justo lo que tiene que detectar.
     */
    $test = Livewire::test(Insulin::class)
        ->call('storeEvent', $envelope, $occurredAt)
        ->call('fetchEvents');

    $snapshotJson = json_encode($test->snapshot);

    expect($snapshotJson)->not->toContain($envelope);
    expect($snapshotJson)->not->toContain('v1.');
});

/**
 * El catálogo no lleva LOINC (ADR 0006, insulina es administración de medicación, no observación)
 * y no publica `dataOrigins` (corrección de alcance: el formulario no pregunta el origen del dato).
 */
it('el catálogo trae los tipos de insulina, la unidad internacional y las zonas de inyección, sin LOINC ni orígenes', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $catalog = Livewire::test(Insulin::class)->instance()->catalog();

    expect($catalog)->toHaveKeys(['units', 'insulinTypes', 'injectionSites', 'recordedByRoles']);
    expect($catalog)->not->toHaveKey('loinc');
    expect($catalog)->not->toHaveKey('dataOrigins');

    expect($catalog['units'])->toHaveCount(1);
    expect($catalog['units'][0]['code'])->toBe('[iU]');

    $insulinTypeTokens = array_column($catalog['insulinTypes'], 'token');
    expect($insulinTypeTokens)->toEqualCanonicalizing(['rapid', 'long', 'mixed']);

    $injectionSiteTokens = array_column($catalog['injectionSites'], 'token');
    expect($injectionSiteTokens)->toEqualCanonicalizing(['abdomen', 'thigh', 'glute', 'arm']);
});

/**
 * El fallo que llegó a producción: el transporte común pasó a llamarse `storeEvent` en
 * {@see HealthEventPage} y dos módulos de JavaScript siguieron llamando al nombre viejo, con lo que
 * la pantalla reventaba al guardar con «Public method [...] not found on component». Nada lo
 * comprobaba.
 *
 * Este test lee el módulo de la pantalla, saca cada `$wire.<metodo>` que llama y exige que exista
 * de verdad como método público de {@see Insulin} —propio o heredado—. Renombrar el método en el
 * servidor sin tocar el cliente deja de compilar aquí, no en producción.
 */
it('cada $wire.<metodo> del modulo de insulina existe como metodo publico de la pagina', function (): void {
    $module = file_get_contents(resource_path('js/health/insulinPage.js'));

    preg_match_all('/\$wire\.([a-zA-Z]+)/', $module, $matches);

    $calledMethods = array_values(array_unique($matches[1]));

    expect($calledMethods)->not->toBeEmpty('el módulo tiene que llamar a algún método del componente');

    foreach ($calledMethods as $method) {
        expect(method_exists(Insulin::class, $method))
            ->toBeTrue("insulinPage.js llama a \$wire.{$method}(), que no existe en ".Insulin::class);

        expect((new ReflectionMethod(Insulin::class, $method))->isPublic())
            ->toBeTrue("\$wire.{$method}() existe pero no es público, así que Livewire no lo expone");
    }
});

/**
 * El número y el orden de los argumentos también forman parte del contrato: `storeEvent` recibe
 * primero el sobre y después la fecha canónica, y `fetchEvents` se llama sin argumentos, así que
 * sus dos parámetros tienen que ser opcionales.
 */
it('storeEvent y fetchEvents aceptan los argumentos con los que los llama el cliente', function (): void {
    $storeEvent = new ReflectionMethod(Insulin::class, 'storeEvent');

    expect($storeEvent->getNumberOfParameters())->toBe(2);
    expect($storeEvent->getParameters()[0]->getName())->toBe('payload');
    expect($storeEvent->getParameters()[1]->getName())->toBe('occurredAt');
    expect($storeEvent->getNumberOfRequiredParameters())->toBe(2);

    expect((new ReflectionMethod(Insulin::class, 'fetchEvents'))->getNumberOfRequiredParameters())->toBe(0);
});

/**
 * Los campos que el cliente lee de la respuesta tienen que existir en lo que devuelve el servidor:
 * `insulinPage.js` lee `id`, `occurredAt` y `payload` de cada fila de `fetchEvents`.
 */
it('fetchEvents devuelve exactamente las claves que lee el cliente', function (): void {
    $user = User::factory()->registered()->create();
    Event::factory()->for($user)->create();

    $this->actingAs($user);

    $rows = Livewire::test(Insulin::class)->instance()->fetchEvents();

    expect($rows[0])->toHaveKeys(['id', 'occurredAt', 'payload']);
});

/**
 * La pantalla se renderiza entera, con el envoltorio de página de Filament (sin él el contenido
 * queda pegado a la barra superior porque se pierde el contenedor con el relleno vertical) y con
 * los `<option>` pintados por el servidor: si los pintase Alpine, el morph de Livewire los borraría
 * en la primera petición (ADR 0002).
 */
it('la pantalla se renderiza con el envoltorio de pagina y las opciones pintadas por el servidor', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $html = Livewire::test(Insulin::class)->assertOk()->html();

    expect($html)->toContain('fi-page');
    expect($html)->toContain('x-data="phrInsulinPage"');
    expect($html)->toContain('data-phr-insulin-catalog');

    /** Las tres opciones de tipo de insulina, emitidas por Blade desde `catalog()`. */
    expect($html)->toContain('value="rapid"');
    expect($html)->toContain('value="long"');
    expect($html)->toContain('value="mixed"');

    /** Las dos regiones descifradas, cada una con su island y su `wire:key` estable (ADR 0002). */
    expect($html)->toContain('wire:key="insulin-list-region"');
    expect($html)->toContain('wire:key="insulin-chart-region"');
    expect($html)->toContain('id="insulin-chart-caption"');

    /** Ninguna variante de `wire:model` en una pantalla de datos cifrados (ADR 0002). */
    expect($html)->not->toContain('wire:model');
});
