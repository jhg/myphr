<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec 0001 §3.1: la autenticación es OPAQUE zero-knowledge; el servidor nunca ve ni deriva una
 * contraseña, así que guardar una columna `password` es guardar un sitio donde alguien podría acabar
 * escribiendo un hash por error o por una migración futura descuidada. `User::getAuthPassword()`
 * (app/Models/User.php) ya devolvía `''` de forma incondicional, así que ningún guard dependía del
 * valor real de la columna; borrarla no cambia el comportamiento de autenticación, solo quita
 * superficie de ataque.
 *
 * `down()` no restaura una columna `not null`: la tabla `users` nunca tuvo una contraseña real que
 * pudiera perderse, así que no hay nada que preservar salvo la forma de la columna.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->dropColumn('password');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->string('password')->nullable()->after('email_verified_at');
        });
    }
};
