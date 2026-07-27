<?php

declare(strict_types=1);

namespace App\Filament\Pages;

use App\Catalog\PatientLabelled;
use App\Crypto\CanonicalDate;
use App\Crypto\EnvelopeValidator;
use App\Models\Event;
use BackedEnum;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

/**
 * Transporte común de ciphertext para las pantallas de eventos clínicos (ADR 0002, ADR 0004,
 * ADR 0006).
 *
 * Todas las pantallas de eventos clínicos (glucemia, tensión, comidas, insulina, ...) comparten el
 * mismo contrato: el ciphertext baja como valor de retorno de {@see self::fetchEvents()} y sube
 * como parámetro de {@see self::storeEvent()}. El servidor no ve nunca el contenido de un evento,
 * solo valida la envoltura del sobre y la autorización, nunca el contenido del sobre.
 *
 * Ninguna subclase debe introducir una propiedad pública que guarde un payload: eso lo metería en
 * el snapshot de Livewire, justo lo que el ADR 0002 prohíbe.
 *
 * Hereda de {@see PhrPage}, que ya redeclara sin `#[Url]` las seis propiedades de
 * `InteractsWithActions`; no hace falta volver a tocarlas aquí.
 */
abstract class HealthEventPage extends PhrPage
{
    /**
     * Casos de un enum del catálogo, listos para el `catalog()` que consume el cliente.
     *
     * Cubre solo la forma exactamente repetida en las cuatro pantallas: token más etiqueta traducida
     * y nada más. Lo que varía —`UcumUnit` y `FoodQuantityUnit`, que publican `code`, o las entradas
     * con campos añadidos— se queda escrito en línea donde está, porque absorberlo aquí exigiría
     * parámetros que costarían más de leer que las cuatro líneas que ahorran.
     *
     * @param  list<PatientLabelled&BackedEnum>  $cases
     * @return list<array{token: string, label: string}>
     */
    protected static function labelledOptions(array $cases, string $locale): array
    {
        return array_map(
            static fn (PatientLabelled&BackedEnum $case): array => [
                'token' => (string) $case->value,
                'label' => $case->label($locale),
            ],
            $cases,
        );
    }

    /**
     * Techo duro de {@see self::fetchEvents()}, para que un `$limit` grande no fuerce una consulta
     * sin límite práctico.
     */
    private const int MAX_FETCH_LIMIT = 500;

    /**
     * Guarda un evento clínico cuyo contenido ya viene cifrado en el cliente.
     *
     * El servidor no interpreta `$payload`: solo comprueba que tiene forma de sobre válido
     * ({@see EnvelopeValidator}) y que `$occurredAt` está en su forma canónica, porque participa en
     * el dato asociado del AEAD con el que se cifró (ADR 0004, ADR 0006). Cualquiera de las dos
     * comprobaciones que falle aborta antes de tocar la base de datos: nunca se guarda un payload
     * mal formado.
     *
     * @return array{id: string, occurredAt: string}
     */
    public function storeEvent(string $payload, string $occurredAt): array
    {
        Gate::authorize('create', Event::class);

        if (! EnvelopeValidator::isValid($payload)) {
            throw ValidationException::withMessages([
                'payload' => __('The encrypted envelope does not have a valid format.'),
            ]);
        }

        $canonicalOccurredAt = self::parseCanonicalOccurredAt($occurredAt);

        $event = Event::query()->create([
            'user_id' => Auth::id(),
            'occurred_at' => $canonicalOccurredAt,
            'payload' => $payload,
        ]);

        return [
            'id' => $event->id,
            'occurredAt' => self::toCanonicalOccurredAt($event->occurred_at),
        ];
    }

    /**
     * Devuelve eventos clínicos del usuario autenticado, cifrados, acotados por fecha y por cursor.
     *
     * El ADR 0006 no permite guardar el tipo en claro, así que el servidor no puede filtrar por
     * tipo: esta lista trae **todos** los eventos del usuario en el tramo pedido, no solo de un
     * tipo. El cliente descifra cada sobre y descarta los que no correspondan a la pantalla actual.
     *
     * Por fecha sí puede filtrar, y por eso existen `$from` y `$to`: `occurred_at` es una de las
     * tres columnas en claro del ADR 0006 y el servidor ya la usa para ordenar y paginar, así que
     * acotarla no le revela nada que no supiera. El ahorro es real: hoy la pantalla de glucemia se
     * baja y descifra meses de comidas y de insulina para tirarlos.
     *
     * **El rango es semiabierto `[$from, $to)`**: `$from` entra (`>=`) y `$to` no (`<`). Se elige
     * así, y no con las dos puntas cerradas, porque el borde superior natural de un día de
     * calendario es la medianoche del siguiente: con `<` el cliente pasa esa medianoche tal cual y
     * no tiene que fabricar un `23:59:59.999999` que dejaría fuera cualquier evento registrado en
     * la última fracción de segundo del día. Además hace que las dos cotas superiores de este
     * método —`$to` y `$before`— tengan exactamente la misma semántica.
     *
     * **El rango y el cursor conviven, no se anulan.** Los tres filtros se combinan con `AND`, así
     * que la cota superior efectiva es la más estricta de `$to` y `$before`, y `$from` sigue siendo
     * el suelo pase lo que pase: un cursor nunca ensancha el rango. Paginar dentro de un rango
     * significa dejar `$from` y `$to` fijos en todas las páginas y mover solo `$before` (la fecha
     * del evento más antiguo de la página anterior); el recorrido termina cuando una página vuelve
     * con menos de `$limit` filas. Por eso el cursor no se ha reutilizado como punta del rango: es
     * un valor que se mueve en cada página, y confundirlo con `$to` haría que la segunda página
     * reanclase en silencio el tramo que la persona pidió.
     *
     * Los parámetros nuevos van al final porque el cliente los pasa por posición desde
     * `$wire.fetchEvents(...)`, y las cuatro pantallas de historial más el panel de inicio ya
     * llaman con la firma anterior.
     *
     * @param  string|null  $before  Cursor de paginación, exclusivo; `null` para la primera página.
     * @param  string|null  $from  Inicio del rango, canónico e incluido; `null` para no acotar.
     * @param  string|null  $to  Fin del rango, canónico y excluido; `null` para no acotar.
     * @return list<array{id: string, occurredAt: string, payload: string}>
     */
    public function fetchEvents(?string $before = null, int $limit = 100, ?string $from = null, ?string $to = null): array
    {
        Gate::authorize('viewAny', Event::class);

        $limit = min(max($limit, 1), self::MAX_FETCH_LIMIT);

        $query = Event::query()
            ->where('user_id', Auth::id())
            ->orderByDesc('occurred_at')
            ->limit($limit);

        if ($before !== null) {
            $query->where('occurred_at', '<', self::parseCanonicalOccurredAt($before));
        }

        /**
         * Las dos puntas se validan con el mismo `parseCanonicalOccurredAt` que `storeEvent`, y no
         * con un formato propio más laxo: un segundo criterio de fecha sería un segundo sitio donde
         * equivocarse, y el que acabaría desviándose es justo el que no participa en el AEAD.
         */
        $fromDate = $from === null ? null : self::parseCanonicalOccurredAt($from);
        $toDate = $to === null ? null : self::parseCanonicalOccurredAt($to);

        /**
         * Un rango del revés se rechaza en vez de devolver la lista vacía que produciría solo: sin
         * error, la pantalla diría «no hay registros en este periodo» y esa frase, ante un historial
         * clínico, se lee como «no tienes registros», que es una respuesta falsa a una pregunta mal
         * formulada.
         */
        if ($fromDate !== null && $toDate !== null && $fromDate->greaterThan($toDate)) {
            throw ValidationException::withMessages([
                'from' => __('The start of the range must not be later than its end.'),
            ]);
        }

        if ($fromDate !== null) {
            $query->where('occurred_at', '>=', $fromDate);
        }

        if ($toDate !== null) {
            $query->where('occurred_at', '<', $toDate);
        }

        return $query->get()
            ->map(fn (Event $event): array => [
                'id' => $event->id,
                'occurredAt' => self::toCanonicalOccurredAt($event->occurred_at),
                'payload' => $event->payload,
            ])
            ->all();
    }

    /**
     * Valida que `$occurredAt` tenga exactamente la forma canónica del ADR 0004 y la convierte.
     *
     * La comparación por ida y vuelta (parsear y volver a formatear) atrapa también los
     * desbordamientos que `createFromFormat` no rechaza por sí solo, como un mes 13 o un día 32:
     * si el valor se reinterpreta a otra fecha, la cadena reformateada ya no coincide con la
     * recibida y la validación falla.
     */
    private static function parseCanonicalOccurredAt(string $occurredAt): CarbonImmutable
    {
        $date = CanonicalDate::parse($occurredAt);

        if (! $date instanceof CarbonImmutable) {
            throw ValidationException::withMessages([
                'occurredAt' => __('The date must be in the canonical form YYYY-MM-DDTHH:MM:SS.ffffffZ.'),
            ]);
        }

        return $date;
    }

    private static function toCanonicalOccurredAt(DateTimeInterface $date): string
    {
        return CanonicalDate::format($date);
    }
}
