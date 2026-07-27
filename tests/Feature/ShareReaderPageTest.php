<?php

declare(strict_types=1);

use App\Models\Share;
use App\Models\ShareLink;
use App\Models\User;
use App\Security\Opaque\Base64Url;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;

uses(RefreshDatabase::class);

/**
 * ADR 0011: la página que abre el profesional. Lo que estos tests vigilan no es cómo se ve, sino lo
 * que **no** sale por ella: nada de la cuenta del paciente, nada que distinga un enlace vivo de uno
 * muerto y ninguna cookie.
 */
beforeEach(function (): void {
    config()->set('share.decoy_salt_key', Base64Url::encode(str_repeat("\x2a", 32)));
});

it('sirve la página del lector sin sesión y sin cookies', function (): void {
    $response = $this->get('/s/'.Str::uuid());

    $response->assertOk()
        ->assertHeader('Cache-Control', 'no-store, private')
        ->assertHeader('Referrer-Policy', 'no-referrer');

    /**
     * Ni una cookie. Una cookie de sesión aquí sería un identificador estable de un profesional en
     * su consulta, correlacionable entre los recortes de dos pacientes distintos.
     */
    expect($response->headers->getCookies())->toBeEmpty();
});

/**
 * La respuesta es la misma para un enlace vivo, uno caducado, uno revocado y uno que nunca existió.
 * Si la página dijera «este enlace ya no está disponible», una lista de identificadores se
 * convertiría en un mapa de qué recortes siguen abiertos, y de paso diría que esa persona compartió
 * algo. La respuesta genérica única empieza en esta página, no en el `challenge`.
 */
it('responde igual para un enlace vivo, uno caducado y uno inexistente', function (): void {
    $live = ShareLink::factory()->create();
    $expired = ShareLink::factory()->expired()->create();

    /**
     * Se compara el `<body>` y no el documento entero porque el ayudante de fuentes de
     * laravel-vite-plugin emite las precargas una sola vez por proceso, y esa diferencia es del
     * banco de pruebas y no de esta página.
     */
    $bodies = collect([$live->id, $expired->id, (string) Str::uuid()])
        ->map(function (string $link): string {
            $content = $this->get('/s/'.$link)->assertOk()->getContent();

            return str_replace($link, 'LINK', substr($content, (int) strpos($content, '<body')));
        });

    expect($bodies->unique())->toHaveCount(1);
});

/** Ni una consulta a la base de datos: la página no mira si el enlace existe. */
it('no consulta la base de datos para pintar la página', function (): void {
    $queries = 0;

    DB::listen(function () use (&$queries): void {
        $queries++;
    });

    $this->get('/s/'.Str::uuid())->assertOk();

    expect($queries)->toBe(0);
});

/**
 * Nada de la cuenta del paciente sale por aquí: ni su nombre, ni su correo, ni su idioma, ni cuántos
 * recortes tiene. El servidor los conoce y esta página no los pinta.
 */
it('no filtra nada de la cuenta del paciente', function (): void {
    $user = User::factory()->registered()->create(['locale' => 'zh_CN']);
    $share = Share::factory()->for($user)->create();
    $link = ShareLink::factory()->for($share)->create();

    $content = $this->withHeader('Accept-Language', 'es')->get('/s/'.$link->id)->getContent();

    expect($content)->not->toContain($user->email)
        ->and($content)->not->toContain($user->id)
        ->and($content)->not->toContain($share->id)
        ->and($content)->not->toContain($share->payload)
        ->and($content)->not->toContain($share->descriptor)
        ->and($content)->not->toContain($link->wrapper)
        /** El idioma de la cuenta es columna en claro (ADR 0007) y no tiene por qué salir de casa. */
        ->and($content)->toContain('lang="es"');
});

/**
 * Ni la sal ni el comprobante del PIN pueden viajar en la cáscara: con ellos en la página, el ataque
 * fuera de línea contra un PIN de seis dígitos vuelve, que es el fallo que este diseño corrigió.
 */
it('no publica la sal ni el comprobante del PIN', function (): void {
    $link = ShareLink::factory()->create();
    $content = $this->get('/s/'.$link->id)->getContent();

    expect($content)->not->toContain(Base64Url::encode((string) $link->pin_salt))
        ->and($content)->not->toContain(Base64Url::encode((string) $link->pin_tag));
});

it('se pinta en el idioma del profesional, negociado por Accept-Language', function (string $header, string $tag): void {
    $this->withHeader('Accept-Language', $header)
        ->get('/s/'.Str::uuid())
        ->assertOk()
        ->assertSee('lang="'.$tag.'"', false);
})->with([
    'castellano' => ['es-ES,es;q=0.9', 'es'],
    'chino' => ['zh-CN,zh;q=0.9', 'zh-CN'],
    'inglés' => ['en-GB,en;q=0.8', 'en'],
    'idioma no soportado' => ['fr-FR,fr;q=0.9', 'en'],
]);

/**
 * El catálogo trae los tres idiomas dentro para que el selector de la página cambie de idioma sin
 * pedir nada al servidor: una segunda petición sería una petición más que ata a ese lector con ese
 * enlace, y una cookie de preferencia sería justo la cookie que esta ruta se quita de encima.
 */
it('publica el vocabulario clínico en los tres idiomas y el término LOINC sin traducir', function (): void {
    $content = $this->get('/s/'.Str::uuid())->getContent();
    $catalog = json_decode(
        html_entity_decode((string) preg_replace(
            '/.*<script type="application\/json" data-phr-reader-catalog>(.*?)<\/script>.*/s',
            '$1',
            $content,
        ), ENT_QUOTES),
        true,
    );

    expect(array_keys($catalog['labels']))->toBe(['en', 'es', 'zh_CN'])
        ->and($catalog['labels']['es']['types']['glucose'])->toBe('Glucemia')
        ->and($catalog['labels']['zh_CN']['types']['glucose'])->not->toBe('Glucemia')
        /** El término oficial LOINC no se traduce (ADR 0005): va una sola vez y en inglés. */
        ->and($catalog['loinc']['41653-7'])->toBe('Glucose [Mass/volume] in Capillary blood by Glucometer')
        /** Los códigos UCUM son notación de intercambio, no algo que se le pida leer a nadie. */
        ->and($catalog['units']['Cel'])->toBe('°C');
});

/**
 * `open` devuelve, además del envoltorio y el paquete, las dos piezas de los datos asociados que el
 * lector no lleva consigo. Las dos van dentro del AEAD, así que un servidor que mintiera en
 * cualquiera de ellas no engaña a nadie: el envoltorio deja de abrir. El instante de generación no
 * está aquí a propósito: viaja en el fragmento de la URL, que el servidor nunca ve.
 */
it('devuelve el identificador del recorte y la caducidad junto al paquete', function (): void {
    $tag = random_bytes(ShareLink::PIN_TAG_BYTES);
    $link = ShareLink::factory()->create(['pin_tag' => $tag]);

    $body = json_decode(
        $this->postJson("/s/{$link->id}/open", ['pinTag' => Base64Url::encode($tag)])
            ->assertOk()
            ->getContent(),
        true,
    );

    expect($body['shareId'])->toBe($link->share_id)
        ->and($body['expiresAt'])->toBe($link->expires_at->format('Y-m-d\TH:i:s.u\Z'))
        ->and($body)->not->toHaveKey('generatedAt');
});
