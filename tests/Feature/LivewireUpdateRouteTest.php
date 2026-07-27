<?php

declare(strict_types=1);

use App\Providers\AppServiceProvider;
use Symfony\Component\Process\Process;

/**
 * The Livewire update endpoint has to stay inside `/phr` **and** the browser has to be told so.
 *
 * These two things used to be one: the route was declared in `routes/web.php`, so nobody noticed
 * that route files do not run when the routes are cached. The deploy runs `php artisan optimize`, so
 * in production `Livewire::setUpdateRoute()` was never called and Livewire advertised its own default
 * path (`/livewire-<hash>/update`) in `data-update-uri`, while at the same time rejecting that path
 * with a bare 404 because a custom route existed in the compiled table. Every Livewire call — the
 * `$wire.fetchEvents` of the six history screens and of the sharing screen among them — got a 404
 * that never reached application code, so it left nothing in the log either.
 *
 * The route now lives in {@see AppServiceProvider}, which boots on every request. The
 * cached case is exercised for real, in a subprocess, because it cannot be reproduced in-process:
 * the whole point is what happens when the application boots with a compiled route table.
 */
it('advertises the panel update endpoint to the browser', function (): void {
    $html = $this->get('/phr/login')->assertOk()->getContent();

    expect($html)->toContain('data-update-uri="'.route('phr.livewire.update').'"');
});

it('keeps the panel update endpoint when the routes are cached', function (): void {
    /**
     * `APP_ROUTES_CACHE` moves the compiled table to a scratch file, so running this test never
     * leaves a route cache behind in `bootstrap/cache/` for the next command a developer types.
     */
    $cachePath = tempnam(sys_get_temp_dir(), 'phr-routes-').'.php';

    try {
        artisanInSubprocess(['route:cache'], $cachePath);

        $uri = artisanInSubprocess(
            ['tinker', '--execute', 'echo app("livewire")->getUpdateUri();'],
            $cachePath,
        );

        expect(trim($uri))->toBe('/phr/livewire/update');
    } finally {
        @unlink($cachePath);
    }
});

/**
 * Runs an Artisan command in a fresh process with the route cache pointed at `$cachePath`.
 *
 * @param  list<string>  $command
 */
function artisanInSubprocess(array $command, string $cachePath): string
{
    $process = new Process(
        [PHP_BINARY, 'artisan', ...$command],
        base_path(),
        ['APP_ROUTES_CACHE' => $cachePath],
        null,
        120,
    );

    $process->run();

    expect($process->getExitCode())->toBe(0, $process->getErrorOutput());

    return $process->getOutput();
}
