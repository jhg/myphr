<?php

declare(strict_types=1);

namespace App\Http\Controllers\Settings;

use App\Crypto\EnvelopeValidator;
use App\Models\User;
use App\Support\SupportedLocale;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * `PUT /phr/settings` (ADR 0007): única vía de escritura del sobre de configuración.
 *
 * Hasta aquí `users.encrypted_settings` era de escritura única, y solo lo escribía el alta
 * (`RegistrationFinishController`). Este controlador la reabre para el resto de la vida de la
 * cuenta.
 *
 * `PUT` y no `PATCH` porque la escritura es **siempre** un reemplazo completo del documento: el
 * servidor no puede aplicar un parche sobre algo que no puede descifrar. El merge parcial ocurre en
 * el navegador antes de sellar (`resources/js/auth/settings.js`). Ser idempotente hace además que
 * reintentar tras un fallo de red sea seguro.
 *
 * **Lo único que se valida es la envoltura**, con el mismo `EnvelopeValidator` que el alta: prefijo
 * `v1.`, base64url canónico y uno de los tamaños de relleno. Nada del contenido, porque el servidor
 * no tiene la clave y cualquier comprobación adicional sería una afirmación insostenible. Un segundo
 * criterio de validez sería además un segundo sitio donde equivocarse.
 *
 * El usuario sale **siempre** de la sesión, nunca del cuerpo: no hay forma de escribir la
 * configuración de otra persona.
 *
 * `If-Match` no es opcional (ADR 0007, vía de escritura §2.4). El sobre es un documento único y dos
 * pestañas abiertas —el escenario normal de un panel— perderían una de las dos escrituras en
 * silencio, con el usuario descubriendo semanas después que su rango objetivo desapareció. El
 * servidor lo detecta sin descifrar nada: le basta comparar el texto cifrado almacenado con el que
 * el cliente creía vigente. Se acepta `*` únicamente cuando la cuenta todavía no tiene sobre.
 *
 * El único campo que viaja **fuera** del sobre es `locale`, opcional, que se escribe en claro en
 * `users.locale`: es la excepción consciente del ADR 0007, porque el servidor tiene que resolver el
 * idioma del panel antes de que exista ninguna clave. Se valida contra la lista cerrada de
 * `config('app.supported_locales')` y no participa en el `If-Match`, que protege el sobre.
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
         * El idioma se comprueba a mano y no con una regla de validación porque esta ruta responde
         * siempre JSON con un código propio: una `ValidationException` saldría como redirección,
         * igual que ya ocurre con el sobre.
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
         * Las dos columnas se escriben juntas y **después** de validar el sobre y la precondición,
         * para que un 412 o un 422 no dejen el idioma cambiado y los ajustes sin cambiar. Ninguna
         * está en `$fillable`, igual que en el alta.
         */
        $columns = ['encrypted_settings' => $data['encryptedSettings']];

        if (is_string($locale)) {
            $columns['locale'] = $locale;
        }

        $user->forceFill($columns)->save();

        return response()
            ->json(['saved' => true])
            ->header('ETag', $this->currentTag($data['encryptedSettings']))
            ->header('Vary', 'Cookie');
    }

    /**
     * Validador de precondición del sobre vigente: su sha256, o `*` si todavía no hay ninguno.
     *
     * Es un hash del **texto cifrado**, así que no dice nada del contenido ni exige guardar una
     * versión aparte que pudiera divergir de la columna.
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
