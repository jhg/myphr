<?php

declare(strict_types=1);

namespace App\Sharing;

use RuntimeException;

/**
 * Se alcanzó uno de los topes del ADR 0011: recortes activos por usuario, o enlaces vivos por
 * recorte.
 *
 * Los topes no son cosmética. Sin ellos, el endpoint que almacena el paquete es alojamiento anónimo
 * gratuito de hasta 4 MiB por petición para cualquiera con una cuenta, y el coste de almacenamiento
 * de una cuenta deja de estar acotado.
 *
 * Este error sí es explícito, al contrario que {@see InvalidShareLinkException}: lo recibe la propia
 * persona dueña de los datos, en su sesión, y necesita entender que tiene que revocar algo antes de
 * compartir otra vez. Aquí no hay nada que ocultarle a nadie.
 */
final class ShareLimitExceededException extends RuntimeException
{
    public const string CODE = 'share_limit_reached';

    public static function tooManyShares(int $limit): self
    {
        return new self("No se pueden tener más de {$limit} recortes activos a la vez.");
    }

    public static function tooManyLinks(int $limit): self
    {
        return new self("No se pueden tener más de {$limit} enlaces vivos sobre el mismo recorte.");
    }
}
