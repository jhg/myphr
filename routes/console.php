<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

/**
 * Spec 0001 §3.2, §11: purga programada de handshakes de login y registros OPAQUE pendientes
 * caducados, y de enlaces de registro caducados o consumidos con cierta antigüedad. Frecuencia alta
 * (diez minutos) porque el TTL del handshake es de solo 180 segundos (`docs/OPAQUE.md` §14.3): sin
 * purga, cada intento de login sin autenticar hace crecer la tabla sin límite.
 */
Schedule::command('opaque:prune-handshakes')->everyTenMinutes();
