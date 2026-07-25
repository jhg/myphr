<?php

declare(strict_types=1);

namespace App\Filament\Resources\Users\Pages;

use App\Filament\Pages\PhrPage;
use App\Filament\Resources\Users\UserResource;
use App\Models\User;
use App\Provisioning\RegistrationLinks;
use Filament\Actions\Action;
use Filament\Actions\Concerns\InteractsWithActions;
use Filament\Actions\CreateAction;
use Filament\Infolists\Components\TextEntry;
use Filament\Resources\Pages\ManageRecords;
use Filament\Schemas\Components\Callout;
use Filament\Schemas\Components\Text;
use Filament\Schemas\Components\UnorderedList;
use Filament\Support\Enums\Width;
use Filament\Support\Icons\Heroicon;

/**
 * Única página del recurso de usuarios (Spec 0001 §10; ADR 0009).
 *
 * El alta ocurre en dos pasos deliberadamente: el primero pide nombre y login, y el segundo muestra
 * la URL del enlace **una sola vez**. El token en claro solo existe en esa respuesta; en base de
 * datos vive únicamente su `sha256` (Spec 0001 §3.3), así que no hay forma de volver a mostrarlo.
 * La aplicación no lo envía por correo: el administrador lo entrega por el canal que elija
 * (ADR 0009).
 */
final class ManageUsers extends ManageRecords
{
    protected static string $resource = UserResource::class;

    /**
     * Las seis propiedades `#[Url]` de `InteractsWithActions`, redeclaradas sin el atributo
     * (Spec 0001 §9). Aquí importa especialmente: el argumento de la acción de esta página es la
     * URL del enlace de registro en claro, y publicarla en la barra de direcciones la escribiría en
     * el historial del navegador y en el registro de acceso del proveedor.
     *
     * No puede heredarlo de {@see PhrPage} porque esta clase viene de
     * `ManageRecords`, y PHP exige que la redeclaración esté en el cuerpo de la clase: un trait no
     * sobrescribe una propiedad ya heredada.
     *
     * @var mixed
     */
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

    /**
     * @return array<Action>
     */
    protected function getHeaderActions(): array
    {
        return [
            CreateAction::make()
                ->label('Dar de alta')
                ->modalHeading('Dar de alta a una persona')
                ->modalDescription('No se pide contraseña: la elige la persona en su navegador al abrir el enlace.')
                ->modalSubmitActionLabel('Crear y emitir enlace')
                ->createAnother(false)
                ->successNotificationTitle('Cuenta creada y enlace emitido')
                ->after(function (User $record, RegistrationLinks $links): void {
                    /** @var User|null $issuedBy */
                    $issuedBy = auth()->user();

                    $url = $links->issueFor($record, $issuedBy);

                    $this->replaceMountedAction('showRegistrationLink', [
                        'url' => $url,
                        'login' => (string) $record->email,
                    ]);
                }),
        ];
    }

    /**
     * Segundo paso del alta y de la reemisión: la URL, una sola vez (ADR 0009).
     *
     * Se monta con {@see InteractsWithActions::replaceMountedAction()},
     * que sustituye el modal anterior sin cerrarlo. La URL viaja como argumento de la acción, nunca
     * como propiedad `#[Url]`: no aparece en la barra de direcciones (Spec 0001 §9).
     */
    public function showRegistrationLinkAction(): Action
    {
        return Action::make('showRegistrationLink')
            ->label('Enlace de registro')
            ->modalHeading('Enlace de registro')
            ->modalDescription('Se muestra una sola vez. Cópialo ahora.')
            ->modalIcon(Heroicon::OutlinedLink)
            ->modalWidth(Width::TwoExtraLarge)
            ->modalSubmitAction(false)
            ->modalCancelActionLabel('Ya lo he copiado')
            ->schema(fn (array $arguments): array => [
                TextEntry::make('registrationUrl')
                    ->label('Enlace para '.($arguments['login'] ?? ''))
                    ->state((string) ($arguments['url'] ?? ''))
                    ->copyable()
                    ->copyMessage('Enlace copiado')
                    ->extraAttributes(['class' => 'break-all']),

                Callout::make('El token no se guarda: no se puede volver a mostrar.')
                    ->color('warning')
                    ->icon(Heroicon::OutlinedExclamationTriangle),

                UnorderedList::make([
                    Text::make('Caduca en '.RegistrationLinks::TTL_HOURS.' horas y sirve una sola vez.'),
                    Text::make('La aplicación nunca lo envía por correo: hazlo llegar por el canal que elijas.'),
                    Text::make('La parte tras «#» no viaja al servidor salvo dentro de la petición de registro.'),
                ]),
            ]);
    }
}
