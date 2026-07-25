<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ADR 0007: el idioma de la interfaz es la excepción consciente al sobre cifrado y vive en claro.
 *
 * Filament resuelve en servidor el menú, las migas, el título y la pantalla de acceso, que se pinta
 * antes de que exista ninguna clave, así que una preferencia guardada dentro del sobre no se podría
 * leer nunca en el momento en que hace falta.
 *
 * `NULL` significa «no lo he elegido»: entonces se negocia con `Accept-Language`, que el navegador
 * ya manda en todas las peticiones. Solo se guarda un valor cuando la persona lo elige en su perfil.
 * La lista cerrada (`config('app.supported_locales')`) se valida en la aplicación y no con un CHECK,
 * porque añadir un idioma es un cambio de código, no una migración.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->string('locale', 16)->nullable()->after('email_verified_at');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->dropColumn('locale');
        });
    }
};
