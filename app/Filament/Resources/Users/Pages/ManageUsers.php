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
 * The only page of the users resource (Spec 0001 §10; ADR 0009).
 *
 * Signup happens in two steps deliberately: the first asks for the name and the login, and the
 * second shows the link URL **once**. The plaintext token only exists in that response; in the
 * database only its `sha256` lives (Spec 0001 §3.3), so there is no way to show it again. The
 * application does not email it: the administrator delivers it through whatever channel they choose
 * (ADR 0009).
 */
final class ManageUsers extends ManageRecords
{
    protected static string $resource = UserResource::class;

    /**
     * The six `#[Url]` properties of `InteractsWithActions`, redeclared without the attribute
     * (Spec 0001 §9). It matters especially here: the argument of this page's action is the
     * registration link URL in the clear, and publishing it in the address bar would write it into
     * the browser history and into the provider's access log.
     *
     * It cannot be inherited from {@see PhrPage} because this class comes from `ManageRecords`, and
     * PHP requires the redeclaration to be in the class body: a trait does not override an already
     * inherited property.
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
                ->label(__('Enroll'))
                ->modalHeading(__('Enroll a new person'))
                ->modalDescription(__('No password is requested: the person chooses it in their browser when they open the link.'))
                ->modalSubmitActionLabel(__('Create and issue link'))
                ->createAnother(false)
                ->successNotificationTitle(__('Account created and link issued'))
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
     * Second step of signup and of reissue: the URL, once (ADR 0009).
     *
     * It is mounted with {@see InteractsWithActions::replaceMountedAction()}, which replaces the
     * previous modal without closing it. The URL travels as an argument of the action, never as a
     * `#[Url]` property: it does not appear in the address bar (Spec 0001 §9).
     */
    public function showRegistrationLinkAction(): Action
    {
        return Action::make('showRegistrationLink')
            ->label(__('Registration link'))
            ->modalHeading(__('Registration link'))
            ->modalDescription(__("It's shown only once. Copy it now."))
            ->modalIcon(Heroicon::OutlinedLink)
            ->modalWidth(Width::TwoExtraLarge)
            ->modalSubmitAction(false)
            ->modalCancelActionLabel(__("I've copied it"))
            ->schema(fn (array $arguments): array => [
                TextEntry::make('registrationUrl')
                    ->label(__('Link for :login', ['login' => $arguments['login'] ?? '']))
                    ->state((string) ($arguments['url'] ?? ''))
                    ->copyable()
                    ->copyMessage(__('Link copied'))
                    ->extraAttributes(['class' => 'break-all']),

                Callout::make(__('The token is not stored: it cannot be shown again.'))
                    ->color('warning')
                    ->icon(Heroicon::OutlinedExclamationTriangle),

                UnorderedList::make([
                    Text::make(__('Expires in :hours hours and can only be used once.', ['hours' => RegistrationLinks::TTL_HOURS])),
                    Text::make(__('The application never emails it: deliver it through whichever channel you choose.')),
                    Text::make(__('The part after "#" never reaches the server except inside the registration request.')),
                ]),
            ]);
    }
}
