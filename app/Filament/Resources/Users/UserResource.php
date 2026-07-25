<?php

declare(strict_types=1);

namespace App\Filament\Resources\Users;

use App\Filament\Resources\Users\Pages\ManageUsers;
use App\Models\User;
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

    protected static ?string $modelLabel = 'usuario';

    protected static ?string $pluralModelLabel = 'usuarios';

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
                    ->label('Nombre')
                    ->helperText('Se guarda en claro: lo usan el menú de usuario y este listado (ADR 0009).')
                    ->required()
                    ->maxLength(255),

                TextInput::make('email')
                    ->label('Login')
                    ->helperText('Queda fijo tras el registro: el identificador de credencial se deriva de él.')
                    ->email()
                    ->required()
                    ->maxLength(255)
                    ->dehydrateStateUsing(fn (?string $state): string => LoginNormalizer::normalize((string) $state))
                    ->rule(static fn (): Closure => static function (string $attribute, mixed $value, Closure $fail): void {
                        if (User::query()->where('email', LoginNormalizer::normalize((string) $value))->exists()) {
                            $fail('Ya existe una cuenta con ese login.');
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
                    ->label('Nombre')
                    ->searchable()
                    ->sortable(),

                TextColumn::make('email')
                    ->label('Login')
                    ->searchable()
                    ->sortable(),

                IconColumn::make('registered')
                    ->label('Registro OPAQUE')
                    ->boolean()
                    ->state(fn (User $record): bool => $record->hasCompletedOpaqueRegistration()),

                TextColumn::make('opaque_registered_at')
                    ->label('Registrado')
                    ->dateTime()
                    ->placeholder('Pendiente')
                    ->sortable(),

                TextColumn::make('created_at')
                    ->label('Alta')
                    ->dateTime()
                    ->sortable(),
            ])
            ->filters([
                TernaryFilter::make('registered')
                    ->label('Registro OPAQUE completo')
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
            ->label('Reemitir enlace')
            ->icon(Heroicon::OutlinedLink)
            ->color('danger')
            ->authorize('issueRegistrationLink')
            ->modalHeading('Reemitir el enlace de registro')
            ->modalSubmitActionLabel('Emitir el enlace')
            ->schema([
                Callout::make('Si esta cuenta ya tiene datos, la persona perderá el acceso a todo lo anterior.')
                    ->color('danger')
                    ->icon(Heroicon::OutlinedExclamationTriangle)
                    ->description(
                        'Su clave maestra estaba envuelta bajo la contraseña antigua. Al establecer una '
                        .'contraseña nueva se guarda un sobre nuevo y el anterior queda retirado: lo que había '
                        .'cifrado deja de poder abrirse. No hay recuperación.'
                    ),

                UnorderedList::make([
                    Text::make('El enlace sirve para establecer la contraseña inicial, no para recuperarla.'),
                    Text::make('Caduca en '.RegistrationLinks::TTL_HOURS.' horas y sirve una sola vez.'),
                    Text::make('La aplicación no lo envía por correo: se muestra una sola vez y lo entregas tú.'),
                ]),

                TextInput::make('confirmation')
                    ->label('Teclea el login de la cuenta para confirmar')
                    ->helperText('Solo hace falta si la cuenta ya tiene acceso.')
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
                        ->title('Falta la confirmación')
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
