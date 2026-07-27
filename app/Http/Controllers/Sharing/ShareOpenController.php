<?php

declare(strict_types=1);

namespace App\Http\Controllers\Sharing;

use App\Models\ShareLink;
use App\Security\Opaque\Base64Url;
use App\Security\Opaque\InvalidMessageException;
use App\Sharing\InvalidShareLinkException;
use App\Sharing\ShareLinkGate;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * `POST /s/{link}/open` (ADR 0011): segundo paso de la lectura.
 *
 * Recibe el `pinTag` y, **solo si cuadra**, devuelve el envoltorio y el paquete en la misma
 * respuesta, más el identificador del recorte y la caducidad del enlace, que son las dos piezas de
 * los datos asociados que el lector no lleva consigo. Ninguna de las dos es una concesión: van
 * dentro del AEAD de las dos capas, así que un valor falso no abre nada. El instante de generación,
 * que también entra en el dato asociado del paquete, no está aquí porque el servidor no lo tiene:
 * viaja en el fragmento de la URL, que nunca le llega. Antes de eso no sale nada, y esa es la corrección del fallo crítico del diseño inicial:
 * el PIN se verifica en línea, con un contador de cinco intentos en columna, y no fuera de línea
 * contra un blob que el servidor ya entregó.
 *
 * Las cuatro causas de fallo —no existe, caducó, se revocó, PIN incorrecto— salen por la **misma
 * respuesta genérica**, con el mismo código HTTP y el mismo cuerpo. No se devuelven los intentos
 * restantes: serían un oráculo que distingue un enlace vivo de uno que nunca existió, y obligarían
 * además a inventar un contador estable para los identificadores inexistentes. El precio es real y
 * conviene decirlo: quien se equivoca de dedo no sabe cuántos intentos le quedan, y el caso
 * mayoritario es justamente ese. La pantalla del lector puede explicar que hay un número limitado de
 * intentos sin necesidad de que el servidor los cuente en voz alta.
 *
 * Cabeceras: `Cache-Control: no-store` (lo pone el middleware `NoStore`),
 * `Content-Type: application/octet-stream`, y **sin** `ETag`, `Last-Modified` ni
 * `Content-Disposition` descriptivo. El nombre de un fichero adjunto es metadato clínico, y un
 * validador de caché sobre este cuerpo permitiría a un intermediario saber si el paquete cambió. La
 * ruta se excluye además de cualquier CDN.
 *
 * Aquí no se registra ni IP ni agente de usuario, coherente con la exclusión deliberada de ambos en
 * `AuditEvent`: la IP de quien descarga revela el centro sanitario y de ahí el diagnóstico. Tampoco
 * hay entrada de auditoría por descarga.
 */
final readonly class ShareOpenController
{
    public function __construct(private ShareLinkGate $gate) {}

    public function __invoke(Request $request, string $link): Response
    {
        try {
            $opened = $this->gate->open($link, $this->pinTag($request));
        } catch (InvalidShareLinkException) {
            return $this->generic();
        }

        return $this->octetStream($opened, 200);
    }

    /**
     * El comprobante llega en base64url y se decodifica aquí. Una codificación inválida es una causa
     * de fallo más y sale por el mismo sitio que las otras cuatro: devolver un error de validación
     * distinguible daría un oráculo gratis.
     */
    private function pinTag(Request $request): string
    {
        $value = $request->input('pinTag');

        if (! is_string($value)) {
            return '';
        }

        try {
            return Base64Url::decodeExactly($value, ShareLink::PIN_TAG_BYTES, 'pin tag');
        } catch (InvalidMessageException) {
            return '';
        }
    }

    private function generic(): Response
    {
        return $this->octetStream(['error' => InvalidShareLinkException::CODE], 403);
    }

    /**
     * @param  array<string, string>  $body
     */
    private function octetStream(array $body, int $status): Response
    {
        return response((string) json_encode($body), $status, [
            'Content-Type' => 'application/octet-stream',
        ]);
    }
}
