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
 * `POST /phr/shares` (ADR 0011): sube el paquete de un recorte y crea su primer enlace.
 *
 * Es un endpoint HTTP propio y **no** un método de componente Livewire, a propósito. El paquete
 * lleva el prefijo `s1.`, y los dos guardarraíles del ADR 0002 (`livewirePayloadGuard.js` y
 * `EncryptedPayloadGuardHook`) abortan cualquier cadena de más de 256 caracteres que no empiece por
 * `v1.`: un paquete que viajase por Livewire moriría en los dos extremos. No se tocan esos
 * guardarraíles; se usa la vía que el propio ADR 0002 reserva para los blobs grandes.
 *
 * Lo que el servidor valida es **forma y nada más**: prefijo y escalón de relleno del paquete,
 * prefijo y tamaño del descriptor y del envoltorio, forma de los identificadores y coherencia de la
 * caducidad. No puede validar contenido y no lo intenta.
 *
 * El usuario sale siempre de la sesión, nunca del cuerpo.
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
     * La caducidad tiene que llegar del cliente y no calcularla el servidor: entra en la derivación
     * de `wrapKey` y en el dato asociado del envoltorio (`canonicalDate(expiresAt)`), así que el
     * cliente la necesita **antes** de cifrar. Lo que el servidor comprueba es que corresponde a una
     * de las tres opciones de la lista cerrada del ADR 0011.
     *
     * La comparación admite {@see ShareTtl::TOLERANCE_MINUTES} de holgura porque entre que el
     * cliente fija la fecha y llega la petición pasan el Argon2id del PIN, que en un equipo lento
     * son varios segundos, y la subida de hasta 4 MiB. Exigir igualdad al segundo convertiría un
     * portátil viejo en un error de validación.
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
