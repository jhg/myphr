<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth\Opaque;

use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * `GET /phr/set-password`: página de establecimiento de contraseña (Spec 0001 §4.1 y §10).
 *
 * Se sirve **genérica**, sin token en el path y sin ninguna consulta a base de datos: el token viaja
 * en el fragmento de la URL (`#<token>`), que el navegador no envía nunca al servidor. Solo llega al
 * servidor dentro del cuerpo de `registration/start`, que es también el único sitio donde se valida.
 *
 * Consecuencia deliberada: esta página responde igual para un token válido, uno caducado, uno ya
 * consumido y uno inventado. El error de enlace no válido lo muestra el cliente cuando
 * `registration/start` devuelve su error genérico (§7).
 */
final readonly class SetPasswordController
{
    public function __invoke(Request $request): Response
    {
        return response()->view('phr.auth.set-password');
    }
}
