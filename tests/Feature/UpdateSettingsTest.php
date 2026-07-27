<?php

declare(strict_types=1);

use App\Http\Controllers\Settings\UpdateSettingsController;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;

uses(RefreshDatabase::class);

/**
 * The real route lives in `PhrPanelProvider::sessionRoutes()`, registered by another piece of work.
 * An equivalent one is mounted here (same controller, same authentication middleware) to test the
 * controller without depending on that registration.
 */
beforeEach(function (): void {
    Route::middleware('auth')->put('/test/phr/settings', UpdateSettingsController::class);
});

/** `If-Match` precondition for a user's current envelope. */
function ifMatchFor(?string $envelope): string
{
    return $envelope === null || $envelope === '' ? '*' : '"'.hash('sha256', $envelope).'"';
}

it('persists a well formed envelope and returns its tag', function (): void {
    $user = User::factory()->registered()->create(['encrypted_settings' => null]);
    $envelope = envelopeCipherText();

    $this->actingAs($user)
        ->putJson('/test/phr/settings', ['encryptedSettings' => $envelope], ['If-Match' => '*'])
        ->assertOk()
        ->assertJson(['saved' => true])
        ->assertHeader('ETag', ifMatchFor($envelope));

    expect($user->refresh()->encrypted_settings)->toBe($envelope);
});

/**
 * The server only validates the wrapper, but it validates it for real: an envelope the client could
 * never open is not stored, because it would replace the only one that does open.
 */
it('rejects a malformed envelope without writing anything', function (string $envelope): void {
    $original = envelopeCipherText();
    $user = User::factory()->registered()->create(['encrypted_settings' => $original]);

    $this->actingAs($user)
        ->putJson('/test/phr/settings', ['encryptedSettings' => $envelope], ['If-Match' => ifMatchFor($original)])
        ->assertStatus(422)
        ->assertJson(['error' => 'invalid_settings']);

    expect($user->refresh()->encrypted_settings)->toBe($original);
})->with([
    'sin prefijo v1.' => fn (): string => substr(envelopeCipherText(), 3),
    'non-canonical base64url' => fn (): string => 'v1.no-es-base64url!!',
    'size that is not a padding size' => fn (): string => 'v1.'.rtrim(strtr(base64_encode(random_bytes(48)), '+/', '-_'), '='),
]);

/**
 * The user comes from the session and never from the body: there is no field to point at another
 * row.
 */
it('never writes the settings of another user', function (): void {
    $other = User::factory()->registered()->create(['encrypted_settings' => $otherEnvelope = envelopeCipherText()]);
    $user = User::factory()->registered()->create(['encrypted_settings' => null]);

    $this->actingAs($user)
        ->putJson('/test/phr/settings', [
            'encryptedSettings' => $mine = envelopeCipherText(),
            'userId' => $other->id,
            'user_id' => $other->id,
        ], ['If-Match' => '*'])
        ->assertOk();

    expect($other->refresh()->encrypted_settings)->toBe($otherEnvelope)
        ->and($user->refresh()->encrypted_settings)->toBe($mine);
});

/** Two tabs: the second write must not silently overwrite the first. */
it('rejects a stale If-Match instead of losing the other write', function (): void {
    $user = User::factory()->registered()->create(['encrypted_settings' => envelopeCipherText()]);
    $stale = ifMatchFor(envelopeCipherText());

    $this->actingAs($user)
        ->putJson('/test/phr/settings', ['encryptedSettings' => envelopeCipherText()], ['If-Match' => $stale])
        ->assertStatus(412)
        ->assertJson(['error' => 'settings_conflict']);
});

it('requires the If-Match precondition', function (): void {
    $user = User::factory()->registered()->create(['encrypted_settings' => null]);

    $this->actingAs($user)
        ->putJson('/test/phr/settings', ['encryptedSettings' => envelopeCipherText()])
        ->assertStatus(428)
        ->assertJson(['error' => 'precondition_required']);

    expect($user->refresh()->encrypted_settings)->toBeNull();
});

/**
 * The language is the only field that travels outside the envelope, in the clear, in `users.locale`:
 * it is the deliberate exception in ADR 0007, because the server has to resolve it to paint the
 * panel and cannot read what is encrypted. Without this test, the language choice failing to persist
 * is a silent bug: the form answers 200 and the preference is lost.
 */
it('stores the language in the clear next to the encrypted envelope', function (): void {
    $user = User::factory()->registered()->create(['encrypted_settings' => null, 'locale' => null]);
    $envelope = envelopeCipherText();

    $this->actingAs($user)
        ->putJson(
            '/test/phr/settings',
            ['encryptedSettings' => $envelope, 'locale' => 'zh_CN'],
            ['If-Match' => '*'],
        )
        ->assertOk();

    expect($user->refresh()->locale)->toBe('zh_CN')
        ->and($user->encrypted_settings)->toBe($envelope);
});

/**
 * A closed list: the value ends up in `App::setLocale()` and picks a language file, so accepting any
 * string would leave the panel untranslated without saying why.
 */
it('rejects an unsupported language and writes nothing', function (): void {
    $user = User::factory()->registered()->create(['encrypted_settings' => null, 'locale' => 'es']);

    $this->actingAs($user)
        ->putJson(
            '/test/phr/settings',
            ['encryptedSettings' => envelopeCipherText(), 'locale' => 'klingon'],
            ['If-Match' => '*'],
        )
        ->assertUnprocessable();

    expect($user->refresh()->locale)->toBe('es')
        ->and($user->encrypted_settings)->toBeNull();
});

/**
 * The tests above mount an equivalent route to test the controller in isolation, so they do not see
 * the real route or its middleware stack. This one does: if the panel registration is lost or
 * changes method, the rest would stay green while the screen fails in the browser, which is exactly
 * what happened with the language.
 */
it('the real panel route stores the settings and the language', function (): void {
    $user = User::factory()->registered()->create(['encrypted_settings' => null, 'locale' => null]);
    $envelope = envelopeCipherText();

    $this->actingAs($user)
        ->putJson('/phr/settings', ['encryptedSettings' => $envelope, 'locale' => 'zh_CN'], ['If-Match' => '*'])
        ->assertOk();

    expect($user->refresh()->locale)->toBe('zh_CN')
        ->and($user->encrypted_settings)->toBe($envelope);
});
