<?php

declare(strict_types=1);

namespace App\Http\Controllers\Sharing;

use App\Models\ShareLink;
use App\Sharing\ReaderCatalog;
use App\Support\SupportedLocale;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\App;

/**
 * `GET /s/{link}` (ADR 0011): the professional's page.
 *
 * It lives outside the panel on purpose. Everything mounted under `phr` goes through
 * `PhrPanelProvider`, which Filament wraps with the `web` group and therefore with session and CSRF,
 * including its unauthenticated routes. This page must carry no session cookie, no Livewire, no
 * Filament and no charts: it is opened on somebody else's device and the less it carries, the less
 * it leaves behind.
 *
 * The server paints **nothing** of the content: it sends a shell and the client does the work,
 * reading `S` from `location.hash` —the fragment does not travel to the server— and decrypting in
 * the browser. The link identifier is passed to the view because it is the only thing the server
 * does see, and it already sees it from the URL.
 *
 * **This response is the same for every link.** The database is not queried: not to know whether the
 * link exists, nor whether it expired, nor whose it is. A page saying "this link is no longer
 * available" before asking for the PIN would turn a list of identifiers into a map of which
 * clippings are still alive, and along the way say that this person shared something. The single
 * generic response starts here, not at `challenge`.
 *
 * **And it carries nothing of the patient's account**: not their name, not their email, not how many
 * clippings they have. The view only receives the link identifier, the public vocabulary from
 * {@see ReaderCatalog} and two numbers that are constants in the code.
 *
 * It is painted in the professional's `Accept-Language` and never in the owner's language, which is
 * a plaintext column under ADR 0007 and has no reason to leave home. That is why this route does not
 * carry the `SetLocale` middleware, which resolves the account language, and why the header is
 * negotiated by hand here and against the header alone.
 */
final readonly class ShareReaderPageController
{
    public function __invoke(Request $request, string $link): View
    {
        /**
         * `negotiate()` and not `forRequest()`: the latter looks at `users.locale` first, and there
         * is no user to look at here and there must not be one. Setting the request language on top
         * of passing it to the view is what makes `__()` and the `<html lang>` say the same thing.
         */
        $locale = SupportedLocale::negotiate($request->header('Accept-Language'));

        App::setLocale($locale);

        return view('share.reader', [
            'linkId' => $link,
            'locale' => $locale,
            'catalog' => (new ReaderCatalog)->toArray(),
            /**
             * The attempt cap is published so the screen can say how many are left. It is a constant
             * in the code, the same for every link, and not a read of this link's counter: the real
             * counter never leaves the server, because it would tell a live link from one that never
             * existed. What the screen counts are the attempts made **from this browser**, and it
             * says so in those words.
             */
            'maxAttempts' => ShareLink::MAX_ATTEMPTS,
        ]);
    }
}
