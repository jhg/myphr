<?php

declare(strict_types=1);

namespace App\Filament\Pages;

use App\Sharing\ReaderCatalog;
use App\Sharing\Shares;
use App\Sharing\ShareTtl;
use BackedEnum;
use Filament\Support\Icons\Heroicon;
use Illuminate\Contracts\Support\Htmlable;

/**
 * Pantalla desde la que se comparte un recorte del historial con un profesional (ADR 0011).
 *
 * Esta clase no ve nada de lo que se comparte, y no puede: el recorte se arma, se comprime y se
 * cifra entero en el navegador, y sube por `POST /phr/shares`, un endpoint HTTP propio que no pasa
 * por Livewire. Aquí solo se publican tres cosas en claro, que son públicas por naturaleza: la lista
 * cerrada de caducidades, los tipos clínicos que se pueden elegir con su etiqueta traducida, y las
 * URL a las que el cliente tiene que llamar.
 *
 * **Por qué hereda de {@see HealthEventPage}** y no directamente de {@see PhrPage}: para leer los
 * eventos que van a formar el recorte, el cliente usa `fetchEvents`, el mismo método y el mismo
 * criterio de fecha canónica que las seis pantallas de historial. Una segunda vía de lectura sería
 * un segundo sitio donde equivocarse con el rango semiabierto `[from, to)` y con la autorización, y
 * el que acabaría desviándose es justo el que casi nadie mira. `storeEvent` viene de propina y no
 * añade superficie: cualquier pantalla de eventos del panel ya lo expone para el mismo usuario.
 *
 * **Por qué el paquete no sube por Livewire**: lleva prefijo `s1.`, y los dos guardarraíles del
 * ADR 0002 (`livewirePayloadGuard.js` y `EncryptedPayloadGuardHook`) abortan cualquier cadena de
 * más de 256 caracteres que no empiece por `v1.`. No se tocan; se usa la vía que el propio ADR 0002
 * reserva para los blobs grandes.
 */
final class Sharing extends HealthEventPage
{
    protected static string|BackedEnum|null $navigationIcon = Heroicon::Share;

    protected string $view = 'phr.pages.sharing';

    /**
     * Al final del menú, después de las pantallas de registro.
     *
     * Compartir no es una tarea diaria como apuntar una glucemia: se hace antes de una consulta,
     * unas pocas veces al mes. Ponerla arriba la pondría en el camino de quien solo quiere anotar
     * una lectura, y es la única pantalla del panel cuyo botón manda datos fuera.
     */
    protected static ?int $navigationSort = 10;

    /**
     * El título y la etiqueta de navegación se resuelven por método y no como propiedad estática
     * porque un inicializador de propiedad en PHP solo admite expresiones constantes: `__()` no
     * puede llamarse ahí.
     */
    public function getTitle(): string|Htmlable
    {
        return __('Share with a professional');
    }

    public static function getNavigationLabel(): string
    {
        return __('Share');
    }

    /**
     * Tokens de los tipos clínicos que se pueden compartir.
     *
     * Son los valores del campo `type` que va **dentro** del sobre de cada evento (ADR 0006), así
     * que el servidor no los usa para nada: no puede filtrar por tipo y no lo intenta. Se publican
     * solo para pintar las casillas con su etiqueta traducida. La lista tiene que coincidir con
     * `SHAREABLE_TYPES` de `resources/js/health/sharePage.js`, que es quien filtra de verdad, y
     * `tests/Feature/SharingPageTest.php` falla si dejan de coincidir: una casilla de un tipo que el
     * cliente no reconoce produce recortes a los que les falta ese tipo sin que nadie se entere.
     *
     * El orden es el mismo del menú del panel, no alfabético: quien busca «tensión» la busca donde
     * la ve todos los días.
     *
     * @var list<string>
     */
    public const array SHAREABLE_TYPES = [
        'glucose',
        'bloodPressure',
        'insulin',
        'meal',
        'bodyWeight',
        'temperature',
    ];

    /**
     * Catálogo público en claro que el cliente necesita para pintar la pantalla y para cifrar.
     *
     * Nada de lo que sale de aquí depende del usuario: son los mismos tipos, las mismas caducidades
     * y las mismas URL para cualquiera. Lo único que cambia es el idioma de las etiquetas, que sale
     * del que ya está en vigor para esta petición.
     *
     * `readerUrlTemplate` lleva `{link}` sin rellenar y se construye con `route()` en vez de
     * concatenar un prefijo a mano: el prefijo público de la página del lector es una decisión de
     * superficie que puede cambiar, y el día que cambie tiene que cambiar en un único sitio.
     *
     * @return array{
     *     types: list<array{token: string, label: string}>,
     *     ttls: list<array{token: string, hours: int, label: string}>,
     *     defaultTtl: string,
     *     endpoints: array{shares: string},
     *     readerUrlTemplate: string,
     *     limits: array{shares: int, links: int},
     *     readerCatalog: array<string, mixed>,
     * }
     */
    public function catalog(): array
    {
        return [
            'types' => array_map(
                static fn (string $token): array => ['token' => $token, 'label' => self::typeLabel($token)],
                self::SHAREABLE_TYPES,
            ),
            'ttls' => array_map(
                static fn (ShareTtl $ttl): array => [
                    'token' => $ttl->value,
                    'hours' => $ttl->hours(),
                    'label' => self::ttlLabel($ttl),
                ],
                ShareTtl::cases(),
            ),
            /** 24 horas, el valor por defecto del ADR 0011. */
            'defaultTtl' => ShareTtl::Day->value,
            'endpoints' => [
                'shares' => route('filament.phr.shares.index'),
            ],
            'readerUrlTemplate' => self::readerUrlTemplate(),
            'limits' => [
                'shares' => Shares::MAX_ACTIVE_SHARES,
                'links' => Shares::MAX_LINKS_PER_SHARE,
            ],
            /**
             * El mismo vocabulario que recibe la página del lector, para que la vista previa se pinte
             * con las mismas palabras y los mismos términos LOINC que verá el profesional. Es dato
             * público de referencia (ADR 0005): no depende de ninguna cuenta y no dice nada de lo que
             * hay dentro del recorte. Va en esta misma respuesta y no en una petición aparte porque
             * la vista previa no puede añadir ni una llamada al servidor: todo lo que enseña ya está
             * descifrado en el navegador.
             */
            'readerCatalog' => (new ReaderCatalog)->toArray(),
        ];
    }

    /**
     * URL de la página del lector con `{link}` por rellenar.
     *
     * Se genera con un identificador de relleno y se sustituye después, en vez de pasar `{link}`
     * directamente a `route()`: el generador de URL de Laravel trata las llaves como el hueco del
     * parámetro y responde «falta el parámetro link». El relleno es un UUIDv4 con la forma exacta
     * que tendrá el de verdad, para que no se cuele una ruta con restricción de formato.
     */
    private static function readerUrlTemplate(): string
    {
        $placeholder = '00000000-0000-4000-8000-000000000000';

        return str_replace($placeholder, '{link}', route('share.reader', ['link' => $placeholder]));
    }

    /**
     * Etiqueta de un tipo clínico, la misma palabra que usa el menú del panel para esa pantalla:
     * quien elige «Glucemia» aquí tiene que reconocer la pantalla donde la apunta.
     */
    private static function typeLabel(string $token): string
    {
        return match ($token) {
            'glucose' => __('Blood glucose'),
            'bloodPressure' => __('Blood pressure'),
            'insulin' => __('Insulin'),
            'meal' => __('Meals'),
            'bodyWeight' => __('Body weight'),
            'temperature' => __('Temperature'),
            default => $token,
        };
    }

    /**
     * Etiqueta de una caducidad. Se dice en tiempo («1 hora») y no en fecha, porque el TTL se
     * elige antes de generar y la fecha exacta todavía no existe; la fecha se enseña después, con
     * el enlace ya creado.
     */
    private static function ttlLabel(ShareTtl $ttl): string
    {
        return match ($ttl) {
            ShareTtl::Hour => __('1 hour (in-person use)'),
            ShareTtl::Day => __('24 hours'),
            ShareTtl::Week => __('7 days'),
        };
    }
}
