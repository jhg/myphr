<?php

declare(strict_types=1);

namespace App\Http\Controllers\Sharing;

use App\Crypto\CanonicalDate;
use App\Models\Share;
use App\Models\ShareLink;
use App\Models\User;
use App\Sharing\Shares;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * `GET /phr/shares` (ADR 0011): the active clippings of whoever asks.
 *
 * The list is deliberately poor in plaintext: identifiers, dates and the encrypted `descriptor`. The
 * range, the types and the number of events live inside that envelope and the screen is painted by
 * decrypting it in the browser, which is the only place the master key exists. An endpoint that
 * returned "blood glucose, 1 to 30 June" would mean the server had to know it, and knowing it is
 * exactly what this design avoids.
 *
 * What does **not** come out of here: `pin_salt`, `pin_tag` and `wrapper`. The first two are the
 * material for the offline attack on the PIN and the third is the wrapper of `CK`; handing them out
 * in an authenticated listing breaks nothing today —the owner herself is asking— but it would turn
 * any future leak of this response into the critical flaw the ADR fixed. The models already mark
 * them `#[Hidden]`; the shape is still built by hand here, so we do not depend on that.
 *
 * `opened_at` comes out rounded to the hour, exactly as it was stored: it is the mark of the first
 * access and not a history.
 */
final readonly class ListSharesController
{
    public function __construct(private Shares $shares) {}

    public function __invoke(Request $request): JsonResponse
    {
        $user = $request->user();

        if (! $user instanceof User) {
            return response()->json(['error' => 'unauthenticated'], 401);
        }

        $shares = $this->shares->activeFor($user)
            ->map(fn (Share $share): array => [
                'id' => $share->id,
                'expiresAt' => CanonicalDate::format($share->expires_at),
                'createdAt' => CanonicalDate::format($share->created_at),
                'openedAt' => $share->opened_at === null ? null : CanonicalDate::format($share->opened_at),
                'descriptor' => $share->descriptor,
                'links' => $share->links
                    ->map(fn (ShareLink $link): array => [
                        'id' => $link->id,
                        'expiresAt' => CanonicalDate::format($link->expires_at),
                        'attemptsRemaining' => $link->attempts_remaining,
                    ])
                    ->values()
                    ->all(),
            ])
            ->values()
            ->all();

        return response()->json(['shares' => $shares]);
    }
}
