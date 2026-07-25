<?php

declare(strict_types=1);

namespace App\Filament\Pages;

use Filament\Pages\Dashboard as BaseDashboard;

/**
 * Panel de inicio (Spec 0001 §9, «Propiedades en URL»).
 *
 * Sustituye a `Filament\Pages\Dashboard` únicamente para cerrar el mismo agujero que cierra
 * {@see PhrPage}: las seis propiedades `#[Url]` de `InteractsWithActions`. No puede heredar de
 * `PhrPage` porque su comportamiento (widgets, ruta `/`, título) vive en la clase de Filament, y
 * PHP obliga a que la redeclaración esté en el cuerpo de la clase que la quiere sin el atributo:
 * un trait compartido no sobrescribe una propiedad heredada.
 *
 * De ahí la duplicación literal de las seis líneas. Es deliberada y el test de arquitectura la
 * cubre: si alguien borra una, el test falla.
 */
final class Dashboard extends BaseDashboard
{
    /** @var mixed */
    public $defaultAction = null;

    /** @var mixed */
    public $defaultActionArguments = null;

    /** @var mixed */
    public $defaultActionContext = null;

    /** @var mixed */
    public $defaultTableAction = null;

    /** @var mixed */
    public $defaultTableActionRecord = null;

    /** @var mixed */
    public $defaultTableActionArguments = null;
}
