<?php

declare(strict_types=1);

use App\Filament\Pages\PhrPage;
use Filament\Panel;
use Livewire\Attributes\Url;

/**
 * Guardrail from Spec 0001 §9, "Properties in the URL".
 *
 * `InteractsWithActions` publishes the open Filament action and its arguments in the address bar. In
 * this project the argument of an action is almost always the identifier of a clinical event, and a
 * URL ends up in the browser history, in the provider's access log and in the `Referer` of any
 * external resource.
 *
 * {@see PhrPage} redeclares them without the attribute. This test fails if any of them shows up with
 * it again on any page registered in the panel, including those coming from Filament or a package.
 */

/** The six from §9, by name. */
const URL_PUBLISHED_PROPERTIES = [
    'defaultAction',
    'defaultActionArguments',
    'defaultActionContext',
    'defaultTableAction',
    'defaultTableActionRecord',
    'defaultTableActionArguments',
];

/**
 * Every class the panel mounts as a screen: its pages, its resource pages and the login screen.
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
