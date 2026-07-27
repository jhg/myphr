<?php

declare(strict_types=1);

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

/**
 * The `phr-user-id` header (Spec 0001 §6.2): the associated data of the master key AEAD envelope
 * that recovery after a page refresh needs and that a login in the same load already brings itself.
 */
it('the panel publishes the authenticated user identifier in the head', function (): void {
    $user = User::factory()->registered()->create();

    $html = $this->actingAs($user)->get('/phr')->assertOk()->getContent();

    expect($html)->toContain('name="phr-user-id" content="'.$user->id.'"');
});

it('the login screen publishes no user identifier', function (): void {
    $html = $this->get('/phr/login')->assertOk()->getContent();

    expect($html)->not->toContain('phr-user-id');
});
