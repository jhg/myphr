<?php

declare(strict_types=1);

namespace App\Http\Controllers\Sharing;

use App\Crypto\CanonicalDate;
use App\Models\Share;
use App\Models\User;
use App\Sharing\ClientUuid;
use App\Sharing\ShareLimitExceededException;
use App\Sharing\ShareLinkInput;
use App\Sharing\Shares;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * `POST /phr/shares/{share}/links` (ADR 0011): re-arma un enlace sobre un recorte ya subido.
 *
 * Es para lo que existen las dos capas. Agotar los cinco intentos borra la fila del enlace y **no**
 * el paquete, así que quien vio cómo alguien quemaba los intentos fotografiando el QR vuelve a
 * armar un acceso nuevo, con `S` y PIN nuevos, sin recomponer el recorte ni volver a subir hasta
 * 4 MiB. Sirve igual para dar un enlace por destinatario, cada uno con su PIN y su contador.
 *
 * Sigue exigiendo la clave maestra en el navegador, porque `CK` vive dentro del descriptor cifrado:
 * tras el bloqueo por inactividad del ADR 0009 hay que volver a autenticarse. Eso ocurre en el
 * cliente; aquí solo se comprueba que la sesión es de la dueña del recorte.
 */
final readonly class IssueShareLinkController
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

        /**
         * Acotado por `user_id` y por caducidad: un recorte ajeno y uno muerto responden lo mismo
         * que uno inexistente, y sobre un recorte caducado no tiene sentido armar un enlace que
         * nacería sin poder servir nada.
         */
        $record = Share::query()
            ->where('user_id', $user->id)
            ->where('expires_at', '>', now())
            ->whereKey($share)
            ->first();

        if (! $record instanceof Share) {
            return response()->json(['error' => 'share_not_found'], 404);
        }

        $link = ShareLinkInput::parse($request->input('link'));

        if ($link === null) {
            return response()->json(['error' => 'invalid_link'], 422);
        }

        try {
            $created = $this->shares->issueLink($record, $link);
        } catch (ShareLimitExceededException) {
            return response()->json(['error' => ShareLimitExceededException::CODE], 409);
        }

        return response()->json([
            'id' => $created->id,
            'expiresAt' => CanonicalDate::format($created->expires_at),
        ], 201);
    }
}
