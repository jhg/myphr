<?php

declare(strict_types=1);

use App\Filament\Pages\PhrPage;
use Filament\Panel;
use Livewire\Attributes\Url;

/**
 * Guardarraíl de Spec 0001 §9, «Propiedades en URL».
 *
 * `InteractsWithActions` publica en la barra de direcciones la acción abierta de Filament y sus
 * argumentos. En este proyecto el argumento de una acción es casi siempre el identificador de un
 * evento clínico, y una URL acaba en el historial del navegador, en el registro de acceso del
 * proveedor y en el `Referer` de cualquier recurso externo.
 *
 * {@see PhrPage} las redeclara sin el atributo. Este test falla si alguna vuelve a aparecer con él
 * en cualquier página registrada en el panel, incluidas las que vengan de Filament o de un paquete.
 */

/** Las seis de §9, por nombre. */
const URL_PUBLISHED_PROPERTIES = [
    'defaultAction',
    'defaultActionArguments',
    'defaultActionContext',
    'defaultTableAction',
    'defaultTableActionRecord',
    'defaultTableActionArguments',
];

/**
 * Toda clase que el panel monta como pantalla: sus páginas, las páginas de sus recursos y la
 * pantalla de login.
 *
 * @return array<int, class-string>
 */
function phrPanelPageClasses(): array
{
    /** @var Panel $panel */
    $panel = filament()->getPanel('phr');

    $classes = $panel->getPages();

    $loginRouteAction = $panel->getLoginRouteAction();

    if (is_string($loginRouteAction) && class_exists($loginRouteAction)) {
        $classes[] = $loginRouteAction;
    }

    foreach ($panel->getResources() as $resource) {
        $classes = [...$classes, ...array_values($resource::getPages())];
    }

    return array_values(array_unique(array_filter(
        array_map(
            static fn (mixed $page): ?string => match (true) {
                is_string($page) && class_exists($page) => $page,
                is_object($page) && method_exists($page, 'getPage') => $page->getPage(),
                default => null,
            },
            $classes,
        ),
    )));
}

it('registers at least one page in the panel', function (): void {
    expect(phrPanelPageClasses())->not->toBeEmpty();
});

it('never publishes an action or its arguments in the address bar', function (): void {
    $offenders = [];

    foreach (phrPanelPageClasses() as $page) {
        $reflection = new ReflectionClass($page);

        foreach (URL_PUBLISHED_PROPERTIES as $property) {
            if (! $reflection->hasProperty($property)) {
                continue;
            }

            if ($reflection->getProperty($property)->getAttributes(Url::class) !== []) {
                $offenders[] = "{$page}::\${$property}";
            }
        }
    }

    expect($offenders)->toBe([], implode(', ', $offenders)
        .' still carry #[Url]. Redeclare them in the class body, as App\Filament\Pages\PhrPage does.');
});

it('keeps the six properties redeclared on the base page', function (): void {
    $reflection = new ReflectionClass(PhrPage::class);

    foreach (URL_PUBLISHED_PROPERTIES as $property) {
        expect($reflection->getProperty($property)->getDeclaringClass()->getName())
            ->toBe(PhrPage::class);
    }
});
