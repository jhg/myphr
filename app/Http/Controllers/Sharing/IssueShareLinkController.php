<?php

declare(strict_types=1);

namespace App\Http\Controllers\Sharing;

use App\Crypto\CanonicalDate;
use App\Models\Share;
use App\Models\User;
use App\Sharing\ClientUuid;
use App\Sharing\ShareLimitExceededException;
use App\Sharing\ShareLinkInput;
use App\Sharing\Shares;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * `POST /phr/shares/{share}/links` (ADR 0011): re-arms a link on an already uploaded clipping.
 *
 * This is what the two layers exist for. Burning the five attempts deletes the link row and **not**
 * the package, so someone who watched a person burn the attempts while photographing the QR code can
 * arm fresh access, with a new `S` and PIN, without rebuilding the clipping or re-uploading up to
 * 4 MiB. It is equally useful for giving one link per recipient, each with its own PIN and counter.
 *
 * It still requires the master key in the browser, because `CK` lives inside the encrypted
 * descriptor: after the ADR 0009 idle lock you have to authenticate again. That happens on the
 * client; here we only check that the session belongs to the clipping's owner.
 */
final readonly class IssueShareLinkController
{
    public function __construct(private Shares $shares) {}

    public function __invoke(Request $request, string $share): JsonResponse
    {
        $user = $request->user();

        if (! $user instanceof User) {
            return response()->json(['error' => 'unauthenticated'], 401);
        }

        if (! ClientUuid::isValid($share)) {
            return response()->json(['error' => 'share_not_found'], 404);
        }

        /**
         * Scoped by `user_id` and by expiry: somebody else's clipping and a dead one answer the same
         * as a non-existent one, and arming a link on an expired clipping makes no sense since it
         * would be born unable to serve anything.
         */
        $record = Share::query()
            ->where('user_id', $user->id)
            ->where('expires_at', '>', now())
            ->whereKey($share)
            ->first();

        if (! $record instanceof Share) {
            return response()->json(['error' => 'share_not_found'], 404);
        }

        $link = ShareLinkInput::parse($request->input('link'));

        if ($link === null) {
            return response()->json(['error' => 'invalid_link'], 422);
        }

        try {
            $created = $this->shares->issueLink($record, $link);
        } catch (ShareLimitExceededException) {
            return response()->json(['error' => ShareLimitExceededException::CODE], 409);
        }

        return response()->json([
            'id' => $created->id,
            'expiresAt' => CanonicalDate::format($created->expires_at),
        ], 201);
    }
}
