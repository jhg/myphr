<?php

declare(strict_types=1);

namespace App\Filament\Pages;

use App\Sharing\ReaderCatalog;
use App\Sharing\Shares;
use App\Sharing\ShareTtl;
use BackedEnum;
use Filament\Support\Icons\Heroicon;
use Illuminate\Contracts\Support\Htmlable;

/**
 * Screen a clipping of the history is shared with a professional from (ADR 0011).
 *
 * This class sees nothing of what is shared, and it cannot: the clipping is assembled, compressed
 * and encrypted whole in the browser, and uploaded through `POST /phr/shares`, an HTTP endpoint of
 * its own that does not go through Livewire. Only three plaintext things are published here, and
 * they are public by nature: the closed list of expiries, the clinical types that can be picked with
 * their translated labels, and the URLs the client has to call.
 *
 * **Why it extends {@see HealthEventPage}** and not {@see PhrPage} directly: to read the events that
 * will make up the clipping, the client uses `fetchEvents`, the same method and the same canonical
 * date criterion as the six history screens. A second read path would be a second place to get the
 * half-open range `[from, to)` and the authorization wrong, and the one that would drift is exactly
 * the one almost nobody looks at. `storeEvent` comes along for free and adds no surface: any events
 * screen in the panel already exposes it for the same user.
 *
 * **Why the package is not uploaded through Livewire**: it carries the `s1.` prefix, and the two ADR
 * 0002 guardrails (`livewirePayloadGuard.js` and `EncryptedPayloadGuardHook`) abort on any string
 * longer than 256 characters that does not start with `v1.`. They are not touched; we use the route
 * ADR 0002 itself reserves for large blobs.
 */
final class Sharing extends HealthEventPage
{
    protected static string|BackedEnum|null $navigationIcon = Heroicon::Share;

    protected string $view = 'phr.pages.sharing';

    /**
     * At the end of the menu, after the recording screens.
     *
     * Sharing is not a daily task like jotting down a blood glucose reading: you do it before a
     * consultation, a few times a month. Putting it at the top would put it in the way of someone
     * who only wants to log a reading, and it is the only screen in the panel whose button sends
     * data out.
     */
    protected static ?int $navigationSort = 10;

    /**
     * The title and the navigation label are resolved by method and not as a static property because
     * a property initializer in PHP only accepts constant expressions: `__()` cannot be called
     * there.
     */
    public function getTitle(): string|Htmlable
    {
        return __('Share with a professional');
    }

    public static function getNavigationLabel(): string
    {
        return __('Share');
    }

    /**
     * Tokens of the clinical types that can be shared.
     *
     * They are the values of the `type` field that goes **inside** each event's envelope (ADR 0006),
     * so the server does not use them for anything: it cannot filter by type and does not try. They
     * are published only to paint the checkboxes with their translated labels. The list has to match
     * `SHAREABLE_TYPES` in `resources/js/health/sharePage.js`, which is what really filters, and
     * `tests/Feature/SharingPageTest.php` fails if they stop matching: a checkbox for a type the
     * client does not recognize produces clippings missing that type with nobody noticing.
     *
     * The order is the same as the panel menu, not alphabetical: someone looking for "blood
     * pressure" looks for it where they see it every day.
     *
     * @var list<string>
     */
    public const array SHAREABLE_TYPES = [
        'glucose',
        'bloodPressure',
        'insulin',
        'meal',
        'bodyWeight',
        'temperature',
    ];

    /**
     * Public plaintext catalog the client needs to paint the screen and to encrypt.
     *
     * Nothing that comes out of here depends on the user: the same types, the same expiries and the
     * same URLs for everybody. The only thing that changes is the language of the labels, which
     * comes from the one already in force for this request.
     *
     * `readerUrlTemplate` carries an unfilled `{link}` and is built with `route()` instead of
     * concatenating a prefix by hand: the public prefix of the reader page is a surface decision that
     * can change, and the day it changes it has to change in a single place.
     *
     * @return array{
     *     types: list<array{token: string, label: string}>,
     *     ttls: list<array{token: string, hours: int, label: string}>,
     *     defaultTtl: string,
     *     endpoints: array{shares: string},
     *     readerUrlTemplate: string,
     *     limits: array{shares: int, links: int},
     *     readerCatalog: array<string, mixed>,
     * }
     */
    public function catalog(): array
    {
        return [
            'types' => array_map(
                static fn (string $token): array => ['token' => $token, 'label' => self::typeLabel($token)],
                self::SHAREABLE_TYPES,
            ),
            'ttls' => array_map(
                static fn (ShareTtl $ttl): array => [
                    'token' => $ttl->value,
                    'hours' => $ttl->hours(),
                    'label' => self::ttlLabel($ttl),
                ],
                ShareTtl::cases(),
            ),
            /** 24 hours, the ADR 0011 default. */
            'defaultTtl' => ShareTtl::Day->value,
            'endpoints' => [
                'shares' => route('filament.phr.shares.index'),
            ],
            'readerUrlTemplate' => self::readerUrlTemplate(),
            'limits' => [
                'shares' => Shares::MAX_ACTIVE_SHARES,
                'links' => Shares::MAX_LINKS_PER_SHARE,
            ],
            /**
             * The same vocabulary the reader page receives, so the preview is painted with the same
             * words and the same LOINC terms the professional will see. It is public reference data
             * (ADR 0005): it depends on no account and says nothing about what is inside the
             * clipping. It travels in this same response and not in a separate request because the
             * preview cannot add a single call to the server: everything it shows is already
             * decrypted in the browser.
             */
            'readerCatalog' => (new ReaderCatalog)->toArray(),
        ];
    }

    /**
     * URL of the reader page with `{link}` still to be filled in.
     *
     * It is generated with a placeholder identifier and substituted afterwards, instead of passing
     * `{link}` straight to `route()`: Laravel's URL generator treats braces as the parameter slot and
     * answers "missing parameter link". The placeholder is a UUIDv4 with the exact shape the real one
     * will have, so a route with a format constraint does not slip through.
     */
    private static function readerUrlTemplate(): string
    {
        $placeholder = '00000000-0000-4000-8000-000000000000';

        return str_replace($placeholder, '{link}', route('share.reader', ['link' => $placeholder]));
    }

    /**
     * Label of a clinical type, the same word the panel menu uses for that screen: whoever picks
     * "Blood glucose" here has to recognize the screen they log it on.
     */
    private static function typeLabel(string $token): string
    {
        return match ($token) {
            'glucose' => __('Blood glucose'),
            'bloodPressure' => __('Blood pressure'),
            'insulin' => __('Insulin'),
            'meal' => __('Meals'),
            'bodyWeight' => __('Body weight'),
            'temperature' => __('Temperature'),
            default => $token,
        };
    }

    /**
     * Label of an expiry. It is stated as a duration ("1 hour") and not as a date, because the TTL is
     * chosen before generating and the exact date does not exist yet; the date is shown afterwards,
     * once the link is created.
     */
    private static function ttlLabel(ShareTtl $ttl): string
    {
        return match ($ttl) {
            ShareTtl::Hour => __('1 hour (in-person use)'),
            ShareTtl::Day => __('24 hours'),
            ShareTtl::Week => __('7 days'),
        };
    }
}
