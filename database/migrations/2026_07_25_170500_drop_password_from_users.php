<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec 0001 §3.1: authentication is zero-knowledge OPAQUE; the server never sees or derives a
 * password, so keeping a `password` column means keeping a place where somebody could end up writing
 * a hash by mistake or through a careless future migration. `User::getAuthPassword()`
 * (app/Models/User.php) already returned `''` unconditionally, so no guard depended on the real
 * value of the column; dropping it does not change authentication behaviour, it only removes attack
 * surface.
 *
 * `down()` does not restore a `not null` column: the `users` table never held a real password that
 * could be lost, so there is nothing to preserve beyond the shape of the column.
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
