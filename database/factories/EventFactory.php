<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Crypto\EnvelopeValidator;
use App\Models\Event;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * ADR 0006: el contenido de `payload` es cifrado en el cliente, así que la fábrica no puede producir
 * JSON clínico real. Genera un sobre con forma válida según {@see EnvelopeValidator}: prefijo `v1.`
 * más base64url de bytes aleatorios cuyo tamaño total coincide con uno de los tamaños fijos de
 * relleno, para que el guardarraíl de {@see Event::booted()} lo acepte sin necesitar cifrado real.
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
     * Sobre de tamaño válido más pequeño por defecto, para no inflar los tests con relleno mayor.
     */
    private static function fakeEnvelope(int $paddedSize = 256): string
    {
        $totalBytes = EnvelopeValidator::HEADER_BYTES + EnvelopeValidator::TAG_BYTES + $paddedSize;

        return EnvelopeValidator::PREFIX.rtrim(strtr(base64_encode(random_bytes($totalBytes)), '+/', '-_'), '=');
    }
}
