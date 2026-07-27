<?php

declare(strict_types=1);

use App\Models\Share;
use App\Models\ShareLink;
use App\Models\User;
use App\Security\Opaque\Base64Url;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;

uses(RefreshDatabase::class);

/**
 * ADR 0011: the page the professional opens. What these tests watch is not how it looks, but what
 * does **not** come out of it: nothing about the patient account, nothing that tells a live link
 * from a dead one, and no cookies.
 */
beforeEach(function (): void {
    config()->set('share.decoy_salt_key', Base64Url::encode(str_repeat("\x2a", 32)));
});

it('serves the reader page without a session and without cookies', function (): void {
    $response = $this->get('/s/'.Str::uuid());

    $response->assertOk()
        ->assertHeader('Cache-Control', 'no-store, private')
        ->assertHeader('Referrer-Policy', 'no-referrer');

    /**
     * Not one cookie. A session cookie here would be a stable identifier for a professional in their
     * practice, correlatable across the clippings of two different patients.
     */
    expect($response->headers->getCookies())->toBeEmpty();
});

/**
 * The response is the same for a live link, an expired one, a revoked one and one that never
 * existed. If the page said "this link is no longer available", a list of identifiers would become a
 * map of which clippings are still open, and along the way it would say that this person shared
 * something. The single generic response starts on this page, not at `challenge`.
 */
it('answers the same for a live link, an expired one and a non-existent one', function (): void {
    $live = ShareLink::factory()->create();
    $expired = ShareLink::factory()->expired()->create();

    /**
     * The `<body>` is compared and not the whole document because the laravel-vite-plugin font
     * helper emits the preloads only once per process, and that difference belongs to the test
     * harness and not to this page.
     */
    $bodies = collect([$live->id, $expired->id, (string) Str::uuid()])
        ->map(function (string $link): string {
            $content = $this->get('/s/'.$link)->assertOk()->getContent();

            return str_replace($link, 'LINK', substr($content, (int) strpos($content, '<body')));
        });

    expect($bodies->unique())->toHaveCount(1);
});

/** Not one database query: the page does not check whether the link exists. */
it('does not query the database to paint the page', function (): void {
    $queries = 0;

    DB::listen(function () use (&$queries): void {
        $queries++;
    });

    $this->get('/s/'.Str::uuid())->assertOk();

    expect($queries)->toBe(0);
});

/**
 * Nothing about the patient account comes out of here: not their name, not their email, not their
 * language, not how many clippings they have. The server knows them and this page does not paint
 * them.
 */
it('leaks nothing about the patient account', function (): void {
    $user = User::factory()->registered()->create(['locale' => 'zh_CN']);
    $share = Share::factory()->for($user)->create();
    $link = ShareLink::factory()->for($share)->create();

    $content = $this->withHeader('Accept-Language', 'es')->get('/s/'.$link->id)->getContent();

    expect($content)->not->toContain($user->email)
        ->and($content)->not->toContain($user->id)
        ->and($content)->not->toContain($share->id)
        ->and($content)->not->toContain($share->payload)
        ->and($content)->not->toContain($share->descriptor)
        ->and($content)->not->toContain($link->wrapper)
        /** The account language is a plaintext column (ADR 0007) and has no reason to leave home. */
        ->and($content)->toContain('lang="es"');
});

/**
 * Neither the salt nor the PIN proof may travel in the shell: with them on the page, the offline
 * attack against a six-digit PIN is back, which is the flaw this design fixed.
 */
it('publishes neither the salt nor the PIN proof', function (): void {
    $link = ShareLink::factory()->create();
    $content = $this->get('/s/'.$link->id)->getContent();

    expect($content)->not->toContain(Base64Url::encode((string) $link->pin_salt))
        ->and($content)->not->toContain(Base64Url::encode((string) $link->pin_tag));
});

it('is painted in the professional language, negotiated by Accept-Language', function (string $header, string $tag): void {
    $this->withHeader('Accept-Language', $header)
        ->get('/s/'.Str::uuid())
        ->assertOk()
        ->assertSee('lang="'.$tag.'"', false);
})->with([
    'Spanish' => ['es-ES,es;q=0.9', 'es'],
    'chino' => ['zh-CN,zh;q=0.9', 'zh-CN'],
    'English' => ['en-GB,en;q=0.8', 'en'],
    'idioma no soportado' => ['fr-FR,fr;q=0.9', 'en'],
]);

/**
 * The catalog carries all three languages inside so the page's language selector can switch without
 * asking the server for anything: a second request would be one more request tying that reader to
 * that link, and a preference cookie would be exactly the cookie this route shakes off.
 */
it('publishes the clinical vocabulary in the three languages and the LOINC term untranslated', function (): void {
    $content = $this->get('/s/'.Str::uuid())->getContent();
    $catalog = json_decode(
        html_entity_decode((string) preg_replace(
            '/.*<script type="application\/json" data-phr-reader-catalog>(.*?)<\/script>.*/s',
            '$1',
            $content,
        ), ENT_QUOTES),
        true,
    );

    expect(array_keys($catalog['labels']))->toBe(['en', 'es', 'zh_CN'])
        ->and($catalog['labels']['es']['types']['glucose'])->toBe('Glucemia')
        ->and($catalog['labels']['zh_CN']['types']['glucose'])->not->toBe('Glucemia')
        /** The official LOINC term is not translated (ADR 0005): it goes once and in English. */
        ->and($catalog['loinc']['41653-7'])->toBe('Glucose [Mass/volume] in Capillary blood by Glucometer')
        /** UCUM codes are exchange notation, not something anyone should be asked to read. */
        ->and($catalog['units']['Cel'])->toBe('°C');
});

/**
 * On top of the wrapper and the package, `open` returns the two pieces of associated data the reader
 * does not carry with it. Both go inside the AEAD, so a server that lied about either fools nobody:
 * the wrapper stops opening. The generation instant is deliberately not here: it travels in the URL
 * fragment, which the server never sees.
 */
it('returns the clipping identifier and the expiry alongside the package', function (): void {
    $tag = random_bytes(ShareLink::PIN_TAG_BYTES);
    $link = ShareLink::factory()->create(['pin_tag' => $tag]);

    $body = json_decode(
        $this->postJson("/s/{$link->id}/open", ['pinTag' => Base64Url::encode($tag)])
            ->assertOk()
            ->getContent(),
        true,
    );

    expect($body['shareId'])->toBe($link->share_id)
        ->and($body['expiresAt'])->toBe($link->expires_at->format('Y-m-d\TH:i:s.u\Z'))
        ->and($body)->not->toHaveKey('generatedAt');
});

/**
 * The professional sees the **same** interface as the patient —charts, statistics, timeline, search
 * and sub-periods— and not a static report. What this test watches is that the shared module paints
 * it and not a copy: two copies of the same clinical view drift apart as soon as the seventh event
 * type is added, and then the patient and the doctor are looking at different documents of the same
 * data.
 */
it('mounts the shared clipping screen, not a report of its own', function (): void {
    $reader = file_get_contents(base_path('resources/js/reader/readerPage.js'));

    /**
     * The import is dynamic, not static: Chart.js is the bulk of that module and none of it is
     * needed until the PIN is right, so it downloads while the PIN is being typed instead of
     * blocking the first paint of the form. What matters here is unchanged — it is *that* module
     * that paints the clipping.
     */
    expect($reader)
        ->toContain("import('./clippingExplorer.js')")
        ->toContain('renderClippingExplorer(nodes.report');

    $explorer = file_get_contents(base_path('resources/js/reader/clippingExplorer.js'));

    /** The four panel views, imported as they are: nothing is reimplemented here. */
    expect($explorer)
        ->toContain("from '../health/timelineView.js'")
        ->toContain("from '../health/statsView.js'")
        ->toContain("from '../health/chartsView.js'")
        ->toContain("from '../health/eventSearch.js'");
});

/**
 * **The doctor can only narrow inside the clipping, never widen it.**
 *
 * Sub-periods and search work against `memoryEventSource`, which has nowhere to get an event that is
 * not already in the package: the only endpoint serving clinical data is the one behind the PIN, and
 * it hands over the whole package at once. There is no way to ask for one more, and this test checks
 * that absence, which is what you cannot check by looking at the screen.
 */
it('the clipping screen cannot request a single extra event', function (): void {
    $explorer = file_get_contents(base_path('resources/js/reader/clippingExplorer.js'));

    expect($explorer)->toContain("import { flattenDecryptedEvent, memoryEventSource } from '../health/eventSource.js';");

    /** The comments deliberately name what is not used, so they are looked at from outside them. */
    $code = (string) preg_replace(['#/\*[\s\S]*?\*/#', '#^\s*//.*$#m'], ' ', $explorer);

    foreach (['fetch(', 'XMLHttpRequest', 'sendBeacon', '$wire', 'livewire'] as $forbidden) {
        expect($code)->not->toContain($forbidden);
    }

    /** And the decrypted package is not written to the professional's device (ADR 0003). */
    foreach (['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie'] as $storage) {
        expect($code)->not->toContain($storage);
    }
});

/**
 * The page stays outside the panel: extracting the shared views must not have smuggled Livewire or
 * Filament into a document opened without a session and on somebody else's device. The charts do go
 * in now (Chart.js), and that is our own code served from this same origin, which the CSP already
 * allows.
 */
it('the reader page stays free of Livewire, Filament and third-party resources', function (): void {
    $content = $this->get('/s/'.Str::uuid())->getContent();

    expect($content)
        ->not->toContain('livewire')
        ->and($content)->not->toContain('filament');

    $entry = file_get_contents(base_path('resources/js/reader.js'));

    expect($entry)->toContain("import { startReaderPage } from './reader/readerPage.js';");
});

/**
 * What really ends up in a medical record is paper, so the print stylesheet is not an extra: the
 * controls and the charts go away (a printed dropdown is ink you cannot click, and a canvas drawn in
 * dark theme comes out invisible on white), and the clinical table with its LOINC term stays.
 */
it('keeps the print stylesheet and the LOINC term of the clinical table', function (): void {
    $explorer = file_get_contents(base_path('resources/js/reader/clippingExplorer.js'));

    expect($explorer)
        ->toContain("section.setAttribute('data-phr-reader-screen-only', '')")
        ->toContain("chartsCard.card.setAttribute('data-phr-reader-screen-only', '')")
        ->toContain("'reader.table.loinc',");

    expect(file_get_contents(base_path('resources/css/reader.css')))
        ->toContain('[data-phr-reader-screen-only] {');
});
