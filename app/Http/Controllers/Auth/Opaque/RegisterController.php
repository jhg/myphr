<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth\Opaque;

use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * `GET /phr/register`: página de alta pública (ADR 0009).
 *
 * Se sirve sin ninguna consulta a base de datos, igual que {@see SetPasswordController}: aquí no hay
 * nada que validar todavía. El nombre, el login y el `registrationRequest` de OPAQUE viajan juntos
 * en el cuerpo de `registration/public/start`, que es el único sitio donde se comprueba si el correo
 * ya tiene cuenta.
 *
 * A diferencia del alta por invitación, esta pantalla sí revela que una cuenta existe cuando el
 * correo está tomado. Es una decisión consciente del ADR 0009: sin ese aviso, quien se equivoca de
 * correo no puede saber qué le ha pasado ni cómo seguir. Se mitiga con la limitación de intentos por
 * IP del endpoint, no aquí.
 */
final readonly class RegisterController
{
    public function __invoke(Request $request): Response
    {
        return response()->view('phr.auth.register');
    }
}
