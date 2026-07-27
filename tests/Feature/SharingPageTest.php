<?php

declare(strict_types=1);

use App\Filament\Pages\Sharing;
use App\Models\User;
use App\Sharing\ReaderCatalog;
use App\Sharing\Shares;
use App\Sharing\ShareTtl;
use App\Support\SupportedLocale;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Livewire;

uses(RefreshDatabase::class);

/** The screen's Alpine module, the source of the contract with the server and with the DOM. */
function sharingModuleSource(): string
{
    return file_get_contents(base_path('resources/js/health/sharePage.js'));
}

function sharingViewSource(): string
{
    return file_get_contents(base_path('resources/views/phr/pages/sharing.blade.php'));
}

/**
 * The template without its `{{-- --}}` comments: the contracts are checked against the markup that
 * reaches the browser, not against the prose explaining it, which deliberately names `wire:model`
 * and `bg-white` to say why they are or are not there.
 */
function sharingViewMarkup(): string
{
    return preg_replace('/\{\{--.*?--\}\}/s', '', sharingViewSource());
}

/**
 * Tests for the sharing screen (ADR 0011).
 *
 * What is checked here is what can break silently: that the catalog the server publishes and the
 * list of types the client filters by do not drift apart, that the Alpine component is registered,
 * and that the markup still honours the two rules the ADR writes down (the PIN and the QR code never
 * at once, and no `wire:model`).
 */
it('is painted for an authenticated session', function (): void {
    $this->actingAs(User::factory()->registered()->create());

    Livewire::test(Sharing::class)
        ->assertOk()
        ->assertSee('phrSharePage', escape: false);
});

it('publishes the shareable types the client module knows how to filter', function (): void {
    /**
     * This is the test that matters most in this file. The server paints the checkboxes and the
     * client filters by the `type` field that goes **inside** the envelope; if the two lists stop
     * matching, the screen offers a type that never ends up inside the clipping, and the result is a
     * history missing something with nothing failing.
     */
    preg_match('/export const SHAREABLE_TYPES = Object\.freeze\(\[(.*?)\]\)/s', sharingModuleSource(), $matches);

    expect($matches)->not->toBeEmpty();

    preg_match_all("/'([a-zA-Z]+)'/", $matches[1], $tokens);

    expect($tokens[1])->toBe(Sharing::SHAREABLE_TYPES);
});

it('publishes the three expiries on the closed list, with 24 hours by default', function (): void {
    $this->actingAs(User::factory()->registered()->create());

    $catalog = Livewire::test(Sharing::class)->instance()->catalog();

    expect(array_column($catalog['ttls'], 'token'))
        ->toBe(array_map(fn (ShareTtl $ttl): string => $ttl->value, ShareTtl::cases()));
    expect(array_column($catalog['ttls'], 'hours'))->toBe([1, 24, 168]);
    expect($catalog['defaultTtl'])->toBe(ShareTtl::Day->value);

    /** Every visible label has to be translated, never the raw token. */
    foreach ($catalog['ttls'] as $ttl) {
        expect($ttl['label'])->not->toBe($ttl['token']);
    }
});

it('publishes the endpoints and the reader URL template', function (): void {
    $this->actingAs(User::factory()->registered()->create());

    $catalog = Livewire::test(Sharing::class)->instance()->catalog();

    expect($catalog['endpoints']['shares'])->toBe(route('filament.phr.shares.index'));

    /**
     * The template carries an unfilled `{link}` and `route()` builds it: the public prefix of the
     * reader page can change, and the day it changes it has to change in a single place.
     */
    expect($catalog['readerUrlTemplate'])->toContain('{link}');
    expect(str_replace('{link}', 'x', $catalog['readerUrlTemplate']))->toBe(route('share.reader', ['link' => 'x']));

    expect($catalog['limits'])->toBe([
        'shares' => Shares::MAX_ACTIVE_SHARES,
        'links' => Shares::MAX_LINKS_PER_SHARE,
    ]);
});

it('publishes no content data in the catalog', function (): void {
    /**
     * The catalog is emitted by the server in the clear inside the HTML. It may only carry public
     * things: types, expiries and URLs. If anyone ever put something from the history in here, that
     * would be the server knowing what this design exists to keep it from knowing.
     */
    $this->actingAs(User::factory()->registered()->create());

    $catalog = Livewire::test(Sharing::class)->instance()->catalog();

    expect(array_keys($catalog))
        ->toBe(['types', 'ttls', 'defaultTtl', 'endpoints', 'readerUrlTemplate', 'limits', 'readerCatalog']);

    /**
     * `readerCatalog` is the same public vocabulary the reader page receives: catalog tokens with
     * their labels, LOINC terms and units (ADR 0005). Nothing in it depends on any account or says
     * what any clipping contains, and it is what lets the preview be painted with the same words the
     * professional will see without a single extra request.
     */
    expect($catalog['readerCatalog'])->toBe((new ReaderCatalog)->toArray());
    expect(array_keys($catalog['readerCatalog']))->toBe(['locales', 'labels', 'loinc', 'units']);
});

it('previews the clipping with the same screen the professional will see', function (): void {
    /**
     * The preview cannot be an abridged version: what leaves here cannot be undone —revoking a link
     * does not delete what the other person already downloaded—, so "what you are about to send" has
     * to be literally what the other person will see. That is why it mounts the same module as the
     * reader page, over the same package body that would be encrypted on generate.
     */
    expect(sharingModuleSource())
        ->toContain("import { renderClippingExplorer } from '../reader/clippingExplorer.js';")
        ->toContain('renderClippingExplorer(this.$refs.preview')
        ->toContain('buildSharePackageBody({');

    /**
     * The region is built entirely by the client: `wire:ignore` with a stable `wire:key` and no
     * `@island`, for the same reason as the blood glucose chart (ADR 0002). The server re-emits an
     * island after any Livewire request and would take the `<canvas>` with it.
     */
    expect(sharingViewSource())
        ->toContain('x-ref="preview"')
        ->toContain('wire:key="sharing-preview-region"');
});

it('registers the Alpine component in app.js', function (): void {
    /**
     * Without this line the screen paints in full and no button responds, with no visible error: it
     * is the silent failure `app.js` itself warns about.
     */
    $app = file_get_contents(base_path('resources/js/app.js'));

    expect($app)->toContain("import { sharePage } from './health/sharePage.js';");
    expect($app)->toContain('phrSharePage: sharePage,');
    expect(sharingViewMarkup())->toContain('x-data="phrSharePage"');
});

it('does not use wire:model anywhere on the screen', function (): void {
    /** ADR 0002: nothing chosen here may enter the Livewire snapshot. */
    expect(sharingViewMarkup())->not->toContain('wire:model');
});

it('reuses the shared range control instead of writing another one', function (): void {
    /**
     * Two range controls with different criteria would disagree exactly at the day boundary, which
     * is where a record either makes it into what the doctor sees or does not.
     */
    expect(sharingViewSource())->toContain("@include('phr.partials.date-range'");
    expect(sharingModuleSource())->toContain("dateRangeControl({ preset: 'month' })");
});

it('never shows the PIN and the QR code at the same time', function (): void {
    /**
     * ADR 0011: "the PIN never appears on the same screen [as the QR code], so a single photo cannot
     * hold both halves". It is checked against the markup because that is where the rule lives: the
     * PIN block is painted only with `! qrVisible` and the QR one only with `qrVisible`.
     */
    $markup = sharingViewMarkup();

    expect($markup)->toContain('x-show="! qrVisible"');
    expect($markup)->toContain('x-show="qrVisible"');

    $pinPosition = strpos($markup, 'result.pin');
    $pinBlock = strrpos(substr($markup, 0, $pinPosition), 'x-show=');

    expect(substr($markup, $pinBlock, 30))->toContain('x-show="! qrVisible"');
});

it('warns about the three ADR trade-offs without small print', function (): void {
    /**
     * The three warnings are the ones from the consequences section of ADR 0011 and they have to be
     * in plain sight, not behind a disclosure: whoever shares has to know that the link plus the PIN
     * are enough, that revoking does not recover what was downloaded, and that the server sees the
     * frequency.
     */
    $markup = sharingViewMarkup();

    expect($markup)->toContain('Anyone holding both the link and the PIN can read the clipping.');
    expect($markup)->toContain('Revoking blocks future readings only.');
    expect($markup)->toContain('The server never learns what you share, but it does learn that you shared, when, and how often.');

    /** No `<details>`: a folded warning is a warning told so you can say it was told. */
    expect($markup)->not->toContain('<details');
});

it('warns that the PIN is shown only once', function (): void {
    expect(sharingViewMarkup())->toContain('This PIN is shown once and is not stored anywhere.');
});

it('has the screen copy translated in both catalogs', function (): void {
    /**
     * The general guardrail (`LocaleTest`) already sweeps the whole repository, but these three
     * pieces of copy are the ones read before deciding to share: if they stayed in English on a
     * Spanish account, the people who need them most would not read them.
     */
    foreach (array_values(array_diff(SupportedLocale::all(), [SupportedLocale::Fallback])) as $locale) {
        $catalog = json_decode(file_get_contents(base_path("lang/{$locale}.json")), true);

        expect($catalog)->toHaveKey('Before you share');
        expect($catalog)->toHaveKey('This PIN is shown once and is not stored anywhere.');
        expect($catalog)->toHaveKey('Share with a professional');
    }
});
