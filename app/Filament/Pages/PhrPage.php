<?php

declare(strict_types=1);

namespace App\Filament\Pages;

use Filament\Pages\Page;

/**
 * Página base de las pantallas propias del panel (Spec 0001 §9, «Propiedades en URL»).
 *
 * `Filament\Actions\Concerns\InteractsWithActions` trae seis propiedades marcadas `#[Url]` que
 * publican en la barra de direcciones la acción abierta y sus argumentos. En este proyecto el
 * argumento de una acción es, casi siempre, el identificador de un evento clínico: llevarlo a la
 * URL lo escribe en el historial del navegador, en el registro de acceso del proveedor y en el
 * `Referer` de cualquier recurso externo que la página cargue.
 *
 * Las seis se redeclaran aquí **en el cuerpo de la clase**, con el mismo nombre, la misma
 * visibilidad y el mismo valor por defecto, pero sin el atributo. Tiene que ser en el cuerpo de la
 * clase y no en un trait: un trait no sobrescribe una propiedad ya heredada, así que la declaración
 * original —y con ella el `#[Url]`— seguiría siendo la que ve la reflexión de Livewire.
 *
 * Redeclarar no cambia el comportamiento de las acciones: Livewire sigue rellenando las propiedades
 * desde la petición, solo deja de sincronizarlas con la barra de direcciones.
 *
 * `tests/Feature/PanelUrlPropertiesTest.php` falla si alguna vuelve a aparecer con el atributo en
 * cualquier página registrada en el panel.
 */
abstract class PhrPage extends Page
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
