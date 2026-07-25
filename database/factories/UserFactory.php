<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Models\User;
use App\Security\Opaque\OpaqueProfile;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Spec 0001 §3.1: el alta no escribe contraseña, ni `email_verified_at`, ni registro OPAQUE.
 *
 * @extends Factory<User>
 */
final class UserFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => fake()->name(),
            'email' => fake()->unique()->safeEmail(),
        ];
    }

    /**
     * Cuenta con el registro OPAQUE completo: la única que puede entrar al panel (ADR 0009).
     */
    public function registered(): static
    {
        return $this->state(fn (array $attributes): array => [
            'opaque_credential_identifier' => random_bytes(32),
            'opaque_registration_record' => random_bytes(192),
            'opaque_profile' => OpaqueProfile::NAME,
            'opaque_registered_at' => now(),
            'encrypted_settings' => 'v1.'.rtrim(strtr(base64_encode(random_bytes(48)), '+/', '-_'), '='),
        ]);
    }
}
