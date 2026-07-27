<?php

declare(strict_types=1);

use App\Security\Opaque\OpaquePurpose;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Ephemeral OPAQUE state shared by signup, login and password change.
 *
 * Two changes, and neither is cosmetic:
 *
 * 1. `purpose` on both tables. Without it, a login handshake could be traded for a password change
 *    ticket, and a pending row born in a password change would slip through `registration/finish`,
 *    which would consume a signup link and rewrite `encrypted_settings`. Existing rows take the
 *    default value that matches the table they live in.
 * 2. `invitation_ref` becomes nullable. A password change does not come from any registration link,
 *    and requiring one would force us to invent a row in `user_registration_links` that nobody
 *    issued and that signup could then consume.
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
