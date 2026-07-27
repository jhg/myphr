<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Models\Share;
use App\Models\ShareLink;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * ADR 0011: envoltorio de un enlace, con valores de la forma correcta y sin ningún significado
 * criptográfico. `pin_tag` son 32 bytes al azar precisamente porque un tag real es indistinguible de
 * eso sin conocer el PIN, que es lo que se pretende.
 *
 * Para probar la apertura con éxito hay que fijar `pin_tag` a mano al valor que el test vaya a
 * enviar: derivarlo aquí exigiría Argon2id en servidor, que este diseño no ejecuta nunca.
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

    /** Enlace ya caducado. */
    public function expired(): static
    {
        return $this->state(fn (): array => ['expires_at' => now()->subMinute()]);
    }

    /** Enlace con un solo intento por delante, para probar el borrado al agotarlos. */
    public function lastAttempt(): static
    {
        return $this->state(fn (): array => ['attempts_remaining' => 1]);
    }
}
