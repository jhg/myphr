<?php

declare(strict_types=1);

namespace App\Http\Controllers\Settings;

use App\Crypto\EnvelopeValidator;
use App\Models\User;
use App\Support\AuditEvent;
use App\Support\SupportedLocale;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * `PUT /phr/settings` (ADR 0007): the only write path for the settings envelope.
 *
 * Until now `users.encrypted_settings` was write-once, and only signup wrote it
 * (`RegistrationFinishController`). This controller reopens it for the rest of the account's life.
 *
 * `PUT` and not `PATCH` because the write is **always** a full replacement of the document: the
 * server cannot apply a patch to something it cannot decrypt. The partial merge happens in the
 * browser before sealing (`resources/js/auth/settings.js`). Being idempotent also makes retrying
 * after a network failure safe.
 *
 * **The only thing validated is the wrapper**, with the same `EnvelopeValidator` as signup: the
 * `v1.` prefix, canonical base64url and one of the padding sizes. Nothing about the content, because
 * the server has no key and any further check would be an untenable claim. A second validity
 * criterion would also be a second place to get it wrong.
 *
 * The user **always** comes from the session, never from the body: there is no way to write somebody
 * else's settings.
 *
 * `If-Match` is not optional (ADR 0007, write path §2.4). The envelope is a single document and two
 * open tabs —the normal scenario in a panel— would silently lose one of the two writes, with the
 * user finding out weeks later that their target range disappeared. The server detects it without
 * decrypting anything: comparing the stored ciphertext with the one the client believed current is
 * enough. `*` is accepted only when the account has no envelope yet.
 *
 * The only field that travels **outside** the envelope is `locale`, optional, which is written in
 * the clear into `users.locale`: it is the deliberate exception in ADR 0007, because the server has
 * to resolve the panel language before any key exists. It is validated against the closed list in
 * `config('app.supported_locales')` and takes no part in the `If-Match`, which protects the
 * envelope.
 */
final readonly class UpdateSettingsController
{
    public function __invoke(Request $request): JsonResponse
    {
        $user = $request->user();

        if (! $user instanceof User) {
            return response()->json(['error' => 'unauthenticated'], 401);
        }

        $data = $request->validate([
            'encryptedSettings' => ['required', 'string', 'max:8192'],
        ]);

        /**
         * The language is checked by hand and not with a validation rule because this route always
         * answers JSON with a code of its own: a `ValidationException` would come out as a redirect,
         * as already happens with the envelope.
         */
        $locale = $request->input('locale');

        if ($locale !== null && ! SupportedLocale::isSupported(is_string($locale) ? $locale : null)) {
            return $this->error('invalid_locale', 422);
        }

        if (! EnvelopeValidator::isValid($data['encryptedSettings'])) {
            return $this->error('invalid_settings', 422);
        }

        $ifMatch = $request->header('If-Match');

        if (! is_string($ifMatch) || $ifMatch === '') {
            return $this->error('precondition_required', 428);
        }

        if (! hash_equals($this->currentTag($user->encrypted_settings), $ifMatch)) {
            return $this->error('settings_conflict', 412);
        }

        /**
         * Both columns are written together and **after** validating the envelope and the
         * precondition, so a 412 or a 422 does not leave the language changed and the settings
         * unchanged. Neither is in `$fillable`, same as at signup.
         */
        $columns = ['encrypted_settings' => $data['encryptedSettings']];

        if (is_string($locale)) {
            $columns['locale'] = $locale;
        }

        $user->forceFill($columns)->save();

        /**
         * We record that the settings changed, never which ones: the envelope is opaque and the
         * language, even though it is in the clear in the column, is a preference of the person that
         * the trail does not need to repeat to do its job.
         */
        activity(AuditEvent::LOG_NAME)
            ->causedBy($user)
            ->performedOn($user)
            ->event(AuditEvent::SettingsUpdated->value)
            ->log(AuditEvent::SettingsUpdated->value);

        return response()
            ->json(['saved' => true])
            ->header('ETag', $this->currentTag($data['encryptedSettings']))
            ->header('Vary', 'Cookie');
    }

    /**
     * Precondition validator for the current envelope: its sha256, or `*` if there is none yet.
     *
     * It is a hash of the **ciphertext**, so it says nothing about the content and requires no
     * separate version that could drift from the column.
     */
    private function currentTag(?string $envelope): string
    {
        return $envelope === null || $envelope === ''
            ? '*'
            : '"'.hash('sha256', $envelope).'"';
    }

    private function error(string $code, int $status): JsonResponse
    {
        return response()->json(['error' => $code], $status);
    }
}
