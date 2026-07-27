<?php

declare(strict_types=1);

namespace App\Http\Controllers\Sharing;

use App\Models\ShareLink;
use App\Sharing\ReaderCatalog;
use App\Support\SupportedLocale;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\App;

/**
 * `GET /s/{link}` (ADR 0011): la página del profesional.
 *
 * Vive fuera del panel a propósito. Todo lo que se monta bajo `phr` pasa por `PhrPanelProvider`, que
 * Filament envuelve con el grupo `web` y por tanto con sesión y CSRF, incluidas sus rutas sin
 * autenticar. Esta página no debe llevar cookie de sesión, ni Livewire, ni Filament, ni gráficas: se
 * abre en un dispositivo ajeno y cuanto menos lleve, menos deja detrás.
 *
 * El servidor no pinta **nada** del contenido: manda una cáscara y el trabajo lo hace el cliente,
 * que lee `S` de `location.hash` —el fragmento no viaja al servidor— y descifra en el navegador. El
 * identificador del enlace se pasa a la vista porque es lo único que el servidor sí ve, y ya lo ve
 * por estar en la URL.
 *
 * **Esta respuesta es la misma para todos los enlaces.** No se consulta la base de datos: ni para
 * saber si el enlace existe, ni si caducó, ni de quién es. Una página que dijera «este enlace ya no
 * está disponible» antes de pedir el PIN convertiría una lista de identificadores en un mapa de qué
 * recortes siguen vivos, y de paso diría que esa persona compartió algo. La respuesta genérica única
 * empieza aquí, no en el `challenge`.
 *
 * **Y no lleva nada de la cuenta del paciente**: ni su nombre, ni su correo, ni cuántos recortes
 * tiene. La vista solo recibe el identificador del enlace, el vocabulario público de
 * {@see ReaderCatalog} y dos números que son constantes del código.
 *
 * Se pinta en el `Accept-Language` del profesional y nunca en el idioma de la persona propietaria,
 * que es columna en claro por el ADR 0007 y no tiene por qué salir de casa. Por eso esta ruta no
 * lleva el middleware `SetLocale`, que resuelve el idioma de la cuenta, y por eso aquí se negocia a
 * mano contra la cabecera y solo contra la cabecera.
 */
final readonly class ShareReaderPageController
{
    public function __invoke(Request $request, string $link): View
    {
        /**
         * `negotiate()` y no `forRequest()`: el segundo mira primero `users.locale`, y aquí no hay
         * usuario que mirar ni debe haberlo. Fijar el idioma de la petición además de pasarlo a la
         * vista es lo que hace que `__()` y el `<html lang>` digan lo mismo.
         */
        $locale = SupportedLocale::negotiate($request->header('Accept-Language'));

        App::setLocale($locale);

        return view('share.reader', [
            'linkId' => $link,
            'locale' => $locale,
            'catalog' => (new ReaderCatalog)->toArray(),
            /**
             * El tope de intentos se publica para que la pantalla pueda decir cuántos quedan. Es una
             * constante del código, igual para todos los enlaces, y no una lectura del contador de
             * este enlace: el contador real no sale nunca del servidor, porque distinguiría un
             * enlace vivo de uno que nunca existió. Lo que la pantalla cuenta son los intentos
             * hechos **desde este navegador**, y lo dice con esas palabras.
             */
            'maxAttempts' => ShareLink::MAX_ATTEMPTS,
        ]);
    }
}
