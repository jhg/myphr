<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * Configuración del servidor ausente, corrupta o fuera de rango
 * (`docs/OPAQUE.md` §18, §12.2).
 *
 * Es un fallo de despliegue o de uso interno de la biblioteca, no un error
 * atribuible a una entrada remota: debe abortar el arranque en lugar de
 * traducirse a una respuesta de autenticación.
 */
final class InvalidConfigurationException extends OpaqueException {}
