<?php

declare(strict_types=1);

namespace App\Filament\Pages;

use App\Crypto\EnvelopeValidator;
use App\Models\Event;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Exception;
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
     * Techo duro de {@see self::fetchEvents()}, para que un `$limit` grande no fuerce una consulta
     * sin límite práctico.
     */
    private const int MAX_FETCH_LIMIT = 500;

    /**
     * Formato canónico de fecha del ADR 0004: `YYYY-MM-DDTHH:MM:SS.ffffffZ`, siempre UTC, siempre
     * con los seis dígitos de fracción. `occurred_at` entra en el dato asociado del AEAD con el que
     * el cliente cifra el sobre, así que una forma distinta produce un sobre indescifrable.
     */
    private const string CANONICAL_DATE_FORMAT = 'Y-m-d\TH:i:s.u\Z';

    private const string CANONICAL_DATE_REGEX = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/';

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
     * Devuelve eventos clínicos del usuario autenticado, cifrados, en un rango acotado por cursor.
     *
     * El ADR 0006 no permite guardar el tipo en claro, así que el servidor no puede filtrar por
     * tipo: esta lista trae **todos** los eventos del usuario en el rango, no solo de un tipo. El
     * cliente descifra cada sobre y descarta los que no correspondan a la pantalla actual.
     *
     * @return list<array{id: string, occurredAt: string, payload: string}>
     */
    public function fetchEvents(?string $before = null, int $limit = 100): array
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
        if (preg_match(self::CANONICAL_DATE_REGEX, $occurredAt) !== 1) {
            throw ValidationException::withMessages([
                'occurredAt' => __('The date must be in the canonical form YYYY-MM-DDTHH:MM:SS.ffffffZ.'),
            ]);
        }

        try {
            $date = CarbonImmutable::createFromFormat(self::CANONICAL_DATE_FORMAT, $occurredAt, 'UTC');
        } catch (Exception) {
            $date = false;
        }

        if (! $date instanceof CarbonImmutable || self::toCanonicalOccurredAt($date) !== $occurredAt) {
            throw ValidationException::withMessages([
                'occurredAt' => __('The date is not a valid canonical date.'),
            ]);
        }

        return $date;
    }

    private static function toCanonicalOccurredAt(DateTimeInterface $date): string
    {
        return CarbonImmutable::instance($date)->utc()->format(self::CANONICAL_DATE_FORMAT);
    }
}
