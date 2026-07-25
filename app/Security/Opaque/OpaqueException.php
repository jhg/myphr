<?php

declare(strict_types=1);

namespace App\Security\Opaque;

use RuntimeException;

/**
 * Excepción base de la implementación OPAQUE-3DH (RFC 9807).
 *
 * Todas las excepciones del subsistema derivan de esta, de modo que los
 * controladores puedan colapsarlas en una única respuesta pública
 * (`docs/OPAQUE.md` §18) sin dejar escapar un error no controlado.
 *
 * No es `final`: la jerarquía de §18 depende de la herencia.
 */
class OpaqueException extends RuntimeException {}
