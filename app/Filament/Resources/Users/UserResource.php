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
 * User management from the panel (Spec 0001 §10; ADR 0009).
 *
 * The listing only shows what the server can see: the name, stored in the clear as a deliberate and
 * bounded exception (ADR 0009 and Spec 0001 §3.1), the login, whether the OPAQUE registration is
 * complete, and the dates. There is no encrypted column, and there cannot be one: the server does
 * not have the key that would open it.
 *
 * Nowhere in this resource is there a password field. The master key is born in the person's browser
 * when they open their registration link (Spec 0001 §5), so all signup can ask for is a name and a
 * login.
 */
final class UserResource extends Resource
{
    protected static ?string $model = User::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedUsers;

    protected static ?string $recordTitleAttribute = 'name';

    /**
     * Resource disabled (ADR 0009): not in the navigation and not reachable by URL.
     *
     * The real gate is {@see UserPolicy}, whose permissions return `false`; this is the second turn
     * of the key, so that carelessly reopening the policy does not hang the section back on the menu
     * without anyone deciding it. The resource code is kept whole because the decision is about
     * scope, not quality: reopening it means touching these two pieces and nothing else.
     */
    protected static bool $shouldRegisterNavigation = false;

    public static function canAccess(): bool
    {
        return false;
    }

    /**
     * The labels are resolved by method and not as a static property because a property initializer
     * in PHP only accepts constant expressions, and `__()` cannot be called there. Fixed as strings,
     * the resource stayed in Spanish even when the panel was in another language.
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
     * Signup form: name and login, nothing else (ADR 0009).
     *
     * The login is normalized with {@see LoginNormalizer}, the single source of `normalize(login)`
     * (`docs/OPAQUE.md` §13.1.1): the string persisted here is the same one the credential
     * identifier will be derived from when that person completes their registration.
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
     * Reissuing a registration link (Spec 0001 §3.4; ADR 0009).
     *
     * It is the most destructive action in the interface and that is why the warning is the first
     * thing in the modal: completing a new registration retires the current master key envelope, and
     * anyone who remembered the previous password loses the ability to open their data. There is no
     * recovery at this stage.
     *
     * The guard that decides whether confirmation is needed is **not duplicated here**: the
     * confirmation field is always sent to {@see RegistrationLinks::issueFor()}, which is what
     * determines whether the account has access and whether what was typed is valid. Duplicating it
     * here would be the second copy Spec 0001 §3.4 explicitly forbids.
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
