<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Crypto\EnvelopeValidator;
use App\Crypto\ShareEnvelopeValidator;
use App\Models\Share;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * ADR 0011: the package is encrypted on the client, so the factory cannot produce real content. It
 * generates an envelope with the shape {@see ShareEnvelopeValidator} validates: the `s1.` prefix
 * plus base64url of random bytes whose total size matches one step of the padding ladder, so the
 * {@see Share::booted()} guardrail accepts it without needing real encryption.
 *
 * By default it uses the **smallest** step (64 KiB): the larger ones are 1 and 4 MiB, and filling
 * the suite's memory with them on every test buys nothing.
 *
 * @extends Factory<Share>
 */
final class ShareFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            /** Explicit UUIDv4: the ADR rules out v7, which carries the creation instant inside. */
            'id' => (string) Str::uuid(),
            'user_id' => User::factory(),
            'expires_at' => now()->addDay(),
            'payload' => self::fakePackage(),
            'descriptor' => self::fakeEnvelope(),
        ];
    }

    /** Already expired clipping, to check it is neither listed nor served. */
    public function expired(): static
    {
        return $this->state(fn (): array => ['expires_at' => now()->subMinute()]);
    }

    public static function fakePackage(int $paddedSize = 65536): string
    {
        $bytes = ShareEnvelopeValidator::HEADER_BYTES + ShareEnvelopeValidator::TAG_BYTES + $paddedSize;

        return ShareEnvelopeValidator::PREFIX.self::base64Url(random_bytes($bytes));
    }

    public static function fakeEnvelope(int $paddedSize = 256): string
    {
        $bytes = EnvelopeValidator::HEADER_BYTES + EnvelopeValidator::TAG_BYTES + $paddedSize;

        return EnvelopeValidator::PREFIX.self::base64Url(random_bytes($bytes));
    }

    private static function base64Url(string $binary): string
    {
        return rtrim(strtr(base64_encode($binary), '+/', '-_'), '=');
    }
}
