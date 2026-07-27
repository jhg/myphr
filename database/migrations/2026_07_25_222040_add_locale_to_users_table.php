<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ADR 0007: the interface language is the deliberate exception to the encrypted envelope and lives
 * in the clear.
 *
 * Filament resolves the menu, the breadcrumbs, the title and the login screen on the server, and the
 * login screen is painted before any key exists, so a preference stored inside the envelope could
 * never be read at the moment it is needed.
 *
 * `NULL` means "I have not chosen": in that case we negotiate with `Accept-Language`, which the
 * browser already sends on every request. A value is only stored when the person picks one in their
 * profile. The closed list (`config('app.supported_locales')`) is validated in the application and
 * not with a CHECK, because adding a language is a code change, not a migration.
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
