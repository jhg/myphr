<?php

declare(strict_types=1);

namespace App\Filament\Resources\Users;

use App\Filament\Resources\Users\Pages\ManageUsers;
use App\Models\User;
use App\Policies\UserPolicy;
use App\Provisioning\RegistrationLinkReissueRequiresConfirmationException;
use App\Provisioning\RegistrationLinks;
use App\Security\Opaque\LoginNormalizer;
use BackedEnum;
use Closure;
use Filament\Actions\Action;
use Filament\Forms\Components\TextInput;
use Filament\Notifications\Notification;
use Filament\Resources\Resource;
use Filament\Schemas\Components\Callout;
use Filament\Schemas\Components\Text;
use Filament\Schemas\Components\UnorderedList;
use Filament\Schemas\Schema;
use Filament\Support\Exceptions\Halt;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\TernaryFilter;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;

/**
 * Gestión de usuarios desde el panel (Spec 0001 §10; ADR 0009).
 *
 * El listado solo muestra lo que el servidor puede ver: el nombre, que se guarda en claro como
 * excepción consciente y acotada (ADR 0009 y Spec 0001 §3.1), el login, si el registro OPAQUE está
 * completo y las fechas. No hay ninguna columna cifrada, ni la puede haber: el servidor no tiene la
 * clave que la abriría.
 *
 * En ningún punto de este recurso hay un campo de contraseña. La clave maestra nace en el navegador
 * de la persona al abrir su enlace de registro (Spec 0001 §5), así que lo único que el alta puede
 * pedir es nombre y login.
 */
final class UserResource extends Resource
{
    protected static ?string $model = User::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedUsers;

    protected static ?string $recordTitleAttribute = 'name';

    /**
     * Recurso desactivado (ADR 0009): ni en la navegación ni accesible por URL.
     *
     * La puerta de verdad es {@see UserPolicy}, cuyos permisos devuelven `false`; esto
     * es la segunda vuelta de llave, para que reabrir la política por descuido no vuelva a colgar el
     * apartado del menú sin que nadie lo decida. El código del recurso se conserva entero porque la
     * decisión es de alcance, no de calidad: reabrirlo es tocar estas dos piezas y nada más.
     */
    protected static bool $shouldRegisterNavigation = false;

    public static function canAccess(): bool
    {
        return false;
    }

    /**
     * Las etiquetas se resuelven por método y no como propiedad estática porque un inicializador de
     * propiedad en PHP solo admite expresiones constantes, y `__()` no puede llamarse ahí. Fijadas
     * como cadena, el recurso seguía en castellano aunque el panel estuviera en otro idioma.
     */
    public static function getModelLabel(): string
    {
        return __('user');
    }

    public static function getPluralModelLabel(): string
    {
        return __('users');
    }

    /**
     * Formulario del alta: nombre y login, nada más (ADR 0009).
     *
     * El login se normaliza con {@see LoginNormalizer}, la única fuente de `normalize(login)`
     * (`docs/OPAQUE.md` §13.1.1): la cadena que se persiste aquí es la misma de la que se derivará
     * el identificador de credencial cuando esa persona complete su registro.
     */
    public static function form(Schema $schema): Schema
    {
        return $schema
            ->components([
                TextInput::make('name')
                    ->label(__('Name'))
                    ->helperText(__('Stored in plain text: used by the user menu and this list.'))
                    ->required()
                    ->maxLength(255),

                TextInput::make('email')
                    ->label(__('Login'))
                    ->helperText(__('Fixed once registration is complete: the credential identifier is derived from it.'))
                    ->email()
                    ->required()
                    ->maxLength(255)
                    ->dehydrateStateUsing(fn (?string $state): string => LoginNormalizer::normalize((string) $state))
                    ->rule(static fn (): Closure => static function (string $attribute, mixed $value, Closure $fail): void {
                        if (User::query()->where('email', LoginNormalizer::normalize((string) $value))->exists()) {
                            $fail(__('An account with that login already exists.'));
                        }
                    }),
            ]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->recordTitleAttribute('name')
            ->defaultSort('created_at', 'desc')
            ->columns([
                TextColumn::make('name')
                    ->label(__('Name'))
                    ->searchable()
                    ->sortable(),

                TextColumn::make('email')
                    ->label(__('Login'))
                    ->searchable()
                    ->sortable(),

                IconColumn::make('registered')
                    ->label(__('OPAQUE registration'))
                    ->boolean()
                    ->state(fn (User $record): bool => $record->hasCompletedOpaqueRegistration()),

                TextColumn::make('opaque_registered_at')
                    ->label(__('Registered'))
                    ->dateTime()
                    ->placeholder(__('Pending'))
                    ->sortable(),

                TextColumn::make('created_at')
                    ->label(__('Created'))
                    ->dateTime()
                    ->sortable(),
            ])
            ->filters([
                TernaryFilter::make('registered')
                    ->label(__('OPAQUE registration complete'))
                    ->queries(
                        true: fn (Builder $query): Builder => $query->whereNotNull('opaque_registered_at'),
                        false: fn (Builder $query): Builder => $query->whereNull('opaque_registered_at'),
                        blank: fn (Builder $query): Builder => $query,
                    ),
            ])
            ->recordActions([
                self::issueRegistrationLinkAction(),
            ])
            ->toolbarActions([]);
    }

    /**
     * Reemisión de enlace de registro (Spec 0001 §3.4; ADR 0009).
     *
     * Es la acción más destructiva de la interfaz y por eso el aviso es lo primero del modal:
     * completar un registro nuevo retira el sobre vigente de la clave maestra, y quien recordase la
     * contraseña anterior deja de poder abrir sus datos. No hay recuperación en esta fase.
     *
     * La guardia que decide si hace falta confirmación **no se replica aquí**: el campo de
     * confirmación se envía siempre a {@see RegistrationLinks::issueFor()}, que es quien determina si
     * la cuenta tiene acceso y si lo tecleado vale. Duplicarla aquí sería la segunda copia que la
     * Spec 0001 §3.4 prohíbe expresamente.
     */
    public static function issueRegistrationLinkAction(): Action
    {
        return Action::make('issueRegistrationLink')
            ->label(__('Reissue link'))
            ->icon(Heroicon::OutlinedLink)
            ->color('danger')
            ->authorize('issueRegistrationLink')
            ->modalHeading(__('Reissue the registration link'))
            ->modalSubmitActionLabel(__('Issue the link'))
            ->schema([
                Callout::make(__('If this account already holds data, the person will lose access to everything already stored.'))
                    ->color('danger')
                    ->icon(Heroicon::OutlinedExclamationTriangle)
                    ->description(
                        __('Their master key was wrapped under the old password. Setting a new password stores a new envelope and retires the previous one: whatever it protected can no longer be opened. There is no recovery.')
                    ),

                UnorderedList::make([
                    Text::make(__('The link is for setting the initial password, not for recovering it.')),
                    Text::make(__('Expires in :hours hours and can only be used once.', ['hours' => RegistrationLinks::TTL_HOURS])),
                    Text::make(__('The application does not email it: it is shown once and you deliver it yourself.')),
                ]),

                TextInput::make('confirmation')
                    ->label(__('Type the account login to confirm'))
                    ->helperText(__('Only needed if the account already has access.'))
                    ->autocomplete(false),
            ])
            ->action(function (User $record, array $data, ManageUsers $livewire, RegistrationLinks $links): void {
                /** @var string|null $confirmation */
                $confirmation = $data['confirmation'] ?? null;

                /** @var User|null $issuedBy */
                $issuedBy = auth()->user();

                try {
                    $url = $links->issueFor($record, $issuedBy, $confirmation);
                } catch (RegistrationLinkReissueRequiresConfirmationException $exception) {
                    Notification::make()
                        ->danger()
                        ->title(__('Confirmation required'))
                        ->body($exception->getMessage())
                        ->send();

                    throw new Halt;
                }

                $livewire->replaceMountedAction('showRegistrationLink', [
                    'url' => $url,
                    'login' => (string) $record->email,
                ]);
            });
    }

    /**
     * @return array<string, mixed>
     */
    public static function getPages(): array
    {
        return [
            'index' => ManageUsers::route('/'),
        ];
    }
}
