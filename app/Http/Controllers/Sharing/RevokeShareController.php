<?php

declare(strict_types=1);

namespace App\Http\Controllers\Sharing;

use App\Models\Share;
use App\Models\User;
use App\Sharing\ClientUuid;
use App\Sharing\Shares;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * `DELETE /phr/shares/{share}` (ADR 0011): revocación.
 *
 * Borrado **físico** del recorte y, en cascada, de todos sus enlaces. Sin `SoftDeletes` y sin
 * `deleted_at`, excepción consciente al patrón del ADR 0006: si revocar dejase la fila, el paquete
 * seguiría en la base de datos y la promesa de que revocar cierra la lectura sería falsa.
 *
 * El recorte se busca **siempre** acotado por `user_id`, y no por identificador a secas: los
 * identificadores son UUID y no se enumeran, pero apoyar el aislamiento entre cuentas en que nadie
 * adivine un UUID es apoyarlo en nada. Un recorte ajeno responde igual que uno inexistente.
 */
final readonly class RevokeShareController
{
    public function __construct(private Shares $shares) {}

    public function __invoke(Request $request, string $share): JsonResponse
    {
        $user = $request->user();

        if (! $user instanceof User) {
            return response()->json(['error' => 'unauthenticated'], 401);
        }

        if (! ClientUuid::isValid($share)) {
            return response()->json(['error' => 'share_not_found'], 404);
        }

        $record = Share::query()
            ->where('user_id', $user->id)
            ->whereKey($share)
            ->first();

        if (! $record instanceof Share) {
            return response()->json(['error' => 'share_not_found'], 404);
        }

        $this->shares->revoke($user, $record);

        return response()->json(['revoked' => true]);
    }
}
