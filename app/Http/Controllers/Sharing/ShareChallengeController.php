<?php

declare(strict_types=1);

namespace App\Http\Controllers\Sharing;

use App\Security\Opaque\Base64Url;
use App\Sharing\ShareLinkGate;
use Illuminate\Http\JsonResponse;

/**
 * `POST /s/{link}/challenge` (ADR 0011): primer paso de la lectura.
 *
 * Devuelve **solo la sal** con la que el cliente estira el PIN con Argon2id. Ni un byte del paquete
 * ni del envoltorio: entregarlos aquí, antes de validar el PIN, es exactamente el fallo que
 * invalidaba el diseño inicial, porque con el blob descargado un PIN de seis dígitos son un millón
 * de pruebas fuera de línea.
 *
 * Responde **siempre 200 y siempre con 16 bytes**, exista el enlace o no. Un 404 sobre un enlace
 * inexistente, caducado o revocado convertiría una lista de identificadores en un mapa de qué
 * recortes siguen vivos, y de paso diría que esa persona compartió algo. Aquí todavía no hay PIN que
 * valorar, así que las cuatro situaciones tienen que ser indistinguibles.
 *
 * La ruta va sin sesión, sin CSRF y sin autenticación: quien la usa es un profesional sin cuenta.
 * Es `POST` y no `GET` para que el identificador del enlace no acabe en el historial de navegación
 * como una petición de recurso ni en ninguna caché intermedia.
 */
final readonly class ShareChallengeController
{
    public function __construct(private ShareLinkGate $gate) {}

    public function __invoke(string $link): JsonResponse
    {
        return response()->json([
            'pinSalt' => Base64Url::encode($this->gate->challenge($link)),
        ]);
    }
}
