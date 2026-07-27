<?php

declare(strict_types=1);

namespace App\Http\Controllers\Sharing;

use App\Crypto\CanonicalDate;
use App\Models\Share;
use App\Models\ShareLink;
use App\Models\User;
use App\Sharing\Shares;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * `GET /phr/shares` (ADR 0011): los recortes activos de quien pregunta.
 *
 * La lista es deliberadamente pobre en claro: identificadores, fechas y el `descriptor` cifrado. El
 * rango, los tipos y el número de eventos viven dentro de ese sobre y la pantalla se pinta
 * descifrándolo en el navegador, que es el único sitio donde existe la clave maestra. Un endpoint
 * que devolviese «glucemias, del 1 al 30 de junio» tendría que haberlo sabido el servidor, y saberlo
 * es justo lo que este diseño evita.
 *
 * Lo que **no** sale de aquí: `pin_salt`, `pin_tag` y `wrapper`. Los dos primeros son el material del
 * ataque fuera de línea contra el PIN y el tercero es el envoltorio de `CK`; entregarlos en un
 * listado autenticado no rompe nada hoy —es la propia dueña quien pregunta— pero convertiría
 * cualquier fuga futura de esta respuesta en el fallo crítico que el ADR corrigió. Los modelos ya los
 * marcan `#[Hidden]`; aquí se construye la forma a mano de todas formas, para no depender de eso.
 *
 * `opened_at` sale redondeado a la hora, tal como se guardó: es la marca del primer acceso y no un
 * historial.
 */
final readonly class ListSharesController
{
    public function __construct(private Shares $shares) {}

    public function __invoke(Request $request): JsonResponse
    {
        $user = $request->user();

        if (! $user instanceof User) {
            return response()->json(['error' => 'unauthenticated'], 401);
        }

        $shares = $this->shares->activeFor($user)
            ->map(fn (Share $share): array => [
                'id' => $share->id,
                'expiresAt' => CanonicalDate::format($share->expires_at),
                'createdAt' => CanonicalDate::format($share->created_at),
                'openedAt' => $share->opened_at === null ? null : CanonicalDate::format($share->opened_at),
                'descriptor' => $share->descriptor,
                'links' => $share->links
                    ->map(fn (ShareLink $link): array => [
                        'id' => $link->id,
                        'expiresAt' => CanonicalDate::format($link->expires_at),
                        'attemptsRemaining' => $link->attempts_remaining,
                    ])
                    ->values()
                    ->all(),
            ])
            ->values()
            ->all();

        return response()->json(['shares' => $shares]);
    }
}
