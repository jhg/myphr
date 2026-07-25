<?php

declare(strict_types=1);

use App\Security\Opaque\OpaquePurpose;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Estado efímero de OPAQUE compartido por el alta, el login y el cambio de contraseña.
 *
 * Dos cambios, y ninguno es cosmético:
 *
 * 1. `purpose` en las dos tablas. Sin él, un handshake de login se canjearía por un ticket de
 *    cambio de contraseña, y un pendiente nacido en el cambio se colaría por `registration/finish`,
 *    que consumiría un enlace de alta y reescribiría `encrypted_settings`. Las filas anteriores
 *    toman el valor por defecto que les corresponde por la tabla en la que viven.
 * 2. `invitation_ref` pasa a ser nullable. Un cambio de contraseña no nace de ningún enlace de
 *    registro, y exigir uno obligaría a inventar una fila en `user_registration_links` que nadie
 *    ha emitido y que quedaría consumible por el alta.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('opaque_registrations', function (Blueprint $table): void {
            $table->string('purpose', 32)->default(OpaquePurpose::Registration->value);
        });

        Schema::table('opaque_login_handshakes', function (Blueprint $table): void {
            $table->string('purpose', 32)->default(OpaquePurpose::Login->value);
        });

        Schema::table('opaque_registrations', function (Blueprint $table): void {
            $table->uuid('invitation_ref')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('opaque_registrations', function (Blueprint $table): void {
            $table->dropColumn('purpose');
        });

        Schema::table('opaque_login_handshakes', function (Blueprint $table): void {
            $table->dropColumn('purpose');
        });
    }
};
