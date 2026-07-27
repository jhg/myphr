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
 * ADR 0011: el paquete se cifra en el cliente, así que la fábrica no puede producir contenido real.
 * Genera un sobre con la forma que valida {@see ShareEnvelopeValidator}: prefijo `s1.` más base64url
 * de bytes aleatorios cuyo tamaño total coincide con un escalón de la escalera de relleno, para que
 * el guardarraíl de {@see Share::booted()} lo acepte sin necesitar cifrado real.
 *
 * Por defecto usa el escalón **más pequeño** (64 KiB): los mayores son de 1 y 4 MiB y llenar la
 * memoria de la suite con ellos en cada test no aporta nada.
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
            /** UUIDv4 explícito: el ADR descarta el v7, que lleva el instante de creación dentro. */
            'id' => (string) Str::uuid(),
            'user_id' => User::factory(),
            'expires_at' => now()->addDay(),
            'payload' => self::fakePackage(),
            'descriptor' => self::fakeEnvelope(),
        ];
    }

    /** Recorte ya caducado, para probar que ni se lista ni se sirve. */
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
