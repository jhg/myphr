<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Crypto\EnvelopeValidator;
use App\Models\Event;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * ADR 0006: the contents of `payload` are encrypted on the client, so the factory cannot produce
 * real clinical JSON. It generates an envelope with a valid shape according to {@see
 * EnvelopeValidator}: the `v1.` prefix plus base64url of random bytes whose total size matches one
 * of the fixed padding sizes, so the {@see Event::booted()} guardrail accepts it without needing
 * real encryption.
 *
 * @extends Factory<Event>
 */
final class EventFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'occurred_at' => fake()->dateTimeBetween('-1 year', 'now'),
            'payload' => self::fakeEnvelope(),
        ];
    }

    /**
     * Smallest valid envelope size by default, so tests are not inflated with larger padding.
     */
    private static function fakeEnvelope(int $paddedSize = 256): string
    {
        $totalBytes = EnvelopeValidator::HEADER_BYTES + EnvelopeValidator::TAG_BYTES + $paddedSize;

        return EnvelopeValidator::PREFIX.rtrim(strtr(base64_encode(random_bytes($totalBytes)), '+/', '-_'), '=');
    }
}
