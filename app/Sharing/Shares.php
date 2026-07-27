<?php

declare(strict_types=1);

namespace App\Sharing;

use App\Models\Share;
use App\Models\ShareLink;
use App\Models\User;
use App\Support\AuditEvent;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Alta, listado y revocación de recortes compartidos (ADR 0011), desde la sesión de quien es dueño
 * de los datos.
 *
 * Concentra aquí, y no en los controladores, tres cosas que no pueden vivir en dos sitios:
 *
 * * Los **topes**, porque un tope que solo esté en una de las dos vías de creación es un tope que no
 *   existe.
 * * El **rastro de actividad**, por el mismo motivo por el que `RegistrationLinks::issueFor()` lo
 *   emite dentro y no en quien llama.
 * * La regla de que **revocar es borrado físico**. Sin `SoftDeletes` y sin `deleted_at`: si revocar
 *   dejase la fila, el paquete seguiría en la base de datos y la promesa de que revocar cierra la
 *   lectura sería falsa.
 *
 * Lo que esta clase **no** hace, y conviene decirlo: no mira dentro de `payload` ni de `descriptor`.
 * No puede. Solo comprueba la forma de los sobres, cosa que ya hacen los guardarraíles de los
 * modelos, y las fechas.
 */
final readonly class Shares
{
    /**
     * Recortes activos —no caducados— por usuario.
     *
     * El ADR deja la cifra pendiente y aquí se fija de forma explícita. Veinte cubre con holgura el
     * caso real (un recorte por consulta, unas pocas al mes, caducando a las 24 horas) y acota el
     * peor caso de almacenamiento de una cuenta a veinte veces el escalón mayor.
     */
    public const int MAX_ACTIVE_SHARES = 20;

    /**
     * Enlaces vivos sobre el mismo recorte.
     *
     * Existen varios a propósito: uno por destinatario, cada uno con su PIN y su contador, y uno
     * nuevo cuando alguien quema los cinco intentos del anterior. Cinco es suficiente para ambos
     * usos y evita que re-armar en bucle infle la tabla.
     */
    public const int MAX_LINKS_PER_SHARE = 5;

    /**
     * Crea el recorte y su primer enlace en la misma transacción.
     *
     * Van juntos porque un recorte sin enlace no sirve para nada y un enlace sin recorte no puede
     * existir: dejar a medias cualquiera de los dos por un fallo de red produciría filas huérfanas
     * que nadie va a limpiar a mano.
     *
     * @param  array{id: string, payload: string, descriptor: string, expiresAt: Carbon}  $share
     * @param  array{id: string, pinSalt: string, pinTag: string, wrapper: string}  $link
     *
     * @throws ShareLimitExceededException Si la cuenta ya está en el tope de recortes activos.
     */
    public function create(User $user, array $share, array $link): Share
    {
        $this->assertBelowShareLimit($user);

        $created = DB::transaction(function () use ($user, $share, $link): Share {
            $record = Share::create([
                'id' => $share['id'],
                'user_id' => $user->id,
                'expires_at' => $share['expiresAt'],
                'payload' => $share['payload'],
                'descriptor' => $share['descriptor'],
            ]);

            $this->attachLink($record, $link);

            return $record;
        });

        /**
         * Se anota que hubo una compartición y cuándo, nunca de qué. El servidor ya sabe ambas
         * cosas: la fila existe y lleva fecha. Ni el rango, ni los tipos, ni el número de eventos
         * pueden entrar aquí, porque están cifrados y el rastro no es sitio para reintroducir el
         * metadato que el ADR 0006 quitó del esquema.
         *
         * El sujeto es el usuario y no el recorte, a propósito: el recorte se borra al revocarlo o
         * al purgarlo, y una entrada de auditoría apuntando a una fila que ya no existe no es un
         * rastro, es un identificador huérfano.
         */
        activity(AuditEvent::LOG_NAME)
            ->causedBy($user)
            ->performedOn($user)
            ->event(AuditEvent::ShareCreated->value)
            ->log(AuditEvent::ShareCreated->value);

        return $created;
    }

    /**
     * Re-arma un enlace sobre un recorte que ya existe, con `S` y PIN nuevos.
     *
     * Es la razón de ser de las dos capas: agotar los intentos borra la fila del enlace y no el
     * paquete, así que rehacer el acceso no obliga a recomponer ni a re-subir el recorte. Sigue
     * exigiendo la clave maestra en el navegador, porque `CK` vive dentro del descriptor cifrado.
     *
     * @param  array{id: string, pinSalt: string, pinTag: string, wrapper: string}  $link
     *
     * @throws ShareLimitExceededException Si el recorte ya está en su tope de enlaces vivos.
     */
    public function issueLink(Share $share, array $link): ShareLink
    {
        $live = $share->links()->where('expires_at', '>', Carbon::now())->count();

        if ($live >= self::MAX_LINKS_PER_SHARE) {
            throw ShareLimitExceededException::tooManyLinks(self::MAX_LINKS_PER_SHARE);
        }

        return $this->attachLink($share, $link);
    }

    /**
     * Recortes vivos de una persona, con sus enlaces vivos.
     *
     * Lo que devuelve es deliberadamente pobre: identificadores, fechas y el descriptor cifrado. La
     * pantalla de comparticiones activas se pinta descifrando ese descriptor en el navegador, que es
     * el único sitio donde existe la clave maestra.
     *
     * @return Collection<int, Share>
     */
    public function activeFor(User $user): Collection
    {
        $now = Carbon::now();

        return Share::query()
            ->where('user_id', $user->id)
            ->where('expires_at', '>', $now)
            ->with(['links' => fn ($query) => $query->where('expires_at', '>', $now)->orderBy('created_at')])
            ->orderByDesc('created_at')
            ->get();
    }

    /**
     * Revocación: borrado físico del recorte y, en cascada, de todos sus enlaces.
     *
     * Sin lápida y sin `SoftDeletes`, excepción consciente al patrón del ADR 0006. Lo que esto **no**
     * hace, y hay que decirlo sin adornos: no borra lo que la otra persona ya descargó. Una foto
     * fija entregada es suya para siempre; revocar solo impide lecturas futuras.
     */
    public function revoke(User $user, Share $share): void
    {
        $share->delete();

        activity(AuditEvent::LOG_NAME)
            ->causedBy($user)
            ->performedOn($user)
            ->event(AuditEvent::ShareRevoked->value)
            ->log(AuditEvent::ShareRevoked->value);
    }

    /**
     * @param  array{id: string, pinSalt: string, pinTag: string, wrapper: string}  $link
     */
    private function attachLink(Share $share, array $link): ShareLink
    {
        return ShareLink::create([
            'id' => $link['id'],
            'share_id' => $share->id,
            'pin_salt' => $link['pinSalt'],
            'pin_tag' => $link['pinTag'],
            'attempts_remaining' => ShareLink::MAX_ATTEMPTS,
            'wrapper' => $link['wrapper'],
            /**
             * El enlace hereda la caducidad del recorte. No puede vivir más que él —serviría un
             * paquete que ya no está— y hacerlo vivir menos exigiría una segunda fecha en la
             * derivación de `wrapKey` sin ganar nada.
             */
            'expires_at' => $share->expires_at,
        ]);
    }

    /**
     * @throws ShareLimitExceededException
     */
    private function assertBelowShareLimit(User $user): void
    {
        $active = Share::query()
            ->where('user_id', $user->id)
            ->where('expires_at', '>', Carbon::now())
            ->count();

        if ($active >= self::MAX_ACTIVE_SHARES) {
            throw ShareLimitExceededException::tooManyShares(self::MAX_ACTIVE_SHARES);
        }
    }
}
