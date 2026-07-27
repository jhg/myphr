<?php

declare(strict_types=1);

namespace App\Filament\Pages;

use Filament\Pages\Page;

/**
 * Base page for the panel's own screens (Spec 0001 §9, "Properties in the URL").
 *
 * `Filament\Actions\Concerns\InteractsWithActions` brings six properties marked `#[Url]` that
 * publish the open action and its arguments in the address bar. In this project the argument of an
 * action is, almost always, the identifier of a clinical event: putting it in the URL writes it into
 * the browser history, into the provider's access log and into the `Referer` of any external
 * resource the page loads.
 *
 * All six are redeclared here **in the class body**, with the same name, the same visibility and the
 * same default value, but without the attribute. It has to be in the class body and not in a trait:
 * a trait does not override an already inherited property, so the original declaration —and with it
 * the `#[Url]`— would still be the one Livewire's reflection sees.
 *
 * Redeclaring does not change how actions behave: Livewire still fills the properties from the
 * request, it just stops syncing them with the address bar.
 *
 * `tests/Feature/PanelUrlPropertiesTest.php` fails if any of them shows up with the attribute again
 * on any page registered in the panel.
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
