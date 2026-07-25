<?php

declare(strict_types=1);

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

/**
 * Cabecera `phr-user-id` (Spec 0001 §6.2): el dato asociado del sobre AEAD de la clave maestra que
 * la recuperación tras un F5 necesita y que un login en la misma carga ya trae por su cuenta.
 */
it('el panel publica el identificador del usuario autenticado en la cabecera', function (): void {
    $user = User::factory()->registered()->create();

    $html = $this->actingAs($user)->get('/phr')->assertOk()->getContent();

    expect($html)->toContain('name="phr-user-id" content="'.$user->id.'"');
});

it('la pantalla de login no publica ningun identificador de usuario', function (): void {
    $html = $this->get('/phr/login')->assertOk()->getContent();

    expect($html)->not->toContain('phr-user-id');
});
