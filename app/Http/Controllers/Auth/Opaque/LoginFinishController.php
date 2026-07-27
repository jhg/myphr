<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth\Opaque;

use App\Auth\SessionSecrets;
use App\Models\OpaqueLoginHandshake;
use App\Models\User;
use App\Security\Opaque\BinaryCodec;
use App\Security\Opaque\Ke3;
use App\Security\Opaque\OpaqueException;
use App\Security\Opaque\OpaquePurpose;
use App\Security\Opaque\ServerLogin;
use App\Security\Opaque\ServerLoginState;
use App\Support\AuditEvent;
use Filament\Facades\Filament;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Crypt;

/**
 * `POST /phr/auth/opaque/login/finish` (Spec 0001 §4.4 / `docs/OPAQUE.md` §15.4).
 *
 * It consumes the handshake **before** validating the MAC: swapping the order opens a retry oracle
 * on the same handshake. Consumption is a conditional write decided by the number of affected rows,
 * not a `SELECT` followed by a `DELETE`, because `lockForUpdate()` is a no-op on SQLite and two
 * simultaneous requests would consume the same handshake (`docs/OPAQUE.md` §14.3).
 *
 * Every failure —invalid MAC, expired handshake, reused handshake, fake branch, account with no
 * master key envelope— produces **the same generic error** and no session.
 *
 * On success, the order is normative (§5, step 14): `Auth::login`, `session()->regenerate()` and
 * only then minting the session secret. Minting it earlier would tie it to the previous session
 * identifier and it would be lost on regeneration, with no symptom until that person's first page
 * refresh.
 */
final readonly class LoginFinishController
{
    public function __construct(private SessionSecrets $sessionSecrets) {}

    public function __invoke(Request $request): JsonResponse
    {
        $data = $request->validate([
            'handshakeId' => ['required', 'string', 'uuid'],
            'finishLoginRequest' => ['required', 'string', 'max:128'],
        ]);

        $handshake = OpaqueLoginHandshake::query()->whereKey($data['handshakeId'])->first();

        $consumed = OpaqueLoginHandshake::query()
            ->whereKey($data['handshakeId'])
            ->where('purpose', OpaquePurpose::Login->value)
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
            /**
             * The `session_key` `ServerFinish` returns is discarded right here: the client already
             * has its copy and the server does not need it after the handshake (§4.4).
             */
            ServerLogin::serverFinish($ke3, $state);
        } catch (OpaqueException) {
            return $this->genericError();
        }

        unset($state);

        $user = $handshake->user_id === null
            ? null
            : User::query()->whereKey($handshake->user_id)->first();

        /** Correct fake branch (§15.4, step 7): the MAC matched, but there is no account behind it. */
        if (! $user instanceof User) {
            return $this->genericError();
        }

        $envelope = $user->currentMasterKeyEnvelope;

        if ($envelope === null) {
            return $this->genericError();
        }

        Auth::guard('web')->login($user, remember: false);
        $request->session()->regenerate();

        $sessionSecret = $this->sessionSecrets->mint($request->session());

        /**
         * We record that the account logged in, after the session exists: if something failed
         * earlier, we would not have to undo an entry claiming an access that never happened.
         */
        activity(AuditEvent::LOG_NAME)
            ->causedBy($user)
            ->performedOn($user)
            ->event(AuditEvent::LoggedIn->value)
            ->log(AuditEvent::LoggedIn->value);

        /** The `userId` is the associated data of the master key envelope: without it the client cannot open it. */
        return response()->json([
            'userId' => $user->getKey(),
            'redirect' => $request->session()->pull('url.intended', $this->panelUrl()),
            'csrf' => $request->session()->token(),
            'sessionSecret' => $sessionSecret,
            'encryptedUserMasterKey' => $envelope->envelope,
            'encryptedSettings' => $user->encrypted_settings,
        ]);
    }

    /**
     * Destination after login. `url.intended` first, so we do not lose the deep URL a middleware
     * pulled the person out of with `redirect()->guest()` (§4.4).
     */
    private function panelUrl(): string
    {
        return Filament::getCurrentPanel()?->getUrl() ?? url('/');
    }

    /**
     * Non-existent, already consumed or expired handshake (`docs/OPAQUE.md` §15.4, step 2).
     *
     * A 64-byte comparison against a value that cannot match is run anyway, so timing does not tell
     * the "there is no handshake" case from the "the MAC does not match" case.
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

    /**
     * A single error for every cause (§4.4): wrong credentials, non-existent account, invalid MAC,
     * expired handshake and reused handshake.
     */
    private function genericError(): JsonResponse
    {
        return response()->json(['error' => 'authentication_failed'], 401);
    }
}
