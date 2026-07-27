<?php

declare(strict_types=1);

namespace App\Sharing;

use App\Models\Share;
use App\Models\ShareLink;
use App\Models\User;
use App\Support\AuditEvent;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Creating, listing and revoking shared clippings (ADR 0011), from the session of whoever owns the
 * data.
 *
 * It gathers here, and not in the controllers, three things that cannot live in two places:
 *
 * * The **caps**, because a cap that is only on one of the two creation paths is a cap that does not
 *   exist.
 * * The **activity trail**, for the same reason `RegistrationLinks::issueFor()` emits it inside and
 *   not in the caller.
 * * The rule that **revoking is a physical delete**. No `SoftDeletes` and no `deleted_at`: if
 *   revoking left the row, the package would stay in the database and the promise that revoking
 *   closes the read would be false.
 *
 * What this class does **not** do, and it is worth saying: it does not look inside `payload` or
 * `descriptor`. It cannot. It only checks the shape of the envelopes, which the model guardrails
 * already do, and the dates.
 */
final readonly class Shares
{
    /**
     * Active —not expired— clippings per user.
     *
     * The ADR leaves the figure open and it is fixed explicitly here. Twenty comfortably covers the
     * real case (one clipping per consultation, a few a month, expiring after 24 hours) and bounds
     * the worst-case storage of an account to twenty times the largest step.
     */
    public const int MAX_ACTIVE_SHARES = 20;

    /**
     * Live links on the same clipping.
     *
     * Several exist on purpose: one per recipient, each with its own PIN and counter, and a new one
     * when somebody burns the five attempts of the previous one. Five is enough for both uses and
     * stops re-arming in a loop from inflating the table.
     */
    public const int MAX_LINKS_PER_SHARE = 5;

    /**
     * Creates the clipping and its first link in the same transaction.
     *
     * They go together because a clipping without a link is useless and a link without a clipping
     * cannot exist: leaving either half-done because of a network failure would produce orphan rows
     * nobody is going to clean up by hand.
     *
     * @param  array{id: string, payload: string, descriptor: string, expiresAt: Carbon}  $share
     * @param  array{id: string, pinSalt: string, pinTag: string, wrapper: string}  $link
     *
     * @throws ShareLimitExceededException If the account is already at the active clipping cap.
     */
    public function create(User $user, array $share, array $link): Share
    {
        $this->assertBelowShareLimit($user);

        $created = DB::transaction(function () use ($user, $share, $link): Share {
            $record = Share::create([
                'id' => $share['id'],
                'user_id' => $user->id,
                'expires_at' => $share['expiresAt'],
                'payload' => $share['payload'],
                'descriptor' => $share['descriptor'],
            ]);

            $this->attachLink($record, $link);

            return $record;
        });

        /**
         * We record that a share happened and when, never what of. The server already knows both:
         * the row exists and carries a date. Neither the range, nor the types, nor the number of
         * events can go in here, because they are encrypted and the trail is no place to reintroduce
         * the metadata ADR 0006 removed from the schema.
         *
         * The subject is the user and not the clipping, on purpose: the clipping is deleted when it
         * is revoked or pruned, and an audit entry pointing at a row that no longer exists is not a
         * trail, it is an orphan identifier.
         */
        activity(AuditEvent::LOG_NAME)
            ->causedBy($user)
            ->performedOn($user)
            ->event(AuditEvent::ShareCreated->value)
            ->log(AuditEvent::ShareCreated->value);

        return $created;
    }

    /**
     * Re-arms a link on a clipping that already exists, with a new `S` and PIN.
     *
     * This is the whole point of the two layers: running out of attempts deletes the link row and
     * not the package, so redoing access does not force rebuilding or re-uploading the clipping. It
     * still requires the master key in the browser, because `CK` lives inside the encrypted
     * descriptor.
     *
     * @param  array{id: string, pinSalt: string, pinTag: string, wrapper: string}  $link
     *
     * @throws ShareLimitExceededException If the clipping is already at its live link cap.
     */
    public function issueLink(Share $share, array $link): ShareLink
    {
        $live = $share->links()->where('expires_at', '>', Carbon::now())->count();

        if ($live >= self::MAX_LINKS_PER_SHARE) {
            throw ShareLimitExceededException::tooManyLinks(self::MAX_LINKS_PER_SHARE);
        }

        return $this->attachLink($share, $link);
    }

    /**
     * A person's live clippings, with their live links.
     *
     * What it returns is deliberately poor: identifiers, dates and the encrypted descriptor. The
     * active shares screen is painted by decrypting that descriptor in the browser, which is the
     * only place the master key exists.
     *
     * @return Collection<int, Share>
     */
    public function activeFor(User $user): Collection
    {
        $now = Carbon::now();

        return Share::query()
            ->where('user_id', $user->id)
            ->where('expires_at', '>', $now)
            ->with(['links' => fn ($query) => $query->where('expires_at', '>', $now)->orderBy('created_at')])
            ->orderByDesc('created_at')
            ->get();
    }

    /**
     * Revocation: physical delete of the clipping and, in cascade, of all its links.
     *
     * No tombstone and no `SoftDeletes`, a deliberate exception to the ADR 0006 pattern. What this
     * does **not** do, and it has to be said plainly: it does not delete what the other person
     * already downloaded. A still photo once handed over is theirs forever; revoking only prevents
     * future reads.
     */
    public function revoke(User $user, Share $share): void
    {
        $share->delete();

        activity(AuditEvent::LOG_NAME)
            ->causedBy($user)
            ->performedOn($user)
            ->event(AuditEvent::ShareRevoked->value)
            ->log(AuditEvent::ShareRevoked->value);
    }

    /**
     * @param  array{id: string, pinSalt: string, pinTag: string, wrapper: string}  $link
     */
    private function attachLink(Share $share, array $link): ShareLink
    {
        return ShareLink::create([
            'id' => $link['id'],
            'share_id' => $share->id,
            'pin_salt' => $link['pinSalt'],
            'pin_tag' => $link['pinTag'],
            'attempts_remaining' => ShareLink::MAX_ATTEMPTS,
            'wrapper' => $link['wrapper'],
            /**
             * The link inherits the clipping's expiry. It cannot outlive it —it would serve a
             * package that is no longer there— and making it live less would require a second date
             * in the `wrapKey` derivation for no gain.
             */
            'expires_at' => $share->expires_at,
        ]);
    }

    /**
     * @throws ShareLimitExceededException
     */
    private function assertBelowShareLimit(User $user): void
    {
        $active = Share::query()
            ->where('user_id', $user->id)
            ->where('expires_at', '>', Carbon::now())
            ->count();

        if ($active >= self::MAX_ACTIVE_SHARES) {
            throw ShareLimitExceededException::tooManyShares(self::MAX_ACTIVE_SHARES);
        }
    }
}
