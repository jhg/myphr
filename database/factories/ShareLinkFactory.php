<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Models\Share;
use App\Models\ShareLink;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * ADR 0011: a link wrapper, with values of the right shape and no cryptographic meaning at all.
 * `pin_tag` is 32 random bytes precisely because a real tag is indistinguishable from that without
 * knowing the PIN, which is the whole point.
 *
 * To test a successful open you have to set `pin_tag` by hand to the value the test is going to
 * send: deriving it here would need Argon2id on the server, which this design never runs.
 *
 * @extends Factory<ShareLink>
 */
final class ShareLinkFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'id' => (string) Str::uuid(),
            'share_id' => Share::factory(),
            'pin_salt' => random_bytes(ShareLink::PIN_SALT_BYTES),
            'pin_tag' => random_bytes(ShareLink::PIN_TAG_BYTES),
            'attempts_remaining' => ShareLink::MAX_ATTEMPTS,
            'wrapper' => ShareFactory::fakeEnvelope(),
            'expires_at' => now()->addDay(),
        ];
    }

    /** Already expired link. */
    public function expired(): static
    {
        return $this->state(fn (): array => ['expires_at' => now()->subMinute()]);
    }

    /** Link with a single attempt left, to test deletion once they run out. */
    public function lastAttempt(): static
    {
        return $this->state(fn (): array => ['attempts_remaining' => 1]);
    }
}
