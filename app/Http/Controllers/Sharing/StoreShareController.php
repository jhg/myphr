<?php

declare(strict_types=1);

namespace App\Http\Controllers\Sharing;

use App\Crypto\CanonicalDate;
use App\Crypto\EnvelopeValidator;
use App\Crypto\ShareEnvelopeValidator;
use App\Models\User;
use App\Sharing\ClientUuid;
use App\Sharing\ShareLimitExceededException;
use App\Sharing\ShareLinkInput;
use App\Sharing\Shares;
use App\Sharing\ShareTtl;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * `POST /phr/shares` (ADR 0011): uploads a clipping's package and creates its first link.
 *
 * It is an HTTP endpoint of its own and **not** a Livewire component method, on purpose. The package
 * carries the `s1.` prefix, and the two ADR 0002 guardrails (`livewirePayloadGuard.js` and
 * `EncryptedPayloadGuardHook`) abort on any string longer than 256 characters that does not start
 * with `v1.`: a package travelling over Livewire would die at both ends. Those guardrails are not
 * touched; we use the route ADR 0002 itself reserves for large blobs.
 *
 * What the server validates is **shape and nothing else**: the package prefix and padding step, the
 * prefix and size of the descriptor and the wrapper, the shape of the identifiers and the
 * consistency of the expiry. It cannot validate content and does not try.
 *
 * The user always comes from the session, never from the body.
 */
final readonly class StoreShareController
{
    public function __construct(private Shares $shares) {}

    public function __invoke(Request $request): JsonResponse
    {
        $user = $request->user();

        if (! $user instanceof User) {
            return response()->json(['error' => 'unauthenticated'], 401);
        }

        $id = $request->input('id');

        if (! ClientUuid::isValid($id)) {
            return $this->error('invalid_share_id');
        }

        $payload = $request->input('payload');

        if (! ShareEnvelopeValidator::isValid($payload)) {
            return $this->error('invalid_package');
        }

        $descriptor = $request->input('descriptor');

        if (! EnvelopeValidator::isValid($descriptor)) {
            return $this->error('invalid_descriptor');
        }

        $expiresAt = $this->parseExpiry($request->input('expiresAt'));

        if (! $expiresAt instanceof CarbonImmutable) {
            return $this->error('invalid_expiry');
        }

        $link = ShareLinkInput::parse($request->input('link'));

        if ($link === null) {
            return $this->error('invalid_link');
        }

        try {
            $share = $this->shares->create($user, [
                'id' => (string) $id,
                'payload' => (string) $payload,
                'descriptor' => (string) $descriptor,
                'expiresAt' => Carbon::instance($expiresAt),
            ], $link);
        } catch (ShareLimitExceededException) {
            return $this->error(ShareLimitExceededException::CODE, 409);
        }

        return response()->json([
            'id' => $share->id,
            'expiresAt' => CanonicalDate::format($share->expires_at),
        ], 201);
    }

    /**
     * The expiry has to come from the client and not be computed by the server: it goes into the
     * `wrapKey` derivation and into the wrapper's associated data (`canonicalDate(expiresAt)`), so
     * the client needs it **before** encrypting. What the server checks is that it corresponds to
     * one of the three options in the ADR 0011 closed list.
     *
     * The comparison allows {@see ShareTtl::TOLERANCE_MINUTES} of slack because between the client
     * fixing the date and the request arriving there are the Argon2id of the PIN, which on a slow
     * machine is several seconds, and the upload of up to 4 MiB. Requiring equality to the second
     * would turn an old laptop into a validation error.
     */
    private function parseExpiry(mixed $value): ?CarbonImmutable
    {
        $date = CanonicalDate::parse($value);

        if (! $date instanceof CarbonImmutable) {
            return null;
        }

        $now = CarbonImmutable::now();
        $tolerance = ShareTtl::TOLERANCE_MINUTES * 60;

        foreach (ShareTtl::cases() as $ttl) {
            if (abs($date->diffInSeconds($now->addHours($ttl->hours()))) <= $tolerance) {
                return $date;
            }
        }

        return null;
    }

    private function error(string $code, int $status = 422): JsonResponse
    {
        return response()->json(['error' => $code], $status);
    }
}
