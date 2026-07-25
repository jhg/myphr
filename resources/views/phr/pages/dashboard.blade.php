{{--
    Panel de inicio (ADR 0002, ADR 0004, ADR 0006, ADR 0007, ADR 0008).

    Resumen de glucemia y tensión de la última semana y del último mes. Es la primera pantalla que
    ve la persona al entrar, y todo el cálculo ocurre en el navegador sobre eventos descifrados
    (`resources/js/health/dashboardPage.js`, que reutiliza `health/statistics.js`): el servidor nunca
    ve un valor clínico, así que aquí no hay ningún `wire:model` ni propiedad pública con datos.

    Estructura fija: otro agente escribe `phrDashboardPage` en Alpine contra este contrato, así que
    los `x-ref` y el nombre del componente no se tocan aquí.

    Sobre los islands (ADR 0002), con la verdad y no con la versión cómoda: esta pantalla **sí**
    hace peticiones de Livewire —`dashboardPage.js` llama a `await this.$wire.fetchEvents(...)` una
    vez por periodo— y **después** escribe en `$refs.glucose` y `$refs.bloodPressure`, que viven
    dentro de `@island(name: 'dashboard-glucose')` y `@island(name: 'dashboard-blood-pressure')`.
    Esa es exactamente la precondición que las tres pantallas con gráfica documentan como fatal para
    una región en island: el servidor reemite el island y el contenido que Alpine había escrito
    desaparece. Aquí no se ha reproducido —la petición la lanza `init()` desde el `<div>` de fuera,
    y lo que protege el contenido es el `wire:ignore` con `wire:key` estable de dentro, no el
    island—, pero la diferencia es de matiz, no de categoría.

    Si algún día el panel pierde sus tarjetas tras cargar, esto es lo primero que hay que mirar: la
    salida es quitar los `@island` y dejar `wire:ignore` + `wire:key`, como hacen los lienzos de las
    otras pantallas. La forma actual la fija `tests/Feature/DashboardPageTest.php`, que exige tres
    islands, así que cambiarla es cambiar también ese test, a conciencia.

    Estilo: MediCare+ (DESIGN.md), las mismas tarjetas que `glucose.blade.php`: superficie
    `bg-surface`, borde `border-border`, radio 8px, sombra Subtle, 24px de relleno.
--}}
{{--
    El contenido va envuelto en `<x-filament-panels::page>` por el mismo motivo que
    `glucose.blade.php`: esta página define su propia `$view`, y sin ese componente se pierde el
    contenedor `fi-page-header-main-ctn` de Filament (el `py-8` y la cabecera).
--}}
<x-filament-panels::page>
<div
    x-data="phrDashboardPage"
    wire:key="dashboard-page"
    class="space-y-6"
>
    {{--
        Avisos de carga: sobres que no abrieron, resumen recortado o un fallo al pedir datos. El
        contenido lo escribe Alpine a partir de lo descifrado, así que lleva las dos capas del
        ADR 0002 igual que las dos regiones de abajo: `@island` por fuera, `wire:ignore` con
        `wire:key` estable por dentro.
    --}}
    @island(name: 'dashboard-notice')
        <div wire:ignore x-ref="notice" wire:key="dashboard-notice-region"></div>
    @endisland

    {{--
        Card · DESIGN.md § Cards, con los mismos papeles que `glucose.blade.php`: `bg-surface`,
        `border-border`, `rounded-card` y `p-card` conmutan solos con el tema. Escrito con la rampa
        (`bg-white`, `border-gray-200`) la tarjeta saldría blanca en modo oscuro: `bg-white` no
        conmuta y `gray-200` es allí la tinta, no un borde (ver `theme.css`, § Ramp Mapping — Dark).
    --}}
    <section class="rounded-card border border-border bg-surface p-card shadow-sm">
        <h2 class="font-display text-subhead text-ink">
            {{ __('Blood glucose') }}
        </h2>

        @island(name: 'dashboard-glucose')
            <div wire:ignore x-ref="glucose" wire:key="dashboard-glucose-region" class="mt-4"></div>
        @endisland
    </section>

    <section class="rounded-card border border-border bg-surface p-card shadow-sm">
        <h2 class="font-display text-subhead text-ink">
            {{ __('Blood pressure') }}
        </h2>

        @island(name: 'dashboard-blood-pressure')
            <div wire:ignore x-ref="bloodPressure" wire:key="dashboard-bp-region" class="mt-4"></div>
        @endisland
    </section>
</div>
</x-filament-panels::page>
