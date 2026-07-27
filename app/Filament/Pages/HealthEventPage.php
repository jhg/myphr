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
 * Shared ciphertext transport for the clinical event screens (ADR 0002, ADR 0004, ADR 0006).
 *
 * Every clinical event screen (blood glucose, blood pressure, meals, insulin, ...) shares the same
 * contract: the ciphertext comes down as the return value of {@see self::fetchEvents()} and goes up
 * as a parameter of {@see self::storeEvent()}. The server never sees the content of an event, it
 * only validates the envelope wrapper and authorization, never the envelope's content.
 *
 * No subclass should introduce a public property holding a payload: that would put it in the
 * Livewire snapshot, exactly what ADR 0002 forbids.
 *
 * It extends {@see PhrPage}, which already redeclares the six `InteractsWithActions` properties
 * without `#[Url]`; there is no need to touch them again here.
 */
abstract class HealthEventPage extends PhrPage
{
    /**
     * Cases of a catalog enum, ready for the `catalog()` the client consumes.
     *
     * It covers only the shape repeated exactly across the four screens: a token plus a translated
     * label and nothing else. What varies —`UcumUnit` and `FoodQuantityUnit`, which expose `code`,
     * or the entries with extra fields— stays written inline where it is, because absorbing it here
     * would need parameters that cost more to read than the four lines they save.
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
     * Hard ceiling for {@see self::fetchEvents()}, so a large `$limit` does not force a query with
     * no practical bound.
     */
    private const int MAX_FETCH_LIMIT = 500;

    /**
     * Stores a clinical event whose content already arrives encrypted from the client.
     *
     * The server does not interpret `$payload`: it only checks that it has the shape of a valid
     * envelope ({@see EnvelopeValidator}) and that `$occurredAt` is in its canonical form, because it
     * takes part in the AEAD associated data it was encrypted with (ADR 0004, ADR 0006). If either
     * check fails it aborts before touching the database: a malformed payload is never stored.
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
     * Returns the authenticated user's clinical events, encrypted, bounded by date and by cursor.
     *
     * ADR 0006 does not allow storing the type in the clear, so the server cannot filter by type:
     * this list brings **every** event of the user in the requested stretch, not only one type. The
     * client decrypts each envelope and discards those that do not belong to the current screen.
     *
     * By date it can filter, and that is why `$from` and `$to` exist: `occurred_at` is one of the
     * three plaintext columns from ADR 0006 and the server already uses it to order and paginate, so
     * bounding it reveals nothing it did not already know. The saving is real: today the blood
     * glucose screen downloads and decrypts months of meals and insulin only to throw them away.
     *
     * **The range is half-open `[$from, $to)`**: `$from` is included (`>=`) and `$to` is not (`<`).
     * It is chosen this way, and not with both ends closed, because the natural upper edge of a
     * calendar day is the next day's midnight: with `<` the client passes that midnight as is and
     * does not have to make up a `23:59:59.999999` that would exclude any event recorded in the last
     * fraction of a second of the day. It also makes the two upper bounds of this method —`$to` and
     * `$before`— have exactly the same meaning.
     *
     * **The range and the cursor coexist, they do not cancel out.** The three filters combine with
     * `AND`, so the effective upper bound is the stricter of `$to` and `$before`, and `$from` stays
     * the floor no matter what: a cursor never widens the range. Paginating within a range means
     * keeping `$from` and `$to` fixed on every page and moving only `$before` (the date of the
     * oldest event on the previous page); the walk ends when a page comes back with fewer than
     * `$limit` rows. That is why the cursor has not been reused as the range's upper end: it is a
     * value that moves on every page, and confusing it with `$to` would make the second page
     * silently re-anchor the stretch the person asked for.
     *
     * The new parameters go last because the client passes them positionally from
     * `$wire.fetchEvents(...)`, and the four history screens plus the home dashboard already call
     * with the previous signature.
     *
     * @param  string|null  $before  Pagination cursor, exclusive; `null` for the first page.
     * @param  string|null  $from  Start of the range, canonical and included; `null` for no bound.
     * @param  string|null  $to  End of the range, canonical and excluded; `null` for no bound.
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
         * Both ends are validated with the same `parseCanonicalOccurredAt` as `storeEvent`, and not
         * with a looser format of their own: a second date criterion would be a second place to get
         * it wrong, and the one that would drift is exactly the one that does not take part in the
         * AEAD.
         */
        $fromDate = $from === null ? null : self::parseCanonicalOccurredAt($from);
        $toDate = $to === null ? null : self::parseCanonicalOccurredAt($to);

        /**
         * A backwards range is rejected instead of returning the empty list it would produce on its
         * own: without an error, the screen would say "no records in this period" and that sentence,
         * in front of a medical history, reads as "you have no records", which is a false answer to a
         * badly formed question.
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
     * Validates that `$occurredAt` has exactly the canonical ADR 0004 form and converts it.
     *
     * The round-trip comparison (parse and format again) also catches the overflows
     * `createFromFormat` does not reject on its own, such as a month 13 or a day 32: if the value is
     * reinterpreted as another date, the reformatted string no longer matches the one received and
     * validation fails.
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
