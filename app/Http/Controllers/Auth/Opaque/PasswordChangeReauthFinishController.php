<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth\Opaque;

use App\Auth\PasswordChangeTickets;
use App\Models\OpaqueLoginHandshake;
use App\Models\User;
use App\Security\Opaque\BinaryCodec;
use App\Security\Opaque\Ke3;
use App\Security\Opaque\OpaqueException;
use App\Security\Opaque\OpaquePurpose;
use App\Security\Opaque\ServerLogin;
use App\Security\Opaque\ServerLoginState;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;

/**
 * `POST /phr/auth/password/reauth/finish`: phase A of the password change, step 7.
 *
 * It closes the OPAQUE login of the reauthentication and, only if the MAC matches, mints the ticket
 * that authorizes the rest of the flow and returns the current master key envelope so the browser
 * can open it with the old KEK.
 *
 * As in `login/finish`, the handshake is consumed **before** validating the MAC, by a conditional
 * write decided by the number of affected rows: swapping the order opens a retry oracle, and a
 * `SELECT` followed by a `DELETE` is no good because `lockForUpdate()` is a no-op on SQLite
 * (`docs/OPAQUE.md` §14.3).
 *
 * Unlike `login/finish`, `Auth::login` is **not** called here, the session is **not** regenerated
 * and no session secret is minted: the session already exists, and regenerating it at this point
 * would take with it the ticket just stored in it. That is also why the flow does not reuse
 * `login/finish` and why `purpose` tells the two kinds of handshake apart.
 */
final readonly class PasswordChangeReauthFinishController
{
    public function __construct(private PasswordChangeTickets $tickets) {}

    public function __invoke(Request $request): JsonResponse
    {
        $data = $request->validate([
            'handshakeId' => ['required', 'string', 'uuid'],
            'finishLoginRequest' => ['required', 'string', 'max:128'],
        ]);

        $user = $request->user();

        if (! $user instanceof User) {
            return $this->genericError();
        }

        $handshake = OpaqueLoginHandshake::query()->whereKey($data['handshakeId'])->first();

        $consumed = OpaqueLoginHandshake::query()
            ->whereKey($data['handshakeId'])
            ->where('purpose', OpaquePurpose::PasswordChange->value)
            ->where('user_id', $user->getKey())
            ->where('expires_at', '>', now())
            ->delete();

        if ($consumed !== 1 || ! $handshake instanceof OpaqueLoginHandshake) {
            return $this->fakeCompareAndFail($data['finishLoginRequest']);
        }

        try {
            $state = ServerLoginState::parse(Crypt::decryptString((string) $handshake->state_ciphertext));
            $ke3 = Ke3::fromBase64Url($data['finishLoginRequest']);
        } catch (DecryptException|OpaqueException) {
            return $this->genericError();
        }

        try {
            ServerLogin::serverFinish($ke3, $state);
        } catch (OpaqueException) {
            return $this->genericError();
        }

        unset($state);

        $envelope = $user->currentMasterKeyEnvelope;

        if ($envelope === null) {
            return response()->json(['error' => 'password_change_unavailable'], 409);
        }

        return response()->json([
            'ticket' => $this->tickets->mint($request->session()),
            'userId' => $user->getKey(),
            'encryptedUserMasterKey' => $envelope->envelope,
            'envelopeId' => $envelope->getKey(),
        ])->header('Vary', 'Cookie');
    }

    /**
     * Handshake that does not exist, has expired, was already consumed, is of another purpose or
     * belongs to somebody else.
     *
     * The 64-byte comparison against an impossible value is run anyway, so timing does not tell
     * "there is no handshake" from "the MAC does not match".
     */
    private function fakeCompareAndFail(string $finishLoginRequest): JsonResponse
    {
        try {
            $ke3 = Ke3::fromBase64Url($finishLoginRequest);
        } catch (OpaqueException) {
            return $this->genericError();
        }

        BinaryCodec::constantTimeEquals($ke3->clientMac, str_repeat("\x00", Ke3::MAC_LENGTH));

        return $this->genericError();
    }

    /** A single error for every reauthentication failure cause, and never a ticket. */
    private function genericError(): JsonResponse
    {
        return response()->json(['error' => 'authentication_failed'], 401);
    }
}
