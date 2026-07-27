<?php

declare(strict_types=1);

namespace App\Sharing;

use App\Crypto\CanonicalDate;
use App\Models\Share;
use App\Models\ShareLink;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Puerta de lectura de un recorte compartido (ADR 0011).
 *
 * Es la pieza que corrigió el fallo crítico del diseño inicial. Aquel entregaba el paquete a
 * cualquiera que conociese el identificador y pedía el PIN después, en el cliente: con el blob
 * descargado, un PIN de seis dígitos son un millón de pruebas fuera de línea y no protege de nada,
 * y ningún KDF lento lo arregla, porque aguantar solo con coste exigiría 40 bits, que ya no es un
 * PIN.
 *
 * De ahí la regla que manda en todo este fichero: **no sale un solo byte del paquete ni del
 * envoltorio antes de que el PIN cuadre**. `challenge()` entrega únicamente la sal, que es pública
 * por construcción, y `open()` entrega el resto solo tras comparar el comprobante.
 *
 * El contador de intentos vive en columna y se consume con una escritura condicional atómica, la
 * misma forma de `RegistrationLinks::consume()`. No se usa `lockForUpdate()`: en SQLite es un no-op,
 * así que un contador apoyado en él pasaría los tests sin proteger nada. Y no se usa el
 * `RateLimiter` de Laravel, que vive en caché y al que un `cache:clear` operativo le devolvería a un
 * atacante el millón de intentos.
 *
 * Las cuatro causas de fallo —no existe, caducó, se revocó, PIN incorrecto— salen por el mismo
 * {@see InvalidShareLinkException}, sin variantes.
 */
final readonly class ShareLinkGate
{
    public function __construct(private DecoySalt $decoy) {}

    /**
     * Primer paso: entrega la sal con la que el cliente estira el PIN con Argon2id.
     *
     * Devuelve **siempre** 16 bytes, exista el enlace o no. Para un enlace vivo, su `pin_salt`; para
     * cualquier otra cosa, la señuelo determinista de {@see DecoySalt}. En este paso no hay PIN que
     * valorar todavía, así que inexistente, caducado y revocado tienen que ser indistinguibles de
     * vivo: si no lo fueran, una lista de identificadores se convertiría en un mapa de qué recortes
     * siguen abiertos.
     *
     * No consume intentos. Consumirlos aquí dejaría a cualquiera matar un enlace ajeno con cinco
     * peticiones sin conocer ni el PIN ni `S`.
     *
     * @param  string  $linkId  Identificador tal como llegó por la URL.
     * @return string 16 bytes binarios.
     */
    public function challenge(string $linkId): string
    {
        $link = $this->liveLink($linkId);

        if (! $link instanceof ShareLink) {
            return $this->decoy->for($linkId);
        }

        return (string) $link->pin_salt;
    }

    /**
     * Segundo paso: comprueba el PIN y, solo si cuadra, devuelve el envoltorio y el paquete.
     *
     * El orden de las operaciones es la parte que importa:
     *
     * 1. Se **consume un intento** con una escritura condicional atómica. Va primero, antes de mirar
     *    el comprobante, porque hacerlo al revés dejaría a dos peticiones simultáneas leer el mismo
     *    contador y gastar un solo intento entre las dos: bastarían diez hilos para convertir cinco
     *    intentos en cincuenta.
     * 2. Se compara el comprobante en tiempo constante con `hash_equals()`. Una comparación con `==`
     *    o un `where('pin_tag', ...)` en SQL filtran por tiempo cuántos bytes iniciales coincidían.
     * 3. Si no cuadra y era el último intento, la fila del enlace se borra. Se borra **solo el
     *    enlace**, nunca el paquete: la persona re-arma un enlace nuevo, con `S` y PIN nuevos, sin
     *    rehacer el recorte, que es para lo que existen las dos capas.
     * 4. Si cuadra, el contador vuelve a su tope y se marca el primer acceso.
     *
     * Lo que devuelve son las cuatro cosas que el lector necesita y no puede saber por sí solo: el
     * envoltorio, el paquete, el identificador del recorte y la caducidad del enlace. Los dos
     * últimos entran en los datos asociados de las dos capas, así que un servidor que mintiera en
     * cualquiera de ellos no engaña a nadie: el envoltorio deja de abrir y el error es visible
     * (ADR 0004). El instante de generación **no** sale de aquí porque el servidor no lo sabe: viaja
     * en el fragmento de la URL, que nunca le llega (ver `crypto/shareLink.js`).
     *
     * @param  string  $linkId  Identificador de la URL.
     * @param  string  $pinTag  Comprobante de 32 bytes calculado por el cliente.
     * @return array{wrapper: string, package: string, shareId: string, expiresAt: string}
     *
     * @throws InvalidShareLinkException Siempre que no se pueda servir, sea cual sea el motivo.
     */
    public function open(string $linkId, string $pinTag): array
    {
        if (! Str::isUuid($linkId) || strlen($pinTag) !== ShareLink::PIN_TAG_BYTES) {
            throw InvalidShareLinkException::generic();
        }

        $now = Carbon::now();

        /**
         * Escritura condicional: solo baja el contador si el enlace existe, no ha caducado y le
         * quedan intentos. El número de filas afectadas es la respuesta, y es atómico en el motor
         * sin necesidad de transacción ni de bloqueo.
         */
        $consumed = ShareLink::query()
            ->whereKey($linkId)
            ->where('attempts_remaining', '>', 0)
            ->where('expires_at', '>', $now)
            ->update(['attempts_remaining' => DB::raw('attempts_remaining - 1')]);

        if ($consumed !== 1) {
            throw InvalidShareLinkException::generic();
        }

        $link = ShareLink::query()->with('share')->whereKey($linkId)->first();

        /**
         * El paquete se comprueba aparte: un enlace vivo cuyo recorte ya caducó no debe servir nada,
         * y la caducidad se aplica en la consulta que sirve el blob, como
         * `RegistrationLinks::validate()`, para que la purga programada sea solo higiene.
         */
        $share = $link?->share;

        if (! $link instanceof ShareLink || ! $share instanceof Share || ! $share->expires_at->greaterThan($now)) {
            throw InvalidShareLinkException::generic();
        }

        if (! hash_equals((string) $link->pin_tag, $pinTag)) {
            if ($link->attempts_remaining <= 0) {
                ShareLink::query()->whereKey($linkId)->delete();
            }

            throw InvalidShareLinkException::generic();
        }

        $this->rearmAfterSuccess($link);
        $this->markFirstOpen($share, $now);

        return [
            'wrapper' => (string) $link->wrapper,
            'package' => (string) $share->payload,
            'shareId' => (string) $share->getKey(),
            'expiresAt' => CanonicalDate::format($link->expires_at),
        ];
    }

    /**
     * Enlace utilizable: existe, no caducó y su recorte tampoco.
     *
     * `Str::isUuid()` primero porque el identificador llega de una URL pública y la columna es de
     * tipo UUID: en PostgreSQL, consultar una cadena que no lo es revienta la consulta en lugar de
     * no devolver filas, y ese 500 sería otra forma de distinguir entradas.
     */
    private function liveLink(string $linkId): ?ShareLink
    {
        if (! Str::isUuid($linkId)) {
            return null;
        }

        $now = Carbon::now();

        return ShareLink::query()
            ->whereKey($linkId)
            ->where('expires_at', '>', $now)
            ->whereHas('share', fn ($query) => $query->where('expires_at', '>', $now))
            ->first();
    }

    /**
     * Un PIN correcto devuelve el contador a su tope.
     *
     * Sin esto, abrir cinco veces el mismo enlace con el PIN bueno lo mataría: el profesional que
     * recarga la pestaña, o que vuelve a mirarlo al día siguiente, se quedaría sin acceso sin haber
     * hecho nada mal. Los cinco intentos existen para acotar la fuerza bruta sobre el PIN, no para
     * racionar las lecturas legítimas.
     */
    private function rearmAfterSuccess(ShareLink $link): void
    {
        if ($link->attempts_remaining === ShareLink::MAX_ATTEMPTS) {
            return;
        }

        ShareLink::query()
            ->whereKey($link->getKey())
            ->update(['attempts_remaining' => ShareLink::MAX_ATTEMPTS]);
    }

    /**
     * Marca del **primer** acceso, redondeada a la hora y escrita una sola vez.
     *
     * La condición `whereNull` es la que garantiza el «una sola vez» sin leer antes: dos aperturas
     * simultáneas producen una única escritura. Redondear a la hora es deliberado: con marcas al
     * segundo, y sobre todo con un historial de accesos, el servidor sabría cuántas veces y cuándo
     * se consultó cada envío, que es el rastro que el ADR 0006 descarta.
     */
    private function markFirstOpen(Share $share, Carbon $now): void
    {
        Share::query()
            ->whereKey($share->getKey())
            ->whereNull('opened_at')
            ->update(['opened_at' => $now->clone()->startOfHour()]);
    }
}
