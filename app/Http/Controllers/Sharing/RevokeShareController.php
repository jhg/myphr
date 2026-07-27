<?php

declare(strict_types=1);

namespace App\Http\Controllers\Sharing;

use App\Models\Share;
use App\Models\User;
use App\Sharing\ClientUuid;
use App\Sharing\Shares;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * `DELETE /phr/shares/{share}` (ADR 0011): revocation.
 *
 * A **physical** delete of the clipping and, in cascade, of all its links. No `SoftDeletes` and no
 * `deleted_at`, a deliberate exception to the ADR 0006 pattern: if revoking left the row, the
 * package would stay in the database and the promise that revoking closes the read would be false.
 *
 * The clipping is **always** looked up scoped by `user_id`, and not by identifier alone: the
 * identifiers are UUIDs and are not enumerable, but resting isolation between accounts on nobody
 * guessing a UUID is resting it on nothing. Somebody else's clipping answers the same as a
 * non-existent one.
 */
final readonly class RevokeShareController
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

        $record = Share::query()
            ->where('user_id', $user->id)
            ->whereKey($share)
            ->first();

        if (! $record instanceof Share) {
            return response()->json(['error' => 'share_not_found'], 404);
        }

        $this->shares->revoke($user, $record);

        return response()->json(['revoked' => true]);
    }
}
