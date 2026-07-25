<?php

use App\Http\Middleware\NoStore;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        /**
         * `NoStore` tiene que envolver a todo lo demás en las rutas donde está montado (Spec 0001
         * §4). Sin prioridad explícita, el ordenador de middleware sube `Authenticate` por delante
         * de él y la respuesta de una sesión caducada, que nace de una excepción, sale sin la
         * cabecera.
         */
        $middleware->prependToPriorityList(
            before: EncryptCookies::class,
            prepend: NoStore::class,
        );
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        /**
         * Las rutas de autenticación del panel (`/phr/auth/*`, Spec 0001 §4) son un contrato JSON:
         * su cliente es un módulo ES, no un formulario. Sin esta condición, un error de validación
         * o una sesión caducada responderían con una redirección HTML y el navegador no sabría
         * distinguir un 401 de un 200.
         */
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->is('phr/auth/*'),
        );
    })->create();
