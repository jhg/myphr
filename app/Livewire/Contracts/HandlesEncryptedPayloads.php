<?php

declare(strict_types=1);

namespace App\Livewire\Contracts;

use App\Livewire\Hooks\EncryptedPayloadGuardHook;

/**
 * Interfaz marcadora (Spec 0001 §9; ADR 0002): un componente Livewire que maneja datos cifrados la
 * implementa para que {@see EncryptedPayloadGuardHook} vigile sus propiedades
 * públicas.
 *
 * Es una interfaz vacía a propósito: el guardarraíl no necesita ningún método del componente, solo
 * saber que pertenece a esta categoría. Es la opción más simple para "aplicar solo a los componentes
 * que manejen datos cifrados" que pide la spec, sin que esta concrete el mecanismo.
 */
interface HandlesEncryptedPayloads {}
