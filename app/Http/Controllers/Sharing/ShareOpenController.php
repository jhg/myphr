<?php

declare(strict_types=1);

namespace App\Http\Controllers\Sharing;

use App\Models\ShareLink;
use App\Security\Opaque\Base64Url;
use App\Security\Opaque\InvalidMessageException;
use App\Sharing\InvalidShareLinkException;
use App\Sharing\ShareLinkGate;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * `POST /s/{link}/open` (ADR 0011): second step of the read.
 *
 * It receives the `pinTag` and, **only if it matches**, returns the wrapper and the package in the
 * same response, plus the clipping identifier and the link expiry, which are the two pieces of
 * associated data the reader does not carry with it. Neither is a concession: they go inside the
 * AEAD of both layers, so a false value opens nothing. The generation instant, which also goes into
 * the package's associated data, is not here because the server does not have it: it travels in the
 * URL fragment, which never reaches it. Before that nothing comes out, and that is the fix for the
 * critical flaw in the original design: the PIN is verified online, with a five-attempt counter in a
 * column, and not offline against a blob the server already handed over.
 *
 * The four failure causes —does not exist, expired, revoked, wrong PIN— come out through the **same
 * generic response**, with the same HTTP status and the same body. The remaining attempts are not
 * returned: they would be an oracle telling a live link from one that never existed, and they would
 * also force inventing a stable counter for non-existent identifiers. The price is real and worth
 * saying: whoever fat-fingers the PIN does not know how many attempts are left, and that is by far
 * the most common case. The reader screen can explain that there is a limited number of attempts
 * without the server counting them out loud.
 *
 * Headers: `Cache-Control: no-store` (set by the `NoStore` middleware),
 * `Content-Type: application/octet-stream`, and **no** `ETag`, `Last-Modified` or descriptive
 * `Content-Disposition`. An attachment's filename is clinical metadata, and a cache validator over
 * this body would let an intermediary know whether the package changed. The route is also excluded
 * from any CDN.
 *
 * Neither IP nor user agent is logged here, consistent with the deliberate exclusion of both in
 * `AuditEvent`: the IP of whoever downloads reveals the healthcare centre and from there the
 * diagnosis. There is no audit entry per download either.
 */
final readonly class ShareOpenController
{
    public function __construct(private ShareLinkGate $gate) {}

    public function __invoke(Request $request, string $link): Response
    {
        try {
            $opened = $this->gate->open($link, $this->pinTag($request));
        } catch (InvalidShareLinkException) {
            return $this->generic();
        }

        return $this->octetStream($opened, 200);
    }

    /**
     * The proof arrives as base64url and is decoded here. An invalid encoding is one more failure
     * cause and comes out through the same place as the other four: returning a distinguishable
     * validation error would give away an oracle for free.
     */
    private function pinTag(Request $request): string
    {
        $value = $request->input('pinTag');

        if (! is_string($value)) {
            return '';
        }

        try {
            return Base64Url::decodeExactly($value, ShareLink::PIN_TAG_BYTES, 'pin tag');
        } catch (InvalidMessageException) {
            return '';
        }
    }

    private function generic(): Response
    {
        return $this->octetStream(['error' => InvalidShareLinkException::CODE], 403);
    }

    /**
     * @param  array<string, string>  $body
     */
    private function octetStream(array $body, int $status): Response
    {
        return response((string) json_encode($body), $status, [
            'Content-Type' => 'application/octet-stream',
        ]);
    }
}
