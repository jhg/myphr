<?php

declare(strict_types=1);

namespace App\Sharing;

use App\Crypto\CanonicalDate;
use App\Models\Share;
use App\Models\ShareLink;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The reading gate of a shared clipping (ADR 0011).
 *
 * This is the piece that fixed the critical flaw in the original design. That one handed the package
 * to anyone who knew the identifier and asked for the PIN afterwards, on the client: with the blob
 * downloaded, a six-digit PIN is a million offline guesses and protects nothing, and no slow KDF
 * fixes it, because holding on cost alone would need 40 bits, which is no longer a PIN.
 *
 * Hence the rule that governs this whole file: **not a single byte of the package or the wrapper
 * leaves before the PIN matches**. `challenge()` hands out only the salt, which is public by
 * construction, and `open()` hands out the rest only after comparing the proof.
 *
 * The attempt counter lives in a column and is consumed with an atomic conditional write, the same
 * shape as `RegistrationLinks::consume()`. `lockForUpdate()` is not used: on SQLite it is a no-op,
 * so a counter relying on it would pass the tests without protecting anything. And Laravel's
 * `RateLimiter` is not used either, since it lives in cache and an operational `cache:clear` would
 * hand an attacker back their million attempts.
 *
 * The four failure causes —does not exist, expired, revoked, wrong PIN— all come out through the
 * same {@see InvalidShareLinkException}, with no variants.
 */
final readonly class ShareLinkGate
{
    public function __construct(private DecoySalt $decoy) {}

    /**
     * First step: hands out the salt the client stretches the PIN with using Argon2id.
     *
     * It **always** returns 16 bytes, whether the link exists or not. For a live link, its
     * `pin_salt`; for anything else, the deterministic decoy from {@see DecoySalt}. At this step
     * there is no PIN to judge yet, so non-existent, expired and revoked have to be
     * indistinguishable from alive: if they were not, a list of identifiers would become a map of
     * which clippings are still open.
     *
     * It consumes no attempts. Consuming them here would let anyone kill someone else's link with
     * five requests, knowing neither the PIN nor `S`.
     *
     * @param  string  $linkId  Identifier exactly as it arrived in the URL.
     * @return string 16 binary bytes.
     */
    public function challenge(string $linkId): string
    {
        $link = $this->liveLink($linkId);

        if (! $link instanceof ShareLink) {
            return $this->decoy->for($linkId);
        }

        return (string) $link->pin_salt;
    }

    /**
     * Second step: checks the PIN and, only if it matches, returns the wrapper and the package.
     *
     * The order of operations is the part that matters:
     *
     * 1. An **attempt is consumed** with an atomic conditional write. It goes first, before looking
     *    at the proof, because doing it the other way round would let two simultaneous requests read
     *    the same counter and spend a single attempt between them: ten threads would be enough to
     *    turn five attempts into fifty.
     * 2. The proof is compared in constant time with `hash_equals()`. A comparison with `==` or a
     *    `where('pin_tag', ...)` in SQL leaks by timing how many leading bytes matched.
     * 3. If it does not match and it was the last attempt, the link row is deleted. **Only the
     *    link** is deleted, never the package: the person re-arms a new link, with a new `S` and
     *    PIN, without redoing the clipping, which is what the two layers exist for.
     * 4. If it matches, the counter goes back to its cap and the first access is marked.
     *
     * What it returns is the four things the reader needs and cannot work out on its own: the
     * wrapper, the package, the clipping identifier and the link expiry. The last two go into the
     * associated data of both layers, so a server that lied about either fools nobody: the wrapper
     * stops opening and the error is visible (ADR 0004). The generation instant does **not** come
     * from here because the server does not know it: it travels in the URL fragment, which never
     * reaches it (see `crypto/shareLink.js`).
     *
     * @param  string  $linkId  Identifier from the URL.
     * @param  string  $pinTag  32-byte proof computed by the client.
     * @return array{wrapper: string, package: string, shareId: string, expiresAt: string}
     *
     * @throws InvalidShareLinkException Whenever it cannot be served, for whatever reason.
     */
    public function open(string $linkId, string $pinTag): array
    {
        if (! Str::isUuid($linkId) || strlen($pinTag) !== ShareLink::PIN_TAG_BYTES) {
            throw InvalidShareLinkException::generic();
        }

        $now = Carbon::now();

        /**
         * Conditional write: it only decrements the counter if the link exists, has not expired and
         * has attempts left. The number of affected rows is the answer, and it is atomic in the
         * engine with no transaction and no lock.
         */
        $consumed = ShareLink::query()
            ->whereKey($linkId)
            ->where('attempts_remaining', '>', 0)
            ->where('expires_at', '>', $now)
            ->update(['attempts_remaining' => DB::raw('attempts_remaining - 1')]);

        if ($consumed !== 1) {
            throw InvalidShareLinkException::generic();
        }

        $link = ShareLink::query()->with('share')->whereKey($linkId)->first();

        /**
         * The package is checked separately: a live link whose clipping already expired must serve
         * nothing, and expiry is enforced in the query that serves the blob, like
         * `RegistrationLinks::validate()`, so the scheduled pruning is only hygiene.
         */
        $share = $link?->share;

        if (! $link instanceof ShareLink || ! $share instanceof Share || ! $share->expires_at->greaterThan($now)) {
            throw InvalidShareLinkException::generic();
        }

        if (! hash_equals((string) $link->pin_tag, $pinTag)) {
            if ($link->attempts_remaining <= 0) {
                ShareLink::query()->whereKey($linkId)->delete();
            }

            throw InvalidShareLinkException::generic();
        }

        $this->rearmAfterSuccess($link);
        $this->markFirstOpen($share, $now);

        return [
            'wrapper' => (string) $link->wrapper,
            'package' => (string) $share->payload,
            'shareId' => (string) $share->getKey(),
            'expiresAt' => CanonicalDate::format($link->expires_at),
        ];
    }

    /**
     * Usable link: it exists, it has not expired and neither has its clipping.
     *
     * `Str::isUuid()` comes first because the identifier arrives from a public URL and the column is
     * of type UUID: on PostgreSQL, querying a string that is not one blows the query up instead of
     * returning no rows, and that 500 would be another way of telling inputs apart.
     */
    private function liveLink(string $linkId): ?ShareLink
    {
        if (! Str::isUuid($linkId)) {
            return null;
        }

        $now = Carbon::now();

        return ShareLink::query()
            ->whereKey($linkId)
            ->where('expires_at', '>', $now)
            ->whereHas('share', fn ($query) => $query->where('expires_at', '>', $now))
            ->first();
    }

    /**
     * A correct PIN puts the counter back at its cap.
     *
     * Without this, opening the same link five times with the right PIN would kill it: the
     * professional who reloads the tab, or looks at it again the next day, would lose access having
     * done nothing wrong. The five attempts exist to bound brute force on the PIN, not to ration
     * legitimate reads.
     */
    private function rearmAfterSuccess(ShareLink $link): void
    {
        if ($link->attempts_remaining === ShareLink::MAX_ATTEMPTS) {
            return;
        }

        ShareLink::query()
            ->whereKey($link->getKey())
            ->update(['attempts_remaining' => ShareLink::MAX_ATTEMPTS]);
    }

    /**
     * Mark of the **first** access, rounded to the hour and written only once.
     *
     * The `whereNull` condition is what guarantees the "only once" without reading first: two
     * simultaneous opens produce a single write. Rounding to the hour is deliberate: with
     * second-precision marks, and above all with an access history, the server would know how many
     * times and when each delivery was read, which is the trail ADR 0006 rules out.
     */
    private function markFirstOpen(Share $share, Carbon $now): void
    {
        Share::query()
            ->whereKey($share->getKey())
            ->whereNull('opened_at')
            ->update(['opened_at' => $now->clone()->startOfHour()]);
    }
}
