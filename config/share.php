<?php

declare(strict_types=1);

/**
 * Configuración de la compartición de recortes (ADR 0011).
 *
 * Solo hay un secreto aquí, y es el de la **sal señuelo** del `challenge`. Cuando el enlace no
 * existe, caducó o se revocó, esa ruta devuelve igualmente una sal de 16 bytes derivada por HMAC de
 * esta clave sobre el `linkId`, para que un enlace muerto y uno vivo den respuestas indistinguibles.
 *
 * Tiene entrada propia, y no cuelga de `APP_KEY`, porque el ADR lo pide de forma expresa: `APP_KEY`
 * la rota cualquiera al reinstalar, y con ella cambiaría la sal señuelo de un `linkId` dado. Eso
 * volvería a distinguir enlaces muertos de vivos comparando dos despliegues, que es exactamente la
 * propiedad que la sal señuelo existe para dar.
 */
return [

    /**
     * Clave del HMAC de la sal señuelo, base64url de 32 bytes.
     *
     * Si falta, se usa `opaque.enumeration_key` (véase `App\Sharing\DecoySalt`), que cumple el mismo
     * papel en OPAQUE —hacer indistinguible lo que no existe— y es obligatoria en cualquier
     * instalación capaz de iniciar sesión. No hay valor por defecto: si tampoco está esa, el
     * `challenge` falla en voz alta en lugar de degradarse en silencio.
     */
    'decoy_salt_key' => env('SHARE_DECOY_SALT_KEY'),

];
