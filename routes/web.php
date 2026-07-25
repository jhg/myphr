<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Route;

/**
 * La raíz del sitio manda al panel, que es toda la aplicación.
 *
 * Antes servía `resources/views/welcome.blade.php`, la página de bienvenida de fábrica de Laravel:
 * texto en inglés sin `__()` —la única URL del proyecto sin traducir en ninguno de los tres
 * idiomas— y decenas de peldaños de rampa (`text-gray-900`, `bg-gray-200`, `text-white`) que
 * DESIGN.md prohíbe y que ensuciaban cualquier auditoría de tokens. No la enlazaba nada.
 *
 * Va al panel y no directamente a la pantalla de acceso: si hay sesión, Filament lleva al inicio, y
 * si no la hay, redirige él mismo a `/phr/login`. Así la decisión de a dónde va una visita sin
 * sesión vive en un solo sitio.
 */
Route::redirect('/', '/phr')->name('home');
